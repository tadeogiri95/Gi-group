// app/lib/finanzasCheques.js — Finanzas, parte F2b (1): cheques (migración
// 174; reemplaza R-CHEQUES y PREVISIÓN CHEQUES del libro).
//
//   - Propios (e-cheq de la empresa, siempre Credicoop por ahora): al darlo a
//     un proveedor baja su deuda contra "E-cheq diferidos a pagar"; cuando el
//     banco lo debita, esa cuenta baja contra el banco.
//   - De terceros: al recibirlo entra a "Valores a depositar" contra el
//     cliente; después se deposita (sube el banco), se entrega a un proveedor
//     (baja su deuda) o vuelve rechazado ("Cheques rechazados").
// Cada cambio de estado es una operación en Finanzas, como cargaba el libro
// (PAGO ECHEQ A PROVEEDORES, PAGO ECHEQ, RECEPCIÓN ECHEQ, DEP CHEQUE…).
// Los vivos de R-CHEQUES (ACTIVO y ENTREGADO) se copian sin operación.
import { claveNombre, CUENTA_PROVEEDORES } from "./finanzasProveedores";
import { fechaDelLibro } from "./finanzasProveedores";

export const TIPOS_CHEQUE = {
  echeq_diferido: "E-cheq de pago diferido",
  echeq_comun: "E-cheq común",
  cheque_diferido: "Cheque de pago diferido",
  cheque_fisico: "Cheque físico",
};
export const ESTADOS_CHEQUE = {
  pendiente: { nombre: "Por debitar", vivo: true },
  debitado: { nombre: "Debitado", vivo: false },
  en_cartera: { nombre: "En cartera", vivo: true },
  depositado: { nombre: "Depositado", vivo: false },
  entregado: { nombre: "Entregado", vivo: false },
  rechazado: { nombre: "Rechazado", vivo: false },
  anulado: { nombre: "Anulado", vivo: false },
};
/** Qué se puede hacer con un cheque según su clase y estado. */
export const ACCIONES = {
  propio: { pendiente: ["debitado", "anular"] },
  tercero: { en_cartera: ["depositado", "entregado", "rechazado", "anular"], depositado: ["rechazado"], entregado: ["rechazado"] },
};
export const NOMBRE_ACCION = { debitado: "Debitado", depositado: "Depositado", entregado: "Entregado a un proveedor", rechazado: "Rechazado", anular: "Anular" };
export const BANCO_ECHEQ = "Credicoop";
export const ORIGEN_CHEQUE = "cheque";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const esEcheq = (tipo) => String(tipo || "").startsWith("echeq");

/** Las cuentas que usan los cheques, buscadas por nombre en el plan de cuentas. */
export function cuentasCheques(cuentas = []) {
  const por = (re) => cuentas.find((c) => c.activa !== false && re.test(String(c.nombre || "").trim()))?.codigo || null;
  return {
    proveedores: por(CUENTA_PROVEEDORES),
    diferidos: por(/^e-?cheq diferidos a pagar/i),
    valores: por(/^valores a depositar$/i),
    valoresEcheq: por(/^valores a depositar\s*-\s*e-?cheq$/i) || por(/^valores a depositar$/i),
    rechazados: por(/^cheques rechazados$/i),
    deudores: por(/^deudores por ventas$/i),
  };
}

/** La cuenta de banco (en pesos) de la lista de cajas y bancos que corresponde al nombre del banco del cheque. */
export function cuentaBancoDe(banco, tesoreria = []) {
  const k = claveNombre(banco);
  if (!k) return null;
  const bancos = tesoreria.filter((t) => t.tipo === "banco" && t.moneda !== "USD" && t.activa !== false && claveNombre(t.nombre).includes(k));
  return (bancos.find((t) => /CTACTE/.test(claveNombre(t.nombre))) || bancos[0])?.cuenta || null;
}

/**
 * Revisa los datos de un cheque nuevo.
 * @returns {{ cheque?: object, errores: string[] }}
 */
