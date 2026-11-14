// app/lib/finanzasHistoricoBase.js — lo que necesitan el Histórico
// (/api/finanzas/historico) y la revisión de lo cargado a mano en el libro
// (etapa 7, /api/finanzas/libro): plan de cuentas, cajas, proveedores,
// clientes, lo que ya vino del libro, lo que entró a las cajas por otro lado
// y lo del libro que el Dueño anuló a mano. Con sesion va con el pase del
// usuario; sin sesion (el script del libro) con service_role, filtrado por la
// empresa.
import { sbGet, sbGetAll } from "./sbHelpers";
import { ORIGEN_LIBRO, anuladaAMano } from "./finanzasHistorico";
import { ORIGEN_SALDO_INICIAL } from "./finanzasProveedores";
import { desdeManuales } from "./finanzasLibroManual";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const ORIGENES = `origen=in.(${ORIGEN_LIBRO},${ORIGEN_SALDO_INICIAL})`;

/** @param {string} e empresa @param {object} [sesion] */
export async function leerBaseHistorico(e, sesion) {
  const [cuentas, tesoreria, proveedores, clientes, existentes] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre&order=codigo.asc`),
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre&order=nombre.asc,id.asc`, 10000),
    leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=nombre.asc,id.asc`, 10000),
    leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&${ORIGENES}&select=id,origen,origen_id,fecha,descripcion`, 100000),
  ]);
  // 13/11: lo que entró por otro lado (extracto, plazos fijos, pagos…) a
  // una caja o banco, para no pasarlo dos veces
  const lista = tesoreria.map((t) => `"${String(t.cuenta).replace(/"/g, "")}"`).join(",");
  const otras = lista
    ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&origen=not.in.(${ORIGEN_LIBRO},${ORIGEN_SALDO_INICIAL})&or=(${encodeURIComponent(`cuenta_debe.in.(${lista}),cuenta_haber.in.(${lista})`)})&select=id,origen,fecha,total,cuenta_debe,cuenta_haber`, 100000)
    : [];
  // 13/11: lo del libro que el Dueño anuló en Gypi, para no volver a pasarlo
  const anuladasLibro = await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_LIBRO}&anulada_at=not.is.null&select=origen_id,anulada_por_nombre`, 100000);
  const anuladas = [...new Set(anuladasLibro.filter((o) => anuladaAMano(o.anulada_por_nombre)).map((o) => o.origen_id))];
  return { cuentas, tesoreria, proveedores, clientes, existentes, otras, anuladas };
}

/**
 * Desde qué fecha el Histórico dejó Gypi igual al libro (ver desdeManuales),
 * a partir de lo que ya vino del libro.
 * @param {{ origen: string, fecha: string, descripcion?: string }[]} existentes
 */
export function desdeDeExistentes(existentes = []) {
  let apertura = null;
  let primera = null;
  for (const o of existentes) {
    if (o.origen === ORIGEN_SALDO_INICIAL && /del libro$/.test(String(o.descripcion || "")) && (!apertura || o.fecha > apertura)) apertura = o.fecha;
    if (o.origen === ORIGEN_LIBRO && (!primera || o.fecha < primera)) primera = o.fecha;
  }
  return desdeManuales({ apertura, primeraDelLibro: primera });
}

/** Lo mismo sin leer todo: dos consultas cortas (para el GET del script). */
export async function leerDesdeManuales(e) {
  const [ap, pr] = await Promise.all([
    sbGet(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_SALDO_INICIAL}&anulada_at=is.null&descripcion=like.*del%20libro&select=fecha&order=fecha.desc&limit=1`, { silent: true, fallback: [] }),
    sbGet(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_LIBRO}&anulada_at=is.null&select=fecha&order=fecha.asc&limit=1`, { silent: true, fallback: [] }),
  ]);
  return desdeManuales({ apertura: ap?.[0]?.fecha || null, primeraDelLibro: pr?.[0]?.fecha || null });
}
