// app/lib/finanzasDesarrollismo.js — Finanzas (15/11, pedido de Tadeo): el
// Desarrollismo (desarrollos inmobiliarios) con cada ingreso y cada gasto
// imputado a su obra. Las obras son centros de costo (división DESARROLLISTA,
// vienen del libro: DESARROLLISTA NUMA, CAÑITAS 67/5…). Los tipos del
// Desarrollismo piden la obra; el cobro por ventas arranca con la caja del
// Desarrollismo al debe y Anticipo de Clientes al haber (una seña o una cuota
// todavía no es venta: al escriturar se pasa a Ventas Desarrollismo).
// Sin imports: lo usan el formulario de operación y ➕ Cargar.

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const TIPO_COBRO_DESARROLLISMO = "COBRO POR VENTAS DESARROLLISMO";

/** El cobro por ventas del Desarrollismo (señas y cuotas de los compradores). */
export const esCobroDesarrollismo = (tipo) => sinTildes(tipo?.codigo) === sinTildes(TIPO_COBRO_DESARROLLISMO);

/** Los tipos del Desarrollismo (inversiones, cobros por ventas, aportes) van siempre a una obra. */
export const pideObra = (tipo) => /DESARROLL/.test(sinTildes(tipo?.codigo).toUpperCase());

/** Un centro de costo del Desarrollismo (división DESARROLLISTA, o el código lo dice). */
export const esObraDesarrollo = (c) => /^desarroll/.test(sinTildes(c?.division)) || /^desarroll/.test(sinTildes(c?.codigo));

/** Los centros de costo para elegir: en los tipos del Desarrollismo, las obras primero. */
export function centrosParaElegir(tipo, centros = []) {
  const activos = centros.filter((c) => c.activo !== false);
  if (!pideObra(tipo)) return activos;
  return [...activos.filter(esObraDesarrollo), ...activos.filter((c) => !esObraDesarrollo(c))];
}

/** Un centro de costo nuevo para una obra del Desarrollismo, o { error }. */
export function obraNueva(nombre, centros = []) {
  const limpio = txt(nombre, 46).toUpperCase();
  if (!limpio) return { error: "Falta el nombre de la obra" };
  const codigo = /^DESARROLL/.test(sinTildes(limpio).toUpperCase()) ? limpio : `DESARROLLISTA ${limpio}`;
  if (centros.some((c) => sinTildes(c.codigo) === sinTildes(codigo))) return { error: `La obra ${codigo} ya existe` };
  return { fila: { codigo, nombre: `Desarrollos — ${txt(nombre, 90)}`, division: "DESARROLLISTA", tipo: "INVERSION", activo: true } };
}

/**
 * Las cuentas con las que arranca un cobro del Desarrollismo, solo en los
 * lados que el tipo deja vacíos: al debe la caja (la elegida en Tesorería o
 * la del Desarrollismo) y al haber Anticipo de Clientes.
 * @returns {{ cuenta_debe?: string, cuenta_haber?: string }}
 */
export function cuentasCobroDesarrollismo(tipo, { cuentas = [], tesoreria = [] } = {}, cajaInicial = "", actuales = {}) {
  if (!esCobroDesarrollismo(tipo)) return {};
  const r = {};
  if (!actuales.cuenta_debe) {
    const activas = tesoreria.filter((t) => t.activa !== false);
    const caja = activas.find((t) => t.cuenta === cajaInicial) || activas.find((t) => /desarroll/.test(sinTildes(t.nombre)));
    if (caja) r.cuenta_debe = caja.cuenta;
  }
  if (!actuales.cuenta_haber) {
    const anticipo = cuentas.find((c) => c.activa !== false && /^anticipos? de clientes?$/.test(sinTildes(c.nombre)));
    if (anticipo) r.cuenta_haber = anticipo.codigo;
  }
  return r;
}
