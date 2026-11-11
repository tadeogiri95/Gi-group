// app/lib/finanzasTipos.js — Finanzas, parte 2 del plan del 09/11: los tipos
// de operación nuevos. Sin migración.
//
// El tipo dice en qué renglón del flujo de caja va una operación. Antes
// mezclaba la forma de pago ("PAGO TRANSF", "PAGO EFECTIVO", "PAGO ECHEQ…")
// y si se había pagado o no ("GASTOS DE LOGÍSTICA" y "PAGO GASTOS DE
// LOGÍSTICA"). Ahora son tres cosas separadas:
//   - el tipo (esta lista, unos 40 en lugar de 61);
//   - la forma de pago, que sale sola de la caja o el banco y del cheque
//     (formaDePago);
//   - la cuenta del plan de cuentas, que es la que va al Estado de Resultados.
//
// TIPOS_NUEVOS trae cada tipo con su línea del flujo (los códigos de la hoja
// FLUJO_V2 del libro) y los tipos viejos que reemplaza. Los que ya estaban
// bien (VENTA, APERTURA, INVERSIONES DESARROLLISMO…) quedan con su código.
// "Pasar a los tipos nuevos" (/api/finanzas/tipos) reescribe las operaciones,
// los proveedores y la lista de tipos de Gypi; el script del libro hace lo
// mismo en T-OPERACIONES, con copia de respaldo.

export const CLAVE_TIPOS = "finanzas_tipos";
export const VERSION_TIPOS = 1;
export const SIN_TIPO = "SIN TIPO";

