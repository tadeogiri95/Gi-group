// app/lib/paginaClienteOt.js — Qué ve el cliente en la página de su OT
// (/ot/<código>, 04/11; app/lib/linkClienteOt.js). Solo lo que le sirve al
// cliente: la OT completa, el estado, el % de producción y de instalación, la
// entrega y el PDF. Nunca precios, costos, operarios, paradas, retrabajos,
// notas internas ni minutas: por eso se arma acá campo por campo y no se pasa
// la fila de la OT entera. Sin nada de servidor: se prueba con datos sueltos.
import { partesOt } from "./nombreOt";
import { textoEntrega } from "./otLista";
import { piezasConManual } from "./avanceManual";
import { porcentajeOt } from "./piezas";
import { pdfsDeOt } from "./pdfOt";

/**
 * @param {{ proyecto: object, avance?: object[], instalacion?: number|null,
 *   acta?: { firmada_at?: string }|null, pausa?: object|null, archivos?: object[]|null,
 *   modo?: string|null, empresa?: object, ahora?: string }} d
 *   avance: filas de v_avance_piezas de esa OT; instalacion: el % del último
 *   reporte de instalación; archivos: la lista de PDF de la carpeta.
 */
export function datosClienteOt({ proyecto, avance = [], instalacion = null, acta = null, pausa = null, archivos = null, modo = null, empresa = {}, ahora = new Date().toISOString() }) {
  const p = proyecto || {};
  const filas = piezasConManual((avance || []).filter((f) => String(f.ot) === String(p.ot)), [p]);
  const produccion = porcentajeOt(filas);
  const inst = Number.isFinite(Number(instalacion)) && instalacion !== null ? Math.max(0, Math.min(100, Math.floor(Number(instalacion)))) : null;
  const { pdfs, deLaMadre } = pdfsDeOt(p.ot, archivos);
  const entrega = textoEntrega(p, modo);
  return {
    empresa: { nombre: String(empresa?.nombre || ""), logo: urlSegura(empresa?.logo_url), color: colorSeguro(empresa?.color_primario) },
    ot: partesOt(p),
    estado: estadoCliente({ p, produccion, instalacion: inst, acta, pausa }),
    produccion,
    instalacion: inst,
    entrega: entrega ? entrega.replace(/^Entrega /, "") : "",
    pdf: pdfs[0] ? { url: pdfs[0].url, nombre: pdfs[0].nombre, deLaMadre } : null,
    actualizado: ahora,
  };
}

/** Estado en palabras del cliente: { texto, tono: verde|ambar|gris }. */
export function estadoCliente({ p = {}, produccion = null, instalacion = null, acta = null, pausa = null }) {
  if (acta?.firmada_at) return { texto: "Instalada", tono: "verde" };
  if (p.estado === "cerrado" || p.terminado_planilla) return { texto: "Terminada", tono: "verde" };
  if (pausa) return { texto: "En pausa", tono: "gris" };
  if (instalacion != null && instalacion > 0) return { texto: instalacion >= 100 ? "Instalada" : "En instalación", tono: instalacion >= 100 ? "verde" : "ambar" };
  if (produccion != null && produccion >= 100) return { texto: "Fabricada, lista para instalar", tono: "verde" };
  if (produccion != null && produccion > 0) return { texto: "En fabricación", tono: "ambar" };
  return { texto: "En preparación", tono: "gris" };
}

function urlSegura(u) {
  const s = String(u ?? "").trim();
  return /^https:\/\/[^\s"'<>]{1,500}$/.test(s) ? s : null;
}

function colorSeguro(c) {
  const s = String(c ?? "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(s) ? s : null;
}
