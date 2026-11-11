// app/lib/finanzasGastos.js — Finanzas, parte 5 del plan del 11/11: cargar
// un gasto devengado, con factura o sin factura. Sin migración.
//
// Devengar = anotar el gasto en el mes en que ocurrió, aunque se pague
// después. La operación queda:
//   Debe:  la cuenta del gasto (y el IVA crédito fiscal si hay factura A)
//   Haber: la deuda — Proveedores si hay un proveedor, o la cuenta "a pagar"
//          que se elija (Acreedores Varios, Impuesto IIBB A Pagar…)
// con la fecha del mes del gasto: si la factura es de otro mes (la luz de
// octubre que llega en noviembre), la operación va el último día de ese mes
// (o el primero, si el gasto es de un mes que todavía no empezó).
// Si ya se pagó, se carga también el pago (Debe la deuda / Haber la caja o el
// banco) con el mismo tipo, así en el flujo de caja cae en su renglón.
//
// Parte 6: subir la factura (PDF o foto) → la IA de Gypi la lee (PROMPT_GASTO,
// esquemaGasto) → propuestaDeLectura arma el formulario ya lleno, con avisos,
// y el dueño lo revisa y lo guarda (o lo corrige).
import { cajasDelLado } from "./finanzasOperaciones";
import { clavePersona } from "./finanzasPersonas";

