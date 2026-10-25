// /api/flota — Vehículos de la empresa y sus papeles (Mantenimiento, parte
// 28; ítem 43; migración 126).
//
// POST { accion, ... } (gerencia y Administración)
//   vehiculo_guardar  → alta o edición; la patente se guarda sin espacios ni guiones;
//                       con el último service y cada cuánto se revisa cada aspecto (128)
//   vehiculo_baja     → dar de baja o reactivar (no se borra: tiene historial)
//   papel_guardar     → con id corrige un papel; sin id agrega uno (renovar)
//   papel_borrar      → un papel cargado por error
//   licencia_guardar  → categoría y vencimiento de la licencia de un empleado
//   checklist_plantilla_guardar → secciones y puntos del checklist de la empresa
//                       (null = volver a la de fábrica; 127)
// POST checklist_crear (parte 29, 127): el responsable de mantenimiento del
//   vehículo o su suplente (parte 34, 133; sin la 133, el chofer), o gerencia
//   y Administración, de cualquiera. Revisa que estén todos los
//   puntos de las secciones elegidas, con nota y foto los que no están bien, y
//   actualiza los kilómetros del vehículo.
//   Cada punto en Mal crea un arreglo pendiente (parte 31, 129).
// POST arreglos y mantenimientos (parte 31, 129; gerencia y Administración):
//   arreglo_crear      → a mano o desde un ⚠️ Revisar de un checklist
//   arreglo_editar     → prioridad y responsable
//   arreglo_descartar  → con el motivo (no se borra)
//   mantenimiento_crear → service o reparación; con arreglo_id resuelve ese
//                       arreglo (también lo puede hacer el responsable del
//                       arreglo). Un service pone al día la alerta de service.
//   mantenimiento_borrar → uno cargado por error
//   mantenimiento_asignar → responsable de mantenimiento y suplente (parte 34, 133)
// La lectura va por /api/data (vehiculos, vehiculo_papeles, vehiculo_checklists,
// flota_config, vehiculo_arreglos y vehiculo_mantenimientos, solo lectura).
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
import { arreglosDeChecklist, ultimoService } from "../../lib/arreglosFlota";
import { CAMPOS_VEHICULO, puedeChecklistVehiculo } from "../../lib/mantenimiento";
import { logger } from "../../lib/logger";

function faltaMigracion(err) {
  const m = String(err?.message);
  return /vehiculos|vehiculo_papeles|licencia_/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}

// Parte 31: arreglos y mantenimientos
function faltaMigracionArreglos(err) {
  const m = String(err?.message);
  return /vehiculo_arreglos|vehiculo_mantenimientos/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}

// Parte 30: frecuencias, último service y aviso diario de la flota
function faltaMigracionAlertas(err) {
  const m = String(err?.message);
  return /frecuencias|service_fecha|service_km|aviso_firma/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m);
}

function faltaMigracionChecklist(err) {
  const m = String(err?.message);
  return /vehiculo_checklists|flota_config/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}

// Parte 34: responsables de mantenimiento
function faltaMigracionResponsables(err) {
  const m = String(err?.message);
  return /mant_responsable_id|mant_suplente_id/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m);
}

// A cargo de los arreglos que salen de un vehículo: su responsable de
// mantenimiento (133) o, si no tiene, el chofer
const aCargoDeArreglos = (veh) => veh[CAMPOS_VEHICULO.responsable] || veh.responsable_id || null;

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
    service_fecha: d.service_fecha, service_km: d.service_km,
  };
  if (d.frecuencias) fila.frecuencias = d.frecuencias;
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
  // select=*: con la 133 vienen el responsable de mantenimiento y el suplente
  const [veh] = (await sbGet(`vehiculos?id=eq.${d.vehiculo_id}&empresa_id=eq.${e}&select=*`, opts)) || [];
  if (!veh) return noEncontrado("vehículo");
  if (!puedeChecklistVehiculo(veh, { empleadoId: sesion.empleado_id, gestion: puedeEditarFlota(sesion.rol) })) {
    return NextResponse.json({ error: "El checklist de este vehículo lo hacen su responsable de mantenimiento, el suplente o la oficina" }, { status: 403 });
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
  // Lo que quedó Mal pasa a arreglos pendientes, con su nota y foto
  const nuevos = arreglosDeChecklist(items);
  let arreglos = 0;
  if (nuevos.length && c?.id) {
    try {
      await sbPost("vehiculo_arreglos", nuevos.map((a) => ({
        ...a, empresa_id: e, vehiculo_id: veh.id, checklist_id: c.id, responsable_id: aCargoDeArreglos(veh), creado_por: sesion.empleado_id || null,
      })), opts);
      arreglos = nuevos.length;
      broadcastRefresh(e, "vehiculo_arreglos");
    } catch (err) {
      // El checklist ya quedó guardado: sin la 129 no se corta por los arreglos
      if (!faltaMigracionArreglos(err)) throw err;
      logger.warn("[flota] checklist sin arreglos: falta la migración 129");
    }
  }
  broadcastRefresh(e, "vehiculo_checklists");
  return NextResponse.json({ ok: true, checklist: c, arreglos });
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
  // Flota es un módulo propio (viene con las OT y se puede apagar aparte, 131)
  return requireModulo(sesion.empresa_id, "flota");
}

