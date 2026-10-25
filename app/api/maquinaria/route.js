// /api/maquinaria — Máquinas de la empresa y su plan de mantenimiento
// (Mantenimiento, parte 33; ítem 43; migración 132).
//
// POST { accion, ... } (gerencia y Administración)
//   maquina_guardar → alta o edición; el código va en mayúsculas y es uno por
//                     empresa. En el alta, con_plantilla carga las tareas de
//                     la plantilla de su tipo (se cuentan desde hoy).
//   maquina_baja    → dar de baja o reactivar (no se borra: tiene historial)
//   horas_guardar   → lectura del horómetro (no puede bajar)
//   tarea_guardar   → con id edita una tarea; sin id la agrega
//   tarea_borrar    → la saca del plan (queda inactiva con su historial)
//   registro_crear  → una tarea hecha, con su checklist: revisa que estén
//                     todos los puntos, nota en los que no están bien y la
//                     confirmación de seguridad; pone la tarea al día y
//                     actualiza las horas de la máquina.
// La lectura va por /api/data (maquinas, maquina_tareas y maquina_registros,
// solo lectura). Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { maquinariaBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { normalizarCodigo, puedeEditarMaquinaria, tareasDePlantilla, tipoMaquina } from "../../lib/maquinaria";
import { contarEstados } from "../../lib/checklistVehiculo";
import { logger } from "../../lib/logger";

function faltaMigracion(err) {
  const m = String(err?.message);
  return /maquinas|maquina_tareas|maquina_registros/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}

const noEncontrado = (que) => NextResponse.json({ error: `No encontré esa ${que}` }, { status: 404 });
const hoyArg = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

async function guardarMaquina(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const codigo = normalizarCodigo(d.codigo);
  const ahora = new Date().toISOString();
  const fila = {
    codigo, nombre: d.nombre, tipo: tipoMaquina(d.tipo).id, marca: d.marca, modelo: d.modelo, serie: d.serie, anio: d.anio,
    ubicacion: d.ubicacion, division: d.division, foto_url: d.foto_url, manual_url: d.manual_url, criticidad: d.criticidad,
    con_horometro: d.con_horometro, horas: d.con_horometro ? d.horas : null, servicio_tecnico: d.servicio_tecnico,
    servicio_telefono: d.servicio_telefono, estado: d.estado, notas: d.notas, updated_at: ahora,
  };
  try {
    if (d.id) {
      const [antes] = (await sbGet(`maquinas?id=eq.${d.id}&empresa_id=eq.${e}&select=horas`, opts)) || [];
      if (!antes) return noEncontrado("máquina");
      if (fila.horas !== antes.horas) fila.horas_at = fila.horas === null ? null : ahora;
      const [m] = (await sbPatch(`maquinas?id=eq.${d.id}&empresa_id=eq.${e}`, fila, opts)) || [];
      if (!m) return noEncontrado("máquina");
      broadcastRefresh(e, "maquinas");
      return NextResponse.json({ ok: true, maquina: m });
    }
    const [m] = (await sbPost("maquinas", { ...fila, empresa_id: e, horas_at: fila.horas === null ? null : ahora }, opts)) || [];
    let tareas = 0;
    if (d.con_plantilla && m?.id) {
      const nuevas = tareasDePlantilla(fila.tipo).map((t) => ({
        ...t, empresa_id: e, maquina_id: m.id, horas_base: t.cada_horas && fila.horas != null ? fila.horas : null,
      }));
      if (nuevas.length) {
        await sbPost("maquina_tareas", nuevas, opts);
        tareas = nuevas.length;
        broadcastRefresh(e, "maquina_tareas");
      }
    }
    broadcastRefresh(e, "maquinas");
    return NextResponse.json({ ok: true, maquina: m || fila, tareas });
  } catch (err) {
    if (String(err?.message).includes("23505")) {
      return NextResponse.json({ error: `Ya hay una máquina con el código ${codigo}` }, { status: 409 });
    }
    throw err;
  }
}

