// app/lib/minutas.js — Minuta de la reunión de Buenos Días (Minuta, parte M1;
// migración 150; diseño en notes/diseno-minuta-buenos-dias.md).
//
// Las secciones son las de la minuta v2 en papel, en el mismo orden y con los
// mismos horarios. Cada renglón se elige de lo que ya está en Gypi (OT,
// personas, artículos, proveedores, vehículos) y se guarda como dato: la OT,
// su división, su proyecto y su cliente se copian al renglón para que la
// minuta de un día no cambie si la OT cambia después.
//
// Lo usan la pantalla (app/components/MinutaScreen.jsx) y el servidor
// (app/api/minutas/route.js).

export const CLAVE_CONFIG_MINUTA = "minuta_config";

/** Los bloques de la reunión, con su horario y quién expone (formato v2). */
export const BLOQUES = [
  { id: "foco", titulo: "Foco del día", ayuda: "Lo que no se puede atrasar: los proyectos prioritarios de hoy, en orden.", horario: "1 min" },
  { id: "produccion", numero: 1, titulo: "Producción", horario: "8:46 – 8:51" },
  { id: "instalacion", numero: 2, titulo: "Instalación", horario: "8:51 – 8:56" },
  { id: "dyt", numero: 3, titulo: "Diseño y técnica", horario: "8:56 – 9:02", ayuda: "Una línea por ítem. Si un área no tuvo movimiento, \"Sin cambios\" y se pasa a la siguiente." },
  { id: "feedback", numero: 4, titulo: "Feedback general", horario: "9:02 – 9:03", ayuda: "Una línea por ítem, dirigido al área que corresponda. Nadie responde ni se justifica en el momento: el jueves se revisan todos juntos." },
  { id: "compras", numero: 5, titulo: "Compras y logística", horario: "9:03 – 9:05" },
  { id: "estacionamiento", titulo: "Estacionamiento", ayuda: "Fuera de la reunión: los temas que no entran en 20 minutos." },
];

// Campos de un renglón: ot (con división, proyecto y cliente), semaforo,
// texto, responsable, fecha (fecha_objetivo), area, tipo y los de datos.
export const SECCIONES = [
  { id: "foco", bloque: "foco", titulo: "Foco del día", campos: ["ot", "texto"], texto: "Por qué es prioridad" },
  { id: "prod_terminada", bloque: "produccion", letra: "a", titulo: "Producción terminada", ayuda: "Lo que se cerró ayer en el taller.", campos: ["ot", "texto"], texto: "Observación" },
  { id: "prod_en_curso", bloque: "produccion", letra: "b", titulo: "En curso", ayuda: "Se detalla lo que cambió o tiene contingencia; el resto va en verde.", campos: ["ot", "semaforo", "texto", "responsable", "fecha"], texto: "Contingencia" },
  { id: "prod_a_iniciar", bloque: "produccion", letra: "c", titulo: "A iniciar", ayuda: "Entran a producción hoy y mañana.", campos: ["ot", "fecha", "listo", "texto"], texto: "Observación", fecha: "Entrega comprometida" },
  { id: "inst_terminada", bloque: "instalacion", letra: "a", titulo: "Instalación terminada", ayuda: "Obras cerradas ayer.", campos: ["ot", "texto"], texto: "Observación" },
  { id: "inst_en_curso", bloque: "instalacion", letra: "b", titulo: "En curso", ayuda: "Dónde está cada cuadrilla hoy.", campos: ["ot", "semaforo", "instaladores", "texto", "responsable", "fecha"], texto: "Contingencia" },
  {
    id: "inst_pendiente", bloque: "instalacion", letra: "c", titulo: "Pendientes de instalación",
    ayuda: "Detalles chicos de obras ya \"terminadas\". Sin responsable y sin fecha objetivo el pendiente no se registra. Si aparece 3 días seguidos, pasa a rojo y lo toma Gerencia.",
    campos: ["ot", "semaforo", "texto", "responsable", "fecha"], texto: "Contingencia", obligatorios: ["responsable", "fecha"],
  },
  { id: "postventa", bloque: "instalacion", letra: "d", titulo: "Post-venta", ayuda: "La contingencia es el reclamo del cliente.", campos: ["ot", "semaforo", "texto", "responsable", "fecha"], texto: "Reclamo" },
  // Sin OT todavía (presupuesto, diseño, relevamiento): cliente, proyecto y descripción
  { id: "dyt", bloque: "dyt", titulo: "Estado de las cuatro áreas", campos: ["area", "tipo", "ot", "texto"], texto: "Descripción" },
  { id: "feedback", bloque: "feedback", titulo: "Feedback", campos: ["ot", "tipo", "area", "texto", "responsable"], texto: "Qué pasó", responsable: "Lo trae" },
  { id: "compra", bloque: "compras", letra: "a", titulo: "Compras a disparar hoy", campos: ["articulo", "ot", "proveedor", "tipo", "fecha"], texto: "Qué se compra", fecha: "Necesario para" },
  { id: "movimiento", bloque: "compras", letra: "b", titulo: "Movimientos del día", campos: ["texto", "desde", "hasta", "responsable", "vehiculo"], texto: "Qué se mueve", responsable: "Quién" },
  { id: "estacionamiento", bloque: "estacionamiento", titulo: "Estacionamiento", campos: ["texto", "responsable", "fecha", "donde"], texto: "Tema", responsable: "Lo resuelven", fecha: "Cuándo" },
];

