// app/lib/finanzasCorregir.js — Corregir o anular un movimiento de cajas y
// bancos (pedido de Tadeo del 12/11). Sin migración.
//
// Desde el 19/11 (punto 12, migración 199) se corrige en su lugar: la
// operación es la misma (no cambia de número, sigue unida a su extracto, su
// orden o su plazo fijo) y en su historial queda qué cambió, quién y cuándo.
// El libro reescribe el renglón solo (cambia la versión). Sin la 199, como
// antes: la deja anulada ("corregida por …") y carga una nueva.
//
// Se corrige o se anula lo que no depende de otra pantalla: lo cargado a mano,
// los plazos fijos, el extracto del banco, Mi caja, el
// FCI y los títulos. Lo que sale de una factura, un cheque, una orden de pago,
// un cobro, una venta o un sueldo se cambia desde donde salió. Lo copiado del
// libro se corrige en el libro mientras el libro sea el que manda: al volver
// a pasar el histórico, Gypi lo actualiza solo. Cuando el libro ya es copia
// completa de Gypi (espejo_completo_at, PR 11), también se corrige acá.

export const SE_CORRIGEN = new Set(["manual", "plazo_fijo", "banco", "mi_caja", "fci", "titulos"]);
/**
 * Se anulan también los gastos (con su pago, si lo tienen) y, desde el 13/11
 * (pedido de Tadeo), lo copiado del libro y los saldos iniciales: sin tener
 * que ir al libro. Lo del libro anulado a mano no vuelve al pasar el
 * histórico otra vez (finanzasHistorico.js); la apertura sí se vuelve a armar.
 */
// Etapa 5 (14/11): la entrega estimada de una OT sin precio, si el Dueño no la
// quiere (anulada a mano, Gypi no la vuelve a crear)
// 💱 La compra o venta de dólares (14/11) se anula entera (con su diferencia
// de cotización), no se corrige: se vuelve a cargar
export const SE_ANULAN = new Set([...SE_CORRIGEN, "gasto", "libro", "saldo_inicial", "entrega_estimada", "dolares", "ajuste_saldo"]);
/** Para revisar que se confirman tal como están (etapa 5). */
export const SE_CONFIRMAN = new Set(["entrega_estimada"]);
export const puedeConfirmar = (op) => !!op && !op.anulada_at && op.estado === "para_revisar" && SE_CONFIRMAN.has(op.origen);
export const MARCA_CORREGIDA = "(corregida)";
export const MAX_ANULAR_JUNTAS = 200;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const dias = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

/** Con el libro como copia completa de Gypi, también lo que vino del libro. */
export const SE_CORRIGEN_ESPEJO = new Set(["libro", "saldo_inicial"]);
/** Los campos que se corrigen, con su nombre para el historial. */
export const CAMPOS_CORREGIBLES = {
  fecha: "Fecha", total: "Importe", tipo_cambio: "Tipo de cambio", cuenta_debe: "Debe", cuenta_haber: "Haber",
  descripcion: "Descripción", referencia: "Referencia",
};

/**
 * ¿Se corrige acá? espejo = el libro ya es copia completa de Gypi.
 * @param {object} op
 * @param {{ espejo?: boolean }} [opts]
 */
export const puedeCorregir = (op, { espejo = false } = {}) => !!op && !op.anulada_at
  && (SE_CORRIGEN.has(op.origen || "manual") || (espejo && SE_CORRIGEN_ESPEJO.has(op.origen)));
export const puedeAnular = (op) => !!op && !op.anulada_at && SE_ANULAN.has(op.origen || "manual");

/** De dónde se cambia lo que no se corrige acá. */
export function dondeSeCambia(op, { espejo = false } = {}) {
  const o = op?.origen;
  if (espejo && SE_CORRIGEN_ESPEJO.has(o)) return "acá (✏ Corregir)";
  if (o === "cheque") return "Finanzas → Cheques (abrí el cheque y tocá ↩ Deshacer)";
  if (o === "orden_pago" || o === "pago") return "Finanzas → Pagos (anulando la orden)";
  if (["factura_oc", "factura_oc_otra", "factura_suelta"].includes(o)) return "Compras (corrigiendo o anulando la factura)";
  if (o === "cobro" || o === "compensacion") return "Finanzas → Clientes";
  if (o === "venta_ot" || o === "entrega_ot") return "la OT";
  if (o === "consumo_ot") return "la OT: Gypi lo anota solo cuando se entrega, con su costo real de materiales";
  if (o === "liquidacion" || o === "pago_sueldo") return "Finanzas → Sueldos";
  if (o === "dolares") return "➕ Cargar → 💱 Comprar o vender dólares: anulala (se anula con su diferencia de cotización) y cargala de nuevo";
  if (o === "ajuste_saldo") return "la cuenta corriente: anulalo y hacé otro ⚖ Ajustar saldo";
  if (o === "saldo_inicial") return "Configuración → 📚 Histórico del libro (la apertura se vuelve a armar al pasarlo)";
  if (o === "libro") return "el libro: corregila o borrala ahí y volvé a pasar el histórico (Configuración → 📚 Histórico del libro), Gypi la actualiza sola";
  return "donde salió";
}

