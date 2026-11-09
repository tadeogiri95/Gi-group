// app/lib/finanzas.js — Finanzas, parte F1a (migración 171): configuración
// copiada del libro contable (plan de cuentas, tipos de operación, cajas y
// bancos, centros de costo) y cuentas sugeridas para los tipos que no tienen.
//
// El libro se sube como Excel (Google Sheets → Archivo → Descargar → .xlsx) y
// se lee en el navegador con app/lib/leerXlsx.js. Acá está lo que convierte
// cada hoja en filas para la base, sin red ni base: se puede probar con el
// libro de verdad. El servidor vuelve a validar todo con limpiarFila().
//
// Finanzas es solo del rol Dueño (gerencial). El Supervisor no entra, aunque
// en lo demás pueda lo mismo que el Dueño (comoDueno): por eso acá se mira el
// rol y no comoDueno().

/** ¿Puede entrar a Finanzas? Solo el Dueño. */
export const esDuenoFinanzas = (u) => u?.rol === "gerencial";

export const MAX_FILAS_IMPORTAR = 3000;

// Tablas de la configuración: nombre en la app, tabla, clave y hoja del libro
export const TABLAS_FIN = {
  cuentas:   { tabla: "fin_cuentas",         clave: "codigo", hoja: "dim_plan_cuentas", nombre: "Plan de cuentas" },
  tipos:     { tabla: "fin_tipos_operacion", clave: "codigo", hoja: "dim_tipos_op",     nombre: "Tipos de operación" },
  tesoreria: { tabla: "fin_tesoreria",       clave: "cuenta", hoja: "dim_tesoreria",    nombre: "Cajas y bancos" },
  centros:   { tabla: "fin_centros_costo",   clave: "codigo", hoja: "dim_cc",           nombre: "Centros de costo" },
};
export const HOJA_OPERACIONES = "T-OPERACIONES";

export const TIPOS_TESORERIA = { caja: "Caja", banco: "Banco", fci: "FCI", plazo_fijo: "Plazo fijo", otro: "Otro" };

// Un código de cuenta del libro: "01.01.01.001.001" (grupos de dígitos con puntos)
export const CODIGO_CUENTA = /^\d{1,3}(\.\d{1,4}){1,7}$/;

const txt = (v, max = 120) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : "";
};
const siNo = (v, porDefecto = false) => {
  const t = txt(v).toUpperCase();
  if (!t) return porDefecto;
  return t === "SI" || t === "SÍ" || t === "S" || t === "TRUE" || t === "1" || t === "X";
};
const clave = (v) => txt(v, 200).toLowerCase();

/** Fila de títulos (la primera que tiene `primero`) y la posición de cada título. */
export function titulosDe(grilla, primero) {
  const buscado = clave(primero);
  const i = (grilla || []).slice(0, 20).findIndex((f) => (f || []).some((c) => clave(c) === buscado));
  if (i < 0) return null;
  const col = {};
  (grilla[i] || []).forEach((c, j) => { const k = clave(c); if (k && col[k] === undefined) col[k] = j; });
  return { fila: i, col };
}

const celda = (fila, col, nombre) => (col[nombre] === undefined ? "" : fila?.[col[nombre]]);

/** "CAJA USD" → caja, "BANCO" → banco, "PLAZO FIJO" → plazo_fijo, "FCI" → fci. */
export function tipoTesoreria(grupo) {
  const g = clave(grupo);
  if (g.startsWith("caja")) return "caja";
  if (g.startsWith("banco")) return "banco";
  if (g.startsWith("fci") || g.includes("fondo")) return "fci";
  if (g.startsWith("plazo")) return "plazo_fijo";
  return "otro";
}

function sinTitulos(nombre, primero) {
  return { filas: [], avisos: [`No encontré los títulos de la hoja ${nombre} (la columna "${primero}").`] };
}