async function bajaMaquina(sesion, { id, activo }) {
  const e = sesion.empresa_id;
  const [m] = (await sbPatch(`maquinas?id=eq.${id}&empresa_id=eq.${e}`, { activo, updated_at: new Date().toISOString() }, { sesion })) || [];
  if (!m) return noEncontrado("máquina");
  broadcastRefresh(e, "maquinas");
  return NextResponse.json({ ok: true, maquina: m });
}

async function guardarHoras(sesion, { id, horas }) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [m] = (await sbGet(`maquinas?id=eq.${id}&empresa_id=eq.${e}&select=id,horas,con_horometro`, opts)) || [];
  if (!m) return noEncontrado("máquina");
  if (!m.con_horometro) return NextResponse.json({ error: "Esa máquina no tiene horómetro. Marcalo en su ficha." }, { status: 400 });
  if (m.horas != null && horas < m.horas) {
    return NextResponse.json({ error: `La máquina tenía ${m.horas.toLocaleString("es-AR")} h. Revisá el número.` }, { status: 400 });
  }
  await sbPatch(`maquinas?id=eq.${id}&empresa_id=eq.${e}`, { horas, horas_at: new Date().toISOString() }, opts);
  broadcastRefresh(e, "maquinas");
  return NextResponse.json({ ok: true });
}

function idsRepetidos(checklist) {
  return new Set(checklist.map((p) => p.id)).size !== checklist.length;
}

async function guardarTarea(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (idsRepetidos(d.checklist)) return NextResponse.json({ error: "Hay dos puntos con el mismo código" }, { status: 400 });
  if (d.ultima_fecha && d.ultima_fecha > hoyArg()) return NextResponse.json({ error: "La última vez no puede ser después de hoy" }, { status: 400 });
  const [m] = (await sbGet(`maquinas?id=eq.${d.maquina_id}&empresa_id=eq.${e}&select=id,horas`, opts)) || [];
  if (!m) return noEncontrado("máquina");
  const fila = {
    nombre: d.nombre, cada_dias: d.cada_dias, cada_horas: d.cada_horas, aviso_dias: d.aviso_dias, aviso_horas: d.aviso_horas,
    checklist: d.checklist, quien: d.quien, duracion_min: d.duracion_min, parar_maquina: d.parar_maquina,
    seguridad: d.seguridad, insumos: d.insumos, ultima_fecha: d.ultima_fecha, ultima_horas: d.ultima_horas,
    updated_at: new Date().toISOString(),
  };
  if (d.id) {
    const [antes] = (await sbGet(`maquina_tareas?id=eq.${d.id}&maquina_id=eq.${m.id}&empresa_id=eq.${e}&select=id,horas_base`, opts)) || [];
    if (!antes) return noEncontrado("tarea");
    // Una tarea que pasa a contarse por horas arranca desde las horas de hoy
    if (fila.cada_horas && antes.horas_base == null) fila.horas_base = m.horas ?? null;
    const [t] = (await sbPatch(`maquina_tareas?id=eq.${d.id}&empresa_id=eq.${e}`, fila, opts)) || [];
    broadcastRefresh(e, "maquina_tareas");
    return NextResponse.json({ ok: true, tarea: t || fila });
  }
  const existentes = (await sbGet(`maquina_tareas?maquina_id=eq.${m.id}&empresa_id=eq.${e}&select=orden&order=orden.desc&limit=1`, opts)) || [];
  const [t] = (await sbPost("maquina_tareas", {
    ...fila, empresa_id: e, maquina_id: m.id, horas_base: fila.cada_horas ? m.horas ?? null : null, orden: (existentes[0]?.orden ?? -1) + 1,
  }, opts)) || [];
  broadcastRefresh(e, "maquina_tareas");
  return NextResponse.json({ ok: true, tarea: t || fila });
}

async function borrarTarea(sesion, id) {
  const e = sesion.empresa_id;
  const [t] = (await sbPatch(`maquina_tareas?id=eq.${id}&empresa_id=eq.${e}`, { activa: false, updated_at: new Date().toISOString() }, { sesion })) || [];
  if (!t) return noEncontrado("tarea");
  broadcastRefresh(e, "maquina_tareas");
  return NextResponse.json({ ok: true });
}