export function validarCheque(f = {}, { proveedores = [], tesoreria = [] } = {}) {
  const errores = [];
  const clase = f.clase === "propio" ? "propio" : f.clase === "tercero" ? "tercero" : null;
  if (!clase) errores.push("Elegí si es propio o recibido");
  const tipo = TIPOS_CHEQUE[f.tipo] ? f.tipo : null;
  if (!tipo) errores.push("Elegí el tipo de cheque");
  const importe = centavos(f.importe);
  if (!(importe > 0) || importe >= 1e13) errores.push("El importe tiene que ser mayor a cero");
  if (!FECHA.test(String(f.fecha_pago || ""))) errores.push("Falta la fecha de pago");
  if (f.fecha_emision && !FECHA.test(String(f.fecha_emision))) errores.push("Revisá la fecha de emisión");
  const banco = txt(f.banco, 60) || (clase === "propio" && esEcheq(tipo) ? BANCO_ECHEQ : "");
  if (!banco) errores.push("Falta el banco");
  const proveedorId = f.proveedor_id ? Number(f.proveedor_id) : null;
  const proveedor = proveedorId ? proveedores.find((p) => Number(p.id) === proveedorId) : null;
  if (proveedorId && !proveedor) errores.push("Ese proveedor no está en la lista");
  if (clase === "propio" && !proveedor) errores.push("Elegí a qué proveedor se lo diste");
  const recibido = txt(f.recibido_de, 120);
  if (clase === "tercero" && !recibido) errores.push("Falta de quién lo recibiste");
  let cuentaBanco = f.cuenta_banco ? String(f.cuenta_banco) : null;
  if (cuentaBanco && !tesoreria.some((t) => t.cuenta === cuentaBanco && t.tipo === "banco")) errores.push("Ese banco no está en la lista de cajas y bancos");
  if (clase === "propio" && !cuentaBanco) cuentaBanco = cuentaBancoDe(banco, tesoreria);
  if (errores.length) return { errores };
  return {
    errores,
    cheque: {
      clase, tipo, banco, numero: txt(f.numero, 40) || null,
      librador: txt(f.librador, 120) || null,
      beneficiario: clase === "propio" ? txt(proveedor.nombre, 120) : txt(f.beneficiario, 120) || null,
      proveedor_id: clase === "propio" ? proveedor.id : null,
      recibido_de: clase === "tercero" ? recibido : null,
      fecha_emision: f.fecha_emision || null, fecha_pago: f.fecha_pago, importe,
      cuenta_banco: cuentaBanco || null,
      estado: clase === "propio" ? "pendiente" : "en_cartera",
      notas: txt(f.notas, 300) || null,
    },
  };
}

const opBase = (ch, { fecha, tipo, debe, haber, descripcion, proveedor_id = null, entidad = null, accion }) => ({
  fecha, tipo, proveedor_id, entidad: proveedor_id ? null : (entidad ? txt(entidad, 120) : null),
  neto: ch.importe, iva: 0, otros_impuestos: 0, total: ch.importe, moneda: "ARS", tipo_cambio: null, total_ars: ch.importe,
  cuenta_debe: debe, cuenta_haber: haber,
  descripcion: txt(`${descripcion} · ${TIPOS_CHEQUE[ch.tipo] || "Cheque"}${ch.banco ? ` ${ch.banco}` : ""}${ch.numero ? ` N° ${ch.numero}` : ""}`, 500),
  referencia: ch.numero ? txt(ch.numero, 120) : null,
  origen: ORIGEN_CHEQUE, origen_id: `${ch.id}:${accion}`, estado: "confirmada",
});

