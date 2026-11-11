// app/lib/finanzasBuenasPracticas.js — Finanzas, parte 7 del plan del 11/11:
// cuentas según buenas prácticas contables (Argentina). Sin migración.
//
// - Cada tipo de operación tiene una contrapartida que corresponde: una compra
//   o un gasto contra Proveedores o Acreedores Varios, un impuesto contra su
//   cuenta "a pagar", un ajuste de caja contra un resultado, una máquina
//   contra su cuenta de bienes de uso. CUENTAS_RECOMENDADAS las busca por el
//   nombre en el plan de cuentas de la empresa (los códigos cambian de un
//   plan a otro) y cuentasRecomendadas dice qué tipos conviene cambiar.
// - Ajuste De Capital es una cuenta del patrimonio: no es comodín. Se usó para
//   cargar lo histórico del libro; desde Gypi solo la usan la apertura, los
//   saldos iniciales y los movimientos con los socios (usoAjusteCapital).
// - revisionContable junta lo que hay que mirar: operaciones contra Ajuste De
//   Capital, tipos sin cuentas o con otra cuenta que la recomendada y cuentas
//   que faltan en el plan.

export const CUENTA_AJUSTE = /^ajuste de capital$/i;
/** Los tipos que sí pueden ir contra Ajuste De Capital: apertura, saldos y socios. */
export const TIPOS_PATRIMONIO = /APERTURA|SALDO INICIAL|SOCIO|DIVIDENDO|RECLASIF|APORTES? DESARROLL/i;

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Las cuentas recomendadas por tipo: la primera que exista de cada lista
 * (por nombre). Cada lado dice cuándo se cambia la cuenta que ya tiene el tipo:
 *   "siempre": si es otra (la contrapartida de un cobro o un pago);
 *   "vacio": solo si no tiene o es del patrimonio (la cuenta de gasto que ya
 *            eligió el dueño, más precisa, se respeta);
 *   un prefijo ("02", "04", "01.02"): si la que tiene no es de ese rubro
 *            (pasivo, resultado, bien de uso).
 * Sin lado = no se toca (la caja o el banco se eligen al cargar).
 */
