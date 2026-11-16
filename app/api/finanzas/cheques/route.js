// /api/finanzas/cheques — Finanzas, parte F2b (1): cheques (migración 174;
// reglas en app/lib/finanzasCheques.js).
//
//   GET → los cheques (sin los anulados, salvo ?anulados=1), las cajas y
//       bancos, el plan de cuentas y los proveedores.
//   POST { accion: "crear", cheque } → alta de un cheque propio (a un
//       proveedor) o recibido (de un cliente), con su operación.
//   POST { accion: "cambiar", id, a, fecha, cuenta_banco?, proveedor_id? } →
//       debitado, depositado, entregado, rechazado o anular; cada uno con su
//       operación (anular anula la del alta). Si el banco ya tiene un
//       movimiento igual (13/11), 409 con los repetidos: usar_operacion = id
//       une el cheque a ese movimiento sin cargar otro; confirmar_repetido
//       carga uno nuevo igual.
//   POST { accion: "cliente", id, cliente_id } → el cliente que dio un
//       cheque de terceros (migración 192); sus movimientos pasan a su
//       cuenta corriente. cliente_id null lo suelta.
//   POST { accion: "copiar_libro", filas } → los vivos de R-CHEQUES, sin
//       operación (ya están en el libro). Los ya copiados no se repiten.
//   16/11: GET trae también "repetidos": cheques cuyo débito o depósito
//       está dos veces (el de Gypi y el del extracto; chequesRepetidos en
//       finanzasCorregir.js). POST { accion: "anular_repetidos" } une cada
//       cheque al movimiento del banco y anula el que cargó Gypi.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { feriadosFinanzas } from "../../../lib/finanzasDiasHabiles";
import { CLAVE_PLANIFICACION } from "../../../lib/planificacion";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { ESTADOS_CHEQUE, TIPOS_CHEQUE, cambioDeEstado, operacionAlta, validarCheque } from "../../../lib/finanzasCheques";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { frenoRepetidos, repetidosEnBase } from "../../../lib/finanzasRepetidosServidor";
import { clienteDeLista, faltaColumna192 } from "../../../lib/elegirDeLista";
import { chequesRepetidos } from "../../../lib/finanzasCorregir";

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
  const [cuentas, tesoreria, proveedores, clientes] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,activo&order=nombre.asc,id.asc`),
    leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=nombre.asc,id.asc`).catch(() => []),
  ]);
  return { cuentas, tesoreria, proveedores, clientes: clientes || [] };
}

function error(err, donde) {
  if (falta174(err)) return NextResponse.json({ error: FALTA_174, falta_migracion: 174 }, { status: 409 });
  return errorFinanzas(err, donde);
}

