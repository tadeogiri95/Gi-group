// app/lib/planillaMrp.js — Pasar los movimientos de stock de Gypi a la
// planilla MRP (Stock, parte 15; ítem 40). La planilla sigue mandando: su
// script de Apps Script le pide a Gypi los movimientos nuevos cada hora, con
// una clave privada de la empresa, y los anota al final de fact_consumos_stock
// y fact_ingresos_stock con las mismas columnas que el formulario.
//
// En la planilla el stock es: ingresos (fact_ingresos_stock I) menos consumos
// (fact_consumos_stock H). Por eso un retiro va positivo en consumos, una
// devolución negativa (y como CONSUMO FÁBRICA, así baja el consumo real de la
// OT) y un ajuste que suma stock va negativo en consumos.
//
// Compras, parte 23: el mismo script trae las órdenes de compra abiertas a
// fact_ordenes_compra, con lo que falta llegar y ESTADO "PENDIENTE". Así
// EN TRÁNSITO (INVENTARIO W suma esa hoja por SKU) las tiene en cuenta y el
// MRP no sugiere comprar dos veces lo mismo. Las filas de Gypi llevan N° OC
// "GY-OC-<n>" y se rehacen en cada vuelta; las cargadas a mano no se tocan.
import crypto from "crypto";
import { CLAVE_PLANILLA_MRP } from "./movimientosStock";
import { ESTADOS_OC, pendienteItem } from "./ordenesCompra";

export { CLAVE_PLANILLA_MRP };

const PREFIJO = "gyp";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hashClave = (clave) => crypto.createHash("sha256").update(String(clave)).digest("hex");

/** Clave nueva para la empresa. Se muestra una sola vez; se guarda el hash. */
export function generarClave(empresaId) {
  const clave = `${PREFIJO}_${empresaId}_${crypto.randomBytes(24).toString("hex")}`;
  return { clave, hash: hashClave(clave) };
}

/** "gyp_<empresa>_<secreto>" → id de la empresa, o null si no tiene esa forma. */
export function empresaDeClave(clave) {
  const partes = String(clave ?? "").trim().split("_");
  if (partes.length !== 3 || partes[0] !== PREFIJO || !/^[0-9a-f]{48}$/.test(partes[2])) return null;
  return UUID.test(partes[1]) ? partes[1].toLowerCase() : null;
}

/** ¿La clave coincide con el hash guardado? (comparación en tiempo constante) */
export function claveValida(clave, hashGuardado) {
  if (typeof hashGuardado !== "string" || !/^[0-9a-f]{64}$/.test(hashGuardado)) return false;
  return crypto.timingSafeEqual(Buffer.from(hashClave(clave), "hex"), Buffer.from(hashGuardado, "hex"));
}

/** Fecha (YYYY-MM-DD) de un momento en la zona horaria de la empresa. */
export function fechaEnZona(iso, timezone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Argentina/Buenos_Aires" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
  }
}

const ORIGEN = {
  consumo:    { hoja: "consumos", signo: 1,  origen: "CONSUMO FÁBRICA", detalle: "GYPI · Retiro" },
  devolucion: { hoja: "consumos", signo: -1, origen: "CONSUMO FÁBRICA", detalle: "GYPI · Devolución" },
  ajuste:     { hoja: "consumos", signo: -1, origen: "AJUSTE",          detalle: "GYPI · Ajuste" },
  ingreso:    { hoja: "ingresos", signo: 1,  origen: null,              detalle: "GYPI · Ingreso" },
};

/**
 * Un movimiento de Gypi como lo anota la planilla.
 * @returns {object|null} null si el tipo no se pasa a la planilla
 */
export function movimientoParaPlanilla(m, timezone) {
  const o = ORIGEN[m?.tipo];
  if (!o) return null;
  const cantidad = Number(m.cantidad);
  return {
    id: `GY-${m.id}`,
    hoja: o.hoja,
    fecha: fechaEnZona(m.created_at, timezone),
    momento: m.created_at,
    sku: m.sku,
    nombre: m.nombre || m.sku,
    cantidad: Math.round(cantidad * o.signo * 1000) / 1000,
    origen: o.origen,
    detalle: o.detalle,
    ot: m.ot || "",
    colaborador: m.empleado_nombre || "",
    legajo: m.legajo ?? null,
    proveedor: m.proveedor || "",
    comprobante: m.comprobante || "",
    precio_unitario: m.precio_unitario ?? null,
    anulado: !!m.anulado,
  };
}

