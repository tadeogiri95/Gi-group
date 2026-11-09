// app/lib/finanzasLibro.js — Finanzas, parte F2c: Gypi alimenta el libro
// contable (Google Sheets). Sin migración: la clave del script va en
// config_sistema ("finanzas_libro"), como la planilla MRP y el Plan de trabajo.
//
// Un script de Apps Script en el libro le pide a Gypi cada 15 minutos lo que
// se cargó acá y lo deja en las hojas, como si se hubiera cargado a mano:
//   - T-OPERACIONES: cada operación de Gypi es un renglón con
//     referencia_externa "GY-F-<id>". Las cuentas van por nombre en
//     cuenta_debe_override / cuenta_haber_override (el libro las busca en
//     dim_plan_cuentas). Si la operación cambia (otro tipo), se reescribe; si
//     se anula, el renglón se borra. Los saldos iniciales no se mandan: salieron
//     del libro.
//   - R-CHEQUES: cada cheque cargado en Gypi es un renglón con id_op_origen
//     "GY-C-<id>" y el estado como lo usa el libro (ACTIVO, ENTREGADO, PAGADO,
//     RECHAZADO). Los que se copiaron del libro no se repiten: solo se les
//     actualiza el estado y "ENTREGADO A" (se buscan por el número de renglón).
// Las fórmulas del libro (Total, mes, cuentas finales, flujo) se copian del
// renglón de arriba: el script nunca escribe encima de una fórmula.
export { generarClave, empresaDeClave, claveValida } from "./planillaMrp";

export const CLAVE_LIBRO_FIN = "finanzas_libro";
export const PREFIJO_OPERACION = "GY-F-";
export const PREFIJO_CHEQUE = "GY-C-";

const TIPO_LIBRO = {
  echeq_diferido: "E-CHEQ PAGO DIFERIDO",
  echeq_comun: "E-CHEQ COMÚN",
  cheque_diferido: "CHEQUE PAGO DIFERIDO",
  cheque_fisico: "CHEQUE FÍSICO",
};
const ESTADO_LIBRO = {
  pendiente: "ACTIVO", en_cartera: "ACTIVO", entregado: "ENTREGADO",
  debitado: "PAGADO", depositado: "PAGADO", rechazado: "RECHAZADO", anulado: "ANULADO",
};

const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const txt = (v, max = 500) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const fechaAr = (iso) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10) : "");
/** Marca de versión: cambia cada vez que la fila cambia en Gypi. */
const version = (x) => String(x.updated_at || x.created_at || "");

/** Estado del cheque como lo escribe el libro. */
export const estadoLibro = (estado) => ESTADO_LIBRO[estado] || String(estado || "").toUpperCase();

/**
 * El renglón de T-OPERACIONES de una operación de Gypi.
 * @returns {{ id: number, v: string, valores: object }}
 */
export function filaOperacion(op, { cuentas = new Map(), proveedores = new Map(), proyectos = new Map() } = {}) {
  const descripcion = [op.descripcion, op.referencia ? `Ref. ${op.referencia}` : null].filter(Boolean).join(" · ");
  return {
    id: op.id,
    v: version(op),
    valores: {
      fecha: op.fecha,
      usuario: txt(op.cargada_por_nombre, 120) || "Gypi",
      tipo: op.tipo,
      entidad: txt(proveedores.get(Number(op.proveedor_id)) || op.entidad, 120),
      proyecto: op.proyecto_id ? txt(proyectos.get(Number(op.proyecto_id)), 60) : "",
      centro_costo: txt(op.centro_costo, 60),
      neto: n2(op.neto),
      impuestos: n2((Number(op.iva) || 0) + (Number(op.otros_impuestos) || 0)),
      moneda: op.moneda || "ARS",
      // Por nombre: el libro las convierte a código con dim_plan_cuentas
      debe: cuentas.get(op.cuenta_debe) || op.cuenta_debe,
      haber: cuentas.get(op.cuenta_haber) || op.cuenta_haber,
      descripcion: txt(descripcion),
      referencia: `${PREFIJO_OPERACION}${op.id}`,
      estado: op.estado === "para_revisar" ? "" : "CONFIRMADO",
    },
  };
}