async function crearRegistro(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [t] = (await sbGet(`maquina_tareas?id=eq.${d.tarea_id}&empresa_id=eq.${e}&select=id,maquina_id,nombre,checklist,seguridad,activa,ultima_fecha,ultima_horas`, opts)) || [];
  if (!t || t.activa === false) return noEncontrado("tarea");
  const [m] = (await sbGet(`maquinas?id=eq.${t.maquina_id}&empresa_id=eq.${e}&select=id,horas,con_horometro`, opts)) || [];
  if (!m) return noEncontrado("máquina");
  if (d.fecha > hoyArg()) return NextResponse.json({ error: "La fecha no puede ser después de hoy" }, { status: 400 });
  if (t.seguridad && !d.seguridad_ok) return NextResponse.json({ error: "Falta confirmar el aviso de seguridad" }, { status: 400 });
  if (m.con_horometro && d.horas == null) return NextResponse.json({ error: "Poné las horas del horómetro" }, { status: 400 });
  // Cada punto de la tarea, con su estado; nota si no está bien
  const porPunto = new Map(d.items.map((i) => [i.punto, i]));
  for (const p of Array.isArray(t.checklist) ? t.checklist : []) {
    const it = porPunto.get(p.id);
    if (!it) return NextResponse.json({ error: `Falta marcar ${p.nombre}` }, { status: 400 });
    if ((it.estado === "revisar" || it.estado === "mal") && !it.nota) return NextResponse.json({ error: `${p.nombre} necesita una nota` }, { status: 400 });
  }
  const [emp] = sesion.empleado_id
    ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const [r] = (await sbPost("maquina_registros", {
    empresa_id: e, maquina_id: m.id, tarea_id: t.id, tarea_nombre: t.nombre, fecha: d.fecha, horas: m.con_horometro ? d.horas : null,
    items: d.items, ...contarEstados(d.items), seguridad_ok: d.seguridad_ok, observaciones: d.observaciones, fotos: d.fotos,
    firma_url: d.firma_url, empleado_id: sesion.empleado_id || null, empleado_nombre: emp?.nombre || null,
  }, opts)) || [];
  // La tarea queda al día desde esta vez (si no había una más nueva cargada)
  if (!t.ultima_fecha || d.fecha >= t.ultima_fecha) {
    const horas = m.con_horometro && d.horas != null ? d.horas : t.ultima_horas;
    await sbPatch(`maquina_tareas?id=eq.${t.id}&empresa_id=eq.${e}`, { ultima_fecha: d.fecha, ultima_horas: horas ?? null }, opts);
    broadcastRefresh(e, "maquina_tareas");
  }
  if (m.con_horometro && d.horas != null && (m.horas == null || d.horas > m.horas)) {
    await sbPatch(`maquinas?id=eq.${m.id}&empresa_id=eq.${e}`, { horas: d.horas, horas_at: new Date().toISOString() }, opts);
    broadcastRefresh(e, "maquinas");
  }
  broadcastRefresh(e, "maquina_registros");
  return NextResponse.json({ ok: true, registro: r });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(maquinariaBody, raw);
    if (parsed.response) return parsed.response;
    if (!puedeEditarMaquinaria(sesion.rol)) {
      return NextResponse.json({ error: "La maquinaria la cargan gerencia y Administración" }, { status: 403 });
    }
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    // Maquinaria es un módulo propio (viene con las OT y se puede apagar aparte, 132)
    const sinModulo = await requireModulo(sesion.empresa_id, "maquinaria");
    if (sinModulo) return sinModulo;
    const d = parsed.data;
    try {
      if (d.accion === "maquina_guardar") return await guardarMaquina(sesion, d);
      if (d.accion === "maquina_baja") return await bajaMaquina(sesion, d);
      if (d.accion === "horas_guardar") return await guardarHoras(sesion, d);
      if (d.accion === "tarea_guardar") return await guardarTarea(sesion, d);
      if (d.accion === "tarea_borrar") return await borrarTarea(sesion, d.id);
      return await crearRegistro(sesion, d);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para usar Maquinaria falta correr la migración 132 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[maquinaria] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
