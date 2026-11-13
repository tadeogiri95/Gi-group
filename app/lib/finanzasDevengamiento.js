// app/lib/finanzasDevengamiento.js — Finanzas → 📆 Devengamiento (parte 8
// del plan de Tesorería, 13/11). Sin migración.
//
// La lista completa de lo que una pyme tiene que devengar cada mes (lo que
// establecen las normas contables argentinas para pymes y la NIIF para
// PYMES): cada cosa va al mes en que ocurrió, aunque se cobre o se pague en
// otro. Cada renglón junta las cuentas del plan que le corresponden (por la
// clasificación del EERR del libro, y si la cuenta no la tiene, por el
// nombre) y muestra su total del mes, con un botón para cargar.
//
//   - Arriba, "Falta este mes": lo que todos los meses tiene importe y este
//     mes no (los servicios, las amortizaciones), los sueldos sin liquidar,
//     el S.O.S sin subir y las provisiones de aguinaldo y vacaciones.
//   - Recurrentes: el aguinaldo (1/12 de los sueldos), las vacaciones (14
//     días por año) y lo que se repite igual (amortizaciones, un seguro o el
//     inmobiliario pagado por año) Gypi lo propone y el Dueño lo confirma o
//     lo corrige en el asiento.
//   - S.O.S ventas: se guarda el total facturado de cada mes (config_sistema
//     "finanzas_devengamiento") y se compara con las entregas. No cambia el
//     ingreso del resultado, que son las entregas.
//   - Cada renglón se puede ocultar (⚙) y volver a mostrar.
import { finDeMes, importeResultado, mesesHasta, nombreMes } from "./finanzasResultados";
import { leerCsvSos } from "./finanzasSos";

export const CLAVE_DEVENGAMIENTO = "finanzas_devengamiento";
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const GRUPOS_DEVENGAMIENTO = [
  { id: "ing", titulo: "Ingresos" },
  { id: "costo", titulo: "Costo de lo entregado" },
  { id: "personal", titulo: "Personal" },
  { id: "gastos", titulo: "Gastos de funcionamiento" },
  { id: "imp", titulo: "Impuestos y tasas" },
  { id: "fin", titulo: "Financieros" },
  { id: "amort", titulo: "Amortizaciones" },
  { id: "prev", titulo: "Previsiones" },
  { id: "cierre", titulo: "Ajustes de cierre" },
  { id: "otros", titulo: "Sin clasificar" },
];

/**
 * Cómo se carga cada renglón:
 *   auto: sale solo de otra parte de Gypi (las entregas, las compras).
 *   gasto: 🧾 Cargar gasto (con o sin factura), en el mes del gasto.
 *   sueldos: 👷 Sueldos (la liquidación).
 *   sos: el CSV de compras del S.O.S.
 *   ventas: el CSV de ventas del S.O.S (solo como dato).
 *   asiento: un asiento de registro o de ajuste.
 *   mantenimiento: viene de Mantenimiento (flota y maquinaria).
 * recurrente: aguinaldo | vacaciones | repetir (Gypi propone el importe).
 * lado: para las cuentas de balance (anticipos, provisiones), qué lado cuenta.
 */