export const IDS_SECCION = SECCIONES.map((s) => s.id);
export const seccion = (id) => SECCIONES.find((s) => s.id === id) || null;
export const seccionesDe = (bloque) => SECCIONES.filter((s) => s.bloque === bloque);

export const SEMAFOROS = [
  { id: "verde", label: "Verde", punto: "🟢" },
  { id: "amarillo", label: "Amarillo", punto: "🟡" },
  { id: "rojo", label: "Rojo", punto: "🔴" },
];

export const AREAS_DYT = [
  { id: "presupuestos", label: "Presupuestos", detalle: "cotizaciones" },
  { id: "relevamiento", label: "Relevamiento", detalle: "medidas en obra" },
  { id: "diseno", label: "Diseño", detalle: "dibujo" },
  { id: "tecnica", label: "Técnica", detalle: "planillas de producción" },
];
export const ESTADOS_DYT = [
  { id: "terminado", label: "Terminado ayer" },
  { id: "en_curso", label: "En curso hoy" },
  { id: "a_hacer", label: "A hacer / pendiente de arranque" },
];
// Los que aparecen en las minutas en papel (Error, Falta de dato) y dos más
export const TIPOS_FEEDBACK = ["Error", "Falta de dato", "Mejora", "Reconocimiento"];
export const AREAS_FEEDBACK = ["DyT", "Producción", "Instalación", "Compras", "Logística", "Gerencia"];
export const URGENCIAS = [
  { id: "normal", label: "Normal" },
  { id: "urgente", label: "Urgente" },
];
// ¿Planilla y material? en A iniciar
export const LISTO = [
  { id: "listo", label: "Todo listo" },
  { id: "falta_planilla", label: "Falta planilla" },
  { id: "falta_material", label: "Falta material" },
  { id: "falta_todo", label: "Falta planilla y material" },
];

/** Id nuevo para un renglón (lo genera la app para que no cambie al guardar). */
// Instaladores de una instalación en curso: se guardan en datos.instaladores
// como texto ("Ana, Pepe") porque datos solo lleva valores simples.
export const MAX_INSTALADORES = 12;
/** "Ana, Pepe" → ["Ana", "Pepe"] (sin vacíos ni repetidos). */
export function listaInstaladores(v) {
  const l = (Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim()).filter(Boolean);
  return [...new Set(l)].slice(0, MAX_INSTALADORES);
}
/** ["Ana", "Pepe"] → "Ana, Pepe" (o null si no hay nadie). */
export function textoInstaladores(lista) {
  const l = listaInstaladores(lista).map((x) => x.replace(/,/g, " ").slice(0, 60));
  return l.length ? l.join(", ").slice(0, 300) : null;
}