async function crearArreglo(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [veh] = (await sbGet(`vehiculos?id=eq.${d.vehiculo_id}&empresa_id=eq.${e}&select=*`, opts)) || [];
  if (!veh) return noEncontrado("vehículo");
  if (!(await responsableValido(sesion, d.responsable_id))) return noEncontrado("empleado");
  if (d.checklist_id) {
    const [c] = (await sbGet(`vehiculo_checklists?id=eq.${d.checklist_id}&empresa_id=eq.${e}&vehiculo_id=eq.${veh.id}&select=id`, opts)) || [];
    if (!c) return noEncontrado("checklist");
  }
  const [a] = (await sbPost("vehiculo_arreglos", {
    empresa_id: e, vehiculo_id: veh.id, checklist_id: d.checklist_id, seccion_nombre: d.seccion_nombre, punto_nombre: d.punto_nombre,
    descripcion: d.descripcion, foto: d.foto, prioridad: d.prioridad, responsable_id: d.responsable_id ?? aCargoDeArreglos(veh),
    creado_por: sesion.empleado_id || null,
  }, opts)) || [];
  broadcastRefresh(e, "vehiculo_arreglos");
  return NextResponse.json({ ok: true, arreglo: a });
}

async function arregloPendiente(sesion, id) {
  const [a] = (await sbGet(`vehiculo_arreglos?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=id,vehiculo_id,estado,responsable_id,descripcion`, { sesion })) || [];
  return a || null;
}

async function editarArreglo(sesion, d) {
  const a = await arregloPendiente(sesion, d.id);
  if (!a) return noEncontrado("arreglo");
  if (a.estado !== "pendiente") return NextResponse.json({ error: "Ese arreglo ya está cerrado" }, { status: 409 });
  if (!(await responsableValido(sesion, d.responsable_id))) return noEncontrado("empleado");
  await sbPatch(`vehiculo_arreglos?id=eq.${a.id}&empresa_id=eq.${sesion.empresa_id}`, { prioridad: d.prioridad, responsable_id: d.responsable_id }, { sesion });
  broadcastRefresh(sesion.empresa_id, "vehiculo_arreglos");
  return NextResponse.json({ ok: true });
}

async function descartarArreglo(sesion, d) {
  const a = await arregloPendiente(sesion, d.id);
  if (!a) return noEncontrado("arreglo");
  if (a.estado !== "pendiente") return NextResponse.json({ error: "Ese arreglo ya está cerrado" }, { status: 409 });
  await sbPatch(`vehiculo_arreglos?id=eq.${a.id}&empresa_id=eq.${sesion.empresa_id}`, {
    estado: "descartado", motivo: d.motivo, cerrado_por: sesion.empleado_id || null, cerrado_at: new Date().toISOString(),
  }, { sesion });
  broadcastRefresh(sesion.empresa_id, "vehiculo_arreglos");
  return NextResponse.json({ ok: true });
}

// Pone al día vehiculos.service_fecha y service_km con el último service cargado
async function actualizarService(sesion, vehiculoId) {
  const e = sesion.empresa_id;
  const services = (await sbGet(`vehiculo_mantenimientos?empresa_id=eq.${e}&vehiculo_id=eq.${vehiculoId}&tipo=eq.service&select=tipo,fecha,km&order=fecha.desc,id.desc&limit=20`, { sesion })) || [];
  const ult = ultimoService(services);
  if (ult) await sbPatch(`vehiculos?id=eq.${vehiculoId}&empresa_id=eq.${e}`, { service_fecha: ult.fecha, service_km: ult.km }, { sesion });
}

