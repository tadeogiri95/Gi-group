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