/**
 * Renglones de las OC abiertas como van a fact_ordenes_compra: solo artículos
 * de la planilla (con SKU) y lo que todavía falta llegar.
 * @param {object[]} ordenes OC abiertas (borrador, enviada, recibida_parcial)
 * @param {object[]} items sus renglones
 */
export function ordenesParaPlanilla(ordenes, items, timezone) {
  const porOrden = new Map();
  for (const it of items || []) {
    if (!porOrden.has(it.orden_id)) porOrden.set(it.orden_id, []);
    porOrden.get(it.orden_id).push(it);
  }
  const filas = [];
  for (const oc of ordenes || []) {
    for (const it of porOrden.get(oc.id) || []) {
      const sku = String(it.sku ?? "").trim();
      const falta = pendienteItem(it);
      if (!sku || !falta) continue;
      filas.push({
        sku,
        nombre: it.descripcion || sku,
        proveedor: oc.proveedor_nombre || "",
        cantidad: falta,
        fecha_oc: fechaEnZona(oc.enviada_at || oc.created_at, timezone),
        fecha_prometida: oc.fecha_prometida || "",
        numero: `GY-OC-${oc.numero}`,
        notas: `GYPI · ${ESTADOS_OC[oc.estado]?.nombre || oc.estado}${oc.estado === "borrador" ? " (sin enviar)" : ""}`,
      });
    }
  }
  return filas;
}

/**
 * Código para pegar en Apps Script de la planilla MRP (Extensiones → Apps
 * Script). instalarGypi() se corre una vez: pide permiso, deja la tarea de
 * cada hora y trae lo que haya. Sin template strings adentro, para que el
 * texto salga igual.
 */