/**
 * La operación corregida a partir de la original y lo que cambió.
 * Cambia fecha, importe, cuentas, descripción y referencia; el resto queda.
 * Con IVA, el importe nuevo se reparte en la misma proporción.
 *   campos  = lo que se pisa en la misma operación (corregir en el lugar, 199)
 *   detalle = qué cambió, para el historial: [{ campo, antes, despues }]
 *   nueva   = la operación nueva, para corregir como antes (sin la 199)
 * @param {{ cuentas?: object[], espejo?: boolean }} [opts]
 * @returns {{ campos?: object, detalle?: object[], nueva?: object, errores: string[] }}
 */
export function operacionCorregida(op, cambios = {}, { cuentas = [], espejo = false } = {}) {
  const errores = [];
  if (!puedeCorregir(op, { espejo })) return { errores: ["Esta operación no se corrige acá."] };
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
  // En el lugar: solo lo que se corrige; el origen, el número y lo demás quedan
  const campos = {
    fecha, neto, iva, otros_impuestos: otros, total, tipo_cambio: nueva.tipo_cambio, total_ars: nueva.total_ars,
    cuenta_debe: debe, cuenta_haber: haber, descripcion: nueva.descripcion, referencia: nueva.referencia,
  };
  const antes = { ...op, total: totalViejo, descripcion: op.descripcion || null, referencia: op.referencia || null, tipo_cambio: op.moneda === "USD" ? Number(op.tipo_cambio) : null };
  const detalle = Object.keys(CAMPOS_CORREGIBLES)
    .filter((c) => c !== "tipo_cambio" || op.moneda === "USD")
    .filter((c) => String(antes[c] ?? "") !== String(campos[c] ?? ""))
    .map((c) => ({ campo: c, antes: antes[c] ?? null, despues: campos[c] ?? null }));
  return { campos, detalle, nueva, errores };
}

/**
 * Los plazos fijos que quedaron dos veces: la operación que cargó Gypi
 * (origen plazo_fijo) y otra igual que no es de Gypi (copiada del libro o
 * cargada a mano): mismas cuentas, el mismo importe (hasta $1 de diferencia,
 * por el redondeo del interés) y hasta 3 días entre una y otra.
 * Se propone anular la de Gypi: el libro borra su renglón y queda la del
 * libro. Cada operación sirve para un solo par.
 *
 * 16/11: también lo que trajo el extracto del banco aunque se haya cargado
 * con otro tipo o contra otra cuenta (el interés contra Intereses Ganados o
 * contra la cuenta del plazo fijo: entra al mismo banco, mismo importe y
 * hasta 5 días), y el renglón del banco con capital e interés juntos, que
 * repite el vencimiento y el interés que cargó Gypi.
 * @param {{ cuentasPf?: string[], cuentasInteres?: string[] }} [opts]
 * @returns {{ gypi: object, otra: object }[]}
 */
