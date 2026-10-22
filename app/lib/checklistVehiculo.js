// app/lib/checklistVehiculo.js — Checklist de mantenimiento de vehículos
// (Mantenimiento, parte 29; ítem 43; migración 127; diseño en
// notes/diseno-mantenimiento-vehicular.md).
//
// La plantilla son secciones con puntos. Cada empresa la puede cambiar
// (flota_config.checklist); sin cambios se usa PLANTILLA_FABRICA. Cada punto
// se marca Bien, Revisar, Mal o No aplica; Revisar y Mal piden nota y foto.
// Un punto con "minimo" (por ejemplo el dibujo de la cubierta, 1,6 mm) se
// marca Mal solo si el valor queda debajo.

export const ESTADOS_PUNTO = [
  { id: "bien", nombre: "Bien", emoji: "✅" },
  { id: "revisar", nombre: "Revisar", emoji: "⚠️" },
  { id: "mal", nombre: "Mal", emoji: "❌" },
  { id: "na", nombre: "No aplica", emoji: "➖" },
];

export const NIVELES_COMBUSTIBLE = ["reserva", "1/4", "1/2", "3/4", "lleno"];
export const MINIMO_DIBUJO_MM = 1.6;

const p = (id, nombre, extra = {}) => ({ id, nombre, valor: null, minimo: null, ...extra });
const rueda = (id, nombre) => p(id, `${nombre}: dibujo`, { valor: "mm", minimo: MINIMO_DIBUJO_MM });

export const PLANTILLA_FABRICA = [
  { id: "limpieza", nombre: "Limpieza", emoji: "🧽", puntos: [
    p("exterior", "Exterior"),
    p("interior", "Interior y tablero"),
    p("vidrios", "Vidrios y espejos"),
    p("carga", "Caja o zona de carga"),
    p("sueltos", "Sin objetos sueltos ni basura"),
  ] },
  { id: "fluidos", nombre: "Fluidos", emoji: "🛢️", puntos: [
    p("aceite", "Aceite de motor (nivel)"),
    p("refrigerante", "Refrigerante"),
    p("frenos", "Líquido de frenos"),
    p("direccion", "Dirección hidráulica"),
    p("limpiaparabrisas", "Agua del limpiaparabrisas"),
    p("perdidas", "Sin pérdidas debajo del vehículo"),
  ] },
  { id: "documentacion", nombre: "Documentación", emoji: "📄", puntos: [
    p("cedula", "Cédula"),
    p("seguro", "Póliza o certificado de seguro"),
    p("itv", "Oblea y certificado de ITV"),
    p("licencia", "Licencia del chofer"),
    p("patente", "Comprobante de patente"),
    p("legible", "Todo a bordo y legible"),
  ] },
  { id: "neumaticos", nombre: "Neumáticos", emoji: "🛞", puntos: [
    rueda("di", "Delantera izquierda"),
    rueda("dd", "Delantera derecha"),
    rueda("ti", "Trasera izquierda"),
    rueda("td", "Trasera derecha"),
    rueda("auxilio", "Auxilio"),
    p("presion", "Presión de las ruedas", { valor: "psi" }),
    p("cortes", "Sin cortes, globos ni desgaste disparejo"),
    p("herramientas", "Llave de ruedas y criquet"),
  ] },
  { id: "itv", nombre: "ITV (requisitos)", emoji: "✅", puntos: [
    p("matafuego", "Matafuego cargado, vigente y sujeto"),
    p("balizas", "2 balizas triangulares"),
    p("chaleco", "Chaleco reflectivo"),
    p("botiquin", "Botiquín"),
    p("frenos", "Frenos y freno de mano"),
    p("direccion", "Dirección y tren delantero"),
    p("suspension", "Suspensión y amortiguadores"),
    p("cinturones", "Cinturones y asientos"),
    p("bocina", "Bocina"),
    p("escobillas", "Escobillas"),
    p("espejos", "Espejos"),
    p("sin_perdidas", "Sin pérdidas de fluidos"),
    p("polarizado", "Sin polarizado ni laminado no permitido"),
    p("agregados", "Sin enganche, defensas ni luces agregadas sin homologar"),
    p("numeros", "Números de chasis y motor legibles"),
    p("patentes", "Patentes legibles"),
    p("escape", "Escape sin ruido de más ni humo"),
  ] },
  { id: "seguro", nombre: "Seguro", emoji: "🛡️", puntos: [
    p("vigente", "Póliza vigente"),
    p("a_bordo", "Comprobante a bordo"),
    p("grua", "Teléfono de la compañía y de la grúa a mano"),
  ] },
  { id: "luces", nombre: "Luces", emoji: "💡", puntos: [
    p("bajas", "Bajas"),
    p("altas", "Altas"),
    p("posicion", "Posición"),
    p("giros", "Giros (adelante y atrás)"),
    p("balizas", "Balizas"),
    p("freno", "Freno (incluida la tercera)"),
    p("reversa", "Reversa"),
    p("patente", "Patente"),
    p("tablero", "Tablero sin testigos encendidos"),
  ] },
];