/** La operación que genera dar de alta un cheque (propio a un proveedor, o recibido de un cliente). */
export function operacionAlta(ch, cuentas, fecha) {
  const c = cuentasCheques(cuentas);
  if (ch.clase === "propio") {
    if (!c.proveedores || !c.diferidos) return { error: "Faltan las cuentas \"Proveedores\" o \"E-cheq diferidos a pagar\" en el plan de cuentas" };
    return { op: opBase(ch, { fecha, accion: "alta", tipo: esEcheq(ch.tipo) ? "PAGO ECHEQ A PROVEEDORES" : "PAGO CHEQUE A PROVEEDORES", debe: c.proveedores, haber: c.diferidos, proveedor_id: ch.proveedor_id, descripcion: "Pago con cheque propio" }) };
  }
  const valores = esEcheq(ch.tipo) ? c.valoresEcheq : c.valores;
  if (!valores || !c.deudores) return { error: "Faltan las cuentas \"Valores a depositar\" o \"Deudores por ventas\" en el plan de cuentas" };
  return { op: opBase(ch, { fecha, accion: "alta", tipo: esEcheq(ch.tipo) ? "RECEPCIÓN ECHEQ" : "RECEPCIÓN CHEQUE FÍSICO", debe: valores, haber: c.deudores, entidad: ch.recibido_de, descripcion: `Cheque recibido de ${ch.recibido_de || "un cliente"}` }) };
}

/**
 * Cambio de estado de un cheque: el cheque como queda y la operación que
 * genera (null al anular: se anula la del alta).
 * @param {object} ch el cheque
 * @param {"debitado"|"depositado"|"entregado"|"rechazado"|"anular"} accion
 * @param {{ fecha: string, cuenta_banco?: string, proveedor?: { id, nombre } }} datos
 * @param {{ cuentas: object[], tesoreria: object[] }} ctx
 * @returns {{ error?: string, cambios?: object, op?: object|null }}
 */
export function cambioDeEstado(ch, accion, datos, { cuentas = [], tesoreria = [] } = {}) {
  if (!(ACCIONES[ch.clase]?.[ch.estado] || []).includes(accion)) {
    return { error: `Un cheque ${ESTADOS_CHEQUE[ch.estado]?.nombre.toLowerCase() || ch.estado} no se puede marcar ${NOMBRE_ACCION[accion]?.toLowerCase() || accion}` };
  }
  const fecha = datos.fecha;
  if (!FECHA.test(String(fecha || ""))) return { error: "Falta la fecha" };
  const c = cuentasCheques(cuentas);
  const esBanco = (cta) => tesoreria.some((t) => t.cuenta === cta && t.tipo === "banco");
  const valores = esEcheq(ch.tipo) ? c.valoresEcheq : c.valores;

  if (accion === "anular") return { cambios: { estado: "anulado", estado_fecha: fecha }, op: null };

  if (accion === "debitado") {
    const banco = datos.cuenta_banco || ch.cuenta_banco || cuentaBancoDe(ch.banco, tesoreria);
    if (!banco || !esBanco(banco)) return { error: "Elegí el banco que lo debitó" };
    if (!c.diferidos) return { error: "Falta la cuenta \"E-cheq diferidos a pagar\" en el plan de cuentas" };
    return {
      cambios: { estado: "debitado", estado_fecha: fecha, cuenta_banco: banco },
      op: opBase(ch, { fecha, accion, tipo: "PAGO ECHEQ", debe: c.diferidos, haber: banco, proveedor_id: null, entidad: ch.beneficiario, descripcion: `Débito del cheque a ${ch.beneficiario || "un proveedor"}` }),
    };
  }
  if (accion === "depositado") {
    const banco = datos.cuenta_banco;
    if (!banco || !esBanco(banco)) return { error: "Elegí el banco donde lo depositaste" };
    if (!valores) return { error: "Falta la cuenta \"Valores a depositar\" en el plan de cuentas" };
    return {
      cambios: { estado: "depositado", estado_fecha: fecha, cuenta_banco: banco },
      op: opBase(ch, { fecha, accion, tipo: "DEP CHEQUE", debe: banco, haber: valores, entidad: ch.recibido_de || ch.librador, descripcion: "Depósito de cheque" }),
    };
  }
  if (accion === "entregado") {
    const p = datos.proveedor;
    if (!p?.id) return { error: "Elegí a qué proveedor se lo diste" };
    if (!c.proveedores || !valores) return { error: "Faltan las cuentas \"Proveedores\" o \"Valores a depositar\" en el plan de cuentas" };
    return {
      cambios: { estado: "entregado", estado_fecha: fecha, proveedor_id: p.id, entregado_a: txt(p.nombre, 120) },
      op: opBase(ch, { fecha, accion, tipo: esEcheq(ch.tipo) ? "PAGO ECHEQ A PROVEEDORES" : "PAGO CHEQUE A PROVEEDORES", debe: c.proveedores, haber: valores, proveedor_id: p.id, descripcion: "Pago con cheque de terceros" }),
    };
  }
  // Rechazado: vuelve el cheque; sale de donde estaba
  if (!c.rechazados) return { error: "Falta la cuenta \"Cheques rechazados\" en el plan de cuentas" };
  let haber = valores;
  let proveedor_id = null;
  if (ch.estado === "depositado") haber = ch.cuenta_banco;
  if (ch.estado === "entregado") { haber = c.proveedores; proveedor_id = ch.proveedor_id || null; }
  if (!haber) return { error: "No sé de qué cuenta sale el cheque rechazado: revisá el plan de cuentas" };
  return {
    cambios: { estado: "rechazado", estado_fecha: fecha },
    op: opBase(ch, { fecha, accion, tipo: "CHEQUE RECHAZADO", debe: c.rechazados, haber, proveedor_id, entidad: ch.recibido_de || ch.librador, descripcion: "Cheque rechazado" }),
  };
}

