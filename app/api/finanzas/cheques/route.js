// /api/finanzas/cheques — Finanzas, parte F2b (1): cheques (migración 174;
// reglas en app/lib/finanzasCheques.js).
//
//   GET → los cheques (sin los anulados, salvo ?anulados=1), las cajas y
//       bancos, el plan de cuentas y los proveedores.
//   POST { accion: "crear", cheque } → alta de un cheque propio (a un
//       proveedor) o recibido (de un cliente), con su operación.
//   POST { accion: "cambiar", id, a, fecha, cuenta_banco?, proveedor_id? } →
//       debitado, depositado, entregado, rechazado o anular; cada uno con su
//       operación (anular anula la del alta).
//   POST { accion: "copiar_libro", filas } → los vivos de R-CHEQUES, sin
//       operación (ya están en el libro). Los ya copiados no se repiten.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { ESTADOS_CHEQUE, TIPOS_CHEQUE, cambioDeEstado, operacionAlta, validarCheque } from "../../../lib/finanzasCheques";
import { hoyAr } from "../../../lib/finanzasOperaciones";

const MAX_COPIAR = 2000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FALTA_174 = "Para los cheques falta correr la migración 174 en Supabase.";
const falta174 = (err) => /fin_cheques/.test(String(err?.message)) && /does not exist|42P01|PGRST20[05]|schema cache/.test(String(err?.message));

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`)) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function contexto(sesion) {
  const e = sesion.empresa_id;
  const [cuentas, tesoreria, proveedores] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,activo&order=nombre.asc,id.asc`),
  ]);
  return { cuentas, tesoreria, proveedores };
}

function error(err, donde) {
  if (falta174(err)) return NextResponse.json({ error: FALTA_174, falta_migracion: 174 }, { status: 409 });
  return errorFinanzas(err, donde);
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const anulados = new URL(request.url).searchParams.get("anulados") === "1";
  try {
    const [ctx, cheques] = await Promise.all([
      contexto(sesion),
      leer(sesion, `fin_cheques?empresa_id=eq.${e}${anulados ? "" : "&estado=neq.anulado"}&select=*&order=fecha_pago.asc,id.asc`, 20000),
    ]);
    return NextResponse.json({ ...ctx, cheques });
  } catch (err) {
    return error(err, "cheques GET");
  }
}

async function crear(sesion, d) {
  const e = sesion.empresa_id;
  const ctx = await contexto(sesion);
  const { cheque, errores } = validarCheque(d.cheque || {}, ctx);
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const [fila] = (await sbPost("fin_cheques", { ...cheque, empresa_id: e, origen: "manual", cargado_por_nombre: quien, created_at: ahora, updated_at: ahora }, { sesion })) || [];
  if (!fila?.id) return NextResponse.json({ error: "No se pudo guardar el cheque" }, { status: 500 });
  const fecha = fila.fecha_emision || hoyAr();
  const { op, error: sinCuentas } = operacionAlta(fila, ctx.cuentas, fecha);
  if (sinCuentas) {
    // Sin las cuentas el cheque no puede quedar a medias
    await sbPatch(`fin_cheques?id=eq.${fila.id}&empresa_id=eq.${e}`, { estado: "anulado", notas: "Anulado: faltaban cuentas en el plan", updated_at: ahora }, { sesion });
    return NextResponse.json({ error: sinCuentas }, { status: 400 });
  }
  const [o] = (await sbPost("fin_operaciones", { ...op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora }, { sesion })) || [];
  const [final] = (await sbPatch(`fin_cheques?id=eq.${fila.id}&empresa_id=eq.${e}`, { op_alta_id: o?.id || null, updated_at: ahora }, { sesion })) || [];
  broadcastRefresh(e, "fin_cheques");
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, cheque: final || fila });
}

