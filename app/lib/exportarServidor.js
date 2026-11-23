// app/lib/exportarServidor.js — Arma el .zip con todos los datos de una
// empresa (un CSV por tabla). Lo usan "⬇️ Descargar todos los datos"
// (/api/cuenta/exportar) y el respaldo semanal que el script del libro guarda
// en el Google Drive del Dueño (14/11, /api/finanzas/libro?respaldo=1).
// Va con la llave del servidor, siempre filtrado por la empresa.
import { sbGet, sbGetAll } from "./sbHelpers";
import { TABLAS_EXPORTAR, TABLAS_SIN_ID, aCsv, armarZip, leeme, sinSecretos } from "./exportar";
import { logger } from "./logger";

const MAX_FILAS_TABLA = 200000;

/**
 * @param {string} e empresa
 * @returns {Promise<null | { zip: Uint8Array, nombre: string, fecha: string, tablas: object[], fallidas: string[], truncadas: string[] }>}
 *   null si la empresa no existe.
 */
export async function armarRespaldo(e) {
  const [empresa] = (await sbGet(`empresa?id=eq.${e}&select=*&limit=1`)) || [];
  if (!empresa) return null;
  const archivos = { "empresa.csv": aCsv([sinSecretos(empresa)]) };
  const tablas = [{ nombre: "empresa", filas: 1 }];
  const fallidas = [];
  const truncadas = [];
  // De a 4 tablas por vez (14/11: son ~90): rápido sin saturar la base
  const leerTabla = async (tabla) => {
    try {
      const { data, truncado } = await sbGetAll(`${tabla}?empresa_id=eq.${e}&select=*${TABLAS_SIN_ID.has(tabla) ? "" : "&order=id.asc"}`, { maxFilas: MAX_FILAS_TABLA });
      return { tabla, data, truncado };
    } catch (err) {
      logger.error(`[respaldo] ${tabla}`, err);
      return { tabla, error: true };
    }
  };
  for (let i = 0; i < TABLAS_EXPORTAR.length; i += 4) {
    for (const r of await Promise.all(TABLAS_EXPORTAR.slice(i, i + 4).map(leerTabla))) {
      if (r.error) { fallidas.push(r.tabla); continue; }
      archivos[`${r.tabla}.csv`] = aCsv(r.data);
      tablas.push({ nombre: r.tabla, filas: r.data.length });
      if (r.truncado) truncadas.push(r.tabla);
    }
  }
  const fecha = new Date().toISOString().slice(0, 10);
  archivos["LEEME.txt"] = leeme({ empresa: empresa.nombre, fecha, tablas, fallidas, truncadas });
  return { zip: armarZip(archivos), nombre: `gypi-${empresa.slug || "empresa"}-${fecha}.zip`, fecha, tablas, fallidas, truncadas };
}
