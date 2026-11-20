// app/lib/finanzasPlazosFijosServidor.js — lo de plazos fijos que lee y
// escribe la base (reglas en finanzasPlazosFijos.js). Lo usan
// /api/finanzas/plazos-fijos, /api/finanzas/banco (al subir el extracto),
// /api/finanzas/resultados y /api/finanzas/flujo (el aviso).
//
// 20/11: el banco devuelve capital e interés en un solo renglón. Al subir el
// extracto, Gypi registra solo el interés aparte (con el importe del registro
// de plazos fijos) y pasa el renglón a la cuenta del plazo fijo: el saldo del
// banco no cambia, queda igual que el extracto. Antes había que apretar
// "Registrar" en Finanzas → Plazos fijos y, si no, el interés no contaba en
// el Estado de Resultados ni en el flujo de fondos.
import { sbGet, sbGetAll, sbPatch, sbPost } from "./sbHelpers";
import { broadcastRefresh } from "./broadcast";
import { hoyAr } from "./finanzasOperaciones";
import {
  CLAVE_PLAZOS_FIJOS, arreglosDelBanco, contextoPlazos, interesesSinRegistrar, leerGuardados, leerOpsPlazos, vencidosPendientes,
} from "./finanzasPlazosFijos";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

/** La lista guardada, las cuentas de plazo fijo y sus operaciones. */
export async function leerTodoPlazos(sesion) {
  const e = sesion.empresa_id;
  const hoy = hoyAr();
  const [tesoreria, cfg] = await Promise.all([
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
    sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLAZOS_FIJOS}&select=valor&limit=1`, { silent: true, fallback: [] }),
  ]);
  const cuentasPf = tesoreria.filter((t) => t.tipo === "plazo_fijo").map((t) => t.cuenta);
  const guardados = leerGuardados(cfg?.[0]?.valor);
  // Sin plazos guardados no hace falta leer las operaciones
  const { ops, cuentasInteres } = guardados.length || cuentasPf.length
    ? await leerOpsPlazos((path) => leer(sesion, path, 20000), e, cuentasPf, hoy)
    : { ops: [], cuentasInteres: [] };
  return { hoy, tesoreria, cuentasPf, cuentasInteres, ops, guardados, hay: Boolean(cfg?.length) };
}

/**
 * Pasa los renglones del extracto a la cuenta que corresponde (la del plazo
 * fijo o Intereses Ganados). Solo toca renglones que vinieron del banco.
 */
export async function aplicarCambiosPlazos(sesion, cambios = []) {
  const ahora = new Date().toISOString();
  for (const c of cambios) {
    await sbPatch(`fin_operaciones?id=eq.${Number(c.id)}&empresa_id=eq.${sesion.empresa_id}&origen=eq.banco&anulada_at=is.null`, { cuenta_haber: c.cuenta_haber, updated_at: ahora }, { sesion });
  }
  if (cambios.length) broadcastRefresh(sesion.empresa_id, "fin_operaciones");
}

export async function insertarOpsPlazos(sesion, ops = [], quien = null) {
  if (!ops.length) return;
  const ahora = new Date().toISOString();
  await sbPost("fin_operaciones", ops.map((o) => ({ ...o, empresa_id: sesion.empresa_id, cargada_por_nombre: quien || "Gypi (plazo fijo)", created_at: ahora, updated_at: ahora })), { sesion });
  broadcastRefresh(sesion.empresa_id, "fin_operaciones");
}

/**
 * Lo que el banco ya trajo de los plazos vencidos: el interés aparte (si vino
 * junto con el capital) y los renglones pasados a la cuenta que corresponde.
 * No carga vencimientos ni intereses nuevos contra el banco (eso sigue con el
 * botón de Plazos fijos): solo ordena lo que ya está en el extracto.
 * @returns {Promise<{ cargadas: number, corregidas: number, interes: number, errores: string[] }>}
 */
export async function registrarInteresesDelBanco(sesion, { base = null, quien = null } = {}) {
  const e = sesion.empresa_id;
  const b = base || (await leerTodoPlazos(sesion));
  const pendientes = vencidosPendientes(b.guardados, b.ops, b.cuentasPf, b.hoy, { cuentasInteres: b.cuentasInteres })
    .filter((p) => p.falta.interes_junto > 0 || p.falta.ajustes.length > 0);
  if (!pendientes.length) return { cargadas: 0, corregidas: 0, interes: 0, errores: [] };
  const [tipos, cuentas] = await Promise.all([
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,cuenta_debe,cuenta_haber,activo`),
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
  ]);
  const ops = [];
  const cambios = [];
  const errores = [];
  for (const p of pendientes) {
    const { ctx, errores: err } = contextoPlazos({ tipos, cuentas, tesoreria: b.tesoreria, banco: p.banco, cuenta_pf: p.cuenta_pf });
    if (err.length) { errores.push(`Plazo fijo ${p.certificado}: ${err[0]}`); continue; }
    const a = arreglosDelBanco(p, { ajustes: p.falta.ajustes, interesJunto: p.falta.interes_junto }, ctx);
    ops.push(...a.ops);
    cambios.push(...a.cambios);
  }
  await insertarOpsPlazos(sesion, ops, quien);
  await aplicarCambiosPlazos(sesion, cambios);
  const interes = Math.round(ops.reduce((s, o) => s + (Number(o.total) || 0), 0) * 100) / 100;
  return { cargadas: ops.length, corregidas: cambios.length, interes, errores };
}

/** El aviso: los plazos vencidos que todavía no tienen el interés registrado. */
export async function plazosSinInteres(sesion) {
  const b = await leerTodoPlazos(sesion);
  if (!b.guardados.length) return { cantidad: 0, importe: 0, certificados: [] };
  return interesesSinRegistrar(vencidosPendientes(b.guardados, b.ops, b.cuentasPf, b.hoy, { cuentasInteres: b.cuentasInteres }));
}
