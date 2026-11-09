// /api/finanzas/pagos — Finanzas, parte F2b (2): órdenes de pago (migración
// 175; reglas en app/lib/finanzasPagos.js).
//
//   GET → las órdenes (sin las anuladas, salvo ?anuladas=1), los cheques de
//       terceros en cartera, las cajas y bancos, los proveedores, la empresa
//       (para el PDF) y el nombre y WhatsApp del CFO.
//   POST { accion: "crear", orden, mandar? } → orden nueva (borrador, o ya
//       para aprobar con su link si mandar).
//   POST { accion: "mandar", id } → para aprobar: devuelve el link del CFO
//       (el mismo si ya estaba mandada; uno nuevo si fue rechazada).
//   POST { accion: "pagar", id, fecha } → solo aprobadas: genera las
//       operaciones, los e-cheq y entrega los cheques de terceros.
//   POST { accion: "anular", id } → anulada; si estaba pagada, deshace lo
//       que generó (si ningún e-cheq se debitó ni un cheque volvió rechazado).
//   POST { accion: "cfo", nombre, telefono } → guarda a quién se le manda.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige). El
// dato del CFO va en config_sistema.
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { cambioDeEstado, operacionAlta } from "../../../lib/finanzasCheques";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { CLAVE_CFO, accionesOrden, generarPago, validarOrden } from "../../../lib/finanzasPagos";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FALTA_175 = "Para las órdenes de pago falta correr la migración 175 en Supabase.";
const falta175 = (err) => /fin_ordenes_pago/.test(String(err?.message)) && /does not exist|42P01|PGRST20[05]|schema cache/.test(String(err?.message));

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);
const nuevoToken = () => crypto.randomBytes(24).toString("base64url");
const linkCfo = (request, token) => `${(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, "")}/op/${token}`;

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`)) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function contexto(sesion) {
  const e = sesion.empresa_id;
  const [cuentas, tesoreria, proveedores, cheques] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,activo,whatsapp&order=nombre.asc,id.asc`),
    leer(sesion, `fin_cheques?empresa_id=eq.${e}&clase=eq.tercero&estado=eq.en_cartera&select=*&order=fecha_pago.asc,id.asc`, 20000),
  ]);
  return { cuentas, tesoreria, proveedores, cheques };
}

async function leerOrden(sesion, id) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [o] = (await leer(sesion, `fin_ordenes_pago?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=*&limit=1`)) || [];
  return o || null;
}

function error(err, donde) {
  if (falta175(err)) return NextResponse.json({ error: FALTA_175, falta_migracion: 175 }, { status: 409 });
  return errorFinanzas(err, donde);
}