export const ITEMS_DEVENGAMIENTO = [
  // Ingresos
  { id: "entregas", grupo: "ing", nombre: "Entregas de OT valorizadas", ingreso: true, lineas: /^ING_ENT/, cargar: "auto", ayuda: "Es el ingreso del resultado: sale de las entregas de cada OT." },
  { id: "ventas_sos", grupo: "ing", nombre: "Ventas facturadas (S.O.S ventas)", ingreso: true, cargar: "ventas", ayuda: "Solo como dato: se compara con las entregas y no cambia el resultado." },
  { id: "anticipos", grupo: "ing", nombre: "Anticipos de clientes", ingreso: true, balance: true, lado: "haber", nombres: /anticipos? de clientes/i, cargar: "auto", ayuda: "No son ingreso hasta la entrega: se cargan al cobrar." },
  { id: "nc", grupo: "ing", nombre: "Notas de crédito, descuentos y bonificaciones", ingreso: true, lineas: /^ING_NC/, nombres: /descuentos otorgados|bonificaci/i, cargar: "asiento" },
  { id: "otros_ing", grupo: "ing", nombre: "Otros ingresos (recuperos, reintegros, venta de bienes de uso)", ingreso: true, lineas: /^ING_(OTR|X|AJUSTE)/, nombres: /otros ingresos|recupero|reintegro|venta bienes de uso|baja bien de uso|liquidaci[oó]n art|descuentos obtenidos/i, cargar: "asiento" },
  // Costo de lo entregado
  { id: "materiales", grupo: "costo", nombre: "Materiales consumidos", lineas: /^CMV_MAT/, cargar: "auto", ayuda: "Sale de las compras y del costo de cada OT (📊 Resultados)." },
  { id: "inventario", grupo: "costo", nombre: "Diferencia de inventario al cierre", nombres: /diferencia de inventario|costo de mercader[ií]a vendida/i, cargar: "asiento", ayuda: "Stock inicial + compras − stock final." },
  { id: "terceros", grupo: "costo", nombre: "Trabajos tercerizados", lineas: /^CMV_TER/, nombres: /trabajos? de terceros/i, cargar: "gasto" },
  { id: "mod", grupo: "costo", nombre: "Mano de obra de planta", lineas: /^CMV_MOD_(SUE|EXT|GRE)|^CMV_CIF_SUP/, cargar: "sueldos" },
  { id: "servicios", grupo: "gastos", nombre: "Servicios (luz, gas, agua, internet, teléfono)", lineas: /^GO_SER|^CMV_CIF_ELE/, nombres: /electricidad|^gas$|agua|internet|telef|servicios p[uú]blicos/i, cargar: "gasto", ayuda: "En el mes del consumo, aunque la factura llegue después." },
  { id: "cif", grupo: "costo", nombre: "Costos indirectos de fabricación (CIF)", lineas: /^CMV_CIF_(?!DEP)/, nombres: /gastos de fabricaci|insumos|embalaje/i, cargar: "gasto" },
  // Personal
  { id: "sueldos", grupo: "personal", nombre: "Sueldos y jornales (administración, diseño, logística)", lineas: /^GO_[A-Z]+_(SUE|EXT)|^GO_REM/, nombres: /sueldo|jornal|horas extras|remuneraci/i, cargar: "sueldos" },
  { id: "cargas", grupo: "personal", nombre: "Cargas sociales (F.931), ART y seguro de vida", lineas: /_CON$|_ART$/, nombres: /cargas sociales|contribuci[oó]n|aportes y contrib|\bart\b|seguro de vida/i, cargar: "sueldos" },
  { id: "aguinaldo", grupo: "personal", nombre: "Provisión de aguinaldo (1/12 por mes)", lineas: /_SAC$/, nombres: /s\.?\s?a\.?\s?c\.?$|aguinaldo/i, cargar: "asiento", recurrente: "aguinaldo" },
  { id: "vacaciones", grupo: "personal", nombre: "Provisión de vacaciones", lineas: /_VAC$/, nombres: /vacaci/i, cargar: "asiento", recurrente: "vacaciones" },
  { id: "bonos", grupo: "personal", nombre: "Bonos e indemnizaciones", lineas: /_BON$/, nombres: /bono|premio|indemniz|despido/i, cargar: "sueldos" },
  // Gastos de funcionamiento
  { id: "alquileres", grupo: "gastos", nombre: "Alquileres", lineas: /^ING_ALQ|^GO_ALQ/, nombres: /alquiler/i, cargar: "gasto" },
  { id: "seguros", grupo: "gastos", nombre: "Seguros (si se pagan por año, mes a mes)", lineas: /^GO_SEG/, nombres: /seguro/i, cargar: "asiento", recurrente: "repetir" },
  { id: "honorarios", grupo: "gastos", nombre: "Honorarios (contador, abogado, sistemas)", lineas: /^GO_HON/, nombres: /honorario/i, cargar: "gasto" },
  { id: "mantenimiento", grupo: "gastos", nombre: "Mantenimiento y reparaciones (flota y maquinaria)", lineas: /^GO_MAN/, nombres: /mantenimiento|reparaci/i, cargar: "mantenimiento", ayuda: "Viene de Mantenimiento; lo que no, se carga como gasto." },
  { id: "logistica", grupo: "gastos", nombre: "Combustible, fletes y logística", lineas: /^GO_LOG/, nombres: /combustible|flete|movilidad|log[ií]stica/i, cargar: "gasto" },
  { id: "oficina", grupo: "gastos", nombre: "Publicidad, software, viáticos y oficina", lineas: /^GO_ADM|^GO_DIS|^GO_LEA|_VIA$/, nombres: /publicidad|software|suscrip|vi[aá]tico|librer|inform[aá]tica|pasajes|leasing|gastos? generales?|gastos de representaci/i, cargar: "gasto" },
  { id: "comisiones", grupo: "gastos", nombre: "Comisiones de venta", lineas: /^GO_COM/, nombres: /comisiones (varias|de venta)|gastos de (venta|comercializaci)/i, cargar: "gasto" },
  // Impuestos y tasas
  { id: "iibb", grupo: "imp", nombre: "Ingresos Brutos y tasa de comercio e industria", lineas: /^IMP_(IIBB|CI)/, nombres: /ingresos brutos|comercio e industria/i, cargar: "asiento", ayuda: "Sobre las ventas del mes." },
  { id: "debcred", grupo: "imp", nombre: "Impuesto a los débitos y créditos", lineas: /^IMP_DEB/, nombres: /d[eé]bitos y cr[eé]ditos/i, cargar: "auto", ayuda: "Sale del extracto del banco." },
  { id: "inmob", grupo: "imp", nombre: "Inmobiliario y patentes (repartidos por mes)", lineas: /^IMP_(INM|AUT)/, nombres: /inmobiliario|automotor|patente|tasas?$/i, cargar: "asiento", recurrente: "repetir" },
  { id: "ganancias", grupo: "imp", nombre: "Ganancias (provisión estimada por mes)", lineas: /^IMP_GAN/, nombres: /impuesto a las ganancias|ganancia m[ií]nima/i, cargar: "asiento", recurrente: "repetir" },
  { id: "otros_imp", grupo: "imp", nombre: "Otros impuestos y multas", lineas: /^IMP_OTR|^GO_MUL/, nombres: /impuesto|bienes personales|iva cf no computable|multa/i, cargar: "gasto" },
  // Financieros
  { id: "gastos_banco", grupo: "fin", nombre: "Comisiones y gastos bancarios", lineas: /^FIN_COM/, nombres: /comisiones (y gastos bancarios|tarjetas|burs)/i, cargar: "auto", ayuda: "Sale del extracto del banco." },
  { id: "intereses_pag", grupo: "fin", nombre: "Intereses pagados (préstamos, tarjetas, descubierto)", lineas: /^FIN_INT/, nombres: /^intereses(?! ganados)|recargos/i, cargar: "asiento" },
  { id: "intereses_gan", grupo: "fin", nombre: "Intereses ganados (plazos fijos, FCI)", ingreso: true, lineas: /^ING_RENTA/, nombres: /intereses ganados|rendimiento|renta fija/i, cargar: "auto", ayuda: "Salen de 💰 Tesorería (plazos fijos e inversiones)." },
  { id: "dif_cambio", grupo: "fin", nombre: "Diferencia de cambio y de cotización de títulos", lineas: /^FIN_DIF/, nombres: /diferencias? (de )?(cambio|cotizaci)|tenencia|recpam|r\.e\.i/i, cargar: "asiento" },
  // Amortizaciones
  { id: "amortizaciones", grupo: "amort", nombre: "Amortizaciones (máquinas, rodados, inmuebles, equipos, software)", lineas: /_DEP$/, nombres: /amortizaci/i, cargar: "asiento", recurrente: "repetir" },
  // Previsiones
  { id: "incobrables", grupo: "prev", nombre: "Deudores incobrables", nombres: /incobrable|deudores morosos/i, cargar: "asiento" },
  { id: "garantias", grupo: "prev", nombre: "Garantías y service de muebles entregados", nombres: /garant[ií]as? (y|de)|service/i, cargar: "asiento" },
  { id: "juicios", grupo: "prev", nombre: "Juicios", nombres: /juicio/i, cargar: "asiento" },
  // Ajustes de cierre
  { id: "adelantados", grupo: "cierre", nombre: "Gastos pagados por adelantado que pasan al mes", balance: true, lado: "haber", nombres: /pagados? por adelantado|gastos anticipados|a devengar/i, cargar: "asiento" },
  { id: "sin_factura", grupo: "cierre", nombre: "Gastos del mes sin factura (provisión)", balance: true, lado: "haber", nombres: /facturas? a recibir|provisi[oó]n (de |para )?gastos/i, cargar: "gasto", ayuda: "Se corrige cuando llega la factura." },
  // Lo que no entra en ninguno (para que el total del mes cierre con 📊 Resultados)
  { id: "sin_clasificar", grupo: "otros", nombre: "Otras cuentas de resultado", cargar: "gasto" },
];