export function scriptPlanilla({ url, clave }) {
  return `// Gypi → planilla MRP: trae los retiros, devoluciones, ajustes e ingresos
// cargados en Gypi y los anota al final de fact_consumos_stock y
// fact_ingresos_stock. También deja en fact_ordenes_compra lo que falta
// llegar de las órdenes de compra abiertas (N° OC "GY-OC-…"), para que cuente
// en EN TRÁNSITO. Antes que nada anota al final de ARTICULOS los artículos
// nuevos cargados en Gypi (las columnas con fórmula las copia de la fila de
// arriba). Pegalo en un archivo nuevo de Apps Script, guardá y
// ejecutá instalarGypi una sola vez. Después corre solo cada hora.
// La clave es privada: no compartas este código.
var GYPI_URL = ${JSON.stringify(url)};
var GYPI_CLAVE = ${JSON.stringify(clave)};
var GYPI_HOJA_CONSUMOS = "fact_consumos_stock";
var GYPI_HOJA_INGRESOS = "fact_ingresos_stock";
var GYPI_HOJA_PERSONAL = "PERSONAL";
var GYPI_HOJA_ORDENES = "fact_ordenes_compra";
var GYPI_HOJA_ARTICULOS = "ARTICULOS";

function instalarGypi() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "traerMovimientosGypi") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("traerMovimientosGypi").timeBased().everyHours(1).create();
  traerMovimientosGypi();
}

function traerMovimientosGypi() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var desde = Number(props.getProperty("GYPI_DESDE") || 0);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cons = ss.getSheetByName(GYPI_HOJA_CONSUMOS);
    var ing = ss.getSheetByName(GYPI_HOJA_INGRESOS);
    var personal = gypiPersonal_(ss);
    var ya = {};
    // Lo que se cargó a mano en la planilla, para avisar si llega lo mismo de la app
    var aMano = gypiClaves_(cons, 3, 11, 6, 8).concat(gypiClaves_(ing, 2, 0, 8, 9));
    var manual = {};
    aMano.forEach(function (k) { manual[k] = (manual[k] || 0) + 1; });
    gypiIds_(cons).concat(gypiIds_(ing)).forEach(function (id) { ya[id] = true; });
    var anulados = null;
    var ordenes = null;
    var nuevoSku = {};
    for (var vuelta = 0; vuelta < 20; vuelta++) {
      var r = gypiPedir_(desde, vuelta === 0);
      if (vuelta === 0) nuevoSku = gypiArticulos_(ss.getSheetByName(GYPI_HOJA_ARTICULOS), r.articulos || [], props);
      if (anulados === null) anulados = r.anulados || [];
      if (vuelta === 0 && r.ordenes) ordenes = r.ordenes;
      var filasC = [], filasI = [], dudasC = [], dudasI = [];
      r.movimientos.forEach(function (m) {
        if (m.anulado || ya[m.id]) return;
        ya[m.id] = true;
        if (nuevoSku[m.sku]) m.sku = nuevoSku[m.sku];
        var fecha = gypiFecha_(m.fecha);
        var clave = gypiClave_(m.sku, m.hoja === "ingresos" ? "" : m.ot, m.fecha, m.cantidad);
        var duda = manual[clave] > 0;
        if (duda) manual[clave]--;
        var detalle = duda ? m.detalle + " · ¿duplicado?" : m.detalle;
        if (m.hoja === "ingresos") {
          dudasI.push(duda);
          filasI.push([m.id, m.sku, "", fecha, m.nombre, m.proveedor, m.comprobante, fecha, m.cantidad,
            m.precio_unitario === null ? "" : m.precio_unitario]);
        } else {
          dudasC.push(duda);
          var col = gypiColaborador_(personal, m.colaborador);
          filasC.push([m.id, new Date(m.momento), m.sku, col.codigo, fecha.getMonth() + 1, fecha, m.nombre,
            m.cantidad, col.nombre, m.origen, m.ot, detalle]);
        }
      });
      gypiAgregar_(cons, filasC, 6, false, dudasC);
      gypiAgregar_(ing, filasI, 4, true, dudasI);
      desde = r.hasta;
      props.setProperty("GYPI_DESDE", String(desde));
      if (!r.hayMas) break;
    }
    gypiBorrarAnulados_(cons, anulados || []);
    gypiBorrarAnulados_(ing, anulados || []);
    if (ordenes) {
      ordenes.forEach(function (o) { if (nuevoSku[o.sku]) o.sku = nuevoSku[o.sku]; });
      gypiOrdenes_(ss.getSheetByName(GYPI_HOJA_ORDENES), ordenes);
    }
  } finally {
    lock.releaseLock();
  }
}

function gypiPedir_(desde, conOrdenes) {
  var res = UrlFetchApp.fetch(GYPI_URL + "?desde=" + desde + (conOrdenes ? "&ordenes=1" : ""), {
    headers: { Authorization: "Bearer " + GYPI_CLAVE },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("Gypi respondió " + res.getResponseCode() + ": " + res.getContentText());
  return JSON.parse(res.getContentText());
}

// Artículos nuevos de Gypi al final de ARTICULOS. Las columnas que son
// fórmula (en la última fila o arrastrada desde arriba) no se escriben: la
// fórmula de la fila de arriba se copia, así el SKU, el número y el nombre
// normalizado salen como siempre. Después se le avisa a Gypi con qué SKU
// quedó cada uno; si es otro que el provisorio, Gypi lo cambia en todos
// lados. Devuelve { skuProvisorio: skuDeLaPlanilla } de los que cambiaron.
function gypiArticulos_(hoja, articulos, props) {
  var cambios = {};
  if (!hoja || !articulos.length) return cambios;
  var hechos = JSON.parse(props.getProperty("GYPI_ARTICULOS") || "{}");
  var ancho = hoja.getLastColumn();
  var titulos = hoja.getRange(1, 1, 1, ancho).getValues()[0].map(gypiNormalizar_);
  var colSku = titulos.indexOf("ID_SKU") + 1;
  if (colSku < 1) return cambios;
  var fila = gypiPrimeraLibre_(hoja, colSku);
  var modelo = fila > 2 ? hoja.getRange(fila - 1, 1, 1, ancho).getFormulasR1C1()[0] : [];
  var arriba = hoja.getRange(1, 1, Math.min(2, hoja.getMaxRows()), ancho).getFormulas();
  var calculada = titulos.map(function (_, c) {
    var f2 = String((arriba[1] || [])[c] || "").toUpperCase();
    return Boolean(modelo[c]) || Boolean(arriba[0][c]) ||
      f2.indexOf("ARRAYFORMULA") !== -1 || f2.indexOf("BYROW(") !== -1 || f2.indexOf("MAP(") !== -1;
  });
  articulos.forEach(function (a) {
    if (hechos[a.alta] !== undefined) return;
    var porTitulo = {};
    Object.keys(a.columnas).forEach(function (t) { porTitulo[gypiNormalizar_(t)] = a.columnas[t]; });
    var valores = titulos.map(function (t, c) {
      if (calculada[c]) return "";
      var v = porTitulo[t];
      return v === undefined || v === null ? "" : v;
    });
    if (fila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 1);
    hoja.getRange(fila, 1, 1, ancho).setValues([valores]);
    titulos.forEach(function (_, c) {
      if (modelo[c]) hoja.getRange(fila, c + 1).setFormulaR1C1(modelo[c]);
    });
    SpreadsheetApp.flush();
    var sku = String(hoja.getRange(fila, colSku).getValue() || "").trim();
    if (!sku || sku.charAt(0) === "#") {
      sku = "";
      hoja.getRange(fila, 1, 1, ancho).setBackground("yellow");
    }
    hechos[a.alta] = sku;
    fila++;
  });
  var ids = Object.keys(hechos).sort(function (x, y) { return Number(y) - Number(x); });
  var guardar = {};
  ids.slice(0, 300).forEach(function (id) { guardar[id] = hechos[id]; });
  props.setProperty("GYPI_ARTICULOS", JSON.stringify(guardar));
  var confirmar = articulos.map(function (a) {
    var sku = hechos[a.alta];
    if (sku && sku !== a.sku) cambios[a.sku] = sku;
    return { alta: a.alta, sku: sku };
  });
  var res = UrlFetchApp.fetch(GYPI_URL, {
    method: "patch",
    contentType: "application/json",
    payload: JSON.stringify({ articulos: confirmar }),
    headers: { Authorization: "Bearer " + GYPI_CLAVE },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) console.warn("Gypi no confirmó los artículos: " + res.getContentText());
  return cambios;
}

function gypiFecha_(texto) {
  var p = String(texto).split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

// Ids "GY-…" que ya están en la columna A
function gypiIds_(hoja) {
  var n = hoja.getLastRow();
  if (n < 2) return [];
  return hoja.getRange(2, 1, n - 1, 1).getValues()
    .map(function (f) { return String(f[0]); })
    .filter(function (id) { return id.indexOf("GY-") === 0; });
}

// Primera fila libre mirando una columna con datos (las fórmulas llegan más abajo)
function gypiPrimeraLibre_(hoja, columna) {
  var n = hoja.getMaxRows();
  var valores = hoja.getRange(1, columna, n, 1).getValues();
  for (var i = valores.length - 1; i >= 0; i--) {
    if (valores[i][0] !== "" && valores[i][0] !== null) return i + 2;
  }
  return 2;
}

// Artículo, OT, día y cantidad: si coinciden con un renglón cargado a mano,
// puede ser el mismo retiro anotado dos veces.
function gypiClave_(sku, ot, fecha, cantidad) {
  var dia = fecha instanceof Date
    ? fecha.getFullYear() + "-" + ("0" + (fecha.getMonth() + 1)).slice(-2) + "-" + ("0" + fecha.getDate()).slice(-2)
    : String(fecha || "");
  return [String(sku || "").trim(), String(ot || "").trim().toUpperCase(), dia, Math.round(Number(cantidad) * 1000) / 1000].join("|");
}

// Claves de los renglones cargados a mano (con fecha y sin id GY-)
function gypiClaves_(hoja, colSku, colOt, colFecha, colCantidad) {
  var n = hoja.getLastRow();
  if (n < 2) return [];
  var ancho = Math.max(colSku, colOt, colFecha, colCantidad);
  return hoja.getRange(2, 1, n - 1, ancho).getValues()
    .filter(function (f) { return String(f[0]).indexOf("GY-") !== 0 && f[colFecha - 1] !== "" && f[colFecha - 1] !== null; })
    .map(function (f) { return gypiClave_(f[colSku - 1], colOt ? f[colOt - 1] : "", f[colFecha - 1], f[colCantidad - 1]); });
}

function gypiAgregar_(hoja, filas, columnaGuia, conTotales, dudas) {
  if (!filas.length) return;
  var desde = gypiPrimeraLibre_(hoja, columnaGuia);
  var falta = desde + filas.length - 1 - hoja.getMaxRows();
  if (falta > 0) hoja.insertRowsAfter(hoja.getMaxRows(), falta);
  hoja.getRange(desde, 1, filas.length, filas[0].length).setValues(filas);
  if (conTotales) {
    var totales = filas.map(function (_, i) {
      var r = desde + i;
      return ["=I" + r + "*J" + r, "=K" + r + "*0.21", "=K" + r + "+L" + r];
    });
    hoja.getRange(desde, 11, filas.length, 3).setFormulas(totales);
  }
  // Posible duplicado de algo cargado a mano: amarillo, para revisarlo
  (dudas || []).forEach(function (duda, i) {
    if (duda) hoja.getRange(desde + i, 1, 1, filas[0].length).setBackground("yellow");
  });
}

// Si en Gypi anularon un movimiento que ya estaba en la planilla, se borra su fila
function gypiBorrarAnulados_(hoja, anulados) {
  if (!anulados.length) return;
  var borrar = {};
  anulados.forEach(function (id) { borrar[id] = true; });
  var n = hoja.getLastRow();
  if (n < 2) return;
  var ids = hoja.getRange(2, 1, n - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (borrar[String(ids[i][0])]) hoja.deleteRow(i + 2);
  }
}

// Las OC abiertas de Gypi en fact_ordenes_compra. Se rehacen todas en cada
// vuelta: van en un bloque después del último renglón cargado a mano; si
// quedó alguna de Gypi más arriba, se vacía. No se borran filas, así no se
// achican los rangos de las fórmulas que leen la hoja.
function gypiOrdenes_(hoja, ordenes) {
  if (!hoja) return;
  var ANCHO = 9;
  var n = hoja.getLastRow();
  var valores = n >= 2 ? hoja.getRange(2, 1, n - 1, ANCHO).getValues() : [];
  var deGypi = function (f) { return String(f[7]).indexOf("GY-OC-") === 0; };
  var ultimaAMano = 1;
  valores.forEach(function (f, i) {
    var vacia = f.every(function (v) { return v === "" || v === null; });
    if (!vacia && !deGypi(f)) ultimaAMano = i + 2;
  });
  var vacia = function () { var f = []; for (var j = 0; j < ANCHO; j++) f.push(""); return f; };
  valores.forEach(function (f, i) {
    if (i + 2 < ultimaAMano && deGypi(f)) hoja.getRange(i + 2, 1, 1, ANCHO).setValues([vacia()]);
  });
  var filas = ordenes.map(function (o) {
    return [o.sku, o.nombre, o.proveedor, o.cantidad, o.fecha_oc ? gypiFecha_(o.fecha_oc) : "",
      o.fecha_prometida ? gypiFecha_(o.fecha_prometida) : "", "PENDIENTE", o.numero, o.notas];
  });
  // Lo de Gypi de la vuelta anterior que sobra queda en blanco
  var hasta = Math.max(n, ultimaAMano + filas.length);
  while (filas.length < hasta - ultimaAMano) filas.push(vacia());
  if (!filas.length) return;
  var falta = ultimaAMano + filas.length - hoja.getMaxRows();
  if (falta > 0) hoja.insertRowsAfter(hoja.getMaxRows(), falta);
  hoja.getRange(ultimaAMano + 1, 1, filas.length, ANCHO).setValues(filas);
}

function gypiNormalizar_(texto) {
  return String(texto || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toUpperCase().trim();
}

function gypiPersonal_(ss) {
  var hoja = ss.getSheetByName(GYPI_HOJA_PERSONAL);
  if (!hoja || hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues()
    .filter(function (f) { return f[0] !== "" && f[1] !== ""; })
    .map(function (f) {
      return { codigo: f[0], nombre: f[1], palabras: gypiNormalizar_(f[1]).split(/\\s+/) };
    });
}

// El nombre de Gypi ("Facundo Guzmán") contra PERSONAL ("GUZMAN FACUNDO ARIEL"):
// todas sus palabras tienen que estar, y en una sola persona.
function gypiColaborador_(personal, nombre) {
  var palabras = gypiNormalizar_(nombre).split(/\\s+/).filter(function (p) { return p; });
  if (!palabras.length) return { codigo: "", nombre: "" };
  var hallados = personal.filter(function (p) {
    return palabras.every(function (w) { return p.palabras.indexOf(w) !== -1; });
  });
  if (hallados.length === 1) return { codigo: hallados[0].codigo, nombre: hallados[0].nombre };
  return { codigo: "", nombre: gypiNormalizar_(nombre) };
}
`;
}