const L = (nombres, cuando) => ({ nombres, cuando });
const DEUDA = (...n) => L(n, "02");
export const CUENTAS_RECOMENDADAS = {
  "COBRO A CLIENTES": { haber: L(["deudores por ventas"], "siempre"), motivo: "El cobro baja la deuda del cliente." },
  "ANTICIPO DE CLIENTES": { haber: L(["anticipo de clientes"], "siempre"), motivo: "La seña es una deuda con el cliente hasta que se entrega." },
  "OTROS INGRESOS": { haber: L(["otros ingresos"], "04"), motivo: "Un ingreso que no es venta es un resultado (Otros Ingresos), no capital." },
  "PAGO A PROVEEDORES": { debe: L(["proveedores"], "siempre"), motivo: "El pago baja la deuda con el proveedor." },
  COMPRAS: { debe: L(["materias primas"], "vacio"), haber: DEUDA("proveedores"), motivo: "La compra queda como deuda con el proveedor hasta que se paga." },
  "TRABAJOS TERCERIZADOS": { debe: L(["trabajos de terceros"], "vacio"), haber: DEUDA("proveedores"), motivo: "El trabajo de un tercero es costo de producción y queda como deuda con él." },
  SUELDOS: { debe: L(["sueldos, jornales y contribuciones", "sueldos"], "vacio"), haber: DEUDA("sueldos a pagar"), motivo: "El sueldo se devenga en el mes y queda a pagar." },
  IMPUESTOS: { debe: L(["egresos - otros impuestos"], "vacio"), haber: DEUDA("otros impuestos y tributos a pagar", "impuestos varios a pagar"), motivo: "El impuesto se devenga en su período y queda a pagar; al cargarlo elegí su cuenta a pagar (IIBB, tasas…)." },
  SERVICIOS: { debe: L(["servicios publicos"], "vacio"), haber: DEUDA("acreedores varios"), motivo: "La factura del servicio queda a pagar hasta que se paga." },
  "GASTOS DE LOGÍSTICA": { debe: L(["combustibles y lubricantes"], "vacio"), haber: DEUDA("proveedores"), motivo: "El gasto queda como deuda con el proveedor hasta que se paga." },
  "GASTOS DE MANTENIMIENTO": { debe: L(["mantenimiento"], "vacio"), haber: DEUDA("proveedores"), motivo: "El gasto queda como deuda con el proveedor hasta que se paga." },
  "GASTOS DE ADMINISTRACIÓN": { debe: L(["gastos general", "gastos generales"], "vacio"), haber: DEUDA("proveedores"), motivo: "El gasto queda como deuda con el proveedor hasta que se paga." },
  "GASTOS DE COMERCIALIZACIÓN": { debe: L(["gastos de comercializacion"], "vacio"), haber: DEUDA("proveedores"), motivo: "El gasto queda como deuda con el proveedor hasta que se paga." },
  HONORARIOS: { debe: L(["honorarios profesionales"], "vacio"), haber: DEUDA("acreedores varios"), motivo: "Los honorarios quedan a pagar hasta que se pagan." },
  "OTROS GASTOS": { debe: L(["gastos general", "gastos generales"], "vacio"), haber: DEUDA("acreedores varios"), motivo: "El gasto queda a pagar hasta que se paga." },
  "GASTOS BANCARIOS Y FINANCIEROS": { debe: L(["comisiones y gastos bancarios"], "vacio"), motivo: "El banco los debita de la cuenta: van contra el banco." },
  "AJUSTE DE CAJA POSITIVO": { haber: L(["faltantes y sobrantes de caja", "sobrantes de caja", "otros ingresos"], "04"), motivo: "Lo que sobra en la caja es un resultado, no capital." },
  "AJUSTE DE CAJA NEGATIVO": { debe: L(["faltantes y sobrantes de caja", "faltantes de caja"], "04"), motivo: "Lo que falta en la caja es una pérdida, no capital." },
  "MAQUINARIA Y HERRAMIENTAS": { debe: L(["maquinarias y herramientas- valor costo", "maquinarias y herramientas - valor costo"], "01.02"), haber: DEUDA("proveedores"), motivo: "Una máquina es un bien de uso (activo que se amortiza), no un gasto." },
  INFRAESTRUCTURA: { debe: L(["instalaciones - valor costo"], "01.02"), haber: DEUDA("proveedores"), motivo: "Una obra en la planta es un bien de uso (activo que se amortiza), no un gasto." },
};

/** ¿Se cambia la cuenta que tiene el tipo por la recomendada? */
function cambia(actual, recomendada, cuando) {
  if (!recomendada || actual === recomendada) return false;
  if (!actual || String(actual).startsWith("03")) return true;
  if (cuando === "siempre") return true;
  if (cuando === "vacio") return false;
  return !String(actual).startsWith(cuando);
}

/** El código de la primera cuenta activa con alguno de esos nombres. */
export function cuentaPorNombre(cuentas = [], nombres = []) {
  for (const n of nombres) {
    const c = cuentas.find((x) => x.activa !== false && sinTildes(x.nombre) === sinTildes(n));
    if (c) return c.codigo;
  }
  return null;
}

const claveTipo = (s) => sinTildes(s).toUpperCase();
const RECOMENDADAS_POR_CLAVE = new Map(Object.entries(CUENTAS_RECOMENDADAS).map(([k, v]) => [claveTipo(k), v]));

/**
 * Los tipos activos cuya cuenta del debe o del haber conviene cambiar.
 * @returns {{ codigo, nombre, actual: { debe, haber }, recomendada: { debe, haber }, motivo }[]}
 */
export function cuentasRecomendadas(tipos = [], cuentas = []) {
  const out = [];
  for (const t of tipos) {
    if (t.activo === false) continue;
    const r = RECOMENDADAS_POR_CLAVE.get(claveTipo(t.codigo));
    if (!r) continue;
    const lado = (actual, regla) => {
      const rec = regla ? cuentaPorNombre(cuentas, regla.nombres) : null;
      return regla && cambia(actual || null, rec, regla.cuando) ? rec : actual || null;
    };
    const debe = lado(t.cuenta_debe, r.debe);
    const haber = lado(t.cuenta_haber, r.haber);
    if (debe === (t.cuenta_debe || null) && haber === (t.cuenta_haber || null)) continue;
    if (debe && debe === haber) continue;
    out.push({
      codigo: t.codigo, nombre: t.nombre || t.codigo,
      actual: { debe: t.cuenta_debe || null, haber: t.cuenta_haber || null },
      recomendada: { debe, haber },
      motivo: r.motivo,
    });
  }
  return out;
}

