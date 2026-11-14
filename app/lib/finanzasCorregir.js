// app/lib/finanzasCorregir.js — Corregir o anular un movimiento de cajas y
// bancos (pedido de Tadeo del 12/11). Sin migración.
//
// Corregir no pisa la operación: la deja anulada ("corregida por …") y carga
// una nueva con lo cambiado. Así queda a la vista qué había antes, y el libro
// borra el renglón viejo y escribe el nuevo.
//
// Se corrige o se anula lo que no depende de otra pantalla: lo cargado a mano,
// los plazos fijos, el extracto del banco, Mi caja, el
// FCI y los títulos. Lo que sale de una factura, un cheque, una orden de pago,
// un cobro, una venta o un sueldo se cambia desde donde salió. Lo copiado del
// libro se corrige en el libro: al volver a pasar el histórico, Gypi lo
// actualiza solo (si se corrigiera acá, el libro quedaría con los dos).

export const SE_CORRIGEN = new Set(["manual", "plazo_fijo", "banco", "mi_caja", "fci", "titulos"]);
/**
 * Se anulan también los gastos (con su pago, si lo tienen) y, desde el 13/11
 * (pedido de Tadeo), lo copiado del libro y los saldos iniciales: sin tener
 * que ir al libro. Lo del libro anulado a mano no vuelve al pasar el
 * histórico otra vez (finanzasHistorico.js); la apertura sí se vuelve a armar.
 */
// Etapa 5 (14/11): la entrega estimada de una OT sin precio, si el Dueño no la
// quiere (anulada a mano, Gypi no la vuelve a crear)
export const SE_ANULAN = new Set([...SE_CORRIGEN, "gasto", "libro", "saldo_inicial", "entrega_estimada"]);
/** Para revisar que se confirman tal como están (etapa 5). */
export const SE_CONFIRMAN = new Set(["entrega_estimada"]);
export const puedeConfirmar = (op) => !!op && !op.anulada_at && op.estado === "para_revisar" && SE_CONFIRMAN.has(op.origen);
export const MARCA_CORREGIDA = "(corregida)";
export const MAX_ANULAR_JUNTAS = 200;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const dias = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

export const puedeCorregir = (op) => !!op && !op.anulada_at && SE_CORRIGEN.has(op.origen || "manual");
export const puedeAnular = (op) => !!op && !op.anulada_at && SE_ANULAN.has(op.origen || "manual");

/** De dónde se cambia lo que no se corrige acá. */
export function dondeSeCambia(op) {
  const o = op?.origen;
  if (o === "cheque") return "Finanzas → Cheques";
  if (o === "orden_pago" || o === "pago") return "Finanzas → Pagos (anulando la orden)";
  if (["factura_oc", "factura_oc_otra", "factura_suelta"].includes(o)) return "Compras (corrigiendo o anulando la factura)";
  if (o === "cobro" || o === "compensacion") return "Finanzas → Clientes";
  if (o === "venta_ot" || o === "entrega_ot") return "la OT";
  if (o === "consumo_ot") return "la OT: Gypi lo anota solo cuando se entrega, con su costo real de materiales";
  if (o === "liquidacion" || o === "pago_sueldo") return "Finanzas → Sueldos";
  if (o === "saldo_inicial") return "Configuración → 📚 Histórico del libro (la apertura se vuelve a armar al pasarlo)";
  if (o === "libro") return "el libro: corregila o borrala ahí y volvé a pasar el histórico (Configuración → 📚 Histórico del libro), Gypi la actualiza sola";
  return "donde salió";
}

/**
 * La operación corregida (nueva) a partir de la original y lo que cambió.
 * Cambia fecha, importe, cuentas, descripción y referencia; el resto queda.
 * Con IVA, el importe nuevo se reparte en la misma proporción.
 * @returns {{ nueva?: object, errores: string[] }}
 */
