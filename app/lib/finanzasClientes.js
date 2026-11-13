// app/lib/finanzasClientes.js — Finanzas, parte F4a (migración 177): clientes,
// su cuenta corriente y los cobros (reemplaza CC_CLIENTES del libro).
//
//   - Cuenta corriente: las operaciones contra Deudores por Ventas. Al debe es
//     lo vendido (nos deben más), al haber lo cobrado. Saldo = vendido -
//     cobrado; si da negativo, el cliente tiene saldo a favor (un anticipo).
//   - De quién es: el cliente de la lista (cliente_id) o, para lo cargado con
//     nombre escrito (el libro, los cheques recibidos), el cliente que tiene
//     ese nombre o alias.
//   - Cobrar: efectivo a una caja, transferencia a un banco, cheque o e-cheq
//     (entra a la cartera de cheques) y dólares. Los dólares se anotan como en
//     el libro: entran a la caja en USD contra Ajuste De Capital y se
//     descuentan en pesos de la cuenta del cliente contra Ajuste De Capital.
//   - Saldos iniciales: del libro (T-OPERACIONES) hasta la fecha de corte,
//     juntando los nombres escritos distinto, contra Ajuste De Capital.
import { CUENTA_AJUSTE_CAPITAL, ORIGEN_SALDO_INICIAL, TIPO_SALDO_INICIAL, claveNombre, saldosDelLibro } from "./finanzasProveedores";
import { TIPOS_CHEQUE, validarCheque } from "./finanzasCheques";