/** Mayúsculas, sin tildes y sin espacios de más: así se comparan los códigos del libro. */
export function claveTipo(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

const T = (codigo, nombre, grupo, linea, viejos = []) => ({ codigo, nombre, grupo, linea, viejos });

/** Los tipos nuevos, en el orden en que se muestran. linea = renglón del flujo (null: no mueve caja). */
export const TIPOS_NUEVOS = [
  // Operativos que entran
  T("COBRO A CLIENTES", "Cobro a clientes", "COBROS", "ING_TRANSF", ["COBRO TRANSF", "COBRO EFECTIVO", "COBRO ECHEQ", "RECEPCIÓN ECHEQ", "RECEPCIÓN CHEQUE FÍSICO", "DEP CHEQUE", "COBRO CANJE", "RETENCION GDCIAS"]),
  T("ANTICIPO DE CLIENTES", "Anticipo de clientes", "COBROS", "ING_TRANSF", ["ANTICIPO CLI", "APLIC ANTICIPO"]),
  T("OTROS INGRESOS", "Otros ingresos", "COBROS", "ING_AJUSTE"),
  // Operativos que salen
  T("PAGO A PROVEEDORES", "Pago a proveedores", "PAGOS", "EGR_PROVEEDORES", ["PAGO TRANSF", "PAGO EFECTIVO", "PAGO ECHEQ", "PAGO ECHEQ A PROVEEDORES", "PAGO CHEQUE A PROVEEDORES", "PAGO EFECTIVO A PROVEEDORES M.P", "EMISIÓN ECHEQ", "ACRED ECHEQ EMI"]),
  T("COMPRAS", "Compra con o sin factura", "COMPRAS", "EGR_PROVEEDORES", ["COMPRA MP", "COMPRA MP CTDO", "COMPRA IVA CF", "COSTOS INDIRECTOS DE FABRICACIÓN"]),
  T("TRABAJOS TERCERIZADOS", "Trabajos tercerizados", "COMPRAS", "EGR_TERCERIZADOS", ["TRABAJO TERCERIZADO", "PAGO TRABAJO TERCERIZADO"]),
  T("SUELDOS", "Sueldos", "SUELDOS", "EGR_SUELDOS", ["PAGO SUELDO", "DEVENG SUELDO", "PROV SAC", "PROV VAC"]),
  T("IMPUESTOS", "Impuestos", "IMPUESTOS", "EGR_IMPUESTOS", ["PAGO IMPUESTO", "IMPUESTO DEVENG"]),
  T("SERVICIOS", "Servicios", "GASTOS", "EGR_SERVICIOS", ["PAGO DE SERVICIOS CORRIENTES"]),
  T("GASTOS DE LOGÍSTICA", "Gastos de logística", "GASTOS", "EGR_LOGISTICA", ["PAGO GASTOS DE LOGÍSTICA"]),
  T("GASTOS DE MANTENIMIENTO", "Gastos de mantenimiento", "GASTOS", "EGR_MANTENIMIENTO", ["PAGO GASTOS DE MANTENIMIENTO"]),
  T("GASTOS DE ADMINISTRACIÓN", "Gastos de administración", "GASTOS", "EGR_ADMIN", ["PAGO GASTOS DE ADMINISTRACIÓN"]),
  T("GASTOS DE COMERCIALIZACIÓN", "Gastos de comercialización", "GASTOS", "EGR_COMERCIALIZACION", ["PAGO GASTOS DE COMERCIALIZACIÓN"]),
  T("HONORARIOS", "Honorarios", "GASTOS", "EGR_HONORARIOS", ["PAGO HONORARIOS"]),
  T("VIÁTICOS", "Viáticos", "GASTOS", "EGR_VIATICOS", ["PAGO VIATICOS"]),
  T("GASTOS BANCARIOS Y FINANCIEROS", "Gastos bancarios y financieros", "GASTOS", "EGR_BANCARIOS", ["PAGO GASTOS BANCARIOS", "PAGO GASTOS FINANCIEROS", "GASTOS FINANCIEROS", "DIF CAMBIO"]),
  T("TARJETA DE CRÉDITO", "Tarjeta de crédito", "GASTOS", "EGR_TARJETAS", ["PAGO TARJETAS DE CRÉDITO"]),
  T("OTROS GASTOS", "Otros gastos", "GASTOS", "EGR_OTROS", ["PAGO DE OTROS GASTOS"]),
  T("AJUSTE DE CAJA POSITIVO", "Ajuste de caja positivo", "AJUSTES", "ING_AJUSTE"),
  T("AJUSTE DE CAJA NEGATIVO", "Ajuste de caja negativo", "AJUSTES", "EGR_AJUSTE"),
  // Inversión
  T("MAQUINARIA Y HERRAMIENTAS", "Maquinaria y herramientas", "INVERSIÓN", "INV_MAQUINARIA", ["INVERSIONES EN MAQUINARIA Y HERRAMENTAL", "PAGO INVERSIONES EN MAQUINARIA Y HERRAMENTAL"]),
  T("INFRAESTRUCTURA", "Infraestructura", "INVERSIÓN", "INV_INFRA", ["INVERSIONES EN INFRAESTRUCTURA", "PAGO INVERSIONES EN INFRAESTRUCTURA"]),
  T("VENTA BS USO", "Venta de bienes de uso", "INVERSIÓN", "VTA_BS USO"),
  T("INVERSIONES DESARROLLISMO", "Desarrollismo: inversiones (por centro de costo)", "INVERSIÓN", null),
  T("COBRO POR VENTAS DESARROLLISMO", "Desarrollismo: cobros por ventas", "INVERSIÓN", "ING_DESARR_VENTAS"),
  T("APORTES DESARROLLISMO", "Desarrollismo: aportes", "FINANCIACIÓN", "ING_DESARR_APORTES"),
  T("RENDIMIENTOS INMOBILIARIOS", "Alquileres y rendimientos inmobiliarios", "INVERSIÓN", "ING_ALQUILERES", ["COBRO RENDIMIENTOS INMOBILIARIOS"]),
  T("RENDIMIENTOS FINANCIEROS", "Intereses y rendimientos financieros", "INVERSIÓN", "ING_RENTA_FIN", ["COBRO RENDIMIENTOS FINANCIEROS", "INVERSIONES FINANCIERAS"]),
  // Financiación
  T("APORTE DE SOCIOS", "Aporte de socios", "FINANCIACIÓN", "APORTES_SOCIOS", ["APORTES SOCIOS", "APORTE SOCIO"]),
  T("RETIRO DE SOCIOS Y DIVIDENDOS", "Retiro de socios y dividendos", "FINANCIACIÓN", "DIVIDENDOS", ["RETIRO SOCIO", "PAGO DE DIVIDENDOS"]),
  T("PRÉSTAMOS", "Préstamos (tomar y devolver)", "FINANCIACIÓN", "EGR_FINANCIEROS"),
  T("PAGO TRIANGULAR", "Pago de un socio por la empresa", "FINANCIACIÓN", null),
  // Entre cajas propias
  T("TRANSFERENCIA ENTRE CAJAS", "Transferencia entre cajas y bancos", "TESORERÍA", "TES_TRANSF_INTERNA", ["TRANSF INTERNA", "DEPOSITO BANCO", "EXTRACCION"]),
  T("PLAZO FIJO", "Plazo fijo (constituir y rescatar)", "TESORERÍA", "TES_MOV_INTERNO", ["CONSTITUCIÓN PLAZO FIJO", "RESCATE PLAZO FIJO"]),
  T("FCI", "Fondo común de inversión (suscribir y rescatar)", "TESORERÍA", "TES_MOV_INTERNO", ["SUSCRIPCIÓN FCI", "RESCATE FCI"]),
  T("TÍTULOS PÚBLICOS", "Títulos públicos (comprar y vender)", "TESORERÍA", "TES_TITULOS", ["COMPRA TÍTULOS PÚBLICOS", "VENTA TÍTULOS PÚBLICOS"]),
  T("DÓLARES", "Dólares (comprar y vender)", "TESORERÍA", "TES_USD", ["COMPRA USD", "VENTA USD"]),
  // Sin movimiento de caja
  T("VENTA", "Venta o entrega de OT", "VENTAS", null, ["VENTA IVA"]),
  T("NC CLIENTE", "Nota de crédito a cliente", "VENTAS", null),
  T("AMORTIZACIONES", "Amortizaciones", "AJUSTES", null, ["DEPREC"]),
  T("COMPENSACIÓN DE SALDOS", "Compensación de saldos (cliente y proveedor)", "AJUSTES", null),
  T("CHEQUE RECHAZADO", "Cheque rechazado", "AJUSTES", null),
  T("RECLASIF", "Reclasificación de cuenta", "AJUSTES", null),
  T("APERTURA", "Asiento de apertura", "AJUSTES", "TES_APERTURA"),
  T("SALDO INICIAL", "Saldo inicial", "AJUSTES", null),
];

/**
 * La leyenda de cada tipo: qué comprende, en pocas palabras, y un ejemplo.
 * Se muestra en letra chica debajo del desplegable al cargar una operación,
 * para que alguien nuevo sepa cuál elegir. Si el dueño escribió otra en
 * Configuración (columna descripcion de la tabla), manda la suya.
 */
export const LEYENDAS = {
  "COBRO A CLIENTES": "Plata que entra de un cliente por una venta u OT, en efectivo, transferencia o cheque. Baja lo que el cliente debe. Ej.: el cliente transfiere la seña de una cocina.",
  "ANTICIPO DE CLIENTES": "Plata que un cliente paga antes de la entrega. Todavía no es venta: queda como anticipo hasta que se entrega la OT. Ej.: 50 % adelantado al firmar el presupuesto.",
  "OTROS INGRESOS": "Entradas de plata que no son ventas ni cobros de clientes: reintegros, recuperos de gastos, devoluciones de un proveedor. Ej.: el seguro devuelve un siniestro.",
  "PAGO A PROVEEDORES": "Pago de una factura o deuda que ya está cargada en la cuenta del proveedor, con efectivo, transferencia o cheque. Ej.: transferencia a Bosques por la factura de placas.",
  "COMPRAS": "Compra de materiales o insumos para producir, con o sin factura. Queda como deuda con el proveedor hasta que se paga. Ej.: factura de herrajes de Häfele.",
  "TRABAJOS TERCERIZADOS": "Trabajos que hace otro taller para la empresa: pintura, laqueado, corte, mecanizado, vidrios. Ej.: laqueado de frentes en un taller externo.",
  "SUELDOS": "Sueldos, jornales, horas extra, bonos, vacaciones y aguinaldo del personal, y su pago. Ej.: liquidación de la quincena.",
  "IMPUESTOS": "Impuestos y tasas: IVA a pagar, Ingresos Brutos, Ganancias, cargas sociales (F.931), municipales, impuesto al cheque. Ej.: VEP de IIBB del mes con el número del contador.",
  "SERVICIOS": "Servicios del local y la planta: luz, gas, agua, internet, teléfono, alquiler, seguridad, limpieza. Ej.: factura de EPEC.",
  "GASTOS DE LOGÍSTICA": "Todo lo que cuesta mover la mercadería y la gente: combustible, peajes, fletes, mantenimiento de vehículos, seguros de flota. Ej.: carga de gasoil de la camioneta.",
  "GASTOS DE MANTENIMIENTO": "Arreglos y repuestos de máquinas, herramientas y edificio que no los mejoran ni los agrandan. Ej.: cambio de correa de la seccionadora.",
  "GASTOS DE ADMINISTRACIÓN": "Gastos de la oficina y la gestión: librería, software, sistemas, cafetería, trámites, cuotas de cámaras. Ej.: suscripción mensual de un programa.",
  "GASTOS DE COMERCIALIZACIÓN": "Gastos para vender: publicidad, redes, muestras, catálogos, comisiones de venta, exposiciones. Ej.: campaña en Instagram.",
  "HONORARIOS": "Pagos a profesionales independientes: contador, abogado, arquitecto, diseñador, consultores. Ej.: honorarios mensuales del estudio contable.",
  "VIÁTICOS": "Comidas, alojamiento y traslados del personal fuera de la planta (por ejemplo en una instalación en otra ciudad). Ej.: almuerzo del equipo en una obra.",
  "GASTOS BANCARIOS Y FINANCIEROS": "Comisiones, mantenimiento de cuenta, intereses que se pagan y diferencia de cambio. Ej.: comisión mensual del Credicoop.",
  "TARJETA DE CRÉDITO": "Pago del resumen de una tarjeta de la empresa. Ej.: pago del resumen Visa del mes.",
  "OTROS GASTOS": "Gastos que no entran en ningún otro tipo. Usarlo poco: si se repite, conviene un tipo propio. Ej.: multa de tránsito.",
  "AJUSTE DE CAJA POSITIVO": "Al contar la caja sobra plata que no está anotada. Solo para corregir diferencias. Ej.: arqueo con $2.000 de más.",
  "AJUSTE DE CAJA NEGATIVO": "Al contar la caja falta plata que no está anotada. Solo para corregir diferencias. Ej.: arqueo con $1.500 de menos.",
  "MAQUINARIA Y HERRAMIENTAS": "Compra de máquinas o herramientas que duran más de un año (bienes de uso), o mejoras que las agrandan. Ej.: compra de una canteadora.",
  "INFRAESTRUCTURA": "Obras y mejoras del edificio o la planta que duran años: ampliaciones, instalación eléctrica nueva, techos. Ej.: ampliación del galpón.",
  "VENTA BS USO": "Venta de una máquina, vehículo u otro bien de uso de la empresa. Ej.: venta de la camioneta vieja.",
  "INVERSIONES DESARROLLISMO": "Plata que se pone en un desarrollo inmobiliario, separada por centro de costo (cada obra). Ej.: pago de materiales para el edificio en construcción.",
  "COBRO POR VENTAS DESARROLLISMO": "Plata que entra por la venta de unidades de un desarrollo inmobiliario. Ej.: cuota de un comprador de un departamento.",
  "APORTES DESARROLLISMO": "Plata que aportan los socios o inversores para un desarrollo inmobiliario. Ej.: aporte de un inversor para la obra.",
  "RENDIMIENTOS INMOBILIARIOS": "Alquileres u otras ganancias que dejan los inmuebles. Ej.: cobro del alquiler de un local.",
  "RENDIMIENTOS FINANCIEROS": "Intereses y ganancias de inversiones: plazos fijos, fondos comunes, cauciones. Ej.: intereses de un plazo fijo que venció.",
  "APORTE DE SOCIOS": "Plata que los socios ponen en la empresa. Ej.: un socio deposita para cubrir sueldos.",
  "RETIRO DE SOCIOS Y DIVIDENDOS": "Plata que los socios sacan de la empresa, a cuenta de ganancias o como dividendos. Ej.: retiro mensual de un socio.",
  "PRÉSTAMOS": "Préstamos que toma la empresa (entra la plata) y las cuotas que se devuelven (capital). Ej.: acreditación de un préstamo del banco.",
  "PAGO TRIANGULAR": "Un socio paga algo de la empresa con su plata. Queda como deuda de la empresa con el socio. Ej.: un socio paga un proveedor con su tarjeta.",
  "TRANSFERENCIA ENTRE CAJAS": "Pasar plata de una caja o banco propio a otro, sin gastar ni cobrar. Ej.: extraer efectivo del banco para la caja chica.",
  "PLAZO FIJO": "Constituir un plazo fijo (sale del banco) o rescatarlo (vuelve al banco). El interés va aparte, en Rendimientos financieros. Ej.: plazo fijo a 30 días en el Credicoop.",
  "FCI": "Suscribir (poner) o rescatar (sacar) plata de un fondo común de inversión. Ej.: rescate del fondo para pagar sueldos.",
  "TÍTULOS PÚBLICOS": "Compra y venta de bonos o títulos. Ej.: compra de bonos en el banco.",
  "DÓLARES": "Compra o venta de dólares con pesos de la empresa. Ej.: compra de USD 1.000 en el banco.",
  "VENTA": "Venta de una OT cuando se carga en el Plan de trabajo, y su entrega cuando se termina. Gypi la carga sola. Ej.: OT 7961 cocina Riofrío.",
  "NC CLIENTE": "Nota de crédito a un cliente: baja lo que debe por un descuento, devolución o error de facturación. Ej.: descuento por demora en la entrega.",
  "AMORTIZACIONES": "Desgaste anual de máquinas, vehículos y edificio. No mueve plata; lo calcula el contador. Ej.: amortización anual de la seccionadora.",
  "COMPENSACIÓN DE SALDOS": "Cuando alguien es cliente y proveedor a la vez, se cancela una deuda contra la otra sin mover plata. Ej.: el cliente también nos vendió vidrios.",
  "CHEQUE RECHAZADO": "Un cheque que recibimos y el banco rechazó. Vuelve la deuda al cliente. Ej.: e-cheq rechazado sin fondos.",
  "RECLASIF": "Corrige una operación cargada en una cuenta equivocada, pasándola a la correcta. No mueve plata. Ej.: un gasto de logística cargado como administración.",
  "APERTURA": "Saldos con los que arrancan las cuentas al empezar a usar el sistema. Ej.: saldo de los bancos al 31/05.",
  "SALDO INICIAL": "Saldo con el que arranca una caja, un proveedor o un cliente en Gypi. Ej.: lo que se le debía a un proveedor al empezar.",
};

const LEYENDA_POR_CLAVE = new Map(Object.entries(LEYENDAS).map(([c, l]) => [claveTipo(c), l]));
const POR_CODIGO = new Map(TIPOS_NUEVOS.map((t) => [claveTipo(t.codigo), t]));
/** Tipo viejo (clave) → código nuevo. */
export const MAPA_TIPOS = Object.fromEntries(TIPOS_NUEVOS.flatMap((t) => t.viejos.map((v) => [claveTipo(v), t.codigo])));

/** El tipo nuevo de un código (o null si no está en la lista). */
export const tipoDeLista = (codigo) => POR_CODIGO.get(claveTipo(codigo)) || null;

/** Los renglones del flujo que cambian de nombre en el libro (FLUJO_V2) y en Gypi. */
export const LINEAS_RENOMBRADAS = {
  ING_TRANSF: "Cobros a clientes",
  ING_EFECTIVO: "Cobros en efectivo (ya no se usa: va en Cobros a clientes)",
  ING_ECHEQ: "E-cheqs recibidos cobrados (ya no se usa: va en Cobros a clientes)",
  ING_AJUSTE: "Otros ingresos y ajustes de caja positivos",
  EGR_PROVEEDORES: "Pagos a proveedores",
  EGR_ECHEQ: "E-cheqs emitidos pagados (ya no se usa: va en Pagos a proveedores)",
  EGR_BANCARIOS: "Gastos bancarios y financieros",
  EGR_FINANCIEROS: "Préstamos y gastos financieros",
};

/** Una cuenta por su nombre. */
function cuentaPorNombre(cuentas, re) {
  return cuentas.find((c) => re.test(String(c.nombre || "").trim()))?.codigo || null;
}

/** Las cuentas que hacen falta para adivinar el tipo de un renglón sin tipo. */
export function cuentasClave(cuentas = []) {
  return {
    proveedores: cuentaPorNombre(cuentas, /^proveedores$/i),
    deudores: cuentaPorNombre(cuentas, /^deudores por ventas$/i),
    sueldos: cuentaPorNombre(cuentas, /^sueldos a pagar$/i),
  };
}

/**
 * El tipo nuevo de una operación. Un tipo viejo pasa al nuevo; uno que ya
 * está en la lista o que no se conoce queda igual. Sin tipo, se adivina por
 * las cuentas: compra (algo contra Proveedores), sueldo, pago a un proveedor
 * o cobro a un cliente desde una caja; si no, sigue sin tipo.
 * @param {{ tipo?: string, cuenta_debe?: string, cuenta_haber?: string }} op
 * @param {{ cuentas?: object, cajas?: Set<string> }} ctx cuentas = cuentasClave(...)
 */
export function tipoNuevo(op, { cuentas = {}, cajas = new Set() } = {}) {
  const k = claveTipo(op?.tipo);
  if (k && k !== SIN_TIPO) return MAPA_TIPOS[k] || POR_CODIGO.get(k)?.codigo || String(op.tipo).trim();
  const { cuenta_debe: d, cuenta_haber: h } = op || {};
  if (cuentas.proveedores && h === cuentas.proveedores && !cajas.has(d)) return "COMPRAS";
  if (cuentas.sueldos && h === cuentas.sueldos) return "SUELDOS";
  if (cuentas.proveedores && d === cuentas.proveedores && cajas.has(h)) return "PAGO A PROVEEDORES";
  if (cuentas.sueldos && d === cuentas.sueldos && cajas.has(h)) return "SUELDOS";
  if (cuentas.deudores && h === cuentas.deudores && cajas.has(d)) return "COBRO A CLIENTES";
  return op?.tipo ? String(op.tipo).trim() : SIN_TIPO;
}

/**
 * Cómo se muestra un tipo en pantalla: solo su nombre ("Cobro a clientes").
 * Antes salía "COBRO A CLIENTES · Cobro a clientes", el mismo texto dos veces.
 */
export function nombreTipo(t) {
  if (!t) return "";
  const nombre = String(t.nombre || "").trim();
  return nombre || tipoDeLista(t.codigo)?.nombre || String(t.codigo || "");
}

/** La leyenda de un tipo: la que escribió el dueño o la de la lista. */
export function leyendaTipo(t) {
  if (!t) return "";
  const propia = String(t.descripcion || "").trim();
  if (propia) return propia;
  const k = claveTipo(t.codigo);
  return LEYENDA_POR_CLAVE.get(MAPA_TIPOS[k] ? claveTipo(MAPA_TIPOS[k]) : k) || "";
}

/** La línea del flujo de un tipo (viejo o nuevo) según la lista. */
export function lineaDeLista(tipo) {
  const k = claveTipo(tipo);
  return POR_CODIGO.get(claveTipo(MAPA_TIPOS[k] || k))?.linea || null;
}

/**
 * Cómo se pagó o cobró: sale de la caja o el banco y del cheque.
 * @param {{ cuenta_debe, cuenta_haber }} op
 * @param {{ tesoreria: { cuenta, tipo, moneda }[], cuentas: { codigo, nombre }[] }} ctx
 * @returns {"efectivo"|"transferencia"|"cheque"|"tarjeta"|"dolares"|"inversion"|"sin_caja"}
 */
export function formaDePago(op, { tesoreria = [], cuentas = [] } = {}) {
  const t = new Map(tesoreria.map((x) => [x.cuenta, x]));
  const nombre = new Map(cuentas.map((c) => [c.codigo, String(c.nombre || "")]));
  const esCheque = (c) => /cheq|valores a depositar/i.test(nombre.get(c) || "");
  const esTarjeta = (c) => /tarjeta/i.test(nombre.get(c) || "");
  const d = t.get(op?.cuenta_debe);
  const h = t.get(op?.cuenta_haber);
  const caja = d && !h ? d : h && !d ? h : null;
  const otra = caja === d ? op?.cuenta_haber : op?.cuenta_debe;
  if (!caja) {
    if (d && h) return "sin_caja";
    if (esCheque(op?.cuenta_debe) || esCheque(op?.cuenta_haber)) return "cheque";
    if (esTarjeta(op?.cuenta_debe) || esTarjeta(op?.cuenta_haber)) return "tarjeta";
    return "sin_caja";
  }
  if (caja.moneda === "USD") return "dolares";
  if (caja.tipo === "caja") return "efectivo";
  if (caja.tipo !== "banco") return "inversion";
  if (esCheque(otra)) return "cheque";
  if (esTarjeta(otra)) return "tarjeta";
  return "transferencia";
}

export const NOMBRE_FORMA = {
  efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque o e-cheq", tarjeta: "Tarjeta",
  dolares: "Dólares", inversion: "Plazo fijo, FCI o títulos", sin_caja: "Sin movimiento de caja",
};

/**
 * Qué cambia al pasar a los tipos nuevos.
 * @param {{ tipos: { codigo, nombre?, grupo?, cuenta_debe?, cuenta_haber?, activo? }[], operaciones: { id, tipo, cuenta_debe, cuenta_haber }[], proveedores?: { id, fin_tipo }[], cuentas?: object[], tesoreria?: object[] }} d
 * @returns {{ cambios: { viejo, nuevo, operaciones }[], adivinadas: { id, nuevo }[], sin_tipo: number, crear: object[], desactivar: string[], proveedores: { viejo, nuevo, n }[], operaciones: number }}
 */
export function planTipos({ tipos = [], operaciones = [], proveedores = [], cuentas = [], tesoreria = [] }) {
  const ctx = { cuentas: cuentasClave(cuentas), cajas: new Set(tesoreria.map((t) => t.cuenta)) };
  const porViejo = new Map();
  const adivinadas = [];
  let sinTipo = 0;
  for (const op of operaciones) {
    const viejo = String(op.tipo || "");
    const k = claveTipo(viejo);
    const nuevo = tipoNuevo(op, ctx);
    if (!k || k === SIN_TIPO) {
      if (claveTipo(nuevo) === SIN_TIPO || !nuevo) sinTipo++;
      else adivinadas.push({ id: op.id, nuevo });
      continue;
    }
    if (nuevo === viejo) continue;
    const x = porViejo.get(viejo) || { viejo, nuevo, operaciones: 0 };
    x.operaciones++;
    porViejo.set(viejo, x);
  }
  // Los tipos de Gypi: los de la lista que faltan se crean (con las cuentas
  // del primer tipo viejo que las tenga); los viejos se apagan
  const tablaPor = new Map(tipos.map((t) => [claveTipo(t.codigo), t]));
  const crear = [];
  for (const n of TIPOS_NUEVOS) {
    const ya = tablaPor.get(claveTipo(n.codigo));
    const fuente = [ya, ...n.viejos.map((v) => tablaPor.get(claveTipo(v)))].find((t) => t?.cuenta_debe || t?.cuenta_haber);
    const fila = {
      codigo: ya?.codigo || n.codigo, nombre: n.nombre, grupo: n.grupo,
      cuenta_debe: fuente?.cuenta_debe || null, cuenta_haber: fuente?.cuenta_haber || null, activo: true,
    };
    if (!ya || ya.activo === false || ya.nombre !== n.nombre || ya.grupo !== n.grupo || (!ya.cuenta_debe && fila.cuenta_debe) || (!ya.cuenta_haber && fila.cuenta_haber)) crear.push(fila);
  }
  const desactivar = tipos.filter((t) => t.activo !== false && MAPA_TIPOS[claveTipo(t.codigo)] && !POR_CODIGO.has(claveTipo(t.codigo))).map((t) => t.codigo);
  const provs = new Map();
  for (const p of proveedores) {
    const nuevo = p.fin_tipo ? MAPA_TIPOS[claveTipo(p.fin_tipo)] : null;
    if (!nuevo) continue;
    const x = provs.get(p.fin_tipo) || { viejo: p.fin_tipo, nuevo, n: 0 };
    x.n++;
    provs.set(p.fin_tipo, x);
  }
  const cambios = [...porViejo.values()].sort((a, b) => b.operaciones - a.operaciones);
  return {
    cambios, adivinadas, sin_tipo: sinTipo, crear, desactivar, proveedores: [...provs.values()],
    operaciones: cambios.reduce((s, c) => s + c.operaciones, 0) + adivinadas.length,
  };
}

/**
 * Lo que el script del libro necesita para los tipos nuevos. reescribir =
 * ya se apretó "Pasar a los tipos nuevos" en Gypi.
 */
export function tiposParaLibro({ reescribir = false } = {}) {
  return {
    version: VERSION_TIPOS, reescribir: Boolean(reescribir),
    mapa: Object.fromEntries(TIPOS_NUEVOS.flatMap((t) => t.viejos.map((v) => [v, t.codigo]))),
    lista: TIPOS_NUEVOS.map((t) => ({ codigo: t.codigo, nombre: t.nombre, grupo: t.grupo, linea: t.linea || "", signo: signoDe(t), viejos: t.viejos })),
    lineas: LINEAS_RENOMBRADAS,
  };
}

/** signo_esperado de dim_flujo: 1 entra, −1 sale, 0 entre cajas o sin control. */
function signoDe(t) {
  const l = String(t.linea || "");
  if (!l || l.startsWith("TES_") || t.codigo === "PRÉSTAMOS") return 0;
  if (l.startsWith("ING_") || ["APORTES_SOCIOS", "VTA_BS USO"].includes(l)) return 1;
  return -1;
}