export function idRenglon() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

/** Lo que se copia de la OT al renglón: división, proyecto y cliente. */
export function datosDeOt(p) {
  if (!p) return { ot: null, division: null, proyecto: null, cliente: null };
  return {
    ot: p.ot || null,
    division: p.division || null,
    // En la minuta en papel, "Proyecto" es lo que se hace (ALACENAS X 4 DPTOS)
    proyecto: p.descripcion || p.proyecto || p.obra || null,
    cliente: p.cliente || p.obra || null,
  };
}

/** Renglón vacío de una sección. */
/** "12 placas": la cantidad de una compra con su unidad. */
export function textoCantidad(it) {
  const n = Number(it?.datos?.cantidad);
  if (!(n > 0)) return "";
  return `${String(Math.round(n * 1000) / 1000).replace(".", ",")}${it.datos?.unidad ? ` ${it.datos.unidad}` : ""}`;
}

/**
 * Compra a disparar → pedido de material en Compras (parte M4). Devuelve el
 * cuerpo para POST /api/compras (accion pedido_crear) o { error } si falta algo.
 */
export function pedidoDesdeMinuta(it, fecha) {
  const cantidad = Number(it?.datos?.cantidad);
  const sku = it?.datos?.sku || null;
  const descripcion = sku ? null : String(it?.texto || "").trim().slice(0, 200) || null;
  if (!sku && !descripcion) return { error: "Escribí o elegí qué se compra" };
  if (!(cantidad > 0)) return { error: "Poné la cantidad a pedir" };
  const dia = fecha ? `${Number(fecha.slice(8, 10))}/${Number(fecha.slice(5, 7))}` : "";
  const notas = [`Minuta del ${dia}`, it.tipo === "urgente" ? "Urgente" : "", it.datos?.proveedor ? `Proveedor: ${it.datos.proveedor}` : "", it.datos?.ots ? `OT ${it.datos.ots}` : ""]
    .filter(Boolean).join(" · ").slice(0, 300);
  return {
    accion: "pedido_crear", sku, descripcion, cantidad: Math.round(cantidad * 1000) / 1000,
    ...(it.datos?.unidad && !sku ? { unidad: String(it.datos.unidad).slice(0, 20) } : {}),
    ot: it.ot || null, para_fecha: it.fecha_objetivo || null, notas,
  };
}

export function renglonNuevo(seccionId, extra = {}) {
  return {
    id: idRenglon(), seccion: seccionId, ot: null, division: null, proyecto: null, cliente: null,
    semaforo: null, texto: "", responsable: "", fecha_objetivo: null, area: null, tipo: null, datos: {}, ...extra,
  };
}

const lleno = (v) => v != null && String(v).trim() !== "";

/** ¿El renglón tiene algo cargado? Los vacíos no se guardan. */
export function renglonConDatos(it) {
  return [it.ot, it.proyecto, it.cliente, it.texto, it.responsable, it.fecha_objetivo].some(lleno)
    || Object.values(it.datos || {}).some(lleno);
}

/**
 * Lo que falta para poder guardar: los pendientes de instalación necesitan
 * responsable y fecha objetivo ("sin eso no se registra").
 * @returns {string[]} un texto por problema
 */
export function faltantesMinuta(items) {
  const errores = [];
  for (const s of SECCIONES) {
    if (!s.obligatorios) continue;
    const delaSeccion = items.filter((it) => it.seccion === s.id && renglonConDatos(it));
    delaSeccion.forEach((it, i) => {
      const nombre = it.ot ? `OT ${it.ot}` : it.proyecto || it.texto || `renglón ${i + 1}`;
      const falta = [];
      if (s.obligatorios.includes("responsable") && !lleno(it.responsable)) falta.push("responsable");
      if (s.obligatorios.includes("fecha") && !lleno(it.fecha_objetivo)) falta.push("fecha objetivo");
      if (falta.length) errores.push(`${s.titulo}: a "${nombre}" le falta ${falta.join(" y ")}`);
    });
  }
  return errores;
}

