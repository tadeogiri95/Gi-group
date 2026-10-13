// app/lib/carga.js — Acopio y carga de la OT (Órdenes de Producción, parte
// 10; ítem 39). Bultos numerados ("Bulto 3 de 12"), checklist de carga,
// faltantes con fecha, foto y dos firmas. "El camión no sale sin la lista
// firmada": se firma con todo cargado y tildado, o con el faltante anotado.
import { svgQR } from "./tarjetasQR";
import { normalizarChecklist } from "./avance";

export const CLAVE_CHECKLIST_CARGA = "checklist_carga";

/** Checklist de carga del mapa de procesos de la fábrica (de ejemplo). */
export const CHECKLIST_CARGA_FABRICA = [
  "Planilla técnica 100% tildada en control de calidad (o faltantes registrados y avisados al cliente)",
  "Todos los bultos de la lista presentes en el sector de acopio",
  "Caja de herrajes y accesorios completa y cerrada",
  "Herramientas e insumos de instalación (tarugos, silicona, niveles, etc.)",
  "Bultos protegidos (mantas, cartón, film) y bien sujetos",
];

/** Tamaños de rollo de la impresora de etiquetas (ancho × alto en mm). */
export const TAMANOS_ETIQUETA = [
  { id: "100x50", ancho: 100, alto: 50, nombre: "100 × 50 mm" },
  { id: "100x75", ancho: 100, alto: 75, nombre: "100 × 75 mm" },
  { id: "100x150", ancho: 100, alto: 150, nombre: "100 × 150 mm" },
  { id: "62x100", ancho: 62, alto: 100, nombre: "62 × 100 mm (Brother)" },
];

/**
 * Cómo está la carga de una OT.
 * @param {{ bultos?: object[], sueltos?: object[], carga?: object|null, checklist?: string[] }} datos
 *   checklist: el checklist de carga de la empresa
 */
export function estadoCarga({ bultos = [], sueltos = [], carga = null, checklist = [] }) {
  const lista = normalizarChecklist(checklist);
  const tildados = new Set(Array.isArray(carga?.checklist) ? carga.checklist : []);
  const bultosCargados = bultos.filter((b) => b.cargado).length;
  const sueltosCargados = sueltos.filter((s) => s.carga).length;
  const checklistFaltan = lista.filter((t) => !tildados.has(t));
  const pendientes = [];
  if (!bultos.length) pendientes.push("No hay bultos armados");
  else if (bultosCargados < bultos.length) pendientes.push(`Faltan cargar ${bultos.length - bultosCargados} de ${bultos.length} bultos`);
  if (sueltosCargados < sueltos.length) pendientes.push(`Faltan tildar ${sueltos.length - sueltosCargados} sueltos`);
  if (checklistFaltan.length) pendientes.push(`Faltan ${checklistFaltan.length} puntos del checklist`);
  const conFaltantes = !!String(carga?.faltantes || "").trim();
  return {
    bultos: bultos.length,
    bultosCargados,
    sueltos: sueltos.length,
    sueltosCargados,
    checklistFaltan,
    pendientes,
    completa: pendientes.length === 0,
    // Se puede firmar con todo completo, o con el faltante anotado
    puedeFirmar: bultos.length > 0 && (pendientes.length === 0 || conFaltantes),
    conFaltantes,
    firmaCarga: !!carga?.firma_carga_por,
    firmaInstalacion: !!carga?.firma_instalacion_por,
    firmada: !!(carga?.firma_carga_por && carga?.firma_instalacion_por),
    empezada: !!(carga?.firma_carga_por || carga?.firma_instalacion_por),
  };
}

/** Link que abre la carga de la OT en la app (va en el QR del rótulo). */
export function linkCarga(origen, slug, ot) {
  return `${String(origen).replace(/\/$/, "")}/${encodeURIComponent(slug)}?carga=${encodeURIComponent(String(ot))}`;
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));

export const MAX_ETIQUETAS = 999;

/**
 * Etiquetas de módulo (parte 12): una por módulo, "Módulo 3 de 12". Los
 * nombres son opcionales, uno por renglón (copiados del Excel de despiece);
 * si hay más nombres que módulos, manda la lista de nombres.
 * @returns {{ numero: number, contenido: string|null }[]}
 */
export function modulosParaEtiquetas(total, nombres = "") {
  const lista = String(nombres || "").split(/\r?\n/).map((t) => t.split("\t")[0].trim()).filter(Boolean);
  const n = Math.min(MAX_ETIQUETAS, Math.max(Number.isInteger(total) && total > 0 ? total : 0, lista.length));
  return Array.from({ length: n }, (_, i) => ({ numero: i + 1, contenido: lista.at(i)?.slice(0, 80) || null }));
}
/**
 * Página con una etiqueta por bulto (o por módulo, con titulo "Módulo"), del
 * tamaño del rollo de la impresora de etiquetas (una etiqueta por página).
 * @param {{ empresa: string, proyecto: object, bultos: object[], link: string, tamano: { ancho: number, alto: number }, titulo?: string }} datos
 */
export async function htmlRotulos({ empresa, proyecto, bultos, link, tamano, titulo = "Bulto" }) {
  const qr = await svgQR(link);
  const total = bultos.length;
  const qrMm = Math.min(tamano.alto - 8, tamano.ancho * 0.42);
  const datosObra = [proyecto.cliente || proyecto.proyecto, proyecto.obra].filter(Boolean).join(" · ");
  const entrega = proyecto.fecha_entrega ? `Entrega ${proyecto.fecha_entrega.split("-").reverse().join("/")}` : "";
  const items = bultos.map((b) => `
  <div class="rotulo">
    <div class="texto">
      <div class="empresa">${esc(empresa)}</div>
      <div class="ot">OT ${esc(proyecto.ot)}</div>
      <div class="bulto">${esc(titulo)} ${b.numero} de ${total}</div>
      ${datosObra ? `<div class="obra">${esc(datosObra)}</div>` : ""}
      ${entrega ? `<div class="obra">${esc(entrega)}</div>` : ""}
      ${b.contenido ? `<div class="contenido">${esc(b.contenido)}</div>` : ""}
    </div>
    <div class="qr">${qr}</div>
  </div>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo === "Bulto" ? "Rótulos" : "Etiquetas"} OT ${esc(proyecto.ot)}</title>
<style>
  @page { size: ${tamano.ancho}mm ${tamano.alto}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; }
  .rotulo { width: ${tamano.ancho}mm; height: ${tamano.alto}mm; padding: 3mm; display: flex; gap: 3mm; align-items: center; overflow: hidden; page-break-after: always; break-after: page; }
  .texto { flex: 1; min-width: 0; }
  .empresa { font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }
  .ot { font-size: 16pt; font-weight: 800; line-height: 1.1; }
  .bulto { font-size: 14pt; font-weight: 800; margin-top: 1mm; }
  .obra { font-size: 8pt; margin-top: .5mm; }
  .contenido { font-size: 8pt; margin-top: 1mm; border-top: .3mm solid #000; padding-top: 1mm; max-height: 40%; overflow: hidden; }
  .qr svg { width: ${qrMm}mm; height: ${qrMm}mm; display: block; }
</style></head><body>${items}</body></html>`;
}

/** Abre los rótulos (o las etiquetas de módulo) en una pestaña nueva con el diálogo de impresión. */
export async function imprimirRotulos(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(await htmlRotulos(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}
