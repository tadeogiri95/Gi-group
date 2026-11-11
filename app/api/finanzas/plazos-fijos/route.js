// /api/finanzas/plazos-fijos — Finanzas, parte 8 del plan del 11/11: plazos
// fijos con el interés aparte (reglas en app/lib/finanzasPlazosFijos.js). Sin
// migración: la lista va en config_sistema ("finanzas_plazos_fijos").
//
//   GET → los plazos guardados con su situación (vigente, vencido sin
//       registrar, terminado), los vencidos que faltan registrar, los bancos y
//       las cuentas de plazo fijo para elegir.
//   POST { accion: "ver", plazos, banco, cuenta_pf, exportado? } → qué se
//       cargaría de la planilla del banco (sin cargar nada).
//   POST { accion: "cargar", plazos, banco, cuenta_pf, exportado?, fechas?: { cert: fecha }, omitir?: [cert] }
//       → carga lo que falta (constitución y, si ya venció, vencimiento e
//       interés) y guarda la lista, unida por certificado: nada se repite.
//   POST { accion: "vencidos" } → registra el vencimiento y el interés de los
//       plazos guardados que ya vencieron (siempre vuelven a la cuenta).
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA, hoyAr } from "../../../lib/finanzasOperaciones";
import {
  CLAVE_PLAZOS_FIJOS, MAX_PLAZOS, contextoPlazos, cuentasPorDefecto, leerGuardados, listaPlazos, operacionPlazo,
  pathOpsPlazos, planPlazosFijos, plazoValido, unirPlazos, vencidosPendientes,
} from "../../../lib/finanzasPlazosFijos";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

async function leerTodo(sesion) {
  const e = sesion.empresa_id;
  const hoy = hoyAr();
  const [tesoreria, cfg] = await Promise.all([
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
    sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLAZOS_FIJOS}&select=valor&limit=1`, { silent: true, fallback: [] }),
  ]);
  const cuentasPf = tesoreria.filter((t) => t.tipo === "plazo_fijo").map((t) => t.cuenta);
  const ops = await leer(sesion, pathOpsPlazos(e, cuentasPf, hoy), 20000);
  return { hoy, tesoreria, cuentasPf, ops, guardados: leerGuardados(cfg?.[0]?.valor), hay: Boolean(cfg?.length) };
}

async function guardar(sesion, plazos, hay) {
  const e = sesion.empresa_id;
  const valor = { plazos };
  // config_sistema va con la clave de servicio, como las otras listas de Finanzas
  if (hay) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLAZOS_FIJOS}`, { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_PLAZOS_FIJOS, valor });
}

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`);
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function insertar(sesion, ops) {
  if (!ops.length) return;
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  await sbPost("fin_operaciones", ops.map((o) => ({ ...o, empresa_id: sesion.empresa_id, cargada_por_nombre: quien || "Gypi (plazo fijo)", created_at: ahora, updated_at: ahora })), { sesion });
  broadcastRefresh(sesion.empresa_id, "fin_operaciones");
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  try {
    const { hoy, tesoreria, cuentasPf, ops, guardados } = await leerTodo(sesion);
    const vivas = tesoreria.filter((t) => t.activa !== false && t.moneda !== "USD");
    return NextResponse.json({
      hoy,
      plazos: listaPlazos(guardados, ops, cuentasPf, hoy),
      pendientes: vencidosPendientes(guardados, ops, cuentasPf, hoy),
      bancos: vivas.filter((t) => t.tipo === "banco").map((t) => ({ cuenta: t.cuenta, nombre: t.nombre })),
      cuentas_pf: vivas.filter((t) => t.tipo === "plazo_fijo").map((t) => ({ cuenta: t.cuenta, nombre: t.nombre })),
      por_defecto: cuentasPorDefecto(tesoreria, guardados[0] ? tesoreria.find((t) => t.cuenta === guardados[0].cuenta_pf)?.nombre || "" : ""),
    });
  } catch (err) {
    return errorFinanzas(err, "plazos-fijos GET");
  }
}

/** Lo que se cargaría de la planilla, con el contexto ya validado. */
async function planDe(sesion, d) {
  const plazos = (Array.isArray(d.plazos) ? d.plazos : []).slice(0, MAX_PLAZOS).map(plazoValido).filter(Boolean);
  if (!plazos.length) return { error: NextResponse.json({ error: "No vino ningún plazo fijo para cargar" }, { status: 400 }) };
  const e = sesion.empresa_id;
  const [base, tipos, cuentas] = await Promise.all([
    leerTodo(sesion),
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,cuenta_debe,cuenta_haber,activo`),
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
  ]);
  const { ctx, errores } = contextoPlazos({ tipos, cuentas, tesoreria: base.tesoreria, banco: d.banco, cuenta_pf: d.cuenta_pf });
  if (errores.length) return { error: NextResponse.json({ error: errores[0], errores }, { status: 400 }) };
  const fechas = d.fechas && typeof d.fechas === "object" ? d.fechas : {};
  const plan = planPlazosFijos({
    plazos, ops: base.ops, ctx, cuentasPf: base.cuentasPf, hoy: base.hoy, fechas,
    fechaPorDefecto: FECHA.test(String(d.exportado || "")) ? d.exportado : null,
    omitir: Array.isArray(d.omitir) ? d.omitir : [],
  });
  return { plazos, base, ctx, plan };
}