const ITEM = new Map(ITEMS_DEVENGAMIENTO.map((i) => [i.id, i]));
export const itemDevengamiento = (id) => ITEM.get(id) || null;

/** Una cuenta de resultado: con su renglón del EERR (salvo IVA, inversiones y las ventas, que no entran en el resultado) o del rubro RESULTADO / código 04. */
export function esResultado(c) {
  const l = String(c?.linea_eerr || "").toUpperCase();
  if (l) return !/^(IMP_IVA|INV_|ING_VTA)/.test(l);
  return /RESULTADO/i.test(String(c?.rubro || "")) || /^04/.test(String(c?.codigo || ""));
}

/**
 * A qué renglón va cada cuenta: primero por la clasificación del EERR, si no
 * por el nombre. Las cuentas que juntan otras ("Caja") no van.
 * @returns {Map<string, string>} código → id del renglón
 */
export function renglonesDeCuentas(cuentas = []) {
  const out = new Map();
  const madres = new Set();
  for (const c of cuentas) for (const x of cuentas) if (x.codigo !== c.codigo && String(x.codigo).startsWith(`${c.codigo}.`)) { madres.add(c.codigo); break; }
  for (const c of cuentas) {
    if (madres.has(c.codigo)) continue;
    const linea = String(c.linea_eerr || "").toUpperCase();
    const nombre = String(c.nombre || "").trim();
    const resultado = esResultado(c);
    let id = null;
    if (resultado) {
      if (linea) id = ITEMS_DEVENGAMIENTO.find((i) => !i.balance && i.lineas?.test(linea))?.id || null;
      if (!id) id = ITEMS_DEVENGAMIENTO.find((i) => !i.balance && i.nombres?.test(nombre))?.id || null;
      if (!id) id = "sin_clasificar";
    } else {
      id = ITEMS_DEVENGAMIENTO.find((i) => i.balance && i.nombres?.test(nombre))?.id || null;
    }
    if (id) out.set(c.codigo, id);
  }
  return out;
}

