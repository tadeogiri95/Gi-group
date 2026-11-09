// /api/finanzas/sueldos — Finanzas, parte F5b (migración 178): las
// liquidaciones de sueldos (reglas en app/lib/finanzasSueldos.js).
//
//   GET → los conceptos y la cuenta del área de cada empleado, el plan de
//       cuentas, los empleados, las cajas y bancos, las liquidaciones (sin las
//       anuladas, salvo ?anuladas=1) y los pagos de sueldo.
//   POST { accion: "config", conceptos, areas } → guarda los conceptos.
//   POST { accion: "guardar", id?, periodo, fecha, renglones, notas? } → nueva
//       o corregida (solo en borrador).
//   POST { accion: "confirmar", id } → un DEVENG SUELDO por importe.
//   POST { accion: "anular", id } → anula la liquidación y su devengado; no
//       se puede si tiene pagos vivos (se anulan antes).
//   POST { accion: "pagar", id, pagos: [{ empleado_id, cuenta, importe, fecha }] }
//       → un PAGO SUELDO por empleado, desde la caja o el banco elegido.
//   POST { accion: "anular_pago", op_id } → anula un pago de sueldo.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige). Los
// conceptos van en config_sistema.
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA } from "../../../lib/finanzasOperaciones";
import {
  CLAVE_SUELDOS, ORIGEN_LIQUIDACION, ORIGEN_PAGO_SUELDO, cuentaSueldosAPagar, cuentasDeArea, leerConfigSueldos, operacionPagoSueldo,
  operacionesLiquidacion, pagadoPorEmpleado, totalesLiquidacion, validarConfigSueldos, validarLiquidacion,
} from "../../../lib/finanzasSueldos";

const FALTA_178 = "Para los sueldos falta correr la migración 178 en Supabase.";
const falta178 = (err) => /fin_liquidaciones/.test(String(err?.message)) && /does not exist|42P01|PGRST20[05]|schema cache/.test(String(err?.message));
const COLUMNAS_OP = "id,fecha,tipo,entidad,total,total_ars,cuenta_debe,cuenta_haber,descripcion,origen,origen_id,anulada_at";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`)) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function leerConfig(e, cuentas) {
  const cfg = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_SUELDOS}&select=valor&limit=1`, { silent: true, fallback: [] });
  return { guardada: Boolean(cfg?.length), ...leerConfigSueldos(cfg?.[0]?.valor, cuentas) };
}

async function contexto(sesion) {
  const e = sesion.empresa_id;
  const [cuentas, tesoreria, empleados] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
    leer(sesion, `empleados?empresa_id=eq.${e}&select=id,nombre,legajo,division,activo&order=nombre.asc`),
  ]);
  const config = await leerConfig(e, cuentas || []);
  return { cuentas: cuentas || [], tesoreria: tesoreria || [], empleados: empleados || [], config };
}

async function leerLiquidacion(sesion, id) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [l] = (await leer(sesion, `fin_liquidaciones?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=*&limit=1`)) || [];
  return l || null;
}

const opsDeLiquidacion = (sesion, id, origen) =>
  leer(sesion, `fin_operaciones?empresa_id=eq.${sesion.empresa_id}&origen=eq.${origen}&origen_id=like.l${id}:*&select=${COLUMNAS_OP}&order=id.asc`, 20000);

function error(err, donde) {
  if (falta178(err)) return NextResponse.json({ error: FALTA_178, falta_migracion: 178 }, { status: 409 });
  return errorFinanzas(err, donde);
}

