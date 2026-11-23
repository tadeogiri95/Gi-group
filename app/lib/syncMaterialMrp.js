// app/lib/syncMaterialMrp.js — Guarda en cada OT las placas, los fondos y los
// metros de canto que salen de las necesidades del MRP (migración 202;
// reglas en app/lib/materialMrp.js). Corre al final de la sincronización de
// la planilla MRP. Solo escribe las OT que cambiaron. Sin la migración 202 no
// hace nada (los tiempos siguen solo con el Plan de trabajo).
import { logger } from "./logger";
import { materialMrpPorOt, cambiosMaterialMrp } from "./materialMrp";

const PAGINA = 1000;
const MAX_FILAS = 40000;
const EN_PARALELO = 8;

async function todas(fetcher, path) {
  const out = [];
  for (let offset = 0; offset < MAX_FILAS; offset += PAGINA) {
    const filas = (await fetcher(`${path}&limit=${PAGINA}&offset=${offset}`, {})) || [];
    out.push(...filas);
    if (filas.length < PAGINA) break;
  }
  return out;
}

/**
 * @param {string} empresaId
 * @param {(path: string, opts: object) => Promise<any>} fetcher el sbFetch de quien llama (con o sin sesión)
 * @returns {Promise<{ cambiadas: number } | { omitido: string }>}
 */
export async function recalcularMaterialMrp(empresaId, fetcher) {
  let proyectos;
  try {
    proyectos = await todas(fetcher, `proyectos?empresa_id=eq.${empresaId}&select=ot,placas_mrp,fondos_mrp,metros_canto_mrp&order=ot`);
  } catch (e) {
    // Falta la 202: se sigue solo con el Plan
    return { omitido: String(e?.message || e).slice(0, 200) };
  }
  let necesidades, articulos;
  try {
    [necesidades, articulos] = await Promise.all([
      todas(fetcher, `necesidades_stock?empresa_id=eq.${empresaId}&select=ot,sku,nombre,cantidad&order=ot,sku`),
      todas(fetcher, `articulos_stock?empresa_id=eq.${empresaId}&select=sku,nombre,familia,division&order=sku`),
    ]);
  } catch (e) {
    return { omitido: String(e?.message || e).slice(0, 200) };
  }
  const cambios = cambiosMaterialMrp(proyectos, materialMrpPorOt(necesidades, articulos));
  let cambiadas = 0;
  try {
    for (let i = 0; i < cambios.length; i += EN_PARALELO) {
      await Promise.all(cambios.slice(i, i + EN_PARALELO).map(({ ot, ...valores }) =>
        fetcher(`proyectos?empresa_id=eq.${empresaId}&ot=eq.${encodeURIComponent(ot)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(valores),
        })));
      cambiadas += Math.min(EN_PARALELO, cambios.length - i);
    }
  } catch (e) {
    logger.error("[material-mrp] No se pudo guardar el material del MRP de las OT", e);
  }
  return { cambiadas };
}