/**
 * El total de cada renglón por mes: gasto = debe − haber, ingreso = haber −
 * debe, en pesos y sin IVA (como 📊 Resultados). Las anuladas y las "para
 * revisar" no cuentan. En las cuentas de balance (anticipos, provisiones)
 * cuenta solo el lado que dice el renglón.
 * @returns {Map<string, Map<string, number>>} id → mes → total
 */
export function totalesPorMes(ops = [], cuentas = [], meses = []) {
  const renglon = renglonesDeCuentas(cuentas);
  const enVentana = new Set(meses);
  const out = new Map();
  const sumar = (id, mes, n) => {
    if (!out.has(id)) out.set(id, new Map());
    const m = out.get(id);
    m.set(mes, centavos((m.get(mes) || 0) + n));
  };
  for (const op of ops) {
    if (op.anulada_at || op.estado === "para_revisar") continue;
    const mes = String(op.fecha || "").slice(0, 7);
    if (!enVentana.has(mes)) continue;
    const monto = importeResultado(op);
    for (const [lado, cuenta] of [["debe", op.cuenta_debe], ["haber", op.cuenta_haber]]) {
      const id = renglon.get(cuenta);
      if (!id) continue;
      const it = ITEM.get(id);
      if (it.balance) {
        if (it.lado === lado) sumar(id, mes, monto);
        continue;
      }
      const positivo = it.ingreso ? lado === "haber" : lado === "debe";
      sumar(id, mes, positivo ? monto : -monto);
    }
  }
  return out;
}