const refrescar = (e, ...tablas) => tablas.forEach((t) => broadcastRefresh(e, t));
const mal = (msg, status = 400) => NextResponse.json({ error: msg }, { status });

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const anuladas = new URL(request.url).searchParams.get("anuladas") === "1";
  try {
    const [ctx, liquidaciones, ops] = await Promise.all([
      contexto(sesion),
      leer(sesion, `fin_liquidaciones?empresa_id=eq.${e}${anuladas ? "" : "&estado=neq.anulada"}&select=*&order=fecha.desc,id.desc`, 2000),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_PAGO_SUELDO}&select=${COLUMNAS_OP}&order=fecha.asc,id.asc`, 50000),
    ]);
    return NextResponse.json({
      conceptos: ctx.config.conceptos, areas: ctx.config.areas, config_guardada: ctx.config.guardada,
      cuentas: ctx.cuentas, cuentas_area: cuentasDeArea(ctx.cuentas), cuenta_a_pagar: cuentaSueldosAPagar(ctx.cuentas),
      empleados: ctx.empleados, tesoreria: ctx.tesoreria, liquidaciones: liquidaciones || [], pagos: ops || [],
    });
  } catch (err) {
    return error(err, "sueldos GET");
  }
}

async function guardarConfig(sesion, d) {
  const e = sesion.empresa_id;
  const ctx = await contexto(sesion);
  const { valor, errores } = validarConfigSueldos(d, ctx.cuentas);
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const ya = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_SUELDOS}&select=clave&limit=1`, { silent: true, fallback: [] });
  if (ya?.length) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_SUELDOS}`, { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_SUELDOS, valor });
  return NextResponse.json({ ok: true, ...leerConfigSueldos(valor, ctx.cuentas) });
}

async function guardar(sesion, d) {
  const e = sesion.empresa_id;
  const ctx = await contexto(sesion);
  const { liquidacion, errores } = validarLiquidacion(d, { conceptos: ctx.config.conceptos, empleados: ctx.empleados });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const notas = String(d.notas ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const ahora = new Date().toISOString();
  if (d.id != null) {
    const l = await leerLiquidacion(sesion, Number(d.id));
    if (!l) return mal("No encontré esa liquidación", 404);
    if (l.estado !== "borrador") return mal("Solo se corrige una liquidación en borrador. Anulala y cargala de nuevo.");
    const [hecha] = (await sbPatch(`fin_liquidaciones?id=eq.${l.id}&empresa_id=eq.${e}&estado=eq.borrador`, { ...liquidacion, notas, updated_at: ahora }, { sesion })) || [];
    if (!hecha) return mal("La liquidación cambió mientras tanto. Actualizá la pantalla.", 409);
    refrescar(e, "fin_liquidaciones");
    return NextResponse.json({ ok: true, liquidacion: hecha });
  }
  const [nueva] = (await sbPost("fin_liquidaciones", {
    ...liquidacion, notas, empresa_id: e, estado: "borrador", cargada_por_nombre: await nombreEmpleado(sesion), created_at: ahora, updated_at: ahora,
  }, { sesion })) || [];
  if (!nueva?.id) return mal("No se pudo guardar la liquidación", 500);
  refrescar(e, "fin_liquidaciones");
  return NextResponse.json({ ok: true, liquidacion: nueva });
}

async function confirmar(sesion, d) {
  const e = sesion.empresa_id;
  const l = await leerLiquidacion(sesion, Number(d.id));
  if (!l) return mal("No encontré esa liquidación", 404);
  if (l.estado !== "borrador") return mal("Esta liquidación ya no está en borrador");
  const ctx = await contexto(sesion);
  if (!l.renglones?.length) return mal("La liquidación no tiene empleados");
  const { ops, errores } = operacionesLiquidacion(l, { conceptos: ctx.config.conceptos, areas: ctx.config.areas, cuentaAPagar: cuentaSueldosAPagar(ctx.cuentas) });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  if (!ops.length) return mal("La liquidación no tiene importes");
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  // Se marca primero: dos clics no devengan dos veces
  const [tomada] = (await sbPatch(`fin_liquidaciones?id=eq.${l.id}&empresa_id=eq.${e}&estado=eq.borrador`, { estado: "confirmada", confirmada_at: ahora, updated_at: ahora }, { sesion })) || [];
  if (!tomada) return mal("La liquidación cambió mientras tanto. Actualizá la pantalla.", 409);
  try {
    await sbPost("fin_operaciones", ops.map((op) => ({ ...op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora })), { sesion });
  } catch (err) {
    await sbPatch(`fin_liquidaciones?id=eq.${l.id}&empresa_id=eq.${e}`, { estado: "borrador", confirmada_at: null, updated_at: new Date().toISOString() }, { sesion }).catch(() => {});
    throw err;
  }
  refrescar(e, "fin_liquidaciones", "fin_operaciones");
  return NextResponse.json({ ok: true, liquidacion: tomada, operaciones: ops.length });
}

async function anular(sesion, d) {
  const e = sesion.empresa_id;
  const l = await leerLiquidacion(sesion, Number(d.id));
  if (!l) return mal("No encontré esa liquidación", 404);
  if (l.estado === "anulada") return mal("Esta liquidación ya está anulada");
  if (l.estado === "confirmada") {
    const pagos = (await opsDeLiquidacion(sesion, l.id, ORIGEN_PAGO_SUELDO)) || [];
    if (pagos.some((o) => !o.anulada_at)) return mal("La liquidación tiene pagos. Anulá primero los pagos.");
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const [hecha] = (await sbPatch(`fin_liquidaciones?id=eq.${l.id}&empresa_id=eq.${e}&estado=eq.${l.estado}`, { estado: "anulada", updated_at: ahora }, { sesion })) || [];
  if (!hecha) return mal("La liquidación cambió mientras tanto. Actualizá la pantalla.", 409);
  if (l.estado === "confirmada") {
    await sbPatch(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_LIQUIDACION}&origen_id=like.l${l.id}:*&anulada_at=is.null`, {
      anulada_at: ahora, anulada_por_nombre: quien || "Gypi (liquidación anulada)", updated_at: ahora,
    }, { sesion });
  }
  refrescar(e, "fin_liquidaciones", "fin_operaciones");
  return NextResponse.json({ ok: true, liquidacion: hecha });
}