export const ORIGEN_GASTO = "gasto";
export const LETRAS = ["A", "B", "C", "M", "E", "X"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const CUENTA_PROVEEDORES = /^proveedores$/i;
const ACREEDORES = /^acreedores varios$/i;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, n = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Último día de un mes "AAAA-MM". */
export function finDeMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** La fecha con la que va el gasto al Estado de Resultados. */
export function fechaDevengado(fechaFactura, mes) {
  if (!MES.test(String(mes || "")) || !FECHA.test(String(fechaFactura || ""))) return fechaFactura || null;
  const mesFactura = fechaFactura.slice(0, 7);
  if (mes === mesFactura) return fechaFactura;
  return mes < mesFactura ? finDeMes(mes) : `${mes}-01`;
}

/** "Factura A 0001-00001234" a partir de letra, punto de venta y número. */
export function textoComprobante({ con_factura: conFactura, letra, punto_venta: pv, numero }) {
  if (!conFactura) return numero ? `Sin factura (comprobante ${txt(numero, 40)})` : "Sin factura";
  const p = String(pv || "").replace(/\D/g, "");
  const n = String(numero || "").replace(/\D/g, "");
  const nro = p || n ? `${p ? p.padStart(5, "0").slice(-5) : ""}${p && n ? "-" : ""}${n ? n.padStart(8, "0").slice(-8) : ""}` : "";
  return `Factura ${LETRAS.includes(letra) ? letra : ""}${nro ? ` ${nro}` : ""}`.replace(/\s+/g, " ").trim();
}

/** Las cuentas de deuda que se pueden elegir (pasivo: códigos que empiezan con 02). */
export function cuentasDeuda(cuentas = []) {
  return cuentas.filter((c) => String(c.codigo).startsWith("02") && c.activa !== false);
}

/** Los tipos que sirven para un gasto: los que no tienen una caja, una deuda ni un cliente al debe. */
export function tiposDeGasto(tipos = [], tesoreria = []) {
  return tipos.filter((t) => t.activo !== false && !cajasDelLado(t.cuenta_debe, tesoreria)
    && !String(t.cuenta_debe || "").startsWith("02") && !String(t.cuenta_debe || "").startsWith("01.01.02"));
}

/** La deuda que propone un tipo: su cuenta del haber si es un pasivo; si no, Acreedores Varios. */
export function deudaDelTipo(tipo, cuentas = []) {
  const deudas = cuentasDeuda(cuentas);
  if (tipo?.cuenta_haber && deudas.some((c) => c.codigo === tipo.cuenta_haber)) return tipo.cuenta_haber;
  return deudas.find((c) => ACREEDORES.test(String(c.nombre || "").trim()))?.codigo || "";
}

/**
 * Valida el formulario y arma la operación del gasto (y la del pago, si ya se pagó).
 * @param {object} d { tipo, fecha_factura, mes, con_factura, letra, punto_venta, numero, proveedor_id?, entidad?, cuenta_gasto, cuenta_deuda?, neto, iva, otros_impuestos, centro_costo?, proyecto_id?, descripcion?, pagado?, cuenta_caja?, fecha_pago? }
 * @param {{ tipos, cuentas, tesoreria, centros, proveedores, proyectos }} ctx
 * @returns {{ ops: object[], errores: string[] }}
 */
export function operacionesGasto(d = {}, ctx = {}) {
  const { tipos = [], cuentas = [], tesoreria = [], centros = [], proveedores = [], proyectos = [] } = ctx;
  const errores = [];
  const tipo = tipos.find((t) => t.codigo === d.tipo && t.activo !== false);
  if (!tipo) errores.push("Elegí el tipo de gasto.");
  if (!FECHA.test(String(d.fecha_factura || ""))) errores.push(d.con_factura ? "Falta la fecha de la factura." : "Falta la fecha.");
  const mes = MES.test(String(d.mes || "")) ? d.mes : String(d.fecha_factura || "").slice(0, 7);
  const cajas = new Set(tesoreria.map((t) => t.cuenta));
  const codigos = new Set(cuentas.filter((c) => c.activa !== false).map((c) => c.codigo));
  const cuentaProv = cuentas.find((c) => CUENTA_PROVEEDORES.test(String(c.nombre || "").trim()))?.codigo || null;

  const proveedorId = d.proveedor_id ? Number(d.proveedor_id) : null;
  const proveedor = proveedorId ? proveedores.find((p) => Number(p.id) === proveedorId) : null;
  if (proveedorId && !proveedor) errores.push("Ese proveedor no está en la lista.");
  const entidad = proveedor ? null : txt(d.entidad) || null;

  const cuentaGasto = txt(d.cuenta_gasto, 40);
  if (!codigos.has(cuentaGasto)) errores.push("Elegí la cuenta del gasto.");
  else if (cajas.has(cuentaGasto) || cuentaGasto.startsWith("02") || cuentaGasto.startsWith("03")) errores.push("La cuenta del gasto no puede ser una caja, un banco, una deuda ni una cuenta del patrimonio (como Ajuste De Capital).");

  const cuentaDeuda = proveedor ? cuentaProv : txt(d.cuenta_deuda, 40);
  if (proveedor && !cuentaProv) errores.push("Falta la cuenta \"Proveedores\" en el plan de cuentas.");
  if (!proveedor && !cuentasDeuda(cuentas).some((c) => c.codigo === cuentaDeuda)) errores.push("Elegí el proveedor o la cuenta donde queda la deuda (por ejemplo Acreedores Varios).");

  const neto = centavos(d.neto);
  const iva = d.con_factura ? centavos(d.iva) : 0;
  const otros = centavos(d.otros_impuestos);
  if (!(neto > 0) || neto >= 1e13) errores.push("El neto tiene que ser mayor a cero.");
  if (iva < 0 || otros < 0) errores.push("El IVA y las percepciones no pueden ser negativos.");
  if (iva > 0 && !["A", "M"].includes(d.letra)) errores.push("Solo las facturas A (o M) discriminan IVA: en una B o C poné todo en el neto.");
  const total = centavos(neto + iva + otros);

  const centro = txt(d.centro_costo, 60) || null;
  if (centro && !centros.some((c) => c.codigo === centro)) errores.push(`El centro de costo ${centro} no existe.`);
  if (tipo?.pide_cc && !centro) errores.push(`${tipo.nombre || tipo.codigo} pide centro de costo.`);
  const proyectoId = d.proyecto_id ? Number(d.proyecto_id) : null;
  if (proyectoId && !proyectos.some((p) => Number(p.id) === proyectoId)) errores.push("Esa OT no está en la lista.");

  const pagado = Boolean(d.pagado);
  const caja = pagado ? tesoreria.find((t) => t.cuenta === d.cuenta_caja && t.activa !== false) : null;
  if (pagado && !caja) errores.push("Elegí con qué caja o banco se pagó.");
  if (caja && caja.moneda === "USD") errores.push("El pago de un gasto en pesos sale de una caja o banco en pesos.");
  const fechaPago = pagado ? (FECHA.test(String(d.fecha_pago || "")) ? d.fecha_pago : d.fecha_factura) : null;

  if (errores.length) return { ops: [], errores: [...new Set(errores)] };

  const comprobante = textoComprobante(d);
  const fechaFactura = d.fecha_factura;
  const fecha = fechaDevengado(fechaFactura, mes);
  const dma = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}`;
  const descripcion = [
    `${comprobante}${fecha !== fechaFactura ? ` del ${dma(fechaFactura)} (gasto de ${mes.slice(5, 7)}/${mes.slice(0, 4)})` : ""}`,
    txt(d.descripcion, 300),
  ].filter(Boolean).join(" · ").slice(0, 500);
  const comun = { tipo: tipo.codigo, proveedor_id: proveedor ? Number(proveedor.id) : null, entidad, moneda: "ARS", tipo_cambio: null, origen: ORIGEN_GASTO, estado: "confirmada" };
  const devengado = {
    ...comun, fecha, proyecto_id: proyectoId, centro_costo: centro,
    neto, iva, otros_impuestos: otros, total, total_ars: total,
    cuenta_debe: cuentaGasto, cuenta_haber: cuentaDeuda,
    descripcion, referencia: d.con_factura ? comprobante.replace(/^Factura /, "") : txt(d.numero, 60) || null,
  };
  const ops = [devengado];
  if (pagado) {
    ops.push({
      ...comun, fecha: fechaPago, proyecto_id: proyectoId, centro_costo: centro,
      neto: total, iva: 0, otros_impuestos: 0, total, total_ars: total,
      cuenta_debe: cuentaDeuda, cuenta_haber: caja.cuenta,
      descripcion: `Pago de ${comprobante}`.slice(0, 500), referencia: devengado.referencia,
    });
  }
  return { ops, errores: [] };
}

/* ─── Parte 6: la factura leída por la IA ─────────────────────────────── */

export const PROMPT_GASTO = `Leés facturas, tickets y comprobantes de gastos de una fábrica de muebles en Argentina (servicios, impuestos, honorarios, alquileres, insumos) y devolvés sus datos para registrarlos en la contabilidad.
- letra: la letra del comprobante (A, B, C, M, E o X). Vacío si no es una factura (un ticket, un recibo o una boleta de impuestos).
- punto_venta y numero: el punto de venta y el número del comprobante, solo dígitos (en "0003-00012345": punto_venta "0003", numero "00012345"). Vacío si no se ven.
- fecha: fecha de emisión en formato AAAA-MM-DD. Vacío si no se ve.
- emisor: razón social de quien emite el comprobante (no la del cliente que paga). cuit_emisor: su CUIT, solo los 11 dígitos; vacío si no se ve.
- periodo: el mes al que corresponde el gasto, en formato AAAA-MM, si el comprobante lo dice (período facturado, mes de consumo, período fiscal del impuesto, honorarios de tal mes). Si el período abarca dos meses, el mes en que termina. Vacío si no lo dice.
- neto: el importe sin IVA (neto gravado más no gravado más exento). En una factura B, C o un ticket que no discrimina IVA, el total menos las percepciones e impuestos aparte.
- iva: la suma de todos los IVA discriminados (21 %, 10,5 %, 27 %). 0 si no está discriminado.
- otros_impuestos: la suma de percepciones (IVA, Ingresos Brutos, Ganancias), impuestos internos y otros tributos que figuran aparte. 0 si no hay.
- total: el importe total del comprobante.
- moneda: "USD" si los importes están en dólares, si no "ARS".
- concepto: qué se paga, en pocas palabras (por ejemplo "Energía eléctrica planta", "Honorarios contables octubre").
- tipo_sugerido: el código del tipo de gasto que mejor corresponde, de la lista que se te da. Vacío si ninguno corresponde.
Usá punto como separador decimal en los números. Si algo no se puede leer, dejalo vacío o en 0; no inventes datos.`;

/** El esquema de lo que devuelve la IA, con los tipos de gasto de la empresa para elegir. */
export function esquemaGasto(tipos = []) {
  const codigos = [...new Set(tipos.map((t) => String(t.codigo)).filter(Boolean))].slice(0, 200);
  return {
    type: "object",
    additionalProperties: false,
    required: ["letra", "punto_venta", "numero", "fecha", "emisor", "cuit_emisor", "periodo", "neto", "iva", "otros_impuestos", "total", "moneda", "concepto", "tipo_sugerido"],
    properties: {
      letra: { type: "string", enum: [...LETRAS, ""] },
      punto_venta: { type: "string" },
      numero: { type: "string" },
      fecha: { type: "string" },
      emisor: { type: "string" },
      cuit_emisor: { type: "string" },
      periodo: { type: "string" },
      neto: { type: "number" },
      iva: { type: "number" },
      otros_impuestos: { type: "number" },
      total: { type: "number" },
      moneda: { type: "string", enum: ["ARS", "USD"] },
      concepto: { type: "string" },
      tipo_sugerido: { type: "string", enum: [...codigos, ""] },
    },
  };
}

/** La lista de tipos que va en el pedido a la IA: código, nombre y para qué se usa. */
export function tiposParaIa(tipos = [], leyenda = () => "") {
  return tipos.map((t) => `- ${t.codigo}${t.nombre && t.nombre !== t.codigo ? ` (${t.nombre})` : ""}${leyenda(t) ? `: ${leyenda(t)}` : ""}`).join("\n");
}

const soloDigitos = (v) => String(v ?? "").replace(/\D/g, "");

/** El proveedor de la factura: por CUIT, o por el nombre (sin importar el orden de las palabras ni S.A./SRL). */
export function proveedorDeFactura({ emisor, cuit }, proveedores = []) {
  const c = soloDigitos(cuit);
  if (c.length === 11) {
    const porCuit = proveedores.find((p) => soloDigitos(p.cuit) === c);
    if (porCuit) return porCuit;
  }
  const clave = clavePersona(emisor || "");
  return clave ? proveedores.find((p) => clavePersona(p.nombre || "") === clave) || null : null;
}

/**
 * Lo que leyó la IA, como formulario de gasto ya lleno (siempre se revisa antes de guardar).
 * @param {object} l la lectura (esquemaGasto)
 * @param {{ tipos, cuentas, tesoreria, proveedores }} ctx
 * @returns {{ inicial: object, avisos: string[], proveedor_nuevo: { nombre: string, cuit: string } | null }}
 */
export function propuestaDeLectura(l = {}, ctx = {}) {
  const { tipos = [], cuentas = [], tesoreria = [], proveedores = [] } = ctx;
  const avisos = [];
  const deGasto = tiposDeGasto(tipos, tesoreria);
  const fecha = FECHA.test(String(l.fecha || "")) ? l.fecha : "";
  const periodo = MES.test(String(l.periodo || "")) ? l.periodo : "";
  const emisor = txt(l.emisor);
  const cuitDig = soloDigitos(l.cuit_emisor);
  const cuit = cuitDig.length === 11 ? `${cuitDig.slice(0, 2)}-${cuitDig.slice(2, 10)}-${cuitDig.slice(10)}` : "";
  const proveedor = emisor || cuit ? proveedorDeFactura({ emisor, cuit }, proveedores) : null;
  // El tipo: el que tiene guardado el proveedor; si no, el que sugiere la IA
  const tipo = deGasto.find((t) => t.codigo === proveedor?.fin_tipo) || deGasto.find((t) => t.codigo === l.tipo_sugerido) || null;
  const letra = LETRAS.includes(l.letra) ? l.letra : "";
  const conFactura = Boolean(letra);
  const neto = centavos(l.neto);
  const iva = ["A", "M"].includes(letra) ? centavos(l.iva) : 0;
  // En una B o C con IVA leído, el IVA va dentro del neto
  const netoFinal = !["A", "M"].includes(letra) && centavos(l.iva) > 0 ? centavos(neto + centavos(l.iva)) : neto;
  const otros = centavos(l.otros_impuestos);
  const total = centavos(l.total);
  const suma = centavos(netoFinal + iva + otros);

  if (!fecha) avisos.push("No pude leer la fecha: completala.");
  if (!(netoFinal > 0)) avisos.push("No pude leer los importes: completalos.");
  else if (total > 0 && Math.abs(total - suma) > 1) avisos.push(`El total de la factura (${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}) no da con neto + IVA + percepciones (${suma.toLocaleString("es-AR", { minimumFractionDigits: 2 })}): revisá los importes.`);
  if (l.moneda === "USD") avisos.push("La factura está en dólares: pasá los importes a pesos con el tipo de cambio del día.");
  if (!tipo) avisos.push("Elegí el tipo de gasto.");
  if (periodo && fecha && periodo !== fecha.slice(0, 7)) avisos.push(`La factura dice que el gasto es de ${periodo.slice(5, 7)}/${periodo.slice(0, 4)}: va a ese mes.`);
  const proveedorNuevo = !proveedor && emisor ? { nombre: emisor, cuit } : null;
  if (proveedorNuevo) avisos.push(`${emisor}${cuit ? ` (CUIT ${cuit})` : ""} no está en tus proveedores.`);

  const inicial = {
    tipo: tipo?.codigo || "", cuenta_gasto: tipo?.cuenta_debe || "",
    con_factura: conFactura, letra: letra || "A", punto_venta: soloDigitos(l.punto_venta).slice(-5), numero: soloDigitos(l.numero).slice(-8) || txt(l.numero, 40),
    fecha_factura: fecha, mes: periodo || fecha.slice(0, 7),
    proveedor_id: proveedor ? String(proveedor.id) : "",
    entidad: proveedor ? "" : emisor,
    cuenta_deuda: deudaDelTipo(tipo, cuentas),
    neto: netoFinal ? String(netoFinal) : "", iva: iva ? String(iva) : "", otros_impuestos: otros ? String(otros) : "",
    descripcion: txt(l.concepto, 300),
  };
  return { inicial, avisos, proveedor_nuevo: proveedorNuevo };
}