/** Los renglones listos para guardar: sin los vacíos y con su orden dentro de la sección. */
export function renglonesParaGuardar(items) {
  const orden = {};
  return items.filter(renglonConDatos).map((it) => {
    orden[it.seccion] = (orden[it.seccion] || 0) + 1;
    const datos = Object.fromEntries(Object.entries(it.datos || {}).filter(([, v]) => lleno(v) || typeof v === "boolean"));
    return {
      id: it.id, seccion: it.seccion, orden: orden[it.seccion],
      ot: it.ot || null, division: it.division || null, proyecto: it.proyecto || null, cliente: it.cliente || null,
      semaforo: it.semaforo || null, texto: lleno(it.texto) ? String(it.texto).trim() : null,
      responsable: lleno(it.responsable) ? String(it.responsable).trim() : null,
      fecha_objetivo: it.fecha_objetivo || null, area: it.area || null, tipo: it.tipo || null, datos,
      viene_de: it.viene_de || null,
    };
  });
}

/** "09:02" a partir de "09:02:00" o de una fecha. */
export function hora(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
  return String(v).slice(0, 5);
}

/** Minutos entre inicio y cierre ("09:02" → "09:22" = 20), o null. */
export function duracionMinutos(inicio, cierre) {
  if (!inicio || !cierre) return null;
  const min = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
  const d = min(cierre) - min(inicio);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

/** Participantes de la configuración: [{ nombre, area }]. */
export function participantesDe(config) {
  const lista = Array.isArray(config?.participantes) ? config.participantes : [];
  return lista.filter((p) => lleno(p?.nombre)).map((p) => ({
    nombre: String(p.nombre).trim(), area: p.area ? String(p.area).trim() : "",
    ...(p.empleado_id ? { empleado_id: String(p.empleado_id) } : {}),
  }));
}

/** Lista de textos sin repetidos ni vacíos (sin distinguir mayúsculas ni acentos), en orden. */
export function listaUnica(...listas) {
  const vistos = new Set();
  const out = [];
  for (const x of listas.flat()) {
    const t = String(x ?? "").trim();
    const k = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!t || vistos.has(k)) continue;
    vistos.add(k);
    out.push(t);
  }
  return out;
}

/** Tipos de feedback: los de siempre más los que la empresa agregó con "Otro". */
export const tiposFeedbackDe = (config) => listaUnica(TIPOS_FEEDBACK, Array.isArray(config?.tipos_feedback) ? config.tipos_feedback : []);

/** Clientes para Diseño y técnica: los de las OT más los agregados desde la minuta. */
export const clientesDe = (ots = [], config = null) =>
  listaUnica(Array.isArray(config?.clientes) ? config.clientes : [], ots.map((p) => p?.cliente)).sort((a, b) => a.localeCompare(b, "es"));

// ─── Impresión (mismo formato que la minuta v2 en papel) ────────────────────

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const fechaDiaMes = (iso) => (iso ? `${Number(String(iso).slice(8, 10))}/${Number(String(iso).slice(5, 7))}` : "");
const etiqueta = (lista, id) => lista.find((x) => x.id === id)?.label || id || "";