/** El mes anterior ("2026-01" → "2025-12"). */
export function mesAnterior(mes) {
  let [a, m] = mes.split("-").map(Number);
  m -= 1;
  if (m === 0) { m = 12; a -= 1; }
  return `${a}-${String(m).padStart(2, "0")}`;
}

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-10" → "octubre". */
export const mesLargo = (mes) => (MES.test(String(mes || "")) ? MESES_LARGOS[Number(mes.slice(5)) - 1] : String(mes || ""));

const SUELDOS = ["mod", "sueldos"];
const total = (totales, id, mes) => totales.get(id)?.get(mes) || 0;

/**
 * Lo que Gypi propone para un renglón recurrente en un mes, o null.
 *   aguinaldo: 1/12 de los sueldos del mes.
 *   vacaciones: 14 días por año: sueldos ÷ 25 × 14 ÷ 12.
 *   repetir: el último mes con importe de los 12 anteriores.
 * @returns {{ importe: number, como: string, cuenta_debe: string, cuenta_haber: string, fecha: string, descripcion: string } | null}
 */
export function propuestaRecurrente(id, mes, { totales, cuentas = [], hoy = "" } = {}) {
  const it = ITEM.get(id);
  if (!it?.recurrente || !MES.test(String(mes || ""))) return null;
  const sueldos = centavos(SUELDOS.reduce((s, k) => s + total(totales, k, mes), 0));
  let importe = 0;
  let como = "";
  if (it.recurrente === "aguinaldo") {
    importe = centavos(sueldos / 12);
    como = `1/12 de los sueldos de ${mesLargo(mes)} (${sueldos.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
  } else if (it.recurrente === "vacaciones") {
    importe = centavos((sueldos / 25) * 14 / 12);
    como = `14 días de vacaciones por año: sueldos de ${mesLargo(mes)} ÷ 25 × 14 ÷ 12`;
  } else {
    let m = mes;
    for (let i = 0; i < 12; i++) {
      m = mesAnterior(m);
      const t = total(totales, id, m);
      if (t > 0) { importe = t; como = `Igual que en ${mesLargo(m)} ${m.slice(0, 4)}`; break; }
    }
  }
  if (!(importe > 0)) return null;
  const renglon = renglonesDeCuentas(cuentas);
  const deEste = cuentas.filter((c) => renglon.get(c.codigo) === id);
  const contra = {
    aguinaldo: /provisi[oó]n.*(s\.?a\.?c|aguinaldo)|sueldos a pagar/i,
    vacaciones: /provisi[oó]n.*vacaci|sueldos a pagar/i,
  }[it.recurrente] || (id === "amortizaciones" ? /amortizaci[oó]n(es)? acumulad/i : /pagados? por adelantado|gastos anticipados|a devengar|provisi[oó]n para impuestos|acreedores varios/i);
  // Las provisiones en orden: la que nombra la provisión antes que "Sueldos a pagar"
  const haber = cuentas.find((c) => contra.test(String(c.nombre || "")) && /provisi|acumulad|adelantado|anticipad|devengar/i.test(String(c.nombre || "")))
    || cuentas.find((c) => contra.test(String(c.nombre || "")));
  const fin = finDeMes(mes);
  return {
    importe, como,
    cuenta_debe: deEste[0]?.codigo || "",
    cuenta_haber: haber?.codigo || "",
    fecha: hoy && fin > hoy ? hoy : fin,
    descripcion: `${it.nombre.replace(/ \(.*\)$/, "")} de ${mesLargo(mes)} ${mes.slice(0, 4)}`,
  };
}

/**
 * "Falta este mes": lo que se esperaba y no está.
 * @returns {{ id: string, texto: string, accion: "sueldos"|"sos"|"ventas"|"cargar"|"proponer", item?: string }[]}
 */
export function faltaEsteMes(mes, { totales, ops = [], ocultos = [], ventas = {} } = {}) {
  const out = [];
  const oculto = new Set(ocultos);
  const ant = mesAnterior(mes);
  const ant2 = mesAnterior(ant);
  const previos = [ant, ant2, mesAnterior(ant2)];
  const delMes = (o, m) => String(o.fecha || "").slice(0, 7) === m && !o.anulada_at;
  const hay = (origen, m) => ops.some((o) => o.origen === origen && delMes(o, m));
  const nombre = `${mesLargo(mes)}`;
  if (!hay("liquidacion", mes) && previos.some((m) => hay("liquidacion", m))) out.push({ id: "sueldos", texto: `Sueldos de ${nombre} sin liquidar`, accion: "sueldos" });
  if (!hay("sos", mes) && previos.some((m) => hay("sos", m))) out.push({ id: "sos", texto: `S.O.S de compras de ${nombre} sin subir`, accion: "sos" });
  if (!oculto.has("ventas_sos") && !ventas[mes] && previos.some((m) => ventas[m])) out.push({ id: "ventas", texto: `S.O.S de ventas de ${nombre} sin subir`, accion: "ventas" });
  const sueldos = SUELDOS.reduce((s, k) => s + total(totales, k, mes), 0);
  for (const it of ITEMS_DEVENGAMIENTO) {
    if (oculto.has(it.id) || ["auto", "ventas", "sueldos"].includes(it.cargar) || it.id === "sin_clasificar") continue;
    if (total(totales, it.id, mes)) continue;
    const provision = (it.recurrente === "aguinaldo" || it.recurrente === "vacaciones") && sueldos > 0;
    const siempre = total(totales, it.id, ant) && total(totales, it.id, ant2);
    if (!provision && !siempre) continue;
    const pasado = total(totales, it.id, ant);
    out.push({
      id: it.id, item: it.id, accion: it.recurrente ? "proponer" : "cargar",
      texto: `${it.nombre.replace(/ \(.*\)$/, "")} de ${nombre} sin cargar${pasado ? ` (en ${mesLargo(ant)}: $ ${pasado.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ""}`,
    });
  }
  return out;
}