const moverDias = (fecha, d) => new Date(Date.parse(`${fecha}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);

/** 16/11: los cheques del último año con el débito o el depósito dos veces. */
async function repetidosDeCheques(sesion, tesoreria) {
  const e = sesion.empresa_id;
  const desde = moverDias(hoyAr(), -365);
  const cheques = await leer(sesion, `fin_cheques?empresa_id=eq.${e}&estado=in.(debitado,depositado)&op_cierre_id=not.is.null&fecha_pago=gte.${desde}&select=id,clase,estado,numero,importe,fecha_pago,beneficiario,recibido_de,librador,op_cierre_id&order=fecha_pago.asc,id.asc`, 20000);
  if (!cheques?.length) return [];
  const bancos = tesoreria.filter((t) => t.tipo === "banco").map((t) => `"${String(t.cuenta).replace(/"/g, "")}"`);
  if (!bancos.length) return [];
  const l = encodeURIComponent(bancos.join(","));
  const ops = await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=gte.${moverDias(desde, -10)}&or=(cuenta_debe.in.(${l}),cuenta_haber.in.(${l}))&select=id,fecha,tipo,descripcion,origen,total,total_ars,cuenta_debe,cuenta_haber,anulada_at&order=fecha.asc,id.asc`, 50000);
  // Los cheques de otros que ya tienen su movimiento del banco no se tocan
  const todos = await leer(sesion, `fin_cheques?empresa_id=eq.${e}&op_cierre_id=not.is.null&select=id,op_cierre_id`, 20000);
  const otros = (todos || []).filter((c) => !cheques.some((x) => x.id === c.id)).map((c) => ({ ...c, estado: "otro" }));
  return chequesRepetidos([...cheques, ...otros], ops || []);
}

const ORIGEN_TEXTO = { banco: "del extracto del banco", libro: "copiado del libro", manual: "cargado a mano" };
const parCheque = ({ cheque, gypi, otra }) => ({
  id: cheque.id, numero: cheque.numero, estado: cheque.estado, importe: cheque.importe, fecha_pago: cheque.fecha_pago,
  quien: cheque.beneficiario || cheque.recibido_de || cheque.librador || "",
  gypi: { id: gypi.id, fecha: gypi.fecha }, otra: { id: otra.id, fecha: otra.fecha, descripcion: otra.descripcion || "", origen: ORIGEN_TEXTO[otra.origen] || "cargado en otra pantalla" },
});

async function anularRepetidos(sesion) {
  const e = sesion.empresa_id;
  const ctx = await contexto(sesion);
  const pares = await repetidosDeCheques(sesion, ctx.tesoreria);
  if (!pares.length) return NextResponse.json({ ok: true, anuladas: 0 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  let anuladas = 0;
  for (const { cheque, gypi, otra } of pares) {
    const [unido] = (await sbPatch(`fin_cheques?id=eq.${cheque.id}&empresa_id=eq.${e}&op_cierre_id=eq.${gypi.id}`, { op_cierre_id: otra.id, updated_at: ahora }, { sesion })) || [];
    if (!unido) continue;
    const filas = await sbPatch(`fin_operaciones?id=eq.${gypi.id}&empresa_id=eq.${e}&origen=eq.cheque&anulada_at=is.null`, {
      anulada_at: ahora, anulada_por_nombre: `${quien || "Dueño"} (repetida con el extracto)`.slice(0, 120), updated_at: ahora,
    }, { sesion });
    anuladas += filas?.length || 0;
  }
  broadcastRefresh(e, "fin_cheques");
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, anuladas });
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const anulados = new URL(request.url).searchParams.get("anulados") === "1";
  try {
    const [ctx, cheques, planificacion] = await Promise.all([
      contexto(sesion),
      leer(sesion, `fin_cheques?empresa_id=eq.${e}${anulados ? "" : "&estado=neq.anulado"}&select=*&order=fecha_pago.asc,id.asc`, 20000),
      sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`, { silent: true, fallback: [] }).then((r) => r?.[0]?.valor || null).catch(() => null),
    ]);
    const repetidos = await repetidosDeCheques(sesion, ctx.tesoreria).catch(() => []);
    // Los días sin bancos, para saber cuándo se debita o acredita cada cheque
    return NextResponse.json({ ...ctx, cheques, feriados: [...feriadosFinanzas(planificacion)].sort(), repetidos: repetidos.map(parCheque) });
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
  const nuevo = { ...cheque, empresa_id: e, origen: "manual", cargado_por_nombre: quien, created_at: ahora, updated_at: ahora };
  const [fila] = (await sbPost("fin_cheques", nuevo, { sesion }).catch((err) => {
    // Sin la migración 192 el cheque se guarda igual, con el nombre del cliente
    if (!("cliente_id" in nuevo) || !faltaColumna192(err)) throw err;
    const { cliente_id: _c, ...sin } = nuevo;
    return sbPost("fin_cheques", sin, { sesion });
  })) || [];
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
  // 13/11: el débito o el depósito que ya está en el banco (de un extracto o
  // cargado a mano) no se carga otra vez: se usa ese movimiento ("usar_operacion")
  // o, si es otro distinto, se confirma ("confirmar_repetido")
  let usar = null;
  if (r.op) {
    // Solo el banco o la caja: la cartera de cheques tiene muchos del mismo importe
    const rev = await repetidosEnBase(sesion, [r.op], { tesoreria: ctx.tesoreria.filter((t) => t.tipo === "banco" || t.tipo === "caja") });
    const ofrecidas = new Set(rev.repetidos.flatMap((x) => x.parecidas.map((p) => Number(p.id))));
    if (d.usar_operacion != null) {
      usar = Number(d.usar_operacion);
      if (!ofrecidas.has(usar)) return NextResponse.json({ error: "Ese movimiento del banco ya no coincide con el cheque. Actualizá la pantalla." }, { status: 409 });
    } else if (d.confirmar_repetido !== true) {
      const freno = frenoRepetidos(rev);
      if (freno) return freno;
    }
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  // El cambio solo vale si el cheque sigue como lo leímos (dos personas a la vez)
  const [hecho] = (await sbPatch(`fin_cheques?id=eq.${id}&empresa_id=eq.${e}&estado=eq.${ch.estado}`, { ...r.cambios, updated_at: ahora }, { sesion })) || [];
  if (!hecho) return NextResponse.json({ error: "El cheque cambió mientras tanto. Actualizá la pantalla." }, { status: 409 });
  let final = hecho;
  if (usar) {
    [final] = (await sbPatch(`fin_cheques?id=eq.${id}&empresa_id=eq.${e}`, { op_cierre_id: usar, updated_at: ahora }, { sesion })) || [hecho];
  } else if (r.op) {
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

async function asignarCliente(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d.id);
  if (!(id > 0)) return NextResponse.json({ error: "Falta el cheque" }, { status: 400 });
  const [ch] = (await leer(sesion, `fin_cheques?id=eq.${id}&empresa_id=eq.${e}&select=id,clase,recibido_de&limit=1`)) || [];
  if (!ch) return NextResponse.json({ error: "No encontré el cheque" }, { status: 404 });
  if (ch.clase !== "tercero") return NextResponse.json({ error: "Solo los cheques recibidos tienen cliente" }, { status: 400 });
  const ctx = await contexto(sesion);
  const cliente = d.cliente_id ? clienteDeLista({ id: d.cliente_id }, ctx.clientes) : null;
  if (d.cliente_id && !cliente) return NextResponse.json({ error: "Ese cliente no está en la lista" }, { status: 400 });
  const ahora = new Date().toISOString();
  const cambios = { cliente_id: cliente ? Number(cliente.id) : null, updated_at: ahora, ...(cliente ? { recibido_de: String(cliente.nombre).slice(0, 120) } : {}) };
  let final;
  try {
    [final] = (await sbPatch(`fin_cheques?id=eq.${id}&empresa_id=eq.${e}`, cambios, { sesion })) || [];
  } catch (err) {
    if (faltaColumna192(err)) return NextResponse.json({ error: "Para elegir el cliente del cheque falta correr la migración 192 en Supabase.", falta_migracion: 192 }, { status: 409 });
    throw err;
  }
  // Sus movimientos (alta, depósito, rechazo) pasan a la cuenta corriente del cliente
  await sbPatch(`fin_operaciones?empresa_id=eq.${e}&origen=eq.cheque&origen_id=like.${id}:*&proveedor_id=is.null`, { cliente_id: cambios.cliente_id, updated_at: ahora }, { sesion });
  broadcastRefresh(e, "fin_cheques");
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, cheque: final || { ...ch, ...cambios } });
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
    const cliente = f.clase === "tercero" ? clienteDeLista({ nombre: f.librador }, ctx.clientes) : null;
    nuevas.push({
      cliente_id: cliente ? Number(cliente.id) : null,
      empresa_id: e, origen: "libro", referencia: ref, clase: f.clase, tipo: f.tipo, estado: f.estado,
      banco: t(f.banco, 60), numero: t(f.numero, 40), librador: t(f.librador, 120), beneficiario: t(f.beneficiario, 120),
      proveedor_id: proveedorId, entregado_a: t(f.entregado_a, 120), recibido_de: f.clase === "tercero" ? t(f.librador, 120) : null,
      fecha_emision: FECHA.test(String(f.fecha_emision || "")) ? f.fecha_emision : null, fecha_pago: f.fecha_pago, importe,
      cuenta_banco: f.clase === "propio" && f.cuenta_banco && ctx.tesoreria.some((x) => x.cuenta === f.cuenta_banco) ? f.cuenta_banco : null,
      notas: "Copiado de R-CHEQUES", cargado_por_nombre: quien, created_at: ahora, updated_at: ahora,
    });
    ya.add(ref);
  }
  // Cada cheque recibido queda ligado a su cliente (migración 192; sin ella, solo el nombre)
  for (let i = 0; i < nuevas.length; i += 500) {
    const tanda = nuevas.slice(i, i + 500);
    await sbPost("fin_cheques", tanda, { sesion }).catch((err) => {
      if (!faltaColumna192(err)) throw err;
      return sbPost("fin_cheques", tanda.map(({ cliente_id: _c, ...x }) => x), { sesion });
    });
  }
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
    if (d?.accion === "cliente") return await asignarCliente(sesion, d);
    if (d?.accion === "copiar_libro") return await copiarLibro(sesion, d);
    if (d?.accion === "anular_repetidos") return await anularRepetidos(sesion);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return error(err, `cheques ${d?.accion}`);
  }
}