export const CUENTA_DEUDORES = /^deudores por ventas$/i;
export const ORIGEN_COBRO = "cobro";
export const FORMAS_COBRO = { efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque o e-cheq", dolares: "Dólares" };
export const MAX_ALIAS = 30;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const fechaAr = (f) => f.split("-").reverse().join("/");
const usd = (n) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

/** Códigos de Deudores por Ventas en el plan de cuentas. */
export function cuentasDeudores(cuentas = []) {
  return new Set(cuentas.filter((c) => CUENTA_DEUDORES.test(String(c.nombre || "").trim())).map((c) => c.codigo));
}

/**
 * ¿La cuenta es la de un cliente? Deudores por Ventas o Anticipos de clientes:
 * un cobro contra esas cuentas tiene que decir de qué cliente es, así entra a
 * su cuenta corriente (13/11, pedido de Tadeo).
 */
export function cuentasDeCliente(cuentas = []) {
  const nombre = (c) => String(c.nombre || "").trim();
  return new Set(cuentas.filter((c) => CUENTA_DEUDORES.test(nombre(c)) || /^anticipos? (de|a) clientes?$/i.test(nombre(c))).map((c) => c.codigo));
}

/**
 * Nueva operación a mano (13/11): si toca la cuenta de un cliente, queda con
 * su cliente_id. Se busca por el nombre elegido o, si se eligió a alguien que
 * es proveedor y cliente, por el nombre de ese proveedor.
 * @returns {{ cliente_id: number, entidad: string } | null}
 */
export function clienteDeOperacion(op, { cuentas = [], clientes = [], proveedores = [] } = {}) {
  if (!op || op.cliente_id) return null;
  const deCliente = cuentasDeCliente(cuentas);
  if (!deCliente.has(op.cuenta_debe) && !deCliente.has(op.cuenta_haber)) return null;
  const nombre = op.entidad || (op.proveedor_id ? proveedores.find((p) => Number(p.id) === Number(op.proveedor_id))?.nombre : null);
  const c = nombre ? emparejarCliente(nombre, clientes.filter((x) => !x.unido_a)) : null;
  if (!c) return null;
  const elegido = indiceClientes(clientes).destino(c.id);
  const final = clientes.find((x) => Number(x.id) === elegido) || c;
  return { cliente_id: Number(final.id), entidad: txt(final.nombre, 120) };
}

/** Nombre o alias → id del cliente. Los unidos a otro van al que quedó. */
export function indiceClientes(clientes = []) {
  const porId = new Map(clientes.map((c) => [Number(c.id), c]));
  const destino = (c) => {
    let x = c;
    for (let i = 0; i < 10 && x?.unido_a && porId.has(Number(x.unido_a)); i++) x = porId.get(Number(x.unido_a));
    return Number(x.id);
  };
  const indice = new Map();
  // Primero los activos: si un nombre se repite, gana el que se usa
  for (const c of [...clientes].sort((a, b) => Number(b.activo !== false) - Number(a.activo !== false))) {
    for (const n of [c.nombre, ...(c.alias || [])]) {
      const k = claveNombre(n);
      if (k && !indice.has(k)) indice.set(k, destino(c));
    }
  }
  return { porNombre: indice, destino: (id) => (porId.has(Number(id)) ? destino(porId.get(Number(id))) : Number(id)) };
}

/** De quién es una operación: "c<id>" del cliente de la lista, "e<nombre>" si no está, o "". */
export function claveCliente(op, indice) {
  if (op.cliente_id) return `c${indice.destino(op.cliente_id)}`;
  const k = claveNombre(op.entidad);
  if (!k) return "";
  const id = indice.porNombre.get(k);
  return id ? `c${id}` : `e${k}`;
}

/** Cuánto suma a lo que debe el cliente: + venta, - cobro, 0 si no toca Deudores. */
export function efectoCliente(op, cuentasDeu) {
  if (op.anulada_at) return 0;
  const t = Number(op.total_ars) || 0;
  if (cuentasDeu.has(op.cuenta_debe)) return t;
  if (cuentasDeu.has(op.cuenta_haber)) return -t;
  return 0;
}

/**
 * Saldo de cada cliente (los activos de la lista aunque no tengan movimientos,
 * y los nombres escritos que no están en la lista).
 * @returns {{ clave: string, cliente_id: number|null, nombre: string, vendido: number, cobrado: number, saldo: number, ultimo: string }[]}
 */
export function saldosClientes(ops = [], cuentasDeu, clientes = []) {
  const indice = indiceClientes(clientes);
  const por = new Map();
  for (const c of clientes) {
    if (c.activo === false) continue;
    por.set(`c${c.id}`, { clave: `c${c.id}`, cliente_id: Number(c.id), nombre: c.nombre, vendido: 0, cobrado: 0, saldo: 0, ultimo: "" });
  }
  for (const op of ops) {
    const ef = efectoCliente(op, cuentasDeu);
    if (!ef) continue;
    const clave = claveCliente(op, indice);
    if (!clave) continue;
    const s = por.get(clave) || { clave, cliente_id: null, nombre: txt(op.entidad, 120), vendido: 0, cobrado: 0, saldo: 0, ultimo: "" };
    if (ef > 0) s.vendido += ef; else s.cobrado -= ef;
    s.saldo += ef;
    if (op.fecha > s.ultimo) s.ultimo = op.fecha;
    por.set(clave, s);
  }
  return [...por.values()]
    .map((s) => ({ ...s, vendido: centavos(s.vendido), cobrado: centavos(s.cobrado), saldo: centavos(s.saldo) }))
    .sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre));
}

/** Movimientos de un cliente, del más viejo al más nuevo, con el saldo renglón por renglón. */
export function movimientosCliente(ops = [], clave, cuentasDeu, clientes = []) {
  const indice = indiceClientes(clientes);
  let saldo = 0;
  return ops
    .filter((op) => efectoCliente(op, cuentasDeu) && claveCliente(op, indice) === clave)
    .sort((a, b) => (a.fecha === b.fecha ? Number(a.id) - Number(b.id) : a.fecha < b.fecha ? -1 : 1))
    .map((op) => {
      const ef = efectoCliente(op, cuentasDeu);
      saldo = centavos(saldo + ef);
      return { op, venta: ef > 0 ? ef : 0, cobro: ef < 0 ? -ef : 0, saldo };
    });
}