const TIPO_DEL_LIBRO = [
  [/E-?CHEQ.*COM/i, "echeq_comun"],
  [/E-?CHEQ/i, "echeq_diferido"],
  [/DIFERIDO/i, "cheque_diferido"],
  [/./, "cheque_fisico"],
];

/**
 * Los cheques vivos de R-CHEQUES (ACTIVO y ENTREGADO). Cuál es propio sale
 * del nombre de la empresa, que es el que más aparece como librador o
 * beneficiario (o el que se pasa).
 * @param {string[][]} grilla la hoja, con títulos en la primera fila
 * @returns {{ filas: object[], empresa: string, error?: string }}
 */
export function chequesDelLibro(grilla, { empresa = "" } = {}) {
  const titulos = (grilla?.[0] || []).map((t) => String(t || "").trim().toLowerCase());
  const col = (n) => titulos.indexOf(n);
  const c = {
    ref: 0, emision: col("fecha_emision"), tipo: col("tipo"), librador: col("librador"), banco: col("banco"), beneficiario: col("beneficiario"),
    numero: col("nro cheque"), vto: col("vencimiento"), monto: col("monto"), estado: col("estado"), entregado: col("entregado a"),
  };
  if ([c.librador, c.banco, c.vto, c.monto, c.estado].some((i) => i < 0)) {
    return { filas: [], empresa: "", error: "La hoja R-CHEQUES no tiene las columnas librador, banco, vencimiento, monto y estado." };
  }
  const datos = grilla.slice(1).filter((f) => f.some((v) => String(v ?? "").trim()));
  let nombreEmpresa = txt(empresa, 120);
  if (!nombreEmpresa) {
    const cuenta = new Map();
    for (const f of datos) for (const v of [f[c.librador], f[c.beneficiario]]) {
      const k = claveNombre(v);
      if (!k || k === "ALPORTADOR") continue;
      const e = cuenta.get(k) || { n: 0, nombre: txt(v, 120) };
      e.n++;
      cuenta.set(k, e);
    }
    nombreEmpresa = [...cuenta.values()].sort((a, b) => b.n - a.n)[0]?.nombre || "";
  }
  const kEmpresa = claveNombre(nombreEmpresa);
  const filas = [];
  for (const f of datos) {
    const estadoLibro = String(f[c.estado] || "").trim().toUpperCase();
    if (estadoLibro !== "ACTIVO" && estadoLibro !== "ENTREGADO") continue;
    const importe = centavos(String(f[c.monto] ?? "").replace(",", "."));
    const fechaPago = fechaDelLibro(f[c.vto]);
    if (!(importe > 0) || !fechaPago) continue;
    const propio = kEmpresa && claveNombre(f[c.librador]) === kEmpresa;
    const tipoTexto = String(f[c.tipo] ?? "");
    filas.push({
      referencia: txt(f[c.ref], 60) || null,
      clase: propio ? "propio" : "tercero",
      tipo: tipoTexto.trim() ? TIPO_DEL_LIBRO.find(([re]) => re.test(tipoTexto))[1] : "cheque_fisico",
      banco: txt(f[c.banco], 60) || null,
      numero: c.numero >= 0 ? txt(f[c.numero], 40) || null : null,
      librador: txt(f[c.librador], 120) || null,
      beneficiario: c.beneficiario >= 0 ? txt(f[c.beneficiario], 120) || null : null,
      fecha_emision: c.emision >= 0 ? fechaDelLibro(f[c.emision]) : null,
      fecha_pago: fechaPago, importe,
      estado: propio ? "pendiente" : estadoLibro === "ENTREGADO" ? "entregado" : "en_cartera",
      entregado_a: estadoLibro === "ENTREGADO" && c.entregado >= 0 ? txt(f[c.entregado], 120) || null : null,
    });
  }
  return { filas, empresa: nombreEmpresa };
}