async function ver(sesion, d) {
  const r = await planDe(sesion, d);
  if (r.error) return r.error;
  return NextResponse.json({ filas: r.plan.filas, operaciones: r.plan.ops.length });
}

async function cargar(sesion, d) {
  const r = await planDe(sesion, d);
  if (r.error) return r.error;
  const { plazos, base, ctx, plan } = r;
  for (const op of plan.ops) {
    if (op.fecha > base.hoy) return NextResponse.json({ error: `El plazo fijo ${op.referencia} no puede constituirse en el futuro` }, { status: 400 });
  }
  await insertar(sesion, plan.ops);
  const omitidos = new Set((Array.isArray(d.omitir) ? d.omitir : []).map(String));
  const nuevos = plazos.filter((p) => !omitidos.has(p.certificado)).map((p) => ({ ...p, banco: ctx.banco, cuenta_pf: ctx.cuenta_pf, importado: base.hoy }));
  await guardar(sesion, unirPlazos(base.guardados, nuevos), base.hay);
  return NextResponse.json({ ok: true, cargadas: plan.ops.length, plazos: nuevos.length });
}

async function vencidos(sesion) {
  const e = sesion.empresa_id;
  const [base, tipos, cuentas] = await Promise.all([
    leerTodo(sesion),
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,cuenta_debe,cuenta_haber,activo`),
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
  ]);
  const pendientes = vencidosPendientes(base.guardados, base.ops, base.cuentasPf, base.hoy);
  if (!pendientes.length) return NextResponse.json({ ok: true, cargadas: 0, plazos: 0 });
  const ops = [];
  for (const p of pendientes) {
    const { ctx, errores } = contextoPlazos({ tipos, cuentas, tesoreria: base.tesoreria, banco: p.banco, cuenta_pf: p.cuenta_pf });
    if (errores.length) return NextResponse.json({ error: `Plazo fijo ${p.certificado}: ${errores[0]}`, errores }, { status: 400 });
    if (p.falta.r) ops.push(operacionPlazo(p, "r", ctx));
    if (p.falta.i) ops.push(operacionPlazo(p, "i", ctx));
  }
  await insertar(sesion, ops);
  return NextResponse.json({ ok: true, cargadas: ops.length, plazos: pendientes.length });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  try {
    if (d?.accion === "ver") return await ver(sesion, d);
    if (d?.accion === "cargar") return await cargar(sesion, d);
    if (d?.accion === "vencidos") return await vencidos(sesion);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    if (/23505|duplicate/i.test(String(err?.message))) return NextResponse.json({ error: "Alguno de esos plazos fijos ya se cargó recién: actualizá y probá de nuevo." }, { status: 409 });
    return errorFinanzas(err, "plazos-fijos POST");
  }
}