function columnas(s) {
  const c = [];
  const proyectoOt = (it) => [it.ot ? `OT ${it.ot}` : "", it.proyecto].filter(Boolean).join(" · ");
  const fecha = [s.fecha || "Fecha objetivo", (it) => fechaDiaMes(it.fecha_objetivo)];
  if (s.campos.includes("articulo")) c.push(["Qué se compra", (it) => [it.texto, textoCantidad(it)].filter(Boolean).join(" · ")], ["Para proyecto", (it) => [proyectoOt(it), it.cliente].filter(Boolean).join(" · ")]);
  else if (s.id === "dyt") c.push(["OT", (it) => it.ot]);
  else if (s.campos.includes("ot")) c.push(["División", (it) => it.division], ["Proyecto", proyectoOt], ["Cliente", (it) => it.cliente]);
  if (s.campos.includes("semaforo")) c.push(["Estado", (it) => (it.semaforo ? `<span class="punto ${esc(it.semaforo)}">●</span> ${esc(etiqueta(SEMAFOROS, it.semaforo))}` : ""), true]);
  if (s.id === "feedback") c.push(["Tipo", (it) => it.tipo], ["Feedback para", (it) => it.area]);
  if (s.id === "compra") c.push(["Proveedor", (it) => it.datos?.proveedor], ["Urgencia", (it) => etiqueta(URGENCIAS, it.tipo)]);
  // A iniciar: entrega y "¿planilla y material?" como en el papel; la observación al final
  if (s.campos.includes("listo")) c.push(fecha, ["¿Planilla y material?", (it) => etiqueta(LISTO, it.datos?.listo)]);
  if (s.campos.includes("instaladores")) c.push(["Instaladores", (it) => listaInstaladores(it.datos?.instaladores).join(", ")]);
  if (s.campos.includes("texto")) c.push([s.texto || "Detalle", (it) => it.texto]);
  if (s.campos.includes("desde")) c.push(["Desde", (it) => it.datos?.desde], ["Hasta", (it) => it.datos?.hasta]);
  if (s.campos.includes("vehiculo")) c.push(["Quién / vehículo", (it) => [it.responsable, it.datos?.vehiculo].filter(Boolean).join(" / ")]);
  else if (s.campos.includes("responsable")) c.push([s.responsable || "Responsable", (it) => it.responsable]);
  if (s.campos.includes("fecha") && !s.campos.includes("listo")) c.push(fecha);
  if (s.campos.includes("donde")) c.push(["Dónde", (it) => it.datos?.donde]);
  return c;
}

function tablaSeccion(s, items) {
  const cols = columnas(s);
  const filas = items.length
    ? items.map((it) => `<tr>${cols.map(([, f, html]) => `<td>${html ? f(it) : esc(f(it))}</td>`).join("")}</tr>`).join("")
    : `<tr>${cols.map(() => "<td>&nbsp;</td>").join("")}</tr>`;
  return `<table><thead><tr>${cols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${filas}</tbody></table>`;
}

function tablaDyt(items) {
  const celda = (area, estado) => items.filter((it) => it.area === area && it.tipo === estado)
    .map((it) => `<div>${esc([it.ot ? `OT ${it.ot}` : "", it.cliente, it.ot ? "" : it.proyecto, it.texto].filter(Boolean).join(" · "))}</div>`).join("");
  return `<table class="dyt"><thead><tr><th>Área</th>${ESTADOS_DYT.map((e) => `<th>${esc(e.label)}</th>`).join("")}</tr></thead><tbody>${
    AREAS_DYT.map((a) => `<tr><td><b>${esc(a.label)}</b><br><small>${esc(a.detalle)}</small></td>${ESTADOS_DYT.map((e) => `<td>${celda(a.id, e.id)}</td>`).join("")}</tr>`).join("")
  }</tbody></table>`;
}

/**
 * La minuta lista para imprimir o guardar en PDF (hoja A4), con el formato v2.
 * @param {{ empresa: string, minuta: object, items: object[], participantes: { nombre: string, area: string }[] }} datos
 */
