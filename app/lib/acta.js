// app/lib/acta.js — Acta de conformidad de instalación (Órdenes de
// Producción, parte 11; ítem 39). El instalador descarga tildando los bultos,
// revisa el checklist de instalación, anota los pendientes y el cliente firma
// con el dedo en el celular. "La obra se cierra con un acta firmada".
import { normalizarChecklist } from "./avance";

export const CLAVE_CHECKLIST_INSTALACION = "checklist_instalacion";

/** Checklist de instalación del mapa de procesos de la fábrica (de ejemplo). */
export const CHECKLIST_INSTALACION_FABRICA = [
  "Módulos nivelados y bien fijados",
  "Puertas y cajones regulados",
  "Limpieza y retiro de residuos",
  "Recorrida con el cliente",
  "Fotos finales de la obra",
];

/**
 * Cómo está la instalación de una OT.
 * @param {{ bultos?: object[], pendientes?: object[], acta?: object|null, checklist?: string[] }} datos
 *   checklist: el checklist de instalación de la empresa
 */
export function estadoActa({ bultos = [], pendientes = [], acta = null, checklist = [] }) {
  const lista = normalizarChecklist(checklist);
  const tildados = new Set(Array.isArray(acta?.checklist) ? acta.checklist : []);
  const checklistFaltan = lista.filter((t) => !tildados.has(t));
  const noRecibidos = bultos.filter((b) => !b.descargado).map((b) => b.numero);
  const abiertos = pendientes.filter((p) => !p.resuelto).length;
  const firmada = !!acta?.firmada_at;
  // Lo que no se terminó tiene que quedar anotado como pendiente para firmar
  const puedeFirmar = !firmada && (checklistFaltan.length === 0 || pendientes.length > 0);
  let estado = "sin_empezar";
  if (firmada) estado = abiertos ? "con_pendientes" : "instalada";
  else if (acta || pendientes.length || bultos.some((b) => b.descargado)) estado = "en_obra";
  return {
    bultos: bultos.length,
    descargados: bultos.length - noRecibidos.length,
    noRecibidos,
    checklistFaltan,
    pendientes: pendientes.length,
    abiertos,
    firmada,
    puedeFirmar,
    estado,
  };
}

/** Texto corto del estado de la instalación (lista de OT, detalle y tablero). */
export const NOMBRE_ESTADO_ACTA = {
  sin_empezar: "",
  en_obra: "🔧 En instalación",
  con_pendientes: "⏳ Instalada con pendientes",
  instalada: "✅ Instalada",
};

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const fecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

/** Solo se muestran imágenes subidas por la app (https). */
const urlSegura = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);

/**
 * El acta lista para imprimir o guardar en PDF (hoja A4).
 * @param {{ empresa: string, proyecto: object, acta: object, bultos: object[], pendientes: object[], checklist: string[] }} datos
 */
export function htmlActa({ empresa, proyecto, acta, bultos = [], pendientes = [], checklist = [] }) {
  const est = estadoActa({ bultos, pendientes, acta, checklist });
  const tildados = new Set(Array.isArray(acta?.checklist) ? acta.checklist : []);
  const lista = normalizarChecklist(checklist);
  const datosObra = [
    ["Cliente", proyecto.cliente || proyecto.proyecto],
    ["Obra", proyecto.obra],
    ["OT", proyecto.ot],
    ["Fecha", fecha(acta?.firmada_at) || fecha(new Date().toISOString())],
  ].filter(([, v]) => v);
  const firma = urlSegura(acta?.firma_url);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta de conformidad OT ${esc(proyecto.ot)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; font-size: 11pt; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  h2 { font-size: 12pt; margin: 6mm 0 2mm; border-bottom: .3mm solid #000; padding-bottom: 1mm; }
  .empresa { font-size: 10pt; text-transform: uppercase; letter-spacing: .05em; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 1mm 0; vertical-align: top; }
  td.k { width: 30mm; font-weight: 700; }
  ul { margin: 0; padding-left: 5mm; }
  .firma { margin-top: 8mm; display: flex; gap: 10mm; align-items: flex-end; }
  .firma img { max-width: 80mm; max-height: 35mm; display: block; }
  .linea { border-top: .3mm solid #000; padding-top: 1mm; font-size: 9pt; min-width: 70mm; }
  .texto { font-size: 10pt; line-height: 1.4; }
</style></head><body>
  <div class="empresa">${esc(empresa)}</div>
  <h1>Acta de conformidad de instalación</h1>
  <table>${datosObra.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
  <p class="texto">El cliente recibe los trabajos de la obra instalados y declara su conformidad${pendientes.length ? ", con los pendientes que se detallan abajo" : ""}.</p>
  ${bultos.length ? `<h2>Entrega</h2><div class="texto">Se recibieron ${est.descargados} de ${est.bultos} bultos.${est.noRecibidos.length ? ` No llegaron: ${est.noRecibidos.map((n) => `bulto ${n}`).join(", ")}.` : ""}</div>` : ""}
  ${lista.length ? `<h2>Revisión</h2><ul>${lista.map((t) => `<li>${tildados.has(t) ? "✔" : "✘"} ${esc(t)}</li>`).join("")}</ul>` : ""}
  <h2>Pendientes</h2>
  ${pendientes.length ? `<ul>${pendientes.map((p) => `<li>${esc(p.descripcion)}${p.fecha ? ` (se resuelve el ${fecha(p.fecha)})` : ""}${p.resuelto ? " · resuelto" : ""}</li>`).join("")}</ul>` : `<div class="texto">Sin pendientes.</div>`}
  ${acta?.observaciones ? `<h2>Observaciones</h2><div class="texto">${esc(acta.observaciones)}</div>` : ""}
  <div class="firma">
    <div>
      ${firma ? `<img src="${esc(firma)}" alt="Firma del cliente">` : `<div style="height:30mm"></div>`}
      <div class="linea">Firma del cliente · ${esc(acta?.cliente_nombre || "")}</div>
    </div>
    <div>
      <div class="linea">Instalador · ${esc(acta?.instalador || "")}</div>
    </div>
  </div>
</body></html>`;
}

/** Abre el acta en una pestaña nueva con el diálogo de impresión (ahí se elige "Guardar como PDF"). */
export function imprimirActa(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlActa(datos));
  ventana.document.close();
  ventana.focus();
  // Espera la imagen de la firma antes de imprimir
  setTimeout(() => ventana.print(), 600);
}