const refrescar = (e, ...tablas) => tablas.forEach((t) => broadcastRefresh(e, t));

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const anuladas = new URL(request.url).searchParams.get("anuladas") === "1";
  try {
    const [ctx, ordenes, empresas, cfg] = await Promise.all([
      contexto(sesion),
      leer(sesion, `fin_ordenes_pago?empresa_id=eq.${e}${anuladas ? "" : "&estado=neq.anulada"}&select=*&order=numero.desc`, 5000),
      sbGet(`empresa?id=eq.${e}&select=nombre,razon_social,logo_url&limit=1`, { silent: true, fallback: [] }),
      sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CFO}&select=valor&limit=1`, { silent: true, fallback: [] }),
    ]);
    const { cuentas: _c, ...resto } = ctx;
    return NextResponse.json({
      ...resto, ordenes,
      empresa: empresas?.[0] || {},
      cfo: { nombre: cfg?.[0]?.valor?.nombre || "", telefono: cfg?.[0]?.valor?.telefono || "" },
      links: Object.fromEntries((ordenes || []).filter((o) => o.token && o.estado === "para_aprobar").map((o) => [o.id, linkCfo(request, o.token)])),
    });
  } catch (err) {
    return error(err, "pagos GET");
  }
}

async function crear(request, sesion, d) {
  const e = sesion.empresa_id;
  const ctx = await contexto(sesion);
  const { orden, errores } = validarOrden(d.orden || {}, ctx);
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const mandar = d.mandar === true;
  // Número siguiente; si dos se cargan a la vez, el índice único hace reintentar
  for (let intento = 0; intento < 3; intento++) {
    const [ultima] = (await leer(sesion, `fin_ordenes_pago?empresa_id=eq.${e}&select=numero&order=numero.desc&limit=1`)) || [];
    const fila = {
      ...orden, empresa_id: e, numero: (Number(ultima?.numero) || 0) + 1,
      estado: mandar ? "para_aprobar" : "borrador", token: mandar ? nuevoToken() : null, enviada_at: mandar ? ahora : null,
      cargada_por_nombre: quien, created_at: ahora, updated_at: ahora,
    };
    try {
      const [o] = (await sbPost("fin_ordenes_pago", fila, { sesion })) || [];
      if (!o?.id) return NextResponse.json({ error: "No se pudo guardar la orden" }, { status: 500 });
      refrescar(e, "fin_ordenes_pago");
      return NextResponse.json({ ok: true, orden: o, url: o.token ? linkCfo(request, o.token) : null });
    } catch (err) {
      if (!/23505|duplicate key/.test(String(err?.message)) || intento === 2) throw err;
    }
  }
  return NextResponse.json({ error: "No se pudo guardar la orden" }, { status: 500 });
}

async function mandar(request, sesion, d) {
  const e = sesion.empresa_id;
  const o = await leerOrden(sesion, Number(d.id));
  if (!o) return NextResponse.json({ error: "No encontré esa orden" }, { status: 404 });
  if (!accionesOrden(o.estado).includes("mandar")) return NextResponse.json({ error: "Esta orden ya no se manda al CFO" }, { status: 400 });
  if (o.estado === "para_aprobar" && o.token) return NextResponse.json({ ok: true, orden: o, url: linkCfo(request, o.token) });
  const ahora = new Date().toISOString();
  // Link nuevo: el de una orden rechazada deja de servir
  const [hecha] = (await sbPatch(`fin_ordenes_pago?id=eq.${o.id}&empresa_id=eq.${e}&estado=eq.${o.estado}`, {
    estado: "para_aprobar", token: nuevoToken(), enviada_at: ahora, decidida_at: null, decidida_por_nombre: null, decision_nota: null, updated_at: ahora,
  }, { sesion })) || [];
  if (!hecha) return NextResponse.json({ error: "La orden cambió mientras tanto. Actualizá la pantalla." }, { status: 409 });
  refrescar(e, "fin_ordenes_pago");
  return NextResponse.json({ ok: true, orden: hecha, url: linkCfo(request, hecha.token) });
}

async function pagar(sesion, d) {
  const e = sesion.empresa_id;
  const o = await leerOrden(sesion, Number(d.id));
  if (!o) return NextResponse.json({ error: "No encontré esa orden" }, { status: 404 });
  if (o.estado !== "aprobada") return NextResponse.json({ error: "Solo se paga una orden aprobada por el CFO" }, { status: 400 });
  const fecha = FECHA.test(String(d.fecha || "")) ? d.fecha : hoyAr();
  const ctx = await contexto(sesion);
  const plan = generarPago(o, ctx, fecha);
  if (plan.error) return NextResponse.json({ error: plan.error }, { status: 400 });
  // Antes de tocar nada: los cheques de terceros siguen en cartera
  const proveedor = ctx.proveedores.find((p) => Number(p.id) === Number(o.proveedor_id));
  const entregas = [];
  for (const { cheque_id } of plan.entregar) {
    const ch = ctx.cheques.find((c) => Number(c.id) === cheque_id);
    if (!ch) return NextResponse.json({ error: "Un cheque de terceros de la orden ya no está en cartera. Anulá la orden y armá otra." }, { status: 400 });
    const r = cambioDeEstado(ch, "entregado", { fecha, proveedor }, ctx);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    entregas.push({ ch, ...r });
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  // La orden se marca primero: dos clics no pagan dos veces
  const [tomada] = (await sbPatch(`fin_ordenes_pago?id=eq.${o.id}&empresa_id=eq.${e}&estado=eq.aprobada`, {
    estado: "pagada", pagada_at: ahora, pagada_fecha: fecha, pagada_por_nombre: quien, token: null, updated_at: ahora,
  }, { sesion })) || [];
  if (!tomada) return NextResponse.json({ error: "La orden cambió mientras tanto. Actualizá la pantalla." }, { status: 409 });

  const generado = { operaciones: [], cheques_emitidos: [], cheques_entregados: [] };
  const extra = { empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora };
  try {
    if (plan.operaciones.length) {
      const ops = (await sbPost("fin_operaciones", plan.operaciones.map((op) => ({ ...op, ...extra })), { sesion })) || [];
      generado.operaciones.push(...ops.map((x) => x.id));
    }
    for (const ch of plan.emitir) {
      const [fila] = (await sbPost("fin_cheques", { ...ch, empresa_id: e, cargado_por_nombre: quien, created_at: ahora, updated_at: ahora }, { sesion })) || [];
      if (!fila?.id) throw new Error("No se pudo guardar el e-cheq");
      generado.cheques_emitidos.push(fila.id);
      const { op, error: sinCuentas } = operacionAlta(fila, ctx.cuentas, fecha);
      if (sinCuentas) throw new Error(sinCuentas);
      const [x] = (await sbPost("fin_operaciones", { ...op, ...extra }, { sesion })) || [];
      if (x?.id) await sbPatch(`fin_cheques?id=eq.${fila.id}&empresa_id=eq.${e}`, { op_alta_id: x.id, updated_at: ahora }, { sesion });
    }
    for (const { ch, cambios, op } of entregas) {
      const [hecho] = (await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}&estado=eq.en_cartera`, { ...cambios, updated_at: ahora }, { sesion })) || [];
      if (!hecho) throw new Error(`El cheque ${ch.numero || ch.id} ya no estaba en cartera`);
      generado.cheques_entregados.push(ch.id);
      const [x] = (await sbPost("fin_operaciones", { ...op, ...extra }, { sesion })) || [];
      if (x?.id) await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}`, { op_cierre_id: x.id, updated_at: ahora }, { sesion });
    }
  } catch (err) {
    // Lo que se llegó a generar queda anotado en la orden, para revisarlo o anularla
    await sbPatch(`fin_ordenes_pago?id=eq.${o.id}&empresa_id=eq.${e}`, { generado, updated_at: new Date().toISOString() }, { sesion }).catch(() => {});
    refrescar(e, "fin_ordenes_pago", "fin_operaciones", "fin_cheques");
    return NextResponse.json({ error: `El pago quedó a medias: ${err.message || "error"}. Anulá la orden para deshacer lo que se generó.` }, { status: 500 });
  }
  const [final] = (await sbPatch(`fin_ordenes_pago?id=eq.${o.id}&empresa_id=eq.${e}`, { generado, updated_at: new Date().toISOString() }, { sesion })) || [tomada];
  refrescar(e, "fin_ordenes_pago", "fin_operaciones", "fin_cheques");
  return NextResponse.json({ ok: true, orden: final, generado });
}

async function anular(sesion, d) {
  const e = sesion.empresa_id;
  const o = await leerOrden(sesion, Number(d.id));
  if (!o) return NextResponse.json({ error: "No encontré esa orden" }, { status: 404 });
  if (!accionesOrden(o.estado).includes("anular")) return NextResponse.json({ error: "Esta orden ya está anulada" }, { status: 400 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const g = o.generado || {};
  const emitidos = (g.cheques_emitidos || []).map(Number).filter(Boolean);
  const entregados = (g.cheques_entregados || []).map(Number).filter(Boolean);
  const cheques = emitidos.length || entregados.length
    ? (await leer(sesion, `fin_cheques?empresa_id=eq.${e}&id=in.(${[...emitidos, ...entregados].join(",")})&select=*`)) || []
    : [];
  // Primero se revisa que se pueda deshacer todo
  for (const ch of cheques) {
    if (emitidos.includes(ch.id) && !["pendiente", "anulado"].includes(ch.estado)) {
      return NextResponse.json({ error: `El e-cheq${ch.numero ? ` N° ${ch.numero}` : ""} ya se debitó: la orden no se puede anular.` }, { status: 400 });
    }
    if (entregados.includes(ch.id) && !["entregado", "en_cartera"].includes(ch.estado)) {
      return NextResponse.json({ error: `El cheque${ch.numero ? ` N° ${ch.numero}` : ""} volvió rechazado: la orden no se puede anular.` }, { status: 400 });
    }
  }
  const [hecha] = (await sbPatch(`fin_ordenes_pago?id=eq.${o.id}&empresa_id=eq.${e}&estado=eq.${o.estado}`, {
    estado: "anulada", token: null, anulada_at: ahora, anulada_por_nombre: quien, updated_at: ahora,
  }, { sesion })) || [];
  if (!hecha) return NextResponse.json({ error: "La orden cambió mientras tanto. Actualizá la pantalla." }, { status: 409 });
  const anularOp = (id) => sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, { anulada_at: ahora, anulada_por_nombre: quien || "Gypi (orden de pago anulada)", updated_at: ahora }, { sesion });
  for (const id of (g.operaciones || []).map(Number).filter(Boolean)) await anularOp(id);
  for (const ch of cheques) {
    if (emitidos.includes(ch.id) && ch.estado === "pendiente") {
      await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}&estado=eq.pendiente`, { estado: "anulado", estado_fecha: hoyAr(), updated_at: ahora }, { sesion });
      if (ch.op_alta_id) await anularOp(ch.op_alta_id);
    }
    if (entregados.includes(ch.id) && ch.estado === "entregado") {
      // Vuelve a la cartera
      await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}&estado=eq.entregado`, { estado: "en_cartera", estado_fecha: null, proveedor_id: null, entregado_a: null, op_cierre_id: null, updated_at: ahora }, { sesion });
      if (ch.op_cierre_id) await anularOp(ch.op_cierre_id);
    }
  }
  refrescar(e, "fin_ordenes_pago", "fin_operaciones", "fin_cheques");
  return NextResponse.json({ ok: true, orden: hecha });
}

async function guardarCfo(sesion, d) {
  const e = sesion.empresa_id;
  const valor = {
    nombre: String(d.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    telefono: String(d.telefono ?? "").replace(/[^\d+ -]/g, "").trim().slice(0, 30),
  };
  const ya = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CFO}&select=clave&limit=1`, { silent: true, fallback: [] });
  if (ya?.length) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CFO}`, { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_CFO, valor });
  return NextResponse.json({ ok: true, cfo: valor });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  try {
    if (d?.accion === "crear") return await crear(request, sesion, d);
    if (d?.accion === "mandar") return await mandar(request, sesion, d);
    if (d?.accion === "pagar") return await pagar(sesion, d);
    if (d?.accion === "anular") return await anular(sesion, d);
    if (d?.accion === "cfo") return await guardarCfo(sesion, d);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return error(err, `pagos ${d?.accion}`);
  }
}