/** dim_plan_cuentas → { filas: [{ codigo, nombre, rubro, naturaleza, linea_eerr, atribucion }], avisos }. */
export function cuentasDeHoja(grilla) {
  const t = titulosDe(grilla, "codigo");
  if (!t) return sinTitulos("dim_plan_cuentas", "codigo");
  const filas = [];
  const avisos = [];
  const vistos = new Set();
  const nombres = new Map();
  for (const f of grilla.slice(t.fila + 1)) {
    const codigo = txt(celda(f, t.col, "codigo"), 40);
    const nombre = txt(celda(f, t.col, "nombre"));
    if (!codigo && !nombre) continue;
    if (!CODIGO_CUENTA.test(codigo)) { avisos.push(`Cuenta "${nombre || codigo}": el código "${codigo}" no es un código de cuenta; no se copió.`); continue; }
    if (!nombre) { avisos.push(`Cuenta ${codigo} sin nombre; no se copió.`); continue; }
    if (vistos.has(codigo)) { avisos.push(`El código ${codigo} está dos veces en el libro: se copió el primero (${filas.find((x) => x.codigo === codigo).nombre}).`); continue; }
    vistos.add(codigo);
    const n = clave(nombre);
    if (nombres.has(n)) avisos.push(`El nombre "${nombre}" lo tienen dos cuentas (${nombres.get(n)} y ${codigo}). El libro busca por nombre: conviene cambiarle el nombre a una.`);
    else nombres.set(n, codigo);
    const nat = txt(celda(f, t.col, "naturaleza"), 1).toUpperCase();
    filas.push({
      codigo,
      nombre,
      rubro: txt(celda(f, t.col, "rubro"), 60) || null,
      naturaleza: nat === "D" || nat === "H" ? nat : null,
      // El renglón del estado de resultados y si se prorratea entre divisiones (F6a)
      linea_eerr: lineaEerr(celda(f, t.col, "clasificacion_eerr")),
      atribucion: atribucionDe(celda(f, t.col, "atribucion_div")),
    });
  }
  return { filas, avisos: [...new Set(avisos)] };
}

/**
 * dim_tipos_op → { filas, avisos }. Si se pasan los códigos del plan de
 * cuentas, avisa las cuentas por defecto que no existen (y no las usa).
 */
export function tiposDeHoja(grilla, codigosCuentas = null) {
  const t = titulosDe(grilla, "cod_tipo_op");
  if (!t) return sinTitulos("dim_tipos_op", "cod_tipo_op");
  const porCodigo = new Map();
  const avisos = [];
  const cuenta = (v, codigo, lado) => {
    const c = txt(v, 40);
    if (!c) return null;
    if (!CODIGO_CUENTA.test(c)) { avisos.push(`${codigo}: la cuenta del ${lado} "${c}" no es un código; quedó vacía.`); return null; }
    if (codigosCuentas && !codigosCuentas.has(c)) { avisos.push(`${codigo}: la cuenta del ${lado} ${c} no está en el plan de cuentas; quedó vacía.`); return null; }
    return c;
  };
  for (const f of grilla.slice(t.fila + 1)) {
    const codigo = txt(celda(f, t.col, "cod_tipo_op"), 80);
    if (!codigo) continue;
    const fila = {
      codigo,
      nombre: txt(celda(f, t.col, "nombre")) || null,
      grupo: txt(celda(f, t.col, "grupo"), 40) || null,
      base_contable: txt(celda(f, t.col, "base_contable"), 20) || null,
      cuenta_debe: cuenta(celda(f, t.col, "subcuenta_debe_default"), codigo, "debe"),
      cuenta_haber: cuenta(celda(f, t.col, "subcuenta_haber_default"), codigo, "haber"),
      pide_entidad: siNo(celda(f, t.col, "requiere_entidad")),
      pide_ot: siNo(celda(f, t.col, "requiere_proyecto")),
      pide_cc: siNo(celda(f, t.col, "afecta_cc")),
      descripcion: txt(celda(f, t.col, "descripcion_uso"), 500) || null,
    };
    const k = clave(codigo);
    const antes = porCodigo.get(k);
    // Repetido (el libro tiene alguno dos veces): queda el que tiene más datos
    if (antes) {
      const datos = (x) => Object.values(x).filter((v) => v !== null && v !== false && v !== "").length;
      avisos.push(`El tipo ${codigo} está dos veces en el libro: se copió una sola vez.`);
      if (datos(fila) <= datos(antes)) continue;
    }
    porCodigo.set(k, fila);
  }
  return { filas: [...porCodigo.values()], avisos: [...new Set(avisos)] };
}

