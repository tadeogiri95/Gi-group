// app/lib/syncComplejidad.js — Recalcula la clase A/B/C automática de las OT
// de una empresa (parte 46, migración 158; cálculo en app/lib/complejidad.js).
// Corre al final de la sincronización del Plan de trabajo (cambian placas y
// cantos preliminares) y de la planilla MRP (cambian las necesidades). Solo
// escribe las OT cuya clase cambió. Sin la migración 158 no hace nada.
import { logger } from "./logger";
import { clasesAutomaticas, cambiosClase } from "./complejidad";

const PAGINA = 1000;
const MAX_FILAS = 40000;
const OT_POR_PEDIDO = 80;

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
export async function recalcularClases(empresaId, fetcher) {
  let proyectos;
  try {
    proyectos = await todas(fetcher, `proyectos?empresa_id=eq.${empresaId}&select=ot,descripcion,tipo_proyecto,placas,fondos,metros_canto,clase_auto&order=ot`);
  } catch (e) {
    // Falta la 158 (clase_auto) o la 136/139: se sigue sin clase
    return { omitido: String(e?.message || e).slice(0, 200) };
  }
  let necesidades = [];
  try {
    necesidades = await todas(fetcher, `necesidades_stock?empresa_id=eq.${empresaId}&select=ot,nombre,cantidad&order=ot,sku`);
  } catch {
    // Sin la 108 la clase sale solo de las placas del Plan
  }
  const clases = clasesAutomaticas(proyectos, necesidades);
  const grupos = cambiosClase(proyectos, clases);
  let cambiadas = 0;
  try {
    for (const [clase, ots] of grupos) {
      for (let i = 0; i < ots.length; i += OT_POR_PEDIDO) {
        const lista = ots.slice(i, i + OT_POR_PEDIDO).map((o) => `"${o.replace(/"/g, "")}"`).join(",");
        await fetcher(`proyectos?empresa_id=eq.${empresaId}&ot=in.(${encodeURIComponent(lista)})`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ clase_auto: clase || null }),
        });
        cambiadas += Math.min(OT_POR_PEDIDO, ots.length - i);
      }
    }
  } catch (e) {
    logger.error("[complejidad] No se pudo guardar la clase de las OT", e);
  }
  return { cambiadas };
}