async function pagar(sesion, d) {
  const e = sesion.empresa_id;
  const l = await leerLiquidacion(sesion, Number(d.id));
  if (!l) return mal("No encontré esa liquidación", 404);
  if (l.estado !== "confirmada") return mal("Solo se paga una liquidación confirmada");
  const ctx = await contexto(sesion);
  const cuentaAPagar = cuentaSueldosAPagar(ctx.cuentas);
  if (!cuentaAPagar) return mal("Falta la cuenta \"Sueldos A Pagar\" en el plan de cuentas");
  const ya = (await opsDeLiquidacion(sesion, l.id, ORIGEN_PAGO_SUELDO)) || [];
  const pagado = pagadoPorEmpleado(l.id, ya);
  const { porEmpleado } = totalesLiquidacion(l, ctx.config.conceptos);
  const lista = (Array.isArray(d.pagos) ? d.pagos : []).slice(0, 1000);
  if (!lista.length) return mal("Elegí a quién pagar");
  const ops = [];
  const vistos = new Set();
  for (const p of lista) {
    const emp = String(p?.empleado_id ?? "");
    const renglon = (l.renglones || []).find((r) => String(r.empleado_id) === emp);
    const tot = porEmpleado.find((x) => x.empleado_id === emp);
    if (!renglon || !tot) return mal("Hay un empleado que no está en la liquidación");
    if (vistos.has(emp)) return mal(`${renglon.nombre} está dos veces`);
    vistos.add(emp);
    const importe = centavos(p.importe);
    const falta = centavos(tot.total - (pagado[emp] || 0));
    if (!(importe > 0)) return mal(`${renglon.nombre}: falta el importe`);
    if (importe > falta + 0.01) return mal(`${renglon.nombre}: le falta cobrar $ ${falta.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`);
    const caja = ctx.tesoreria.find((t) => t.cuenta === String(p.cuenta || "") && t.activa !== false);
    if (!caja) return mal(`${renglon.nombre}: elegí la caja o el banco`);
    if (caja.moneda && caja.moneda !== "ARS") return mal(`${renglon.nombre}: los sueldos se pagan desde una caja o banco en pesos`);
    const fecha = FECHA.test(String(p.fecha || "")) ? p.fecha : null;
    if (!fecha) return mal(`${renglon.nombre}: falta la fecha del pago`);
    const n = ya.filter((o) => String(o.origen_id).startsWith(`l${l.id}:${emp}:`)).length + 1;
    ops.push(operacionPagoSueldo({ liq: l, renglon, caja, importe, fecha, n }, cuentaAPagar));
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  try {
    await sbPost("fin_operaciones", ops.map((op) => ({ ...op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora })), { sesion });
  } catch (err) {
    if (/23505|duplicate key/.test(String(err?.message))) return mal("Ese pago ya se estaba cargando. Actualizá la pantalla.", 409);
    throw err;
  }
  refrescar(e, "fin_operaciones");
  return NextResponse.json({ ok: true, pagos: ops.length });
}

async function anularPago(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d.op_id);
  if (!Number.isInteger(id) || id <= 0) return mal("Falta el pago");
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const [hecha] = (await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&origen=eq.${ORIGEN_PAGO_SUELDO}&anulada_at=is.null`, {
    anulada_at: ahora, anulada_por_nombre: quien || "Gypi (pago de sueldo anulado)", updated_at: ahora,
  }, { sesion })) || [];
  if (!hecha) return mal("Ese pago ya estaba anulado", 404);
  refrescar(e, "fin_operaciones");
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  try {
    if (d?.accion === "config") return await guardarConfig(sesion, d);
    if (d?.accion === "guardar") return await guardar(sesion, d);
    if (d?.accion === "confirmar") return await confirmar(sesion, d);
    if (d?.accion === "anular") return await anular(sesion, d);
    if (d?.accion === "pagar") return await pagar(sesion, d);
    if (d?.accion === "anular_pago") return await anularPago(sesion, d);
    return mal("Acción desconocida");
  } catch (err) {
    return error(err, `sueldos ${d?.accion}`);
  }
}