/** dim_tesoreria → { filas: [{ cuenta, nombre, tipo, moneda, activa }], avisos }. */
export function tesoreriaDeHoja(grilla) {
  const t = titulosDe(grilla, "cuenta");
  if (!t) return sinTitulos("dim_tesoreria", "cuenta");
  const filas = [];
  const avisos = [];
  for (const f of grilla.slice(t.fila + 1)) {
    const cuenta = txt(celda(f, t.col, "cuenta"), 40);
    const nombre = txt(celda(f, t.col, "nombre"));
    if (!cuenta && !nombre) continue;
    if (!CODIGO_CUENTA.test(cuenta) || !nombre) { avisos.push(`Caja o banco "${nombre || cuenta}" sin código de cuenta; no se copió.`); continue; }
    if (filas.some((x) => x.cuenta === cuenta)) { avisos.push(`La cuenta ${cuenta} está dos veces en cajas y bancos: se copió la primera.`); continue; }
    filas.push({
      cuenta,
      nombre,
      tipo: tipoTesoreria(celda(f, t.col, "grupo")),
      moneda: txt(celda(f, t.col, "moneda"), 3).toUpperCase() === "USD" ? "USD" : "ARS",
      activa: siNo(celda(f, t.col, "activa"), true),
    });
  }
  return { filas, avisos };
}

/** dim_cc → { filas: [{ codigo, nombre, division, tipo, activo }], avisos }. */
export function centrosDeHoja(grilla) {
  const t = titulosDe(grilla, "codigo_cc");
  if (!t) return sinTitulos("dim_cc", "codigo_cc");
  const filas = [];
  const avisos = [];
  for (const f of grilla.slice(t.fila + 1)) {
    const codigo = txt(celda(f, t.col, "codigo_cc"), 60);
    if (!codigo) continue;
    if (filas.some((x) => x.codigo === codigo)) { avisos.push(`El centro de costo ${codigo} está dos veces: se copió el primero.`); continue; }
    filas.push({
      codigo,
      nombre: txt(celda(f, t.col, "nombre")) || null,
      division: txt(celda(f, t.col, "division"), 60) || null,
      tipo: txt(celda(f, t.col, "tipo"), 40) || null,
      activo: siNo(celda(f, t.col, "activo"), true),
    });
  }
  return { filas, avisos };
}

/**
 * Cuentas sugeridas para los tipos sin cuenta del debe o del haber: el par
 * (debe, haber) que más se usó en T-OPERACIONES para ese tipo, salteando las
 * operaciones contra las cuentas de `excluir` (Ajuste De Capital: se usó para
 * cargar lo histórico). Solo completa el lado que falta.
 * @returns {{ codigo, cuenta_debe, cuenta_haber, veces, de }[]} uno por tipo con sugerencia
 */