/** La configuración guardada: renglones ocultos y el total de S.O.S ventas por mes. */
export function configDevengamiento(valor) {
  const v = valor && typeof valor === "object" ? valor : {};
  const ocultos = Array.isArray(v.ocultos) ? v.ocultos.filter((id) => ITEM.has(id)) : [];
  const ventas = {};
  for (const [mes, x] of Object.entries(v.ventas_sos && typeof v.ventas_sos === "object" ? v.ventas_sos : {})) {
    if (MES.test(mes) && x && Number.isFinite(Number(x.neto))) ventas[mes] = { neto: centavos(x.neto), total: centavos(x.total), comprobantes: Number(x.comprobantes) || 0, archivo: String(x.archivo || "").slice(0, 200), subido: String(x.subido || "").slice(0, 30) };
  }
  return { ocultos: [...new Set(ocultos)], ventas_sos: ventas };
}

/**
 * El CSV de ventas del S.O.S, sumado por mes (neto sin IVA y total). Es como
 * el de compras, con "Cliente" en lugar de "Proveedor". La nota de crédito
 * resta.
 * @returns {{ meses: Record<string, { neto: number, total: number, comprobantes: number }>, errores: string[] }}
 */
export function ventasSosPorMes(texto) {
  const crudo = String(texto || "").replace(/^﻿/, "");
  const [primera, ...resto] = crudo.split(/\r?\n/);
  const titulos = (primera || "").split(";").map((t) => (/^\s*(cliente|raz[oó]n social)\s*$/i.test(t) ? "Proveedor" : t)).join(";");
  const { filas, errores } = leerCsvSos([titulos, ...resto].join("\n"));
  if (!filas.length) return { meses: {}, errores: errores.length ? errores.map((e) => e.replace("de compras", "de ventas").replace("Proveedor", "Cliente")) : ["No encontré comprobantes en el archivo"] };
  const meses = {};
  for (const f of filas) {
    const mes = f.fecha.slice(0, 7);
    const pesos = f.moneda === "USD" && f.tipo_cambio ? f.tipo_cambio : 1;
    const m = meses[mes] || (meses[mes] = { neto: 0, total: 0, comprobantes: 0 });
    m.neto = centavos(m.neto + f.signo * f.neto * pesos);
    m.total = centavos(m.total + f.signo * f.total * pesos);
    m.comprobantes += 1;
  }
  return { meses, errores };
}