/** El renglón de R-CHEQUES de un cheque cargado en Gypi. */
export function filaCheque(ch, { empresa = "", proveedores = new Map() } = {}) {
  const propio = ch.clase === "propio";
  return {
    id: ch.id,
    v: version(ch),
    valores: {
      fecha_transac: fechaAr(ch.created_at) || ch.fecha_emision || ch.fecha_pago,
      fecha_emision: ch.fecha_emision || "",
      tipo: TIPO_LIBRO[ch.tipo] || "",
      librador: txt(propio ? empresa || ch.librador : ch.librador || ch.recibido_de, 120),
      banco: txt(ch.banco, 60),
      beneficiario: txt(propio ? ch.beneficiario || proveedores.get(Number(ch.proveedor_id)) : ch.beneficiario || empresa, 120),
      numero: txt(ch.numero, 40),
      vencimiento: ch.fecha_pago,
      monto: n2(ch.importe),
      estado: estadoLibro(ch.estado),
      entregado_a: ch.estado === "entregado" ? txt(ch.entregado_a || proveedores.get(Number(ch.proveedor_id)), 120) : "",
      referencia: `${PREFIJO_CHEQUE}${ch.id}`,
    },
  };
}

/**
 * Lo que el script baja al libro.
 * @returns {{ operaciones: object[], cheques: object[], cheques_libro: { ref: string, estado: string, entregado_a: string }[] }}
 */
export function datosParaLibro({ operaciones = [], cheques = [], cuentas = [], proveedores = [], proyectos = [], empresa = "", tiposNuevos = null } = {}) {
  const ctx = {
    cuentas: new Map(cuentas.map((c) => [c.codigo, c.nombre])),
    proveedores: new Map(proveedores.map((p) => [Number(p.id), p.nombre])),
    proyectos: new Map(proyectos.map((p) => [Number(p.id), p.ot])),
    empresa,
  };
  return {
    operaciones: operaciones
      // Lo que vino del libro (saldos y renglones pasados a Gypi) no vuelve
      .filter((op) => !op.anulada_at && op.origen !== "saldo_inicial" && op.origen !== "libro")
      .map((op) => filaOperacion(op, ctx)),
    // Los anulados cargados en Gypi no van (si ya estaban, el script los borra)
    cheques: cheques.filter((ch) => ch.origen !== "libro" && ch.estado !== "anulado").map((ch) => filaCheque(ch, ctx)),
    cheques_libro: cheques
      .filter((ch) => ch.origen === "libro" && ch.referencia)
      .map((ch) => ({ ref: String(ch.referencia), estado: estadoLibro(ch.estado), entregado_a: ch.estado === "entregado" ? txt(ch.entregado_a || ctx.proveedores.get(Number(ch.proveedor_id)), 120) : "" })),
    // Los tipos nuevos (parte 2): el script los suma a dim_tipos_op y
    // dim_flujo, y con reescribir = true pasa T-OPERACIONES una vez
    ...(tiposNuevos ? { tipos_nuevos: tiposNuevos } : {}),
  };
}

/**
 * Código para pegar en Apps Script del libro (Extensiones → Apps Script).
 * instalarLibroGypi() se corre una vez: pide permiso, deja la tarea de cada
 * 15 minutos y pasa lo que haya. Sin template strings adentro, para que el
 * texto salga igual.
 */