export function sugerirCuentas(grillaOperaciones, tipos, { excluir = [], cuentas = null } = {}) {
  const t = titulosDe(grillaOperaciones, "cod_tipo_op");
  if (!t || t.col.cuenta_debe_final === undefined || t.col.cuenta_haber_final === undefined) return [];
  const fuera = new Set(excluir);
  const usos = new Map(); // tipo → Map("debe|haber" → veces)
  const totales = new Map();
  for (const f of grillaOperaciones.slice(t.fila + 1)) {
    const tipo = clave(celda(f, t.col, "cod_tipo_op"));
    const d = txt(celda(f, t.col, "cuenta_debe_final"), 40);
    const h = txt(celda(f, t.col, "cuenta_haber_final"), 40);
    if (!tipo || !CODIGO_CUENTA.test(d) || !CODIGO_CUENTA.test(h)) continue;
    totales.set(tipo, (totales.get(tipo) || 0) + 1);
    if (fuera.has(d) || fuera.has(h)) continue;
    if (cuentas && (!cuentas.has(d) || !cuentas.has(h))) continue;
    if (!usos.has(tipo)) usos.set(tipo, new Map());
    const m = usos.get(tipo);
    m.set(`${d}|${h}`, (m.get(`${d}|${h}`) || 0) + 1);
  }
  const out = [];
  for (const tipo of tipos) {
    if (tipo.cuenta_debe && tipo.cuenta_haber) continue;
    const m = usos.get(clave(tipo.codigo));
    if (!m?.size) continue;
    const [par, veces] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const [d, h] = par.split("|");
    out.push({
      codigo: tipo.codigo,
      cuenta_debe: tipo.cuenta_debe || d,
      cuenta_haber: tipo.cuenta_haber || h,
      veces,
      de: totales.get(clave(tipo.codigo)) || veces,
    });
  }
  return out;
}

/** Hoja del libro por nombre, sin mirar mayúsculas ni espacios. */
export function hojaDe(hojas, nombre) {
  return (hojas || []).find((h) => clave(h.nombre) === clave(nombre)) || null;
}

/**
 * Todo lo que se copia de un libro: { cuentas, tipos, tesoreria, centros,
 * sugerencias, faltan } con las filas y avisos de cada tabla. `hojas` =
 * [{ nombre, grilla }]. Las hojas que no están van en `faltan`.
 */
export function leerLibro(hojas) {
  const faltan = [];
  const grilla = (nombre) => {
    const h = hojaDe(hojas, nombre);
    if (!h) faltan.push(nombre);
    return h?.grilla || null;
  };
  const vacio = { filas: [], avisos: [] };
  const gCuentas = grilla(TABLAS_FIN.cuentas.hoja);
  const cuentas = gCuentas ? cuentasDeHoja(gCuentas) : vacio;
  const codigos = cuentas.filas.length ? new Set(cuentas.filas.map((c) => c.codigo)) : null;
  const gTipos = grilla(TABLAS_FIN.tipos.hoja);
  const tipos = gTipos ? tiposDeHoja(gTipos, codigos) : vacio;
  const gTes = grilla(TABLAS_FIN.tesoreria.hoja);
  const tesoreria = gTes ? tesoreriaDeHoja(gTes) : vacio;
  const gCc = grilla(TABLAS_FIN.centros.hoja);
  const centros = gCc ? centrosDeHoja(gCc) : vacio;
  const gOps = hojaDe(hojas, HOJA_OPERACIONES)?.grilla;
  const excluir = cuentas.filas.filter((c) => /^ajuste de capital$/i.test(c.nombre)).map((c) => c.codigo);
  const sugerencias = gOps ? sugerirCuentas(gOps, tipos.filas, { excluir, cuentas: codigos }) : [];
  return { cuentas, tipos, tesoreria, centros, sugerencias, faltan };
}

// ─── Lo que valida el servidor ──────────────────────────────────────────

/** "CMV_MOD_SUE" (o vacío / "—" → null). */
function lineaEerr(v) {
  const s = txt(v, 40).toUpperCase().replace(/\s+/g, "_");
  return /^[A-Z][A-Z0-9_]{1,39}$/.test(s) ? s : null;
}
const atribucionDe = (v) => ({ DIRECTO: "DIRECTO", PRORRATEO: "PRORRATEO" }[txt(v, 20).toUpperCase()] || null);