/**
 * Todo lo de la pantalla para un mes: cada renglón con su total del mes, el
 * del mes anterior, las cuentas que junta y la propuesta si es recurrente.
 */
export function devengamientoDelMes(mes, { ops = [], cuentas = [], config = {}, hoy = "" } = {}) {
  const meses = mesesHasta(mes, 13);
  const totales = totalesPorMes(ops, cuentas, meses);
  const { ocultos, ventas_sos } = configDevengamiento(config);
  const renglon = renglonesDeCuentas(cuentas);
  const ant = mesAnterior(mes);
  const items = ITEMS_DEVENGAMIENTO.map((it) => {
    const conCuentas = cuentas.filter((c) => renglon.get(c.codigo) === it.id).map((c) => c.codigo);
    const esVentas = it.id === "ventas_sos";
    return {
      id: it.id, grupo: it.grupo, nombre: it.nombre, cargar: it.cargar, ayuda: it.ayuda || "", recurrente: it.recurrente || null, ingreso: !!it.ingreso,
      oculto: ocultos.includes(it.id),
      total: esVentas ? ventas_sos[mes]?.neto ?? null : total(totales, it.id, mes),
      anterior: esVentas ? ventas_sos[ant]?.neto ?? null : total(totales, it.id, ant),
      cuentas: conCuentas,
      propuesta: it.recurrente ? propuestaRecurrente(it.id, mes, { totales, cuentas, hoy }) : null,
    };
  }).filter((x) => x.id !== "sin_clasificar" || x.total || x.anterior);
  const entregas = total(totales, "entregas", mes);
  const vs = ventas_sos[mes] || null;
  return {
    mes, nombre: nombreMes(mes), items, ocultos,
    falta: faltaEsteMes(mes, { totales, ops, ocultos, ventas: ventas_sos }),
    ventas: vs ? { ...vs, entregas, diferencia: centavos(vs.neto - entregas) } : null,
  };
}