async function cambiar(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta el cheque" }, { status: 400 });
  if (!FECHA.test(String(d.fecha || ""))) return NextResponse.json({ error: "Falta la fecha" }, { status: 400 });
  const [ch] = (await leer(sesion, `fin_cheques?id=eq.${id}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
  if (!ch) return NextResponse.json({ error: "No encontré ese cheque" }, { status: 404 });
  const ctx = await contexto(sesion);
  let proveedor = null;
  if (d.a === "entregado") {
    proveedor = ctx.proveedores.find((p) => Number(p.id) === Number(d.proveedor_id)) || null;
    if (d.proveedor_id && !proveedor) return NextResponse.json({ error: "Ese proveedor no está en la lista" }, { status: 400 });
  }
  const r = cambioDeEstado(ch, d.a, { fecha: d.fecha, cuenta_banco: d.cuenta_banco || null, proveedor }, ctx);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  // El cambio solo vale si el cheque sigue como lo leímos (dos personas a la vez)
  const [hecho] = (await sbPatch(`fin_cheques?id=eq.${id}&empresa_id=eq.${e}&estado=eq.${ch.estado}`, { ...r.cambios, updated_at: ahora }, { sesion })) || [];
  if (!hecho) return NextResponse.json({ error: "El cheque cambió mientras tanto. Actualizá la pantalla." }, { status: 409 });
  let final = hecho;
  if (r.op) {
    const [o] = (await sbPost("fin_operaciones", { ...r.op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora }, { sesion })) || [];
    [final] = (await sbPatch(`fin_cheques?id=eq.${id}&empresa_id=eq.${e}`, { op_cierre_id: o?.id || null, updated_at: ahora }, { sesion })) || [hecho];
  } else if (ch.op_alta_id) {
    // Anular: la operación del alta queda anulada (no se borra)
    await sbPatch(`fin_operaciones?id=eq.${ch.op_alta_id}&empresa_id=eq.${e}&anulada_at=is.null`, { anulada_at: ahora, anulada_por_nombre: quien || "Gypi (cheque anulado)", updated_at: ahora }, { sesion });
  }
  broadcastRefresh(e, "fin_cheques");
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, cheque: final });
}

async function copiarLibro(sesion, d) {
  const e = sesion.empresa_id;
  const lista = Array.isArray(d.filas) ? d.filas : [];
  if (!lista.length) return NextResponse.json({ error: "No hay cheques para copiar" }, { status: 400 });
  if (lista.length > MAX_COPIAR) return NextResponse.json({ error: `Hasta ${MAX_COPIAR} cheques por vez` }, { status: 400 });
  const ctx = await contexto(sesion);
  const ids = new Set(ctx.proveedores.map((p) => Number(p.id)));
  const ya = new Set(((await leer(sesion, `fin_cheques?empresa_id=eq.${e}&origen=eq.libro&select=referencia`, 20000)) || []).map((c) => c.referencia));
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const nuevas = [];
  for (const [i, f] of lista.entries()) {
    const ref = String(f?.referencia ?? "").trim().slice(0, 60);
    if (!ref) return NextResponse.json({ error: `Fila ${i + 1}: falta el número de renglón del libro` }, { status: 400 });
    if (ya.has(ref)) continue;
    if (!["propio", "tercero"].includes(f.clase) || !TIPOS_CHEQUE[f.tipo]) return NextResponse.json({ error: `Fila ${i + 1}: revisá el tipo de cheque` }, { status: 400 });
    const vivos = f.clase === "propio" ? ["pendiente"] : ["en_cartera", "entregado"];
    if (!vivos.includes(f.estado) || !ESTADOS_CHEQUE[f.estado]) return NextResponse.json({ error: `Fila ${i + 1}: revisá el estado` }, { status: 400 });
    const importe = Math.round(Number(f.importe) * 100) / 100;
    if (!(importe > 0) || importe >= 1e13 || !FECHA.test(String(f.fecha_pago || ""))) return NextResponse.json({ error: `Fila ${i + 1}: revisá el importe y la fecha de pago` }, { status: 400 });
    const proveedorId = f.proveedor_id && ids.has(Number(f.proveedor_id)) ? Number(f.proveedor_id) : null;
    const t = (v, n) => (v ? String(v).replace(/\s+/g, " ").trim().slice(0, n) || null : null);
    nuevas.push({
      empresa_id: e, origen: "libro", referencia: ref, clase: f.clase, tipo: f.tipo, estado: f.estado,
      banco: t(f.banco, 60), numero: t(f.numero, 40), librador: t(f.librador, 120), beneficiario: t(f.beneficiario, 120),
      proveedor_id: proveedorId, entregado_a: t(f.entregado_a, 120), recibido_de: f.clase === "tercero" ? t(f.librador, 120) : null,
      fecha_emision: FECHA.test(String(f.fecha_emision || "")) ? f.fecha_emision : null, fecha_pago: f.fecha_pago, importe,
      cuenta_banco: f.clase === "propio" && f.cuenta_banco && ctx.tesoreria.some((x) => x.cuenta === f.cuenta_banco) ? f.cuenta_banco : null,
      notas: "Copiado de R-CHEQUES", cargado_por_nombre: quien, created_at: ahora, updated_at: ahora,
    });
    ya.add(ref);
  }
  for (let i = 0; i < nuevas.length; i += 500) await sbPost("fin_cheques", nuevas.slice(i, i + 500), { sesion });
  broadcastRefresh(e, "fin_cheques");
  return NextResponse.json({ ok: true, copiados: nuevas.length, repetidos: lista.length - nuevas.length });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  try {
    if (d?.accion === "crear") return await crear(sesion, d);
    if (d?.accion === "cambiar") return await cambiar(sesion, d);
    if (d?.accion === "copiar_libro") return await copiarLibro(sesion, d);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return error(err, `cheques ${d?.accion}`);
  }
}
