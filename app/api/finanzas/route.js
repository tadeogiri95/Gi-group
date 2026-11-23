// /api/finanzas — Finanzas, parte F1a (migración 171; app/lib/finanzas.js).
//
//   GET  → configuración: plan de cuentas, tipos de operación, cajas y bancos,
//          centros de costo, y el personal (para elegir el responsable de una caja).
//   POST { accion: "importar", tabla, filas } → copia del libro: alta o
//          reemplazo por código (lo que no viene en el libro queda como está).
//          tabla = cuentas | tipos | tesoreria | centros.
//   POST { accion: "guardar", tabla, fila } → alta o edición de una fila.
//   POST { accion: "caja_nueva", caja: { nombre, tipo, moneda, responsable_id } }
//          → caja nueva desde Tesorería, con el código de cuenta elegido por
//          Gypi (también la suma al plan de cuentas). 15/11.
//   POST { accion: "caja_eliminar", cuenta } → la borra si nunca se usó
//          (migración 195); si tuvo movimientos la archiva, con saldo en cero.
//
// Solo el rol Dueño (gerencial). El Supervisor no entra (pedido de Tadeo,
// 09/11). Lee y escribe con el pase del usuario: la base también exige el rol
// gerencial (RLS de la 171).
import { NextResponse } from "next/server";
import { sbGetAll, sbHeaders } from "../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../lib/planEnforcement";
import { broadcastRefresh } from "../../lib/broadcast";
import { TABLAS_FIN, limpiarFila, limpiarFilas } from "../../lib/finanzas";
import { codigoNuevaCaja, comoEliminarCaja, limpiarCajaNueva } from "../../lib/finanzasCajas";
import { plata } from "../../lib/finanzasOperaciones";
import { sesionDueno, errorFinanzas as errorDe } from "../../lib/finanzasApi";
import { rechazarSiNoConfigura } from "../../lib/accesosServidor";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const TANDA = 500;