export function plazosRepetidos(ops = [], { cuentasPf = [], cuentasInteres = [] } = {}) {
  const vivas = ops.filter((o) => !o.anulada_at);
  const deGypi = vivas.filter((o) => o.origen === "plazo_fijo");
  const otras = vivas.filter((o) => o.origen !== "plazo_fijo");
  const pfs = new Set(cuentasPf);
  const reconocible = new Set([...cuentasPf, ...cuentasInteres].filter(Boolean));
  const usadas = new Set();
  const out = [];
  const enGrupo = new Set();
  // El banco devolvió capital e interés juntos: el vencimiento y el interés de Gypi sobran
  const porCert = new Map();
  for (const g of deGypi) {
    const m = String(g.origen_id || "").match(/^pf(\d+):([ri])$/);
    if (!m) continue;
    porCert.set(m[1], { ...(porCert.get(m[1]) || {}), [m[2]]: g });
  }
  for (const { r, i } of porCert.values()) {
    if (!r || !i || r.cuenta_debe !== i.cuenta_debe) continue;
    const suma = centavos(Number(r.total) + Number(i.total));
    const otra = otras.find((o) => !usadas.has(o.id) && o.cuenta_debe === r.cuenta_debe && reconocible.has(o.cuenta_haber) && !pfs.has(o.cuenta_debe)
      && Math.abs(centavos(o.total) - suma) <= 1 && Math.abs(dias(o.fecha, r.fecha)) <= 5);
    if (!otra) continue;
    usadas.add(otra.id);
    enGrupo.add(r.id).add(i.id);
    out.push({ gypi: r, otra }, { gypi: i, otra });
  }
  for (const g of deGypi) {
    if (enGrupo.has(g.id)) continue;
    const otra = otras.find((o) => !usadas.has(o.id) && o.cuenta_debe === g.cuenta_debe
      && (o.cuenta_haber === g.cuenta_haber
        ? Math.abs(centavos(o.total) - centavos(g.total)) <= 1 && Math.abs(dias(o.fecha, g.fecha)) <= 3
        : o.origen === "banco" && reconocible.has(o.cuenta_haber) && !pfs.has(o.cuenta_debe)
          && Math.abs(centavos(o.total) - centavos(g.total)) <= 1 && Math.abs(dias(o.fecha, g.fecha)) <= 5));
    if (!otra) continue;
    usadas.add(otra.id);
    out.push({ gypi: g, otra });
  }
  return out;
}

/* ─── Cheques con el débito o el depósito dos veces (16/11) ───────────── */

/** Días antes y después de la fecha de pago en que se busca el movimiento del banco. */
const CHEQUE_ANTES = 4;
const CHEQUE_DESPUES = 35;

/**
 * Los cheques debitados o depositados cuyo movimiento cargó Gypi (origen
 * cheque) y que también trajo el extracto o se cargó a mano: mismo banco y
 * sentido, el mismo importe, desde 4 días antes de la fecha de pago hasta 35
 * después (el e-cheq se cobra cuando lo presentan). Se propone quedarse con
 * el del banco (tiene la fecha real), unir el cheque a ese y anular el de
 * Gypi. Cada movimiento sirve para un solo cheque.
 * @param {object[]} cheques con op_cierre_id
 * @param {object[]} ops las del cheque y las de los bancos
 * @returns {{ cheque: object, gypi: object, otra: object }[]}
 */
export function chequesRepetidos(cheques = [], ops = []) {
  const porId = new Map(ops.map((o) => [Number(o.id), o]));
  const deCheques = new Set(cheques.map((c) => Number(c.op_cierre_id)).filter(Boolean));
  const usadas = new Set();
  const out = [];
  const lista = cheques.filter((c) => ["debitado", "depositado"].includes(c.estado) && c.op_cierre_id)
    .sort((a, b) => String(a.fecha_pago).localeCompare(String(b.fecha_pago)) || a.id - b.id);
  for (const ch of lista) {
    const g = porId.get(Number(ch.op_cierre_id));
    if (!g || g.anulada_at || g.origen !== "cheque") continue;
    const sale = ch.estado === "debitado";
    const banco = sale ? g.cuenta_haber : g.cuenta_debe;
    const importe = centavos(g.total_ars ?? g.total);
    const desde = dias(ch.fecha_pago, "1970-01-01") - CHEQUE_ANTES;
    const hasta = dias(ch.fecha_pago, "1970-01-01") + CHEQUE_DESPUES;
    let mejor = null;
    for (const o of ops) {
      if (o.anulada_at || o.origen === "cheque" || usadas.has(Number(o.id)) || deCheques.has(Number(o.id))) continue;
      if ((sale ? o.cuenta_haber : o.cuenta_debe) !== banco) continue;
      if (Math.abs(centavos(o.total_ars ?? o.total) - importe) >= 0.01) continue;
      const d = dias(o.fecha, "1970-01-01");
      if (d < desde || d > hasta) continue;
      const cerca = Math.abs(dias(o.fecha, g.fecha));
      if (!mejor || cerca < mejor.cerca) mejor = { o, cerca };
    }
    if (!mejor) continue;
    usadas.add(Number(mejor.o.id));
    out.push({ cheque: ch, gypi: g, otra: mejor.o });
  }
  return out;
}
