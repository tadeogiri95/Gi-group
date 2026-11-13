// /api/finanzas/cheques/listado — Finanzas, parte 6 del plan de Tesorería
// (13/11): el listado de e-cheq del banco pone al día 🏦 Cheques (reglas en
// app/lib/finanzasEcheqListado.js; migración 189, fin_cheques.id_banco).
//
//   POST multipart { file } → lee el listado y devuelve los cheques, la
//       cuenta propia sugerida, el CUIT de la empresa, los cheques de Gypi y
//       los proveedores, para que la pantalla muestre qué cambia, qué se suma
//       y qué ya estaba (planListado). No guarda nada.
//   POST { accion: "aplicar", cheques, cuenta_propia, cuit_empresa,
//       cuenta_banco, elegidos: [id_banco] } → vuelve a armar el plan con lo
//       que hay en la base y aplica solo lo elegido:
//         - nuevo: el cheque se suma sin operación (lo pagado o cobrado ya
//           está en los movimientos);
//         - cambia: el cambio de estado con su operación, como en Cheques.
//           El débito o el depósito que ya está en el banco (del extracto o
//           cargado a mano: mismo importe, hasta 4 días) se une al cheque en
//           vez de cargarse otra vez;
//         - siempre guarda el Id. Cheque del banco: subirlo otra vez no repite.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../../lib/finanzasApi";
import { BANCO_ECHEQ, cambioDeEstado, cuentaBancoDe } from "../../../../lib/finanzasCheques";
import { grillaDeArchivo } from "../../../../lib/finanzasExtracto";
import { hoyAr } from "../../../../lib/finanzasOperaciones";
import { MAX_LISTADO, chequeNuevo, cuentaPropiaDe, cuentasEmisoras, cuitLimpio, leerListadoEcheq, planListado } from "../../../../lib/finanzasEcheqListado";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIAS_UNIR = 4;
const FALTA_189 = "Para subir el listado de e-cheq falta correr la migración 189 en Supabase.";
const falta189 = (err) => /id_banco|listado/.test(String(err?.message)) && /does not exist|42703|23514|PGRST20[045]|schema cache|violates check/.test(String(err?.message));
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const mover = (fecha, d) => new Date(Date.parse(`${fecha}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
const dias = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`);
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function contexto(sesion) {
  const e = sesion.empresa_id;
  const [cuentas, tesoreria, proveedores, gypi, empresa] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,cuit,activo&order=nombre.asc,id.asc`),
    leer(sesion, `fin_cheques?empresa_id=eq.${e}&select=id,clase,tipo,estado,numero,importe,fecha_pago,banco,beneficiario,recibido_de,librador,proveedor_id,cuenta_banco,op_alta_id,id_banco&order=id.asc`, 20000),
    sbGet(`empresa?id=eq.${e}&select=cuit&limit=1`, { silent: true, fallback: [] }),
  ]);
  return { cuentas, tesoreria, proveedores, gypi, cuit_empresa: cuitLimpio(empresa?.[0]?.cuit) };
}

const bancoPorDefecto = (tesoreria) => cuentaBancoDe(BANCO_ECHEQ, tesoreria) || tesoreria.find((t) => t.tipo === "banco" && t.moneda !== "USD" && t.activa !== false)?.cuenta || "";

async function leerArchivo(sesion, request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Elegí el archivo del listado" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "El archivo pesa más de 4 MB" }, { status: 413 });
  let grilla;
  try {
    grilla = await grillaDeArchivo(new Uint8Array(await file.arrayBuffer()), { maxFilas: MAX_LISTADO + 20, maxCols: 30 });
  } catch {
    return NextResponse.json({ error: "No pude leer el archivo. Subí el listado tal como lo baja el banco (.xls o .xlsx)." }, { status: 400 });
  }
  const { cheques, error } = leerListadoEcheq(grilla || []);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const ctx = await contexto(sesion);
  return NextResponse.json({
    ok: true, archivo: txt(file.name, 200) || null, cheques,
    cuenta_propia: cuentaPropiaDe(cheques), cuentas_emisoras: cuentasEmisoras(cheques),
    cuit_empresa: ctx.cuit_empresa, cuenta_banco: bancoPorDefecto(ctx.tesoreria),
    bancos: ctx.tesoreria.filter((t) => t.tipo === "banco" && t.moneda !== "USD" && t.activa !== false).map((t) => ({ cuenta: t.cuenta, nombre: t.nombre })),
    gypi: ctx.gypi, proveedores: ctx.proveedores.map((p) => ({ id: p.id, nombre: p.nombre, cuit: p.cuit })),
  });
}

/** Lo que llega de la pantalla, solo con la forma de un cheque del listado. */
function chequesDe(lista) {
  const out = [];
  for (const c of Array.isArray(lista) ? lista.slice(0, MAX_LISTADO) : []) {
    const monto = Math.round(Number(c?.monto) * 100) / 100;
    const id = txt(c?.id_banco, 40).toUpperCase();
    if (!id || !(monto > 0) || monto >= 1e13 || !FECHA.test(String(c?.fecha_pago || ""))) continue;
    out.push({
      id_banco: id, numero: txt(c.numero, 40), fecha_pago: c.fecha_pago, fecha_mod: FECHA.test(String(c.fecha_mod || "")) ? c.fecha_mod : null, monto,
      cuenta_emisor: txt(c.cuenta_emisor, 40), beneficiario: txt(c.beneficiario, 120), cuit_beneficiario: cuitLimpio(c.cuit_beneficiario),
      motivo: txt(c.motivo, 120), endosado_a: txt(c.endosado_a, 120), cuit_endosatario: cuitLimpio(c.cuit_endosatario),
      banco: txt(c.banco, 60), estado_banco: txt(c.estado_banco, 20).toUpperCase(),
    });
  }
  return out;
}

async function aplicar(sesion, d) {
  const e = sesion.empresa_id;
  const cheques = chequesDe(d.cheques);
  const elegidos = new Set((Array.isArray(d.elegidos) ? d.elegidos : []).map((x) => txt(x, 40).toUpperCase()));
  if (!cheques.length || !elegidos.size) return NextResponse.json({ error: "Elegí qué cheques poner al día" }, { status: 400 });
  const ctx = await contexto(sesion);
  const banco = txt(d.cuenta_banco, 40);
  if (!ctx.tesoreria.some((t) => t.cuenta === banco && t.tipo === "banco")) return NextResponse.json({ error: "Elegí el banco del listado" }, { status: 400 });
  const { filas } = planListado(cheques, ctx.gypi, { cuentaPropia: txt(d.cuenta_propia, 40), cuitEmpresa: txt(d.cuit_empresa, 20), proveedores: ctx.proveedores });
  const elegidas = filas.filter((f) => elegidos.has(f.c.id_banco) && (f.que === "nuevo" || f.que === "cambia"));
  const hoy = hoyAr();
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);

  // Lo que ya está en el banco, para unir los débitos y depósitos en vez de cargarlos otra vez
  const conPlata = elegidas.filter((f) => ["debitado", "depositado"].includes(f.accion));
  let delBanco = [];
  if (conPlata.length) {
    const fechas = conPlata.map((f) => f.c.fecha_pago).sort();
    const c = encodeURIComponent(`"${banco.replace(/"/g, "")}"`);
    delBanco = await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=gte.${mover(fechas[0], -DIAS_UNIR)}&fecha=lte.${mover(fechas[fechas.length - 1], DIAS_UNIR)}&or=(cuenta_debe.in.(${c}),cuenta_haber.in.(${c}))&select=id,fecha,total,total_ars,cuenta_debe,cuenta_haber,origen&order=fecha.asc,id.asc`, 20000);
  }
  const usadas = new Set((await leer(sesion, `fin_cheques?empresa_id=eq.${e}&op_cierre_id=not.is.null&select=op_cierre_id`, 20000)).map((x) => Number(x.op_cierre_id)));
  const buscarEnBanco = (f, fecha) => {
    const sale = f.accion === "debitado";
    let mejor = null;
    for (const o of delBanco) {
      if (usadas.has(Number(o.id)) || o.origen === "cheque") continue;
      if ((sale ? o.cuenta_haber : o.cuenta_debe) !== banco) continue;
      if (Math.abs((Number(o.total_ars ?? o.total) || 0) - f.c.monto) >= 0.01) continue;
      const dd = dias(o.fecha, fecha);
      if (dd > DIAS_UNIR) continue;
      if (!mejor || dd < mejor.dd) mejor = { o, dd };
    }
    return mejor?.o || null;
  };

  const r = { sumados: 0, cambiados: 0, unidos_al_banco: 0, solo_id: 0, errores: [] };
  // 1. Los nuevos, sin operación
  const nuevos = elegidas.filter((f) => f.que === "nuevo").map((f) => ({
    ...chequeNuevo(f, { cuentaBanco: f.clase === "propio" ? banco : null }), empresa_id: e, cargado_por_nombre: quien, created_at: ahora, updated_at: ahora,
  }));
  for (let i = 0; i < nuevos.length; i += 500) {
    await sbPost("fin_cheques", nuevos.slice(i, i + 500), { sesion });
    r.sumados += nuevos.slice(i, i + 500).length;
  }
  // 2. Los que cambian
  for (const f of elegidas.filter((x) => x.que === "cambia")) {
    const ch = f.cheque;
    if (!f.accion) {
      await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}`, { id_banco: f.c.id_banco, updated_at: ahora }, { sesion });
      r.solo_id++;
      continue;
    }
    const fecha = ["debitado", "depositado"].includes(f.accion) ? f.c.fecha_pago : (f.c.fecha_mod || f.c.fecha_pago);
    const cambio = cambioDeEstado(ch, f.accion, { fecha: fecha > hoy ? hoy : fecha, cuenta_banco: banco, proveedor: f.proveedor }, ctx);
    if (cambio.error) { r.errores.push(`Cheque ${f.c.numero}: ${cambio.error}`); continue; }
    const yaEnBanco = cambio.op && ["debitado", "depositado"].includes(f.accion) ? buscarEnBanco(f, fecha) : null;
    const [hecho] = (await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}&estado=eq.${ch.estado}`, { ...cambio.cambios, id_banco: f.c.id_banco, updated_at: ahora }, { sesion })) || [];
    if (!hecho) { r.errores.push(`Cheque ${f.c.numero}: cambió mientras tanto`); continue; }
    if (yaEnBanco) {
      usadas.add(Number(yaEnBanco.id));
      await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}`, { op_cierre_id: yaEnBanco.id, updated_at: ahora }, { sesion });
      r.unidos_al_banco++;
    } else if (cambio.op) {
      const [o] = (await sbPost("fin_operaciones", { ...cambio.op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora }, { sesion })) || [];
      if (o?.id) await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}`, { op_cierre_id: o.id, updated_at: ahora }, { sesion });
    } else if (ch.op_alta_id) {
      // Anulado: la operación del alta queda anulada (no se borra)
      await sbPatch(`fin_operaciones?id=eq.${ch.op_alta_id}&empresa_id=eq.${e}&anulada_at=is.null`, { anulada_at: ahora, anulada_por_nombre: quien || "Gypi (cheque anulado)", updated_at: ahora }, { sesion });
    }
    r.cambiados++;
  }
  broadcastRefresh(e, "fin_cheques");
  if (r.cambiados) broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, ...r });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  try {
    if (String(request.headers.get("content-type") || "").includes("multipart/form-data")) return await leerArchivo(sesion, request);
    const d = await request.json().catch(() => null);
    if (d?.accion === "aplicar") return await aplicar(sesion, d);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    if (falta189(err)) return NextResponse.json({ error: FALTA_189, falta_migracion: 189 }, { status: 409 });
    return errorFinanzas(err, "cheques listado");
  }
}
