// /api/flota — Vehículos de la empresa y sus papeles (Mantenimiento, parte
// 28; ítem 43; migración 126).
//
// POST { accion, ... } (gerencia y Administración)
//   vehiculo_guardar  → alta o edición; la patente se guarda sin espacios ni guiones
//   vehiculo_baja     → dar de baja o reactivar (no se borra: tiene historial)
//   papel_guardar     → con id corrige un papel; sin id agrega uno (renovar)
//   papel_borrar      → un papel cargado por error
//   licencia_guardar  → categoría y vencimiento de la licencia de un empleado
//   checklist_plantilla_guardar → secciones y puntos del checklist de la empresa
//                       (null = volver a la de fábrica; 127)
// POST checklist_crear (parte 29, 127): el responsable del vehículo (el chofer)
//   o gerencia y Administración, de cualquiera. Revisa que estén todos los
//   puntos de las secciones elegidas, con nota y foto los que no están bien, y
//   actualiza los kilómetros del vehículo.
// La lectura va por /api/data (vehiculos, vehiculo_papeles, vehiculo_checklists
// y flota_config, solo lectura).
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { flotaBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { normalizarPatente, puedeEditarFlota } from "../../lib/flota";
import { contarEstados, plantillaDe } from "../../lib/checklistVehiculo";
import { logger } from "../../lib/logger";

function faltaMigracion(err) {
  const m = String(err?.message);
  return /vehiculos|vehiculo_papeles|licencia_/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}

function faltaMigracionChecklist(err) {
  const m = String(err?.message);
  return /vehiculo_checklists|flota_config/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}

const noEncontrado = (que) => NextResponse.json({ error: `No encontré ese ${que}` }, { status: 404 });

async function responsableValido(sesion, id) {
  if (!id) return true;
  const [emp] = (await sbGet(`empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=id`, { sesion })) || [];
  return Boolean(emp);
}

async function guardarVehiculo(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const patente = normalizarPatente(d.patente);
  if (patente.length < 2) return NextResponse.json({ error: "Poné la patente" }, { status: 400 });
  if (!(await responsableValido(sesion, d.responsable_id))) return noEncontrado("empleado");
  const ahora = new Date().toISOString();
  const fila = {
    patente, tipo: d.tipo, marca: d.marca, modelo: d.modelo, anio: d.anio, color: d.color,
    motor: d.motor, chasis: d.chasis, km: d.km, combustible: d.combustible, foto_url: d.foto_url,
    division: d.division, responsable_id: d.responsable_id, notas: d.notas, updated_at: ahora,
  };
  try {
    if (d.id) {
      const [antes] = (await sbGet(`vehiculos?id=eq.${d.id}&empresa_id=eq.${e}&select=km`, opts)) || [];
      if (!antes) return noEncontrado("vehículo");
      if (d.km !== antes.km) fila.km_at = d.km === null ? null : ahora;
      const [v] = (await sbPatch(`vehiculos?id=eq.${d.id}&empresa_id=eq.${e}`, fila, opts)) || [];
      if (!v) return noEncontrado("vehículo");
      broadcastRefresh(e, "vehiculos");
      return NextResponse.json({ ok: true, vehiculo: v });
    }
    const [v] = (await sbPost("vehiculos", { ...fila, empresa_id: e, km_at: d.km === null ? null : ahora }, opts)) || [];
    broadcastRefresh(e, "vehiculos");
    return NextResponse.json({ ok: true, vehiculo: v || fila });
  } catch (err) {
    if (String(err?.message).includes("23505")) {
      return NextResponse.json({ error: `Ya hay un vehículo con la patente ${patente}` }, { status: 409 });
    }
    throw err;
  }
}

async function bajaVehiculo(sesion, { id, activo }) {
  const e = sesion.empresa_id;
  const [v] = (await sbPatch(`vehiculos?id=eq.${id}&empresa_id=eq.${e}`, { activo, updated_at: new Date().toISOString() }, { sesion })) || [];
  if (!v) return noEncontrado("vehículo");
  broadcastRefresh(e, "vehiculos");
  return NextResponse.json({ ok: true, vehiculo: v });
}

async function guardarPapel(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [veh] = (await sbGet(`vehiculos?id=eq.${d.vehiculo_id}&empresa_id=eq.${e}&select=id`, opts)) || [];
  if (!veh) return noEncontrado("vehículo");
  if (d.vencimiento && d.fecha && d.vencimiento < d.fecha) {
    return NextResponse.json({ error: "El vencimiento no puede ser antes de la fecha" }, { status: 400 });
  }
  const fila = {
    tipo: d.tipo,
    nombre: d.tipo === "otro" ? d.nombre : null,
    numero: d.numero,
    fecha: d.fecha,
    vencimiento: d.vencimiento,
    compania: d.tipo === "seguro" ? d.compania : null,
    cobertura: d.tipo === "seguro" ? d.cobertura : null,
    resultado: d.tipo === "itv" ? d.resultado : null,
    detalle: d.detalle,
    fotos: d.fotos,
    updated_at: new Date().toISOString(),
  };
  if (d.id) {
    const [p] = (await sbPatch(`vehiculo_papeles?id=eq.${d.id}&vehiculo_id=eq.${d.vehiculo_id}&empresa_id=eq.${e}`, fila, opts)) || [];
    if (!p) return noEncontrado("papel");
    broadcastRefresh(e, "vehiculo_papeles");
    return NextResponse.json({ ok: true, papel: p });
  }
  const [p] = (await sbPost("vehiculo_papeles", { ...fila, empresa_id: e, vehiculo_id: d.vehiculo_id, cargado_por: sesion.empleado_id || null }, opts)) || [];
  broadcastRefresh(e, "vehiculo_papeles");
  return NextResponse.json({ ok: true, papel: p || fila });
}

async function borrarPapel(sesion, id) {
  const e = sesion.empresa_id;
  const [p] = (await sbGet(`vehiculo_papeles?id=eq.${id}&empresa_id=eq.${e}&select=id`, { sesion })) || [];
  if (!p) return noEncontrado("papel");
  await sbDelete(`vehiculo_papeles?id=eq.${id}&empresa_id=eq.${e}`, { sesion });
  broadcastRefresh(e, "vehiculo_papeles");
  return NextResponse.json({ ok: true });
}

async function guardarLicencia(sesion, d) {
  const e = sesion.empresa_id;
  const [emp] = (await sbPatch(`empleados?id=eq.${d.empleado_id}&empresa_id=eq.${e}`,
    { licencia_categoria: d.categoria, licencia_vencimiento: d.vencimiento }, { sesion })) || [];
  if (!emp) return noEncontrado("empleado");
  broadcastRefresh(e, "empleados");
  return NextResponse.json({ ok: true, licencia: { empleado_id: emp.id, categoria: emp.licencia_categoria, vencimiento: emp.licencia_vencimiento } });
}

async function plantillaEmpresa(sesion) {
  const [cfg] = (await sbGet(`flota_config?empresa_id=eq.${sesion.empresa_id}&select=checklist`, { sesion })) || [];
  return plantillaDe(cfg);
}

async function crearChecklist(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [veh] = (await sbGet(`vehiculos?id=eq.${d.vehiculo_id}&empresa_id=eq.${e}&select=id,km,responsable_id,activo`, opts)) || [];
  if (!veh) return noEncontrado("vehículo");
  if (!puedeEditarFlota(sesion.rol) && veh.responsable_id !== sesion.empleado_id) {
    return NextResponse.json({ error: "Solo el responsable del vehículo o la oficina pueden hacer su checklist" }, { status: 403 });
  }
  if (veh.km != null && d.km < veh.km) {
    return NextResponse.json({ error: `El vehículo tenía ${veh.km.toLocaleString("es-AR")} km. Revisá el número.` }, { status: 400 });
  }
  // Cada punto de cada sección elegida, con su estado; nota y foto si no está bien
  const plantilla = await plantillaEmpresa(sesion);
  const secciones = plantilla.filter((s) => d.secciones.includes(s.id));
  if (secciones.length !== new Set(d.secciones).size) return NextResponse.json({ error: "Hay una sección que ya no está en el checklist. Volvé a abrirlo." }, { status: 409 });
  const porClave = new Map(d.items.map((i) => [`${i.seccion}.${i.punto}`, i]));
  for (const s of secciones) {
    for (const pt of s.puntos) {
      const it = porClave.get(`${s.id}.${pt.id}`);
      if (!it) return NextResponse.json({ error: `Falta marcar ${s.nombre}: ${pt.nombre}` }, { status: 400 });
      if ((it.estado === "revisar" || it.estado === "mal") && (!it.nota || !it.foto)) {
        return NextResponse.json({ error: `${s.nombre}: ${pt.nombre} necesita nota y foto` }, { status: 400 });
      }
    }
  }
  const items = d.items.filter((i) => d.secciones.includes(i.seccion));
  const [emp] = sesion.empleado_id
    ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const [c] = (await sbPost("vehiculo_checklists", {
    empresa_id: e, vehiculo_id: veh.id, empleado_id: sesion.empleado_id || null, empleado_nombre: emp?.nombre || null,
    km: d.km, combustible: d.combustible, secciones: d.secciones, items, ...contarEstados(items),
    observaciones: d.observaciones, fotos: d.fotos, firma_url: d.firma_url,
  }, opts)) || [];
  if (veh.km == null || d.km > veh.km) {
    await sbPatch(`vehiculos?id=eq.${veh.id}&empresa_id=eq.${e}`, { km: d.km, km_at: new Date().toISOString() }, opts);
  }
  broadcastRefresh(e, "vehiculo_checklists");
  return NextResponse.json({ ok: true, checklist: c });
}

async function guardarPlantilla(sesion, { checklist }) {
  const e = sesion.empresa_id;
  if (checklist) {
    const ids = checklist.map((s) => s.id);
    if (new Set(ids).size !== ids.length || checklist.some((s) => new Set(s.puntos.map((p) => p.id)).size !== s.puntos.length)) {
      return NextResponse.json({ error: "Hay dos secciones o dos puntos con el mismo código" }, { status: 400 });
    }
  }
  const fila = { checklist, updated_at: new Date().toISOString() };
  const opts = { sesion };
  const actualizadas = (await sbPatch(`flota_config?empresa_id=eq.${e}`, fila, opts)) || [];
  if (!actualizadas.length) await sbPost("flota_config", { ...fila, empresa_id: e }, opts);
  broadcastRefresh(e, "flota_config");
  return NextResponse.json({ ok: true });
}

async function chequeos(sesion) {
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  // La flota va con las OT, como Stock y Compras, hasta que Mantenimiento sea un módulo que se venda aparte
  return requireModulo(sesion.empresa_id, "proyectos");
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(flotaBody, raw);
    if (parsed.response) return parsed.response;
    // El checklist lo hace también el chofer (se controla que sea su vehículo)
    if (parsed.data.accion !== "checklist_crear" && !puedeEditarFlota(sesion.rol)) {
      return NextResponse.json({ error: "La flota la cargan gerencia y Administración" }, { status: 403 });
    }
    const bloqueo = await chequeos(sesion);
    if (bloqueo) return bloqueo;
    const d = parsed.data;
    try {
      if (d.accion === "vehiculo_guardar") return await guardarVehiculo(sesion, d);
      if (d.accion === "vehiculo_baja") return await bajaVehiculo(sesion, d);
      if (d.accion === "papel_guardar") return await guardarPapel(sesion, d);
      if (d.accion === "papel_borrar") return await borrarPapel(sesion, d.id);
      if (d.accion === "checklist_crear") return await crearChecklist(sesion, d);
      if (d.accion === "checklist_plantilla_guardar") return await guardarPlantilla(sesion, d);
      return await guardarLicencia(sesion, d);
    } catch (err) {
      if (faltaMigracionChecklist(err)) {
        return NextResponse.json({ error: "Para el checklist de vehículos falta correr la migración 127 en Supabase." }, { status: 409 });
      }
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para usar Flota falta correr la migración 126 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[flota] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