/** Error si la operación usa Ajuste De Capital y no es de apertura, saldos o socios; null si está bien. */
export function usoAjusteCapital({ tipo, cuenta_debe: d, cuenta_haber: h, origen } = {}, cuentas = []) {
  const ajuste = cuentas.filter((c) => CUENTA_AJUSTE.test(String(c.nombre || "").trim())).map((c) => c.codigo);
  if (!ajuste.length || (!ajuste.includes(d) && !ajuste.includes(h))) return null;
  if (TIPOS_PATRIMONIO.test(String(tipo || "")) || ["saldo_inicial", "libro"].includes(origen)) return null;
  return "Ajuste De Capital es una cuenta del patrimonio: no va como contrapartida de compras, gastos, ventas ni cajas. Usá Proveedores, Acreedores Varios, la cuenta \"a pagar\" que corresponda o, en un ajuste de caja, Faltantes y Sobrantes de Caja.";
}

/** Las cuentas que conviene agregar al plan para no usar comodines. */
export const CUENTAS_QUE_FALTAN = [
  { nombres: ["faltantes y sobrantes de caja"], sugerido: "Faltantes y Sobrantes de Caja", para: "los ajustes de caja (hoy van contra Ajuste De Capital o contra Otros Ingresos)" },
  { nombres: ["provision sac a pagar", "sac a pagar", "provision para sac"], sugerido: "Provisión SAC A Pagar", para: "provisionar el aguinaldo todos los meses" },
  { nombres: ["provision vacaciones a pagar", "vacaciones a pagar"], sugerido: "Provisión Vacaciones A Pagar", para: "provisionar las vacaciones todos los meses" },
];

/**
 * Lo que hay que mirar del plan, los tipos y las operaciones.
 * @param {{ cuentas, tipos, operaciones }} d operaciones: las del período (sin anuladas)
 */
export function revisionContable({ cuentas = [], tipos = [], operaciones = [] } = {}) {
  const ajuste = new Set(cuentas.filter((c) => CUENTA_AJUSTE.test(String(c.nombre || "").trim())).map((c) => c.codigo));
  const contraAjuste = operaciones.filter((o) => !o.anulada_at && (ajuste.has(o.cuenta_debe) || ajuste.has(o.cuenta_haber))
    && !TIPOS_PATRIMONIO.test(String(o.tipo || "")) && !["saldo_inicial", "libro"].includes(o.origen));
  const porTipo = new Map();
  for (const o of contraAjuste) {
    const x = porTipo.get(o.tipo) || { tipo: o.tipo, n: 0, total: 0 };
    x.n += 1;
    x.total = Math.round((x.total + (Number(o.total_ars ?? o.total) || 0)) * 100) / 100;
    porTipo.set(o.tipo, x);
  }
  return {
    ajuste: { n: contraAjuste.length, de: operaciones.filter((o) => !o.anulada_at).length, por_tipo: [...porTipo.values()].sort((a, b) => b.n - a.n) },
    tipos_ajuste: tipos.filter((t) => t.activo !== false && !TIPOS_PATRIMONIO.test(t.codigo) && (ajuste.has(t.cuenta_debe) || ajuste.has(t.cuenta_haber))).map((t) => t.codigo),
    sin_cuentas: tipos.filter((t) => t.activo !== false && (!t.cuenta_debe || !t.cuenta_haber)).map((t) => t.codigo),
    recomendadas: cuentasRecomendadas(tipos, cuentas),
    faltan: CUENTAS_QUE_FALTAN.filter((f) => !cuentaPorNombre(cuentas, f.nombres)).map(({ sugerido, para }) => ({ sugerido, para })),
  };
}