/** Alta o reemplazo por clave: filas nuevas entran, las que ya están se actualizan. */
async function upsert(sesion, tabla, filas) {
  const { tabla: t, clave } = TABLAS_FIN[tabla];
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  for (let i = 0; i < filas.length; i += TANDA) {
    const tanda = filas.slice(i, i + TANDA).map((f) => ({ ...f, empresa_id: e, updated_at: ahora }));
    const r = await fetch(`${SB_URL}/rest/v1/${t}?on_conflict=empresa_id,${clave}`, {
      method: "POST",
      headers: await sbHeaders({ sesion }, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(tanda),
    });
    if (!r.ok) throw new Error(`POST ${t}: ${await r.text()}`);
  }
}

const leerTodo = (sesion, path) => sbGetAll(path, { sesion, maxFilas: 60000 }).then((r) => r.data || []);

/** Caja nueva: Gypi elige el código y la suma también al plan de cuentas. */
async function cajaNueva(sesion, d) {
  const e = sesion.empresa_id;
  const { caja, error } = limpiarCajaNueva(d.caja);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const [tesoreria, cuentas] = await Promise.all([
    leerTodo(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda`),
    leerTodo(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
  ]);
  const r = codigoNuevaCaja(caja, tesoreria, cuentas);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  if (!cuentas.some((c) => c.codigo === r.codigo)) {
    await upsert(sesion, "cuentas", [{ codigo: r.codigo, nombre: caja.nombre, rubro: "ACTIVO CORRIENTE", naturaleza: "D", activa: true }]);
    broadcastRefresh(e, "fin_cuentas");
  }
  const fila = { cuenta: r.codigo, ...caja, activa: true };
  await upsert(sesion, "tesoreria", [fila]);
  broadcastRefresh(e, "fin_tesoreria");
  return NextResponse.json({ ok: true, fila, reusa: r.reusa });
}

/** Eliminar una caja: se borra si nunca se usó; si tuvo movimientos, se archiva (con saldo en cero). */
async function cajaEliminar(sesion, d) {
  const e = sesion.empresa_id;
  const cuenta = String(d.cuenta || "").trim();
  if (!cuenta) return NextResponse.json({ error: "Falta la caja" }, { status: 400 });
  const q = encodeURIComponent(`"${cuenta.replace(/"/g, "")}"`);
  const [caja] = await leerTodo(sesion, `fin_tesoreria?empresa_id=eq.${e}&cuenta=eq.${q}&select=cuenta,nombre,tipo,moneda,activa&limit=1`);
  if (!caja) return NextResponse.json({ error: "No encontré esa caja" }, { status: 404 });
  // También las anuladas: una caja que alguna vez se usó no se borra
  const ops = await leerTodo(sesion, `fin_operaciones?empresa_id=eq.${e}&or=(cuenta_debe.eq.${q},cuenta_haber.eq.${q})&select=cuenta_debe,cuenta_haber,total,total_ars,anulada_at`);
  // Cheques y extractos que la nombran (sin esas migraciones, no cuentan)
  const usos = await Promise.all([
    leerTodo(sesion, `fin_cheques?empresa_id=eq.${e}&cuenta_banco=eq.${q}&select=id&limit=1`).catch(() => []),
    leerTodo(sesion, `fin_cargas_banco?empresa_id=eq.${e}&cuenta=eq.${q}&select=id&limit=1`).catch(() => []),
  ]);
  const r = comoEliminarCaja(caja, ops, usos.reduce((n, u) => n + u.length, 0));
  if (r.accion === "saldo") {
    return NextResponse.json({ error: `${caja.nombre} tiene ${plata(r.saldo, caja.moneda)}. Primero pasá esa plata a otra caja (➕ Cargar → Entre cajas) y después archivala.` }, { status: 409 });
  }
  if (r.accion === "archivar") {
    await upsert(sesion, "tesoreria", [{ cuenta: caja.cuenta, nombre: caja.nombre, activa: false }]);
    broadcastRefresh(e, "fin_tesoreria");
    return NextResponse.json({ ok: true, accion: "archivar", movimientos: r.movimientos });
  }
  const res = await fetch(`${SB_URL}/rest/v1/fin_tesoreria?empresa_id=eq.${e}&cuenta=eq.${q}`, {
    method: "DELETE",
    headers: await sbHeaders({ sesion }, { Prefer: "return=representation" }),
  });
  const borradas = res.ok ? await res.json().catch(() => []) : [];
  if (!res.ok || !borradas.length) {
    // Sin la migración 195 la base no deja borrar: se archiva y se avisa
    await upsert(sesion, "tesoreria", [{ cuenta: caja.cuenta, nombre: caja.nombre, activa: false }]);
    broadcastRefresh(e, "fin_tesoreria");
    return NextResponse.json({ ok: true, accion: "archivar", movimientos: 0, aviso: "Quedó archivada: para poder borrarla del todo falta correr la migración 195 en Supabase." });
  }
  broadcastRefresh(e, "fin_tesoreria");
  return NextResponse.json({ ok: true, accion: "borrar" });
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const leer = (path) => sbGetAll(path, { sesion, maxFilas: 5000 }).then((r) => r.data);
    const [cuentas, tipos, tesoreria, centros, personal] = await Promise.all([
      leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,naturaleza,activa&order=codigo.asc`),
      leer(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,base_contable,cuenta_debe,cuenta_haber,pide_entidad,pide_ot,pide_cc,descripcion,activo&order=codigo.asc`),
      leer(`fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,responsable_id,activa&order=cuenta.asc`),
      leer(`fin_centros_costo?empresa_id=eq.${e}&select=codigo,nombre,division,tipo,activo&order=codigo.asc`),
      leer(`empleados?empresa_id=eq.${e}&activo=eq.true&select=id,nombre&order=nombre.asc`),
    ]);
    return NextResponse.json({ cuentas, tipos, tesoreria, centros, personal });
  } catch (err) {
    return errorDe(err, "GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  // Plan de cuentas, tipos, cajas y centros: configuración (181)
  const sinConfigurar = await rechazarSiNoConfigura(sesion);
  if (sinConfigurar) return sinConfigurar;
  const d = await request.json().catch(() => null);
  if (!d || typeof d !== "object") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  try {
    if (d.accion === "caja_nueva") return await cajaNueva(sesion, d);
    if (d.accion === "caja_eliminar") return await cajaEliminar(sesion, d);
  } catch (err) {
    return errorDe(err, d.accion);
  }
  if (!TABLAS_FIN[d.tabla]) return NextResponse.json({ error: "Tabla desconocida" }, { status: 400 });
  try {
    if (d.accion === "importar") {
      const { filas, error } = limpiarFilas(d.tabla, d.filas);
      if (error) return NextResponse.json({ error }, { status: 400 });
      await upsert(sesion, d.tabla, filas);
      broadcastRefresh(sesion.empresa_id, TABLAS_FIN[d.tabla].tabla);
      return NextResponse.json({ ok: true, copiadas: filas.length });
    }
    if (d.accion === "guardar") {
      const { fila, error } = limpiarFila(d.tabla, d.fila);
      if (error) return NextResponse.json({ error }, { status: 400 });
      await upsert(sesion, d.tabla, [fila]);
      broadcastRefresh(sesion.empresa_id, TABLAS_FIN[d.tabla].tabla);
      return NextResponse.json({ ok: true, fila });
    }
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return errorDe(err, d.accion);
  }
}