export function operacionCorregida(op, cambios = {}, { cuentas = [] } = {}) {
  const errores = [];
  if (!puedeCorregir(op)) return { errores: ["Esta operación no se corrige acá."] };
  const fecha = cambios.fecha === undefined ? op.fecha : txt(cambios.fecha, 10);
  if (!FECHA.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) errores.push("La fecha no es válida.");
  const totalViejo = centavos(op.total);
  const total = cambios.total === undefined ? totalViejo : centavos(cambios.total);
  if (!(total > 0) || total >= 1e13) errores.push("El importe tiene que ser mayor a cero.");
  const debe = cambios.cuenta_debe === undefined ? op.cuenta_debe : txt(cambios.cuenta_debe, 40);
  const haber = cambios.cuenta_haber === undefined ? op.cuenta_haber : txt(cambios.cuenta_haber, 40);
  const existe = new Set(cuentas.map((c) => c.codigo));
  for (const [lado, c] of [["debe", debe], ["haber", haber]]) {
    if (!c) errores.push(`Falta la cuenta del ${lado}.`);
    else if (existe.size && !existe.has(c)) errores.push(`La cuenta ${c} del ${lado} no está en el plan de cuentas.`);
  }
  if (debe && debe === haber) errores.push("El debe y el haber son la misma cuenta.");
  const tc = op.moneda === "USD" ? Number(cambios.tipo_cambio ?? op.tipo_cambio) : null;
  if (op.moneda === "USD" && !(tc > 0)) errores.push("En dólares falta el tipo de cambio.");
  if (errores.length) return { errores };

  // El IVA y los otros impuestos siguen la misma proporción del total
  const factor = totalViejo > 0 ? total / totalViejo : 1;
  const iva = centavos((Number(op.iva) || 0) * factor);
  const otros = centavos((Number(op.otros_impuestos) || 0) * factor);
  const neto = centavos(total - iva - otros);
  const sinCambios = fecha === op.fecha && total === totalViejo && debe === op.cuenta_debe && haber === op.cuenta_haber
    && (cambios.descripcion === undefined || txt(cambios.descripcion, 500) === (op.descripcion || ""))
    && (cambios.referencia === undefined || txt(cambios.referencia, 120) === (op.referencia || ""))
    && (op.moneda !== "USD" || tc === Number(op.tipo_cambio));
  if (sinCambios) return { errores: ["No cambiaste nada."] };

  const nueva = {
    fecha, tipo: op.tipo, proveedor_id: op.proveedor_id ?? null, cliente_id: op.cliente_id ?? null, entidad: op.entidad ?? null,
    proyecto_id: op.proyecto_id ?? null, centro_costo: op.centro_costo ?? null,
    neto, iva, otros_impuestos: otros, total, moneda: op.moneda || "ARS", tipo_cambio: op.moneda === "USD" ? tc : null,
    total_ars: op.moneda === "USD" ? centavos(total * tc) : total,
    cuenta_debe: debe, cuenta_haber: haber,
    descripcion: (cambios.descripcion === undefined ? txt(op.descripcion, 500) : txt(cambios.descripcion, 500)) || null,
    referencia: (cambios.referencia === undefined ? txt(op.referencia, 120) : txt(cambios.referencia, 120)) || null,
    comprobante_url: op.comprobante_url ?? null,
    // Los comprobantes (187) siguen con la corregida
    ...(Array.isArray(op.comprobantes) && op.comprobantes.length ? { comprobantes: op.comprobantes } : {}),
    // La corregida es una operación más, cargada a mano (la de Mi caja sigue
    // siendo de Mi caja, así el responsable la sigue viendo)
    origen: op.origen === "mi_caja" ? "mi_caja" : "manual", origen_id: null, estado: "confirmada",
  };
  return { nueva, errores };
}

/**
 * Los plazos fijos que quedaron dos veces: la operación que cargó Gypi
 * (origen plazo_fijo) y otra igual que no es de Gypi (copiada del libro o
 * cargada a mano): mismas cuentas, el mismo importe (hasta $1 de diferencia,
 * por el redondeo del interés) y hasta 3 días entre una y otra.
 * Se propone anular la de Gypi: el libro borra su renglón y queda la del
 * libro. Cada operación sirve para un solo par.
 * @returns {{ gypi: object, otra: object }[]}
 */
export function plazosRepetidos(ops = []) {
  const vivas = ops.filter((o) => !o.anulada_at);
  const deGypi = vivas.filter((o) => o.origen === "plazo_fijo");
  const otras = vivas.filter((o) => o.origen !== "plazo_fijo");
  const usadas = new Set();
  const out = [];
  for (const g of deGypi) {
    const otra = otras.find((o) => !usadas.has(o.id)
      && o.cuenta_debe === g.cuenta_debe && o.cuenta_haber === g.cuenta_haber
      && Math.abs(centavos(o.total) - centavos(g.total)) <= 1
      && Math.abs(dias(o.fecha, g.fecha)) <= 3);
    if (!otra) continue;
    usadas.add(otra.id);
    out.push({ gypi: g, otra });
  }
  return out;
}
