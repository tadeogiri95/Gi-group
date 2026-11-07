// app/lib/sueltosPlanilla.js — Lo que va suelto a obra, desde la planilla de
// despiece de la OT (Tadeo, 07/11; sigue a app/lib/planillaPiezas.js).
//
// Todo va dentro del mueble salvo lo que Técnica marca. En las planillas
// nuevas hay dos columnas con el título SUELTO:
//   - en la hoja DATOS, al lado de cada pieza: SI = esa pieza viaja suelta
//     (un ajuste, una cenefa). Sigue siendo una pieza de su módulo para la
//     producción; además entra en la hoja de sueltos para la carga.
//   - en la hoja PLANILLA, al lado de CANTIDAD de NECESIDADES: SI = ese
//     herraje o perfil va suelto a obra.
// Las planillas viejas no tienen la columna: no se toca la hoja de sueltos.
// Gypi busca la columna por el título, así puede ir donde le quede cómoda a
// Técnica. Sin red ni base.

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const TITULOS_SUELTO = new Set(["suelto", "suelta", "vasuelto", "vasuelta", "sueltos", "sueltas"]);
const FILAS_TITULO = 30;
const MAX_FILAS = 3000;

/** ¿La celda dice que sí? SI, Sí, X, ✓ (un 1 no, para no confundirlo con una cantidad). */
export function esSi(v) {
  const t = String(v ?? "").trim();
  return /^(s[ií]|x|✓|✔)$/i.test(t);
}

/** Primera celda (fila, col) de las de arriba cuyo título es uno de los buscados. */
function buscarTitulo(filas, titulos, { desdeCol = 0, enFila = null } = {}) {
  const hasta = Math.min(filas.length, FILAS_TITULO);
  for (let f = enFila ?? 0; f < (enFila != null ? enFila + 1 : hasta); f++) {
    const fila = filas[f] || [];
    for (let c = desdeCol; c < fila.length; c++) if (titulos.has(norm(fila[c]))) return { fila: f, col: c };
  }
  return null;
}

/**
 * Hoja DATOS → nombres de las piezas marcadas SUELTO (normalizados), o null
 * si la hoja no tiene la columna. El nombre es la columna "Nª" (o "PANEL").
 * @param {string[][]|null} filas
 * @returns {Set<string>|null}
 */
export function piezasSueltasDeDatos(filas) {
  if (!filas) return null;
  const s = buscarTitulo(filas, TITULOS_SUELTO);
  if (!s) return null;
  const n = buscarTitulo(filas, new Set(["na", "no", "n", "nro", "panel", "nombre"]), { enFila: s.fila });
  const colNombre = n ? n.col : 1;
  const out = new Set();
  for (let f = s.fila + 1; f < Math.min(filas.length, MAX_FILAS); f++) {
    const fila = filas[f] || [];
    if (esSi(fila[s.col]) && String(fila[colNombre] ?? "").trim()) out.add(norm(fila[colNombre]));
  }
  return out;
}

/** "PERFIL MOA…" → Perfil; el resto de los componentes, Herraje. */
export function tipoComponente(descripcion) {
  const d = norm(descripcion);
  if (d.startsWith("perfil") || d.includes("perfil")) return "Perfil";
  if (/^(led|tira|fuente|transformador|sensor|interruptor)/.test(d)) return "Accesorio";
  return "Herraje";
}

/** "BISAGRA 35 CODO 0 CIERRE SUAVE-S/Marca-S/COLOR-1 PZ" → "1 PZ" (el envase, si viene al final). */
const envase = (descripcion) => {
  const m = String(descripcion ?? "").match(/-\s*([\d.,]+\s*(?:pz|mt|m|u|un|unid|kg|lt|m2|caja|pack)[^-]*)$/i);
  return m ? m[1].trim().slice(0, 40) : null;
};

/**
 * Hoja PLANILLA → componentes de NECESIDADES marcados SUELTO, o null si la
 * lista no tiene la columna. Busca el renglón con NOMBRE · DESCRIPCIÓN ·
 * CANTIDAD y la columna SUELTO en ese renglón (a la derecha).
 * @param {string[][]|null} filas
 * @returns {{ tipo: string, codigo: string|null, descripcion: string, medida: string|null, cantidad: number }[] | null}
 */