async function crearMantenimiento(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [veh] = (await sbGet(`vehiculos?id=eq.${d.vehiculo_id}&empresa_id=eq.${e}&select=id,km`, opts)) || [];
  if (!veh) return noEncontrado("vehículo");
  let arreglo = null;
  if (d.arreglo_id) {
    arreglo = await arregloPendiente(sesion, d.arreglo_id);
    if (!arreglo || arreglo.vehiculo_id !== veh.id) return noEncontrado("arreglo");
    if (arreglo.estado !== "pendiente") return NextResponse.json({ error: "Ese arreglo ya está cerrado" }, { status: 409 });
  }
  // El responsable de un arreglo lo puede resolver; lo demás, la oficina
  if (!puedeEditarFlota(sesion.rol) && !(arreglo && arreglo.responsable_id && arreglo.responsable_id === sesion.empleado_id)) {
    return NextResponse.json({ error: "Los services y reparaciones los cargan gerencia y Administración" }, { status: 403 });
  }
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  if (d.fecha > hoy) return NextResponse.json({ error: "La fecha no puede ser después de hoy" }, { status: 400 });
  const [emp] = sesion.empleado_id
    ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const [m] = (await sbPost("vehiculo_mantenimientos", {
    empresa_id: e, vehiculo_id: veh.id, tipo: arreglo ? "arreglo" : d.tipo, fecha: d.fecha, km: d.km, donde: d.donde, taller: d.taller,
    detalle: d.detalle, repuestos: d.repuestos, costo: d.costo, factura_url: d.factura_url, fotos: d.fotos,
    cargado_por: sesion.empleado_id || null, cargado_nombre: emp?.nombre || null,
  }, opts)) || [];
  if (arreglo) {
    await sbPatch(`vehiculo_arreglos?id=eq.${arreglo.id}&empresa_id=eq.${e}`, {
      estado: "resuelto", mantenimiento_id: m?.id ?? null, cerrado_por: sesion.empleado_id || null, cerrado_at: new Date().toISOString(),
    }, opts);
    broadcastRefresh(e, "vehiculo_arreglos");
  }
  if (d.km != null && (veh.km == null || d.km > veh.km)) {
    await sbPatch(`vehiculos?id=eq.${veh.id}&empresa_id=eq.${e}`, { km: d.km, km_at: new Date().toISOString() }, opts);
  }
  if (!arreglo && d.tipo === "service") await actualizarService(sesion, veh.id);
  broadcastRefresh(e, "vehiculo_mantenimientos");
  return NextResponse.json({ ok: true, mantenimiento: m });
}

async function borrarMantenimiento(sesion, id) {
  const e = sesion.empresa_id;
  const [m] = (await sbGet(`vehiculo_mantenimientos?id=eq.${id}&empresa_id=eq.${e}&select=id,vehiculo_id,tipo`, { sesion })) || [];
  if (!m) return noEncontrado("mantenimiento");
  // Un arreglo resuelto vuelve a quedar pendiente
  await sbPatch(`vehiculo_arreglos?mantenimiento_id=eq.${m.id}&empresa_id=eq.${e}`, { estado: "pendiente", mantenimiento_id: null, cerrado_por: null, cerrado_at: null }, { sesion });
  await sbDelete(`vehiculo_mantenimientos?id=eq.${m.id}&empresa_id=eq.${e}`, { sesion });
  if (m.tipo === "service") await actualizarService(sesion, m.vehiculo_id);
  broadcastRefresh(e, "vehiculo_mantenimientos");
  return NextResponse.json({ ok: true });
}

async function asignarMantenimiento(sesion, d) {
  const e = sesion.empresa_id;
  if (d.responsable_id && d.responsable_id === d.suplente_id) {
    return NextResponse.json({ error: "El suplente tiene que ser otra persona" }, { status: 400 });
  }
  if (!(await responsableValido(sesion, d.responsable_id)) || !(await responsableValido(sesion, d.suplente_id))) return noEncontrado("empleado");
  const [v] = (await sbPatch(`vehiculos?id=eq.${d.vehiculo_id}&empresa_id=eq.${e}`, {
    [CAMPOS_VEHICULO.responsable]: d.responsable_id, [CAMPOS_VEHICULO.suplente]: d.responsable_id ? d.suplente_id : null, updated_at: new Date().toISOString(),
  }, { sesion })) || [];
  if (!v) return noEncontrado("vehículo");
  broadcastRefresh(e, "vehiculos");
  return NextResponse.json({ ok: true, vehiculo: v });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(flotaBody, raw);
    if (parsed.response) return parsed.response;
    // El checklist lo hace también el responsable de mantenimiento (se controla adentro),
    // y un arreglo lo resuelve también su responsable (se controla adentro)
    const deTodos = parsed.data.accion === "checklist_crear" || (parsed.data.accion === "mantenimiento_crear" && parsed.data.arreglo_id);
    if (!deTodos && !puedeEditarFlota(sesion.rol)) {
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
      if (d.accion === "arreglo_crear") return await crearArreglo(sesion, d);
      if (d.accion === "arreglo_editar") return await editarArreglo(sesion, d);
      if (d.accion === "arreglo_descartar") return await descartarArreglo(sesion, d);
      if (d.accion === "mantenimiento_crear") return await crearMantenimiento(sesion, d);
      if (d.accion === "mantenimiento_borrar") return await borrarMantenimiento(sesion, d.id);
      if (d.accion === "mantenimiento_asignar") return await asignarMantenimiento(sesion, d);
      return await guardarLicencia(sesion, d);
    } catch (err) {
      if (faltaMigracionResponsables(err)) {
        return NextResponse.json({ error: "Para los responsables de mantenimiento falta correr la migración 133 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionArreglos(err)) {
        return NextResponse.json({ error: "Para los arreglos y services de la flota falta correr la migración 129 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionAlertas(err)) {
        return NextResponse.json({ error: "Para las alertas de la flota falta correr la migración 128 en Supabase." }, { status: 409 });
      }
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