const dias = (desde, hasta) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000);

/**
 * Calendario por semana desde hoy (como PREVISIÓN CHEQUES): cuánto se
 * debita de los propios y cuánto vence de los de terceros en cartera.
 * @returns {{ etiqueta: string, desde: number, hasta: number|null, debitar: number, cobrar: number, cantidad: number }[]}
 */
export function calendarioCheques(cheques = [], hoy, semanas = 8) {
  const tramos = [{ etiqueta: "Vencidos", desde: -Infinity, hasta: -1 }, { etiqueta: "Hoy", desde: 0, hasta: 0 }];
  for (let s = 0; s < semanas; s++) tramos.push({ etiqueta: `${s * 7 + 1} a ${s * 7 + 7} días`, desde: s * 7 + 1, hasta: s * 7 + 7 });
  tramos.push({ etiqueta: "Más adelante", desde: semanas * 7 + 1, hasta: Infinity });
  const filas = tramos.map((t) => ({ ...t, debitar: 0, cobrar: 0, cantidad: 0 }));
  for (const ch of cheques) {
    const debita = ch.clase === "propio" && ch.estado === "pendiente";
    const cobra = ch.clase === "tercero" && ch.estado === "en_cartera";
    if (!debita && !cobra) continue;
    const d = dias(hoy, ch.fecha_pago);
    const t = filas.find((x) => d >= x.desde && d <= x.hasta);
    if (!t) continue;
    if (debita) t.debitar += Number(ch.importe) || 0; else t.cobrar += Number(ch.importe) || 0;
    t.cantidad++;
  }
  return filas.map((t) => ({ ...t, debitar: centavos(t.debitar), cobrar: centavos(t.cobrar), desde: Number.isFinite(t.desde) ? t.desde : null, hasta: Number.isFinite(t.hasta) ? t.hasta : null }));
}

/** El aviso del día anterior: los cheques vivos que vencen hasta mañana y todavía no se avisaron. */
export function chequesParaAvisar(cheques = [], hoy) {
  const manana = new Date(Date.parse(`${hoy}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return cheques.filter((ch) => ESTADOS_CHEQUE[ch.estado]?.vivo && ch.fecha_pago <= manana && ch.avisado_para !== ch.fecha_pago);
}

/** Texto del aviso al celular. */
export function textoAviso(cheques, plata = (n) => `$ ${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`) {
  const propios = cheques.filter((c) => c.clase === "propio");
  const terceros = cheques.filter((c) => c.clase === "tercero");
  const suma = (l) => l.reduce((s, c) => s + (Number(c.importe) || 0), 0);
  const partes = [];
  if (propios.length) partes.push(`se debita${propios.length === 1 ? "" : "n"} ${propios.length} cheque${propios.length === 1 ? "" : "s"} propio${propios.length === 1 ? "" : "s"} por ${plata(suma(propios))}`);
  if (terceros.length) partes.push(`vence${terceros.length === 1 ? "" : "n"} ${terceros.length} cheque${terceros.length === 1 ? "" : "s"} en cartera por ${plata(suma(terceros))}`);
  if (!partes.length) return null;
  return { title: "🏦 Cheques", body: `Hasta mañana ${partes.join(" y ")}. Marcalos en Finanzas → Cheques.` };
}