export function componentesSueltos(filas) {
  if (!filas) return null;
  const d = buscarTitulo(filas, new Set(["descripcion"]));
  if (!d) return null;
  const titulo = filas[d.fila];
  const colNombre = norm(titulo[d.col - 1]) === "nombre" ? d.col - 1 : null;
  const colCant = norm(titulo[d.col + 1]).startsWith("cant") ? d.col + 1 : null;
  const s = buscarTitulo(filas, TITULOS_SUELTO, { enFila: d.fila, desdeCol: d.col + 1 });
  if (!s || colCant == null) return null;
  const out = [];
  for (let f = d.fila + 1; f < Math.min(filas.length, MAX_FILAS); f++) {
    const fila = filas[f] || [];
    if (!esSi(fila[s.col])) continue;
    const descripcion = String(fila[d.col] ?? "").replace(/\s+/g, " ").trim();
    if (!descripcion || descripcion === "0") continue;
    const n = Number(String(fila[colCant] ?? "").replace(",", "."));
    const codigo = colNombre != null ? String(fila[colNombre] ?? "").trim() : "";
    out.push({
      tipo: tipoComponente(descripcion),
      codigo: codigo && codigo !== "-" && codigo !== "0" ? codigo.slice(0, 40) : null,
      descripcion: descripcion.slice(0, 200),
      medida: envase(descripcion),
      cantidad: Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100) / 100, 99999) : 1,
    });
  }
  return out;
}

/** Piezas marcadas → ítems de la hoja de sueltos (código = nombre de la pieza, así el escaneo de Carga lo tilda). */
export function piezasComoSueltos(renglones = [], marcadas) {
  if (!marcadas) return [];
  return renglones.filter((r) => marcadas.has(norm(r.nombre))).map((r) => ({
    tipo: "Madera",
    codigo: String(r.nombre).slice(0, 40),
    descripcion: (r.material || r.nombre).slice(0, 200),
    medida: r.l1 && r.l2 ? `${r.l1} × ${r.l2}` : null,
    cantidad: r.cantidad,
    va_con: r.modulo ? `Módulo ${r.modulo}`.slice(0, 80) : null,
  }));
}

const clave = (i) => `${norm(i.tipo)}|${norm(i.codigo)}|${norm(i.descripcion)}`;

/**
 * Qué cambiar en la hoja de sueltos de la OT para que quede como la planilla,
 * sin perder lo tildado ni lo que se cargó a mano:
 *   - un ítem que ya está (mismo tipo, código y descripción) se deja, y si lo
 *     cargó la planilla y cambió la cantidad o la medida, se corrige;
 *   - uno nuevo se agrega;
 *   - uno que había cargado la planilla (ids anteriores) y ya no viene se
 *     borra, salvo que ya esté tildado en acopio o en carga.
 * @param {object[]} actuales filas de sueltos_ot de la OT
 * @param {object[]} nuevos lo que pide la planilla
 * @param {number[]} idsDeLaPlanilla ids que había creado la carga anterior
 */
export function planSueltos(actuales = [], nuevos = [], idsDeLaPlanilla = []) {
  const propios = new Set(idsDeLaPlanilla.map(Number));
  const porClave = new Map();
  for (const a of actuales) if (!porClave.has(clave(a))) porClave.set(clave(a), a);
  const crear = [];
  const corregir = [];
  const siguen = [];
  const usadas = new Set();
  for (const n of nuevos) {
    const k = clave(n);
    if (usadas.has(k)) continue;
    usadas.add(k);
    const a = porClave.get(k);
    if (!a) { crear.push(n); continue; }
    if (propios.has(Number(a.id))) siguen.push(a.id);
    if (propios.has(Number(a.id)) && (Number(a.cantidad) !== Number(n.cantidad) || (a.medida || null) !== (n.medida || null))) {
      corregir.push({ id: a.id, cantidad: n.cantidad, medida: n.medida || null });
    }
  }
  const borrar = [];
  const quedanTildados = [];
  for (const a of actuales) {
    if (!propios.has(Number(a.id)) || usadas.has(clave(a))) continue;
    if (a.acopio || a.carga) { quedanTildados.push(a.id); siguen.push(a.id); } else borrar.push(a.id);
  }
  return { crear, corregir, borrar, siguen, quedanTildados };
}