export function scriptLibro({ url, clave }) {
  return `// Gypi → libro contable: baja a T-OPERACIONES las operaciones cargadas en
// Gypi (compras, pagos, cheques…) y a R-CHEQUES los cheques. Cada renglón de
// Gypi lleva su marca (GY-F-n en referencia_externa, GY-C-n en id_op_origen):
// si cambia en Gypi se reescribe y si se anula se borra. Los renglones
// cargados a mano no se tocan. Las fórmulas se copian del renglón de arriba.
// También suma los tipos de operación nuevos a dim_tipos_op y dim_flujo y,
// cuando en Gypi se aprieta "Pasar a los tipos nuevos", reescribe una sola
// vez cod_tipo_op de T-OPERACIONES (antes deja una copia de respaldo de las
// hojas, con "_bk_tipos_" y la fecha en el nombre).
// Pegalo en un archivo nuevo de Apps Script, guardá y ejecutá
// instalarLibroGypi una sola vez. Después corre solo cada 15 minutos.
// La clave es privada: no compartas este código.
var GYPI_LIBRO_URL = ${JSON.stringify(url)};
var GYPI_LIBRO_CLAVE = ${JSON.stringify(clave)};

// Columnas de cada hoja (por título) que escribe Gypi, en orden
var GYPI_COLS_OPS = [
  ["fecha_operación", "fecha"], ["usuario", "usuario"], ["cod_tipo_op", "tipo"], ["id_entidad", "entidad"],
  ["id_proyecto", "proyecto"], ["centro_costo", "centro_costo"], ["importe_neto", "neto"],
  ["impuestos, retenciones y/o percepciones", "impuestos"], ["moneda", "moneda"],
  ["cuenta_debe_override", "debe"], ["cuenta_haber_override", "haber"], ["descripcion", "descripcion"],
  ["referencia_externa", "referencia"], ["estado", "estado"]
];
var GYPI_COLS_CHEQUES = [
  ["fecha_transac", "fecha_transac"], ["fecha_emision", "fecha_emision"], ["tipo", "tipo"], ["cant", "cant"],
  ["librador", "librador"], ["banco", "banco"], ["beneficiario", "beneficiario"], ["nro cheque", "numero"],
  ["vencimiento", "vencimiento"], ["monto", "monto"], ["estado", "estado"], ["entregado a", "entregado_a"],
  ["id_op_origen", "referencia"]
];
var GYPI_FECHAS = { fecha: 1, fecha_transac: 1, fecha_emision: 1, vencimiento: 1 };

function instalarLibroGypi() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "pasarLibroGypi") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pasarLibroGypi").timeBased().everyMinutes(15).create();
  pasarLibroGypi();
}

function pasarLibroGypi() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var r = gypiLibroPedir_();
    var libro = SpreadsheetApp.getActiveSpreadsheet();
    if (r.tipos_nuevos) gypiLibroTipos_(libro, r.tipos_nuevos);
    var ops = libro.getSheetByName("T-OPERACIONES");
    if (ops) gypiLibroEspejo_(ops, GYPI_COLS_OPS, "referencia_externa", "GY-F-", r.operaciones || [], "fecha_operación");
    var ch = libro.getSheetByName("R-CHEQUES");
    if (ch) {
      gypiLibroEspejo_(ch, GYPI_COLS_CHEQUES, "id_op_origen", "GY-C-", (r.cheques || []).map(function (c) { c.valores.cant = 1; return c; }), "vencimiento");
      gypiLibroEstados_(ch, r.cheques_libro || []);
    }
  } finally {
    lock.releaseLock();
  }
}

function gypiLibroNorm_(s) { return String(s).replace(/\\s+/g, " ").trim().toLowerCase(); }

function gypiLibroTitulos_(hoja) {
  var t = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0].map(gypiLibroNorm_);
  var col = {};
  t.forEach(function (x, i) { if (x && col[x] === undefined) col[x] = i + 1; });
  return col;
}

// Último renglón con dato en esa columna (no cuenta las fórmulas sueltas de más abajo)
function gypiLibroUltima_(hoja, c) {
  var n = hoja.getLastRow();
  if (n < 2) return 1;
  var v = hoja.getRange(2, c, n - 1, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (v[i][0] !== "" && v[i][0] !== null) return i + 2;
  return 1;
}

function gypiLibroValor_(k, v) {
  if (v === null || v === undefined) return "";
  if (GYPI_FECHAS[k] && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(v))) {
    var p = String(v).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  return v;
}

// Las columnas a escribir agrupadas en tramos seguidos (sin pisar fórmulas del medio)
function gypiLibroTramos_(cols, col) {
  var lista = cols.map(function (c) { return { n: col[c[0]], k: c[1] }; }).filter(function (x) { return x.n; });
  lista.sort(function (a, b) { return a.n - b.n; });
  var tramos = [];
  lista.forEach(function (x) {
    var t = tramos[tramos.length - 1];
    if (t && t.desde + t.ks.length === x.n) t.ks.push(x.k); else tramos.push({ desde: x.n, ks: [x.k] });
  });
  return tramos;
}

function gypiLibroEscribir_(hoja, fila, tramos, items) {
  tramos.forEach(function (t) {
    hoja.getRange(fila, t.desde, items.length, t.ks.length).setValues(items.map(function (it) {
      return t.ks.map(function (k) { return gypiLibroValor_(k, it.valores[k]); });
    }));
  });
}

function gypiLibroEspejo_(hoja, cols, tituloMarca, prefijo, items, tituloFecha) {
  var col = gypiLibroTitulos_(hoja);
  var cMarca = col[gypiLibroNorm_(tituloMarca)];
  var cFecha = col[gypiLibroNorm_(tituloFecha)];
  if (!cMarca || !cFecha) throw new Error("La hoja " + hoja.getName() + " no tiene las columnas " + tituloMarca + " y " + tituloFecha);
  var tramos = gypiLibroTramos_(cols, col);
  var vivos = {};
  items.forEach(function (it) { vivos[prefijo + it.id] = it; });

  // 1) Borrar los renglones de Gypi que ya no están (anulados), de abajo para arriba
  var ultima = gypiLibroUltima_(hoja, cMarca);
  if (ultima >= 2) {
    var marcas = hoja.getRange(2, cMarca, ultima - 1, 1).getDisplayValues();
    for (var i = marcas.length - 1; i >= 0; i--) {
      var m = String(marcas[i][0]).trim();
      if (m.indexOf(prefijo) === 0 && !vivos[m]) hoja.deleteRow(i + 2);
    }
  }

  // 2) Reescribir los que cambiaron (la versión va en la nota de la marca)
  ultima = gypiLibroUltima_(hoja, cMarca);
  var ya = {};
  if (ultima >= 2) {
    var rango = hoja.getRange(2, cMarca, ultima - 1, 1);
    var ms = rango.getDisplayValues();
    var notas = rango.getNotes();
    for (var j = 0; j < ms.length; j++) {
      var mk = String(ms[j][0]).trim();
      var it = vivos[mk];
      if (!it) continue;
      ya[mk] = true;
      if (notas[j][0] === it.v) continue;
      gypiLibroEscribir_(hoja, j + 2, tramos, [it]);
      hoja.getRange(j + 2, cMarca).setNote(it.v);
    }
  }

  // 3) Agregar los nuevos al final, con las fórmulas del último renglón
  var nuevos = items.filter(function (it) { return !ya[prefijo + it.id]; });
  if (!nuevos.length) return;
  var fin = Math.max(gypiLibroUltima_(hoja, cFecha), gypiLibroUltima_(hoja, cMarca));
  var desde = fin + 1;
  if (hoja.getMaxRows() < fin + nuevos.length) hoja.insertRowsAfter(hoja.getMaxRows(), fin + nuevos.length - hoja.getMaxRows());
  var ancho = hoja.getLastColumn();
  if (fin >= 2) {
    hoja.getRange(fin, 1, 1, ancho).copyTo(hoja.getRange(desde, 1, nuevos.length, ancho));
    // De lo copiado quedan solo las fórmulas: los datos sueltos del renglón de arriba se borran
    var escritas = {};
    tramos.forEach(function (t) { for (var q = 0; q < t.ks.length; q++) escritas[t.desde + q] = true; });
    var formulas = hoja.getRange(fin, 1, 1, ancho).getFormulas()[0];
    for (var c = 1; c <= ancho; c++) {
      if (!formulas[c - 1] && !escritas[c]) hoja.getRange(desde, c, nuevos.length, 1).clearContent();
    }
  }
  // Numeración de la primera columna (C o |): sigue la del libro
  if (cMarca !== 1 && cFecha !== 1 && fin >= 2) {
    var nums = hoja.getRange(2, 1, fin - 1, 1).getValues().map(function (x) { return Number(x[0]) || 0; });
    var max = Math.max.apply(null, nums.concat([0]));
    hoja.getRange(desde, 1, nuevos.length, 1).setValues(nuevos.map(function (_, k) { return [max + k + 1]; }));
  }
  gypiLibroEscribir_(hoja, desde, tramos, nuevos);
  hoja.getRange(desde, cMarca, nuevos.length, 1).setNotes(nuevos.map(function (it) { return [it.v]; }));
}

// Cheques copiados del libro a Gypi: se actualiza el estado y "ENTREGADO A"
function gypiLibroEstados_(hoja, lista) {
  if (!lista.length) return;
  var col = gypiLibroTitulos_(hoja);
  var cEst = col["estado"], cEnt = col["entregado a"];
  var ultima = hoja.getLastRow();
  if (!cEst || ultima < 2) return;
  var por = {};
  lista.forEach(function (x) { por[String(x.ref)] = x; });
  var refs = hoja.getRange(2, 1, ultima - 1, 1).getDisplayValues();
  var ests = hoja.getRange(2, cEst, ultima - 1, 1).getDisplayValues();
  var ents = cEnt ? hoja.getRange(2, cEnt, ultima - 1, 1).getDisplayValues() : null;
  for (var i = 0; i < refs.length; i++) {
    var x = por[String(refs[i][0]).trim()];
    if (!x) continue;
    if (String(ests[i][0]).trim().toUpperCase() !== x.estado) hoja.getRange(i + 2, cEst).setValue(x.estado);
    if (ents && x.entregado_a && String(ents[i][0]).trim() !== x.entregado_a) hoja.getRange(i + 2, cEnt).setValue(x.entregado_a);
  }
}

// ── Tipos de operación nuevos ──────────────────────────────────────────
function gypiLibroClaveTipo_(s) {
  return String(s || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toUpperCase().replace(/\\s+/g, " ").trim();
}

function gypiLibroTipos_(libro, t) {
  if (!t || !t.lista) return;
  gypiLibroDimTipos_(libro, t);
  gypiLibroDimFlujo_(libro, t.lista);
  if (!t.reescribir) return;
  var props = PropertiesService.getDocumentProperties();
  if (Number(props.getProperty("gypi_tipos_version") || 0) >= Number(t.version)) return;
  gypiLibroReescribirTipos_(libro, t, props);
}

// Los códigos que ya están en una columna (por clave, sin tildes)
function gypiLibroCodigos_(hoja, c) {
  var ya = {};
  var u = gypiLibroUltima_(hoja, c);
  if (u >= 2) hoja.getRange(2, c, u - 1, 1).getDisplayValues().forEach(function (x, i) { ya[gypiLibroClaveTipo_(x[0])] = i + 2; });
  return { ya: ya, ultima: u };
}

// dim_tipos_op: los tipos nuevos que faltan, con las cuentas por defecto del primer tipo viejo que las tenga
function gypiLibroDimTipos_(libro, t) {
  var h = libro.getSheetByName("dim_tipos_op");
  if (!h) return;
  var col = gypiLibroTitulos_(h);
  var cCod = col["cod_tipo_op"];
  if (!cCod) return;
  var c = gypiLibroCodigos_(h, cCod);
  var copiar = ["subcuenta_debe_default", "nombre_debe", "subcuenta_haber_default", "nombre_haber"].filter(function (k) { return col[k]; });
  var fila = c.ultima;
  t.lista.forEach(function (x) {
    if (c.ya[gypiLibroClaveTipo_(x.codigo)]) return;
    fila++;
    h.getRange(fila, cCod).setValue(x.codigo);
    if (col["nombre"]) h.getRange(fila, col["nombre"]).setValue(x.nombre);
    if (col["grupo"]) h.getRange(fila, col["grupo"]).setValue(x.grupo);
    var fuente = (x.viejos || []).map(function (v) { return c.ya[gypiLibroClaveTipo_(v)]; }).filter(function (n) { return n; })[0];
    if (fuente) copiar.forEach(function (k) {
      var v = h.getRange(fuente, col[k]).getValue();
      if (v !== "" && v !== null) h.getRange(fila, col[k]).setValue(v);
    });
    c.ya[gypiLibroClaveTipo_(x.codigo)] = fila;
  });
}

// dim_flujo: la línea del flujo de cada tipo nuevo que falta (los que no mueven caja no van)
function gypiLibroDimFlujo_(libro, lista) {
  var h = libro.getSheetByName("dim_flujo");
  if (!h) return;
  var col = gypiLibroTitulos_(h);
  var cCod = col["cod_tipo_op"], cLinea = col["linea_flujo"], cSigno = col["signo_esperado"];
  if (!cCod || !cLinea) return;
  var c = gypiLibroCodigos_(h, cCod);
  var fila = c.ultima;
  lista.forEach(function (x) {
    if (!x.linea || c.ya[gypiLibroClaveTipo_(x.codigo)]) return;
    fila++;
    h.getRange(fila, cCod).setValue(x.codigo);
    h.getRange(fila, cLinea).setValue(x.linea);
    if (cSigno) h.getRange(fila, cSigno).setValue(x.signo);
    c.ya[gypiLibroClaveTipo_(x.codigo)] = fila;
  });
}

// Copia de respaldo con los valores (sin fórmulas, para que no recalcule)
function gypiLibroRespaldo_(libro, nombre, sello) {
  var h = libro.getSheetByName(nombre);
  if (!h) return;
  var bk = h.copyTo(libro).setName(nombre + "_bk_tipos_" + sello);
  var r = bk.getDataRange();
  r.copyTo(r, { contentsOnly: true });
}

function gypiLibroReescribirTipos_(libro, t, props) {
  var ops = libro.getSheetByName("T-OPERACIONES");
  if (!ops) return;
  var col = gypiLibroTitulos_(ops);
  var cT = col["cod_tipo_op"];
  if (!cT) throw new Error("T-OPERACIONES no tiene la columna cod_tipo_op");
  var ultima = ops.getLastRow();
  if (ultima < 2) return;
  var rT = ops.getRange(2, cT, ultima - 1, 1);
  if (rT.getFormulas().some(function (f) { return f[0]; })) throw new Error("cod_tipo_op tiene fórmulas: no se reescribe");
  var sello = Utilities.formatDate(new Date(), libro.getSpreadsheetTimeZone(), "yyyyMMdd_HHmm");
  ["T-OPERACIONES", "dim_tipos_op", "dim_flujo", "FLUJO_V2"].forEach(function (n) { gypiLibroRespaldo_(libro, n, sello); });
  // Con la copia hecha no se vuelve a intentar sola (si algo falla, queda la copia)
  props.setProperty("gypi_tipos_version", String(t.version));

  var mapa = {};
  Object.keys(t.mapa).forEach(function (k) { mapa[gypiLibroClaveTipo_(k)] = t.mapa[k]; });
  var tipos = rT.getValues();
  var cambia = tipos.map(function (x) { var n = mapa[gypiLibroClaveTipo_(x[0])]; return n && n !== x[0] ? n : null; });

  // Los renglones sin cuenta escrita toman la del tipo: se fija la de hoy antes de cambiarlo
  var nombres = {}, repetidos = {};
  var pc = libro.getSheetByName("dim_plan_cuentas");
  if (pc && pc.getLastRow() >= 2) pc.getRange(2, 1, pc.getLastRow() - 1, 2).getDisplayValues().forEach(function (x) {
    var nom = String(x[1]).trim();
    if (!x[0] || !nom) return;
    if (repetidos[nom] !== undefined) repetidos[nom] = true; else repetidos[nom] = false;
    nombres[String(x[0]).trim()] = nom;
  });
  [["cuenta_debe_override", "cuenta_debe_final"], ["cuenta_haber_override", "cuenta_haber_final"]].forEach(function (par) {
    var cO = col[par[0]], cF = col[par[1]];
    if (!cO || !cF) return;
    var over = ops.getRange(2, cO, ultima - 1, 1).getValues();
    var fin = ops.getRange(2, cF, ultima - 1, 1).getDisplayValues();
    for (var i = 0; i < over.length; i++) {
      if (!cambia[i] || over[i][0] !== "") continue;
      var nom = nombres[String(fin[i][0]).trim()];
      if (nom && !repetidos[nom]) ops.getRange(i + 2, cO).setValue(nom);
    }
  });

  var cambios = cambia.filter(function (x) { return x; }).length;
  rT.setValues(tipos.map(function (x, i) { return [cambia[i] || x[0]]; }));

  // La tabla de equivalencias, a la vista
  var m = libro.getSheetByName("mapa_tipos") || libro.insertSheet("mapa_tipos");
  m.clearContents();
  var filas = [["tipo_viejo", "tipo_nuevo"]].concat(Object.keys(t.mapa).map(function (k) { return [k, t.mapa[k]]; }));
  m.getRange(1, 1, filas.length, 2).setValues(filas);

  // FLUJO_V2: los renglones que ahora juntan todas las formas de pago cambian de nombre
  var f = libro.getSheetByName("FLUJO_V2");
  if (f && t.lineas && f.getLastRow() >= 1) {
    var bc = f.getRange(1, 2, f.getLastRow(), 2).getValues();
    for (var j = 0; j < bc.length; j++) {
      var nuevo = t.lineas[String(bc[j][0]).trim()];
      if (nuevo && bc[j][1] !== nuevo) f.getRange(j + 1, 3).setValue(nuevo);
    }
  }
  libro.toast("Tipos nuevos: se cambiaron " + cambios + " renglones. La copia de respaldo está en las hojas que terminan en _bk_tipos_" + sello + ".", "Gypi", 15);
}

function gypiLibroPedir_() {
  var res = UrlFetchApp.fetch(GYPI_LIBRO_URL, { method: "get", headers: { Authorization: "Bearer " + GYPI_LIBRO_CLAVE }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("Gypi respondió " + res.getResponseCode() + ": " + res.getContentText());
  return JSON.parse(res.getContentText());
}
`;
}