export function htmlMinuta({ empresa, minuta, items = [], participantes = [] }) {
  const presentes = new Set(Array.isArray(minuta?.asistentes) ? minuta.asistentes : []);
  const todos = [...participantes];
  for (const n of presentes) if (!todos.some((p) => p.nombre === n)) todos.push({ nombre: n, area: "" });
  const de = (id) => items.filter((it) => it.seccion === id).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const enCurso = de("prod_en_curso").length;
  const bloque = (b) => {
    const titulo = `${b.numero ? `${b.numero} · ` : ""}${esc(b.titulo)}`;
    const cabeza = `<h2>${titulo}${b.horario ? ` <span class="hora">${esc(b.horario)}</span>` : ""}</h2>${b.ayuda ? `<p class="ayuda">${esc(b.ayuda)}</p>` : ""}`;
    if (b.id === "dyt") return `<section>${cabeza}${tablaDyt(de("dyt"))}</section>`;
    const partes = seccionesDe(b.id).map((s) => {
      const sub = s.letra ? `<h3>${esc(s.letra)}. ${esc(s.titulo)}${s.ayuda ? ` <span class="ayuda">— ${esc(s.ayuda)}</span>` : ""}</h3>` : "";
      const total = s.id === "prod_en_curso" ? `<p class="ayuda">Proyectos en producción hoy: <b>${enCurso || "__"}</b> en total.</p>` : "";
      return `${sub}${total}${tablaSeccion(s, de(s.id))}`;
    }).join("");
    return `<section>${cabeza}${partes}</section>`;
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Minuta ${esc(fechaCorta(minuta?.fecha))}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 9.5pt; margin: 0; }
  .marca { letter-spacing: .25em; font-size: 7.5pt; color: #6b7280; text-transform: uppercase; }
  h1 { font-size: 16pt; margin: 2mm 0 3mm; }
  h1 small { font-size: 10pt; color: #6b7280; font-weight: normal; }
  .cabecera { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2mm; margin-bottom: 3mm; }
  .cabecera div { border-bottom: 1px solid #9ca3af; padding: 1mm 0; }
  .cabecera b { display: block; font-size: 7pt; color: #6b7280; letter-spacing: .08em; }
  .asistencia { display: flex; flex-wrap: wrap; gap: 2mm 5mm; margin: 1mm 0 3mm; }
  .asistencia span::before { content: "☐ "; }
  .asistencia span.si::before { content: "☑ "; }
  section { break-inside: avoid-page; margin-bottom: 3mm; }
  h2 { font-size: 11pt; margin: 3mm 0 1mm; padding-bottom: 1mm; border-bottom: 2px solid #1f2937; }
  h2 .hora { font-size: 8.5pt; color: #6b7280; font-weight: normal; margin-left: 3mm; }
  h3 { font-size: 9.5pt; margin: 2mm 0 1mm; }
  .ayuda { font-size: 8pt; color: #6b7280; font-weight: normal; margin: 0 0 1mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1mm; }
  th { text-align: left; font-size: 7pt; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #9ca3af; padding: 1mm; }
  td { border-bottom: 1px solid #e5e7eb; padding: 1.2mm 1mm; vertical-align: top; }
  table.dyt td { width: 28%; } table.dyt td:first-child { width: 16%; }
  .punto.verde { color: #16a34a; } .punto.amarillo { color: #ca8a04; } .punto.rojo { color: #dc2626; }
  .notas { border: 1px solid #e5e7eb; min-height: 14mm; padding: 2mm; white-space: pre-wrap; }
  .pie { display: flex; justify-content: space-between; margin-top: 6mm; font-size: 8pt; color: #6b7280; }
</style></head><body>
  <div class="marca">${esc(empresa)} · Gestión de operaciones</div>
  <h1>Minuta — Reunión de Buenos Días <small>8:45 a 9:05 hs</small></h1>
  <div class="cabecera">
    <div><b>FECHA</b>${esc(fechaCorta(minuta?.fecha))}</div>
    <div><b>INICIO</b>${esc(hora(minuta?.inicio))}</div>
    <div><b>CIERRE</b>${esc(hora(minuta?.cierre))}</div>
    <div><b>MODERA</b>${esc(minuta?.modera || "")}</div>
    <div><b>REGISTRA</b>${esc(minuta?.registra || "")}</div>
  </div>
  <h2>Asistencia</h2>
  <div class="asistencia">${todos.map((p) => `<span class="${presentes.has(p.nombre) ? "si" : ""}">${esc(p.nombre)}${p.area ? ` · ${esc(p.area)}` : ""}</span>`).join("")}</div>
  ${BLOQUES.map(bloque).join("")}
  <section><h2>Notas libres</h2><div class="notas">${esc(minuta?.notas || "")}</div></section>
  <div class="pie">
    <span>${esc(empresa)} · Minuta de la Reunión de Buenos Días — v2 · Gypi</span>
    <span>Firma / conforme del moderador: ${minuta?.estado === "cerrada" && minuta?.modera ? esc(minuta.modera) : "____________________"}</span>
  </div>
</body></html>`;
}

/** Abre la minuta en una pestaña nueva con el diálogo de impresión ("Guardar como PDF"). */
export function imprimirMinuta(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlMinuta(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 400);
}

// ─── Seguimiento (parte M3) ─────────────────────────────────────────────────
// Lo que tiene que resolverse pasa solo a la minuta siguiente hasta que se
// marca ✓ Resuelto: contingencias (en curso que no está en verde),
// pendientes de instalación, post-venta y estacionamiento.
export const SECCIONES_SEGUIMIENTO = ["prod_en_curso", "inst_en_curso", "inst_pendiente", "postventa", "estacionamiento"];
// "Si aparece 3 días seguidos, pasa a rojo y lo toma Gerencia"
export const VECES_A_GERENCIA = 3;

/** ¿El renglón pasa a la minuta siguiente? */
export function sigueAbierto(it) {
  if (!it || it.resuelto_at || !SECCIONES_SEGUIMIENTO.includes(it.seccion)) return false;
  if (it.seccion === "prod_en_curso" || it.seccion === "inst_en_curso") return it.semaforo === "amarillo" || it.semaforo === "rojo";
  return true;
}

/**
 * El renglón de la minuta anterior, copiado para hoy: con viene_de, desde
 * cuándo está y cuántas veces apareció. Un pendiente de instalación que
 * llega a la 3.ª vez pasa a rojo y lo toma Gerencia.
 * @param {object} it renglón de la minuta anterior
 * @param {string} fechaAnterior fecha de esa minuta
 */
export function renglonQueSigue(it, fechaAnterior) {
  const veces = (Number(it.datos?.veces) || 1) + 1;
  const aGerencia = it.seccion === "inst_pendiente" && veces >= VECES_A_GERENCIA;
  return renglonNuevo(it.seccion, {
    ot: it.ot || null, division: it.division || null, proyecto: it.proyecto || null, cliente: it.cliente || null,
    semaforo: aGerencia ? "rojo" : it.semaforo || null, texto: it.texto || "", responsable: it.responsable || "",
    fecha_objetivo: it.fecha_objetivo || null, area: it.area || null, tipo: it.tipo || null,
    datos: { ...(it.datos || {}), desde: it.datos?.desde || fechaAnterior, veces, ...(aGerencia ? { gerencia: true } : {}) },
    viene_de: it.id,
  });
}

/** Lo de la minuta anterior que todavía no se pasó a esta. */
export function seguimientoPendiente(anteriores, items, seccionId) {
  const ya = new Set(items.map((it) => it.viene_de).filter(Boolean));
  const pendientesYa = new Set(items.filter((it) => it.seccion === seccionId && it.datos?.pendiente_id != null).map((it) => String(it.datos.pendiente_id)));
  return (anteriores || []).filter((it) => it.seccion === seccionId && !ya.has(it.id)
    && !(it.datos?.pendiente_id != null && pendientesYa.has(String(it.datos.pendiente_id))));
}

/** "Viene del 28/10 · 3.ª vez" */
export function textoSeguimiento(it) {
  if (!it?.datos?.desde) return "";
  const d = String(it.datos.desde);
  return `↩ Viene del ${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}${it.datos.veces ? ` · ${it.datos.veces}.ª vez` : ""}`;
}