const LIMPIAR = {
  cuentas: (f) => {
    const codigo = txt(f?.codigo, 40);
    const nombre = txt(f?.nombre);
    if (!CODIGO_CUENTA.test(codigo)) return { error: `"${codigo}" no es un código de cuenta` };
    if (!nombre) return { error: `La cuenta ${codigo} no tiene nombre` };
    const nat = txt(f?.naturaleza, 1).toUpperCase();
    return {
      fila: {
        codigo, nombre, rubro: txt(f?.rubro, 60) || null, naturaleza: nat === "D" || nat === "H" ? nat : null,
        ...(typeof f?.activa === "boolean" ? { activa: f.activa } : {}),
        // Solo si vienen (migración 179): editar una cuenta a mano no las borra
        ...(f && "linea_eerr" in f ? { linea_eerr: lineaEerr(f.linea_eerr) } : {}),
        ...(f && "atribucion" in f ? { atribucion: atribucionDe(f.atribucion) } : {}),
      },
    };
  },
  tipos: (f) => {
    const codigo = txt(f?.codigo, 80);
    if (!codigo) return { error: "Falta el código del tipo de operación" };
    const cuenta = (v) => { const c = txt(v, 40); return CODIGO_CUENTA.test(c) ? c : null; };
    const fila = {
      codigo,
      nombre: txt(f?.nombre) || null,
      grupo: txt(f?.grupo, 40) || null,
      base_contable: txt(f?.base_contable, 20) || null,
      cuenta_debe: cuenta(f?.cuenta_debe),
      cuenta_haber: cuenta(f?.cuenta_haber),
      pide_entidad: !!f?.pide_entidad,
      pide_ot: !!f?.pide_ot,
      pide_cc: !!f?.pide_cc,
      descripcion: txt(f?.descripcion, 500) || null,
    };
    if (typeof f?.activo === "boolean") fila.activo = f.activo;
    return { fila };
  },
  tesoreria: (f) => {
    const cuenta = txt(f?.cuenta, 40);
    const nombre = txt(f?.nombre);
    if (!CODIGO_CUENTA.test(cuenta)) return { error: `"${cuenta}" no es un código de cuenta` };
    if (!nombre) return { error: `La caja ${cuenta} no tiene nombre` };
    const fila = {
      cuenta,
      nombre,
      tipo: TIPOS_TESORERIA[f?.tipo] ? f.tipo : "otro",
      moneda: f?.moneda === "USD" ? "USD" : "ARS",
    };
    if (typeof f?.activa === "boolean") fila.activa = f.activa;
    if (f?.responsable_id === null || /^[0-9a-f-]{36}$/i.test(String(f?.responsable_id ?? ""))) {
      if (f?.responsable_id !== undefined) fila.responsable_id = f.responsable_id;
    }
    return { fila };
  },
  centros: (f) => {
    const codigo = txt(f?.codigo, 60);
    if (!codigo) return { error: "Falta el código del centro de costo" };
    const fila = { codigo, nombre: txt(f?.nombre) || null, division: txt(f?.division, 60) || null, tipo: txt(f?.tipo, 40) || null };
    if (typeof f?.activo === "boolean") fila.activo = f.activo;
    return { fila };
  },
};

/** Una fila de la configuración lista para guardar, o { error }. */
export function limpiarFila(tabla, f) {
  const fn = LIMPIAR[tabla];
  if (!fn) return { error: "Tabla desconocida" };
  return fn(f);
}

/** Varias filas: { filas } sin repetidos por clave, o { error } con la primera mal. */
export function limpiarFilas(tabla, lista) {
  if (!TABLAS_FIN[tabla]) return { error: "Tabla desconocida" };
  if (!Array.isArray(lista) || !lista.length) return { error: "No hay filas para copiar" };
  if (lista.length > MAX_FILAS_IMPORTAR) return { error: `Son más de ${MAX_FILAS_IMPORTAR} filas` };
  const k = TABLAS_FIN[tabla].clave;
  const porClave = new Map();
  for (let i = 0; i < lista.length; i++) {
    const r = limpiarFila(tabla, lista[i]);
    if (r.error) return { error: `Fila ${i + 1}: ${r.error}` };
    if (!porClave.has(r.fila[k])) porClave.set(r.fila[k], r.fila);
  }
  return { filas: [...porClave.values()] };
}
