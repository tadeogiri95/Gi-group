// app/lib/refrescoVisible.js — Recarga periódica que solo corre con la pantalla
// a la vista (F3-04).
//
// Antes cada pestaña abierta repetía todas las consultas cada 1–2 minutos aunque
// nadie la mirara, y cada aviso de Realtime disparaba una recarga completa (una
// ráfaga de cambios = una ráfaga de recargas). Con esto:
//   - el polling se saltea mientras la pestaña está oculta;
//   - al volver a la pestaña se recarga una vez si los datos quedaron viejos o
//     llegó un aviso mientras estaba oculta;
//   - los avisos de Realtime se agrupan: varios seguidos = una sola recarga;
//   - nunca hay dos recargas en paralelo: si llega un pedido durante una, se
//     hace otra al terminar.

const esVisible = (doc) => !doc || doc.visibilityState !== "hidden";

/**
 * @param {() => unknown} fn recarga a ejecutar
 * @param {{ intervaloMs: number, esperaMs?: number, doc?: Document }} opciones
 */
export function crearRefresco(fn, { intervaloMs, esperaMs = 1500, doc = globalThis.document } = /** @type {any} */ ({})) {
  let ultima = Date.now();
  let enCurso = false;
  let repetir = false;
  let pendienteOculto = false;
  let intervalo = null;
  let espera = null;

  async function ejecutar() {
    if (enCurso) {
      repetir = true;
      return;
    }
    enCurso = true;
    ultima = Date.now();
    try {
      await fn();
    } catch {
      // cada pantalla maneja y muestra sus propios errores
    } finally {
      enCurso = false;
      if (repetir) {
        repetir = false;
        ejecutar();
      }
    }
  }

  function alCambiarVisibilidad() {
    if (!esVisible(doc)) return;
    if (pendienteOculto || Date.now() - ultima >= intervaloMs) {
      pendienteOculto = false;
      ejecutar();
    }
  }

  return {
    iniciar() {
      ultima = Date.now();
      intervalo = setInterval(() => {
        if (esVisible(doc)) ejecutar();
      }, intervaloMs);
      doc?.addEventListener?.("visibilitychange", alCambiarVisibilidad);
    },
    detener() {
      clearInterval(intervalo);
      clearTimeout(espera);
      intervalo = espera = null;
      doc?.removeEventListener?.("visibilitychange", alCambiarVisibilidad);
    },
    /** Pide una recarga (p. ej. por un aviso de Realtime); se agrupa con las cercanas. */
    pedir() {
      if (!esVisible(doc)) {
        pendienteOculto = true;
        return;
      }
      clearTimeout(espera);
      espera = setTimeout(() => {
        espera = null;
        ejecutar();
      }, esperaMs);
    },
  };
}