/** Por OT: lo vendido, lo cobrado y lo que falta (solo los movimientos con OT). */
export function saldoPorOt(movimientos = []) {
  const por = new Map();
  for (const m of movimientos) {
    const id = m.op.proyecto_id;
    if (!id) continue;
    const s = por.get(id) || { proyecto_id: id, vendido: 0, cobrado: 0, falta: 0 };
    s.vendido += m.venta;
    s.cobrado += m.cobro;
    s.falta += m.venta - m.cobro;
    por.set(id, s);
  }
  return [...por.values()].map((s) => ({ ...s, vendido: centavos(s.vendido), cobrado: centavos(s.cobrado), falta: centavos(s.falta) }));
}

/** El cliente de la lista con ese nombre o alias (sin mayúsculas, puntos ni espacios), o null. */
export function emparejarCliente(nombre, clientes = []) {
  const k = claveNombre(nombre);
  if (!k) return null;
  const vivos = clientes.filter((c) => c.activo !== false);
  const nombres = (c) => [c.nombre, ...(c.alias || [])].map(claveNombre).filter(Boolean);
  return vivos.find((c) => nombres(c).includes(k))
    // "STOM" y "STOM SAS": uno empieza con el otro (desde 4 letras)
    || vivos.find((c) => nombres(c).some((q) => q.length >= 4 && k.length >= 4 && (q.startsWith(k) || k.startsWith(q))))
    || null;
}

/**
 * El cliente de una OT (auditoría del 12/11, parte 6; migración 184): manda el
 * de la OT. Si la OT ya quedó unida a un cliente (proyectos.cliente_id), ese
 * (o al que se unió); si no, el que corresponde al nombre del Plan de trabajo.
 * @returns {number|null} id de fin_clientes
 */
export function clienteDeOt(p, clientes = [], indice = indiceClientes(clientes)) {
  const id = Number(p?.cliente_id);
  if (id && clientes.some((c) => Number(c.id) === id)) return indice.destino(id);
  const c = emparejarCliente(p?.cliente, clientes);
  return c ? indice.destino(c.id) : null;
}

/** Saldo de cada cliente en el libro hasta la fecha de corte (lo que nos debe; negativo = a favor). */
export function saldosClientesDelLibro(grilla, hasta, cuentasDeu) {
  // Misma cuenta que proveedores pero al revés: al debe sube lo que nos deben
  const r = saldosDelLibro(grilla, hasta, cuentasDeu);
  return {
    ...(r.error ? { error: r.error } : {}),
    filas: r.filas.map((f) => ({ nombre: f.nombre, vendido: f.pagado, cobrado: f.comprado, saldo: centavos(-f.deuda), ultimo: f.ultimo, variantes: f.variantes }))
      .sort((a, b) => b.saldo - a.saldo),
  };
}

/** La operación de saldo inicial de un cliente: Deudores por Ventas contra Ajuste De Capital. */
export function operacionSaldoInicialCliente({ fecha, cliente, saldo }, { cuentaDeudores, cuentaAjuste }) {
  const total = centavos(Math.abs(saldo));
  return {
    fecha, tipo: TIPO_SALDO_INICIAL, proveedor_id: null, cliente_id: Number(cliente.id), entidad: txt(cliente.nombre, 120),
    neto: total, iva: 0, otros_impuestos: 0, total, moneda: "ARS", tipo_cambio: null, total_ars: total,
    cuenta_debe: saldo > 0 ? cuentaDeudores : cuentaAjuste,
    cuenta_haber: saldo > 0 ? cuentaAjuste : cuentaDeudores,
    descripcion: `Saldo inicial al ${fechaAr(fecha)}, copiado del libro`,
    origen: ORIGEN_SALDO_INICIAL, origen_id: `c${cliente.id}`, estado: "confirmada",
  };
}