/** La plantilla de la empresa, o la de fábrica si no la cambió (o vino rota). */
export function plantillaDe(config) {
  const lista = Array.isArray(config?.checklist) ? config.checklist : null;
  const ok = lista && lista.length > 0 && lista.every((s) => s && s.id && s.nombre && Array.isArray(s.puntos));
  return ok ? lista : PLANTILLA_FABRICA;
}

/** Un id corto y único dentro de la lista, a partir del nombre. */
export function idNuevo(nombre, usados = []) {
  const base = String(nombre ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "punto";
  const set = new Set(usados);
  let id = base;
  for (let i = 2; set.has(id); i++) id = `${base}_${i}`;
  return id;
}

/** Con un mínimo (dibujo de la cubierta): debajo es Mal, arriba es Bien. */
export function estadoSugerido(punto, valor) {
  if (punto?.minimo == null || valor === "" || valor == null) return null;
  const n = Number(String(valor).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n < punto.minimo ? "mal" : "bien";
}

/**
 * Qué falta para guardar: cada punto de las secciones elegidas con su estado,
 * y nota y foto en los que quedaron en Revisar o Mal. Devuelve una lista de
 * textos (vacía = se puede guardar).
 */
export function faltantesChecklist({ plantilla, secciones = [], respuestas = {}, km }) {
  const faltan = [];
  if (km === null || km === undefined || km === "" || !Number.isInteger(Number(km)) || Number(km) < 0) faltan.push("Los kilómetros");
  if (!secciones.length) faltan.push("Elegir al menos una sección");
  for (const s of plantilla.filter((x) => secciones.includes(x.id))) {
    for (const pt of s.puntos) {
      const r = respuestas[`${s.id}.${pt.id}`] || {};
      if (!r.estado) { faltan.push(`${s.nombre}: ${pt.nombre}`); continue; }
      if ((r.estado === "revisar" || r.estado === "mal") && !String(r.nota ?? "").trim()) faltan.push(`${s.nombre}: ${pt.nombre} (falta la nota)`);
      if ((r.estado === "revisar" || r.estado === "mal") && !r.foto) faltan.push(`${s.nombre}: ${pt.nombre} (falta la foto)`);
    }
  }
  return faltan;
}

/** Las respuestas en el formato que se guarda: con los nombres, para que el historial no cambie si se edita la plantilla. */
export function itemsChecklist({ plantilla, secciones, respuestas }) {
  const items = [];
  for (const s of plantilla.filter((x) => secciones.includes(x.id))) {
    for (const pt of s.puntos) {
      const r = respuestas[`${s.id}.${pt.id}`] || {};
      const valor = r.valor === "" || r.valor == null ? null : String(r.valor).trim().slice(0, 20);
      items.push({
        seccion: s.id, seccion_nombre: s.nombre, punto: pt.id, nombre: pt.nombre,
        estado: r.estado, valor, unidad: pt.valor || null,
        nota: String(r.nota ?? "").trim() || null, foto: r.foto || null,
        // Parte 31: un punto en Mal que deja el vehículo sin poder circular
        ...(r.estado === "mal" && r.no_circula ? { no_circula: true } : {}),
      });
    }
  }
  return items;
}

export function contarEstados(items = []) {
  return {
    revisar: items.filter((i) => i.estado === "revisar").length,
    mal: items.filter((i) => i.estado === "mal").length,
  };
}

/** "✅ Todo bien", "⚠️ 2 a revisar · ❌ 1 mal". */
export function resumenChecklist(c) {
  const partes = [];
  if (c?.revisar) partes.push(`⚠️ ${c.revisar} a revisar`);
  if (c?.mal) partes.push(`❌ ${c.mal} mal`);
  return partes.length ? partes.join(" · ") : "✅ Todo bien";
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const urlSegura = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
const NOMBRE_ESTADO = Object.fromEntries(ESTADOS_PUNTO.map((e) => [e.id, `${e.emoji} ${e.nombre}`]));

function fechaHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** El checklist listo para imprimir o guardar en PDF (hoja A4). */
export function htmlChecklist({ empresa, vehiculo, checklist }) {
  const items = Array.isArray(checklist.items) ? checklist.items : [];
  const secciones = [...new Set(items.map((i) => i.seccion_nombre))];
  const datos = [
    ["Vehículo", [vehiculo.patente, vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ")],
    ["Fecha", fechaHora(checklist.created_at)],
    ["Hecho por", checklist.empleado_nombre],
    ["Kilómetros", checklist.km != null ? Number(checklist.km).toLocaleString("es-AR") : ""],
    ["Combustible", checklist.combustible],
    ["Resultado", resumenChecklist(checklist)],
  ].filter(([, v]) => v);
  const firma = urlSegura(checklist.firma_url);
  const fotos = (checklist.fotos || []).map(urlSegura).filter(Boolean);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Checklist ${esc(vehiculo.patente)} ${esc(fechaHora(checklist.created_at))}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; font-size: 10pt; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  h2 { font-size: 11pt; margin: 5mm 0 1.5mm; border-bottom: .3mm solid #000; padding-bottom: 1mm; }
  .empresa { font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: .8mm 1mm; vertical-align: top; text-align: left; }
  .datos td.k { width: 30mm; font-weight: 700; }
  .puntos tr { break-inside: avoid; }
  .puntos td { border-bottom: .2mm solid #ccc; }
  .puntos td.e { width: 26mm; white-space: nowrap; }
  .nota { color: #333; }
  .foto { max-width: 30mm; max-height: 22mm; display: block; margin-top: 1mm; }
  .fotos { display: flex; gap: 3mm; flex-wrap: wrap; }
  .fotos img { max-width: 42mm; max-height: 32mm; }
  .firma img { max-width: 70mm; max-height: 28mm; display: block; }
  .linea { border-top: .3mm solid #000; padding-top: 1mm; font-size: 9pt; width: 70mm; }
</style></head><body>
  <div class="empresa">${esc(empresa)}</div>
  <h1>Checklist de mantenimiento</h1>
  <table class="datos">${datos.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
  ${secciones.map((s) => `<h2>${esc(s)}</h2><table class="puntos">${items.filter((i) => i.seccion_nombre === s).map((i) => {
    const foto = urlSegura(i.foto);
    return `<tr><td>${esc(i.nombre)}${i.valor ? ` · ${esc(i.valor)}${i.unidad ? ` ${esc(i.unidad)}` : ""}` : ""}${i.nota ? `<div class="nota">${esc(i.nota)}</div>` : ""}${foto ? `<img class="foto" src="${esc(foto)}" alt="">` : ""}</td><td class="e">${esc(NOMBRE_ESTADO[i.estado] || "")}</td></tr>`;
  }).join("")}</table>`).join("")}
  ${checklist.observaciones ? `<h2>Observaciones</h2><div>${esc(checklist.observaciones)}</div>` : ""}
  ${fotos.length ? `<h2>Fotos del vehículo</h2><div class="fotos">${fotos.map((u) => `<img src="${esc(u)}" alt="">`).join("")}</div>` : ""}
  <div class="firma" style="margin-top:8mm">
    ${firma ? `<img src="${esc(firma)}" alt="Firma">` : `<div style="height:22mm"></div>`}
    <div class="linea">Firma · ${esc(checklist.empleado_nombre || "")}</div>
  </div>
</body></html>`;
}

/** Abre el checklist en una pestaña nueva con el diálogo de impresión (ahí se elige "Guardar como PDF"). */
export function imprimirChecklist(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlChecklist(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 800);
}