/** Los nombres de cliente de las OT que todavía no están en la lista (uno por nombre). */
export function clientesNuevosDeOt(proyectos = [], clientes = []) {
  const vistos = new Set();
  const nuevos = [];
  for (const p of proyectos) {
    const nombre = txt(p.cliente, 120);
    const k = claveNombre(nombre);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    if (!emparejarCliente(nombre, clientes)) nuevos.push(nombre);
  }
  return nuevos.sort((a, b) => a.localeCompare(b));
}

/** Los datos de un cliente nuevo o editado. */
export function validarCliente(f = {}) {
  const errores = [];
  const nombre = txt(f.nombre, 120);
  if (!nombre) errores.push("Falta el nombre");
  const email = txt(f.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errores.push("Revisá el email");
  const alias = [...new Set((Array.isArray(f.alias) ? f.alias : []).map((a) => txt(a, 120)).filter((a) => a && claveNombre(a) !== claveNombre(nombre)))];
  if (alias.length > MAX_ALIAS) errores.push(`Hasta ${MAX_ALIAS} nombres más`);
  if (errores.length) return { errores };
  return {
    errores,
    cliente: { nombre, cuit: txt(f.cuit, 20) || null, telefono: txt(f.telefono, 40) || null, email: email || null, notas: txt(f.notas, 500) || null, alias },
  };
}

/** Unir b a a: a se queda con el nombre y los alias de b; b queda inactivo. */
export function unirClientes(a, b) {
  const alias = [...new Set([...(a.alias || []), b.nombre, ...(b.alias || [])].map((x) => txt(x, 120)).filter((x) => x && claveNombre(x) !== claveNombre(a.nombre)))].slice(0, MAX_ALIAS);
  return { a: { alias }, b: { activo: false, unido_a: Number(a.id) } };
}

/**
 * Un cobro con una o varias formas de pago.
 * @param {{ fecha: string, proyecto_id?: any, notas?: string, formas: object[] }} f
 * @param {{ cliente: object, cuentas: object[], tesoreria: object[], proyectos?: object[], grupo: string }} ctx
 * @returns {{ errores: string[], ops?: object[], cheques?: { cheque: object, op: object }[], total?: number }}
 *   cheques: el cheque a dar de alta y su operación (le falta el id del cheque)
 */
export function armarCobro(f = {}, { cliente, cuentas = [], tesoreria = [], proyectos = [], clientes = [], grupo }) {
  const errores = [];
  if (!cliente || cliente.activo === false) errores.push("Elegí el cliente");
  if (!FECHA.test(String(f.fecha || ""))) errores.push("Falta la fecha");
  const deudores = [...cuentasDeudores(cuentas)][0];
  const ajuste = cuentas.find((c) => CUENTA_AJUSTE_CAPITAL.test(String(c.nombre || "").trim()))?.codigo;
  if (!deudores) errores.push("Falta la cuenta \"Deudores por Ventas\" en el plan de cuentas");
  const proyectoId = f.proyecto_id ? Number(f.proyecto_id) : null;
  const proyecto = proyectoId ? proyectos.find((p) => Number(p.id) === proyectoId) : null;
  if (proyectoId && !proyecto) errores.push("Esa OT no está en la lista");
  // Manda el cliente de la OT (parte 6): el cobro de una OT va a su cliente
  if (proyecto && cliente && clientes.length) {
    const indice = indiceClientes(clientes);
    const deOt = clienteDeOt(proyecto, clientes, indice);
    if (deOt && deOt !== indice.destino(cliente.id)) {
      const nombre = clientes.find((c) => Number(c.id) === deOt)?.nombre || "otro cliente";
      errores.push(`La OT ${proyecto.ot} es de ${nombre}: cargá el cobro a ese cliente o sacá la OT`);
    }
  }
  const formas = Array.isArray(f.formas) ? f.formas.slice(0, 10) : [];
  if (!formas.length) errores.push("Falta cómo pagó");
  const vivas = tesoreria.filter((t) => t.activa !== false);
  const nota = txt(f.notas, 200);
  const ops = [];
  const cheques = [];
  let total = 0;
  const base = (extra) => ({
    fecha: f.fecha, proveedor_id: null, cliente_id: cliente ? Number(cliente.id) : null, entidad: cliente ? txt(cliente.nombre, 120) : null,
    proyecto_id: proyectoId, iva: 0, otros_impuestos: 0, origen: ORIGEN_COBRO, estado: "confirmada", referencia: null, ...extra,
  });
  const desc = (forma) => txt(`Cobro a ${cliente?.nombre || ""} · ${forma}${nota ? ` · ${nota}` : ""}`, 500);
  formas.forEach((x, i) => {
    const n = formas.length > 1 ? `Forma ${i + 1}: ` : "";
    const forma = FORMAS_COBRO[x?.forma] ? x.forma : null;
    if (!forma) { errores.push(`${n}elegí cómo pagó`); return; }
    const importe = centavos(x.importe);
    if (!(importe > 0) || importe >= 1e13) { errores.push(`${n}el importe tiene que ser mayor a cero`); return; }
    if (forma === "cheque") {
      const { cheque, errores: e } = validarCheque({
        clase: "tercero", tipo: x.tipo_cheque, banco: x.banco, numero: x.numero, librador: x.librador || cliente?.nombre,
        fecha_emision: f.fecha, fecha_pago: x.fecha_pago, importe, recibido_de: cliente?.nombre, notas: nota,
      }, { tesoreria });
      if (e.length) { errores.push(`${n}${e[0]}`); return; }
      cheques.push({ cheque, op: base({ tipo: "COBRO A CLIENTES", origen_id: `${grupo}:${i}`, descripcion: desc(`${TIPOS_CHEQUE[cheque.tipo]} ${cheque.banco}${cheque.numero ? ` N° ${cheque.numero}` : ""}`) }) });
      total += importe;
      return;
    }
    const caja = vivas.find((t) => t.cuenta === x.cuenta);
    if (forma === "dolares") {
      if (!caja || caja.moneda !== "USD") { errores.push(`${n}elegí la caja o el banco en dólares`); return; }
      const tc = Number(x.tipo_cambio);
      if (!(tc > 0)) { errores.push(`${n}falta el tipo de cambio`); return; }
      if (!ajuste) { errores.push("Falta la cuenta \"Ajuste De Capital\" en el plan de cuentas"); return; }
      const pesos = centavos(importe * tc);
      const tipo = "COBRO A CLIENTES";
      const d = desc(`USD ${usd(importe)} x $${usd(tc)}`);
      // Como en el libro: los dólares entran a la caja y el cliente baja en pesos
      ops.push(base({ tipo, neto: importe, total: importe, moneda: "USD", tipo_cambio: tc, total_ars: pesos, cuenta_debe: caja.cuenta, cuenta_haber: ajuste, origen_id: `${grupo}:${i}a`, descripcion: d }));
      ops.push(base({ tipo, neto: pesos, total: pesos, moneda: "ARS", tipo_cambio: null, total_ars: pesos, cuenta_debe: ajuste, cuenta_haber: deudores, origen_id: `${grupo}:${i}b`, descripcion: d }));
      total += pesos;
      return;
    }
    const tipoCaja = forma === "efectivo" ? "caja" : null;
    if (!caja || caja.moneda === "USD" || (tipoCaja && caja.tipo !== "caja") || (!tipoCaja && caja.tipo === "caja")) {
      errores.push(`${n}${forma === "efectivo" ? "elegí la caja donde entró" : "elegí el banco donde entró"}`);
      return;
    }
    ops.push(base({
      tipo: "COBRO A CLIENTES", neto: importe, total: importe, moneda: "ARS", tipo_cambio: null, total_ars: importe,
      cuenta_debe: caja.cuenta, cuenta_haber: deudores, origen_id: `${grupo}:${i}`, descripcion: desc(`${FORMAS_COBRO[forma]} a ${caja.nombre}`),
    }));
    total += importe;
  });
  if (errores.length) return { errores };
  return { errores, ops, cheques, total: centavos(total) };
}
