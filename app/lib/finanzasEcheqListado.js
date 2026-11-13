// app/lib/finanzasEcheqListado.js — Finanzas, parte 6 del plan de Tesorería
// (13/11): el listado de e-cheq que baja el banco (Lista_de_ECHEQ.xls) pone
// al día 🏦 Cheques. Migración 189: fin_cheques.id_banco guarda el
// "Id. Cheque" del banco, la llave para no repetir.
//
// Reglas:
//   - Emitidos y recibidos se separan por la cuenta del emisor: la propia es
//     la que más cheques emitió sin endoso (se puede cambiar en pantalla).
//   - Cada cheque se busca primero por Id. Cheque; si no está, por número y
//     monto entre los de Gypi sin Id. (cargados a mano, del libro o de una
//     orden de pago).
//   - El estado del banco se traduce así:
//       ACTIVO     emitido: por debitar   recibido: en cartera, o entregado si se endosó
//       PAGADO     emitido: debitado      recibido: depositado, o entregado si se endosó
//       RECHAZADO  rechazado              ANULADO  anulado
//       CUSTODIA   emitido: por debitar   recibido: en cartera
//     Un recibido está endosado si "Endosado A" es otro CUIT que el de la
//     empresa.
//   - Cada cheque queda "igual", "cambia" (de estado o solo se une con el del
//     banco), "nuevo" (se suma sin operación, como lo copiado del libro: lo
//     ya pagado o cobrado ya está en los movimientos) o "no" (un cambio que
//     no se puede hacer solo: se hace a mano desde el cheque).
import { importeAr, fechaExtracto } from "./finanzasExtracto";
import { ACCIONES, ESTADOS_CHEQUE } from "./finanzasCheques";

export const MAX_LISTADO = 2000;
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const clave = (s) => txt(s, 300).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const soloDigitos = (s) => String(s ?? "").replace(/\D/g, "");
/** "30-71446707-3" → "30714467073". */
export const cuitLimpio = (s) => soloDigitos(s).slice(0, 11);
const numeroLimpio = (s) => soloDigitos(s).replace(/^0+/, "");
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

const COLUMNAS = {
  numero: ["NRODECHEQUE", "NUMERODECHEQUE", "NRO"],
  fecha_pago: ["FECHADEPAGO"],
  fecha_mod: ["FECHAULTMODIFICACION", "FECHAULTIMAMODIFICACION"],
  moneda: ["MONEDA"],
  monto: ["MONTO", "IMPORTE"],
  cuenta_emisor: ["CUENTAEMISOR"],
  beneficiario: ["BENEFICIARIO"],
  cuit_beneficiario: ["CUITCUILCDI", "CUITBENEFICIARIO"],
  motivo: ["MOTIVO"],
  id_banco: ["IDCHEQUE"],
  endosado_a: ["ENDOSADOA"],
  cuit_endosatario: ["CUITENDOSATARIO"],
  banco: ["BANCO"],
  estado_banco: ["ESTADO"],
};

/**
 * Lee la grilla del listado del banco.
 * @returns {{ cheques: object[], error?: string }}
 */
export function leerListadoEcheq(grilla = []) {
  const fila = grilla.findIndex((r) => (r || []).some((c) => clave(c) === "IDCHEQUE"));
  if (fila < 0) return { cheques: [], error: "Ese archivo no es el listado de e-cheq del banco: no tiene la columna \"Id. Cheque\"." };
  const titulos = grilla[fila].map(clave);
  const col = Object.fromEntries(Object.entries(COLUMNAS).map(([k, nombres]) => [k, titulos.findIndex((t) => nombres.includes(t))]));
  const faltan = ["numero", "fecha_pago", "monto", "cuenta_emisor", "id_banco", "estado_banco"].filter((k) => col[k] < 0);
  if (faltan.length) return { cheques: [], error: `Al listado le faltan columnas: ${faltan.join(", ")}.` };
  const dato = (r, k) => (col[k] >= 0 ? r[col[k]] : "");
  const vistos = new Set();
  const cheques = [];
  for (const r of grilla.slice(fila + 1)) {
    const id = txt(dato(r, "id_banco"), 40).toUpperCase();
    if (!id || vistos.has(id)) continue;
    const monto = importeAr(dato(r, "monto"));
    const fecha = fechaExtracto(txt(dato(r, "fecha_pago")));
    if (!(monto > 0) || !fecha) continue;
    if (/D[OÓ]LAR|USD|U\$S/i.test(txt(dato(r, "moneda")))) continue;
    vistos.add(id);
    cheques.push({
      id_banco: id,
      numero: txt(dato(r, "numero"), 40),
      fecha_pago: fecha,
      fecha_mod: fechaExtracto(txt(dato(r, "fecha_mod"))) || null,
      monto: centavos(monto),
      cuenta_emisor: txt(dato(r, "cuenta_emisor"), 40),
      beneficiario: txt(dato(r, "beneficiario")),
      cuit_beneficiario: cuitLimpio(dato(r, "cuit_beneficiario")),
      motivo: txt(dato(r, "motivo"), 120),
      endosado_a: txt(dato(r, "endosado_a")),
      cuit_endosatario: cuitLimpio(dato(r, "cuit_endosatario")),
      banco: txt(dato(r, "banco"), 60),
      estado_banco: txt(dato(r, "estado_banco"), 20).toUpperCase(),
    });
    if (cheques.length >= MAX_LISTADO) break;
  }
  if (!cheques.length) return { cheques: [], error: "No encontré cheques en el listado." };
  return { cheques };
}

/** La cuenta propia: la que más cheques emitió sin endoso. */
export function cuentaPropiaDe(cheques = []) {
  const n = new Map();
  for (const c of cheques) if (!c.endosado_a && c.cuenta_emisor) n.set(c.cuenta_emisor, (n.get(c.cuenta_emisor) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

/** Las cuentas emisoras con cuántos cheques tiene cada una (para elegir la propia). */
export function cuentasEmisoras(cheques = []) {
  const n = new Map();
  for (const c of cheques) if (c.cuenta_emisor) n.set(c.cuenta_emisor, (n.get(c.cuenta_emisor) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).map(([cuenta, cantidad]) => ({ cuenta, cantidad }));
}

/** El estado de Gypi que corresponde al del banco. */
export function estadoDelBanco(c, clase, cuitEmpresa) {
  const endosado = clase === "tercero" && Boolean(c.cuit_endosatario) && c.cuit_endosatario !== cuitLimpio(cuitEmpresa);
  switch (c.estado_banco) {
    case "ACTIVO": return clase === "propio" ? "pendiente" : endosado ? "entregado" : "en_cartera";
    case "PAGADO": return clase === "propio" ? "debitado" : endosado ? "entregado" : "depositado";
    case "RECHAZADO": return "rechazado";
    case "ANULADO": return "anulado";
    case "CUSTODIA": return clase === "propio" ? "pendiente" : "en_cartera";
    default: return null;
  }
}

/** El proveedor del endoso (o del cheque emitido), por CUIT y si no por nombre. */
export function proveedorDe(cuit, nombre, proveedores = []) {
  const c = cuitLimpio(cuit);
  if (c) {
    const p = proveedores.find((x) => cuitLimpio(x.cuit) === c);
    if (p) return p;
  }
  const k = clave(nombre);
  return k ? proveedores.find((x) => clave(x.nombre) === k) || null : null;
}

/** ¿Se puede pasar el cheque de un estado al otro con una acción de Cheques? Devuelve la acción o null. */
export function accionPara(ch, estado) {
  const posibles = ACCIONES[ch.clase]?.[ch.estado] || [];
  const accion = estado === "anulado" ? "anular" : estado;
  return posibles.includes(accion) ? accion : null;
}

/**
 * Qué pasa con cada cheque del listado.
 * @param {object[]} listado de leerListadoEcheq
 * @param {object[]} gypi los cheques de Gypi (con id_banco)
 * @param {{ cuentaPropia: string, cuitEmpresa?: string, proveedores?: object[] }} ctx
 * @returns {{ filas: { c, clase, estado, cheque, que: "igual"|"cambia"|"nuevo"|"no", accion?: string|null, proveedor?: object|null, texto: string }[] }}
 */
export function planListado(listado = [], gypi = [], { cuentaPropia = "", cuitEmpresa = "", proveedores = [] } = {}) {
  const porId = new Map(gypi.filter((g) => g.id_banco).map((g) => [String(g.id_banco).toUpperCase(), g]));
  const usados = new Set();
  const filas = listado.map((c) => {
    const clase = c.cuenta_emisor === cuentaPropia ? "propio" : "tercero";
    const estado = estadoDelBanco(c, clase, cuitEmpresa);
    let cheque = porId.get(c.id_banco) || null;
    if (!cheque) {
      cheque = gypi.find((g) => !g.id_banco && !usados.has(g.id) && g.clase === clase
        && numeroLimpio(g.numero) && numeroLimpio(g.numero) === numeroLimpio(c.numero)
        && Math.abs(centavos(g.importe) - c.monto) < 0.01) || null;
    }
    if (cheque) usados.add(cheque.id);
    const proveedor = estado === "entregado" ? proveedorDe(c.cuit_endosatario, c.endosado_a, proveedores)
      : clase === "propio" ? proveedorDe(c.cuit_beneficiario, c.beneficiario, proveedores) : null;
    const nombre = ESTADOS_CHEQUE[estado]?.nombre || c.estado_banco;
    if (!estado) return { c, clase, estado, cheque, que: "no", texto: `El banco dice "${c.estado_banco}": no sé qué es. Revisalo a mano.` };
    if (!cheque) return { c, clase, estado, cheque, proveedor, que: "nuevo", texto: `Se suma como ${nombre.toLowerCase()}${estado === "entregado" ? ` a ${proveedor?.nombre || c.endosado_a}` : ""}` };
    const unir = !cheque.id_banco;
    if (cheque.estado === estado) return { c, clase, estado, cheque, que: unir ? "cambia" : "igual", accion: null, texto: unir ? "Se une con el del banco (mismo estado)" : "Ya estaba igual" };
    const accion = accionPara(cheque, estado);
    if (!accion) {
      return { c, clase, estado, cheque, que: "no", accion: null, texto: `En Gypi está ${ESTADOS_CHEQUE[cheque.estado]?.nombre.toLowerCase() || cheque.estado} y el banco dice ${nombre.toLowerCase()}: ese cambio se hace a mano desde el cheque.` };
    }
    if (accion === "entregado" && !proveedor) {
      return { c, clase, estado, cheque, que: "no", accion: null, texto: `Se endosó a ${c.endosado_a || "alguien"}, que no está en Proveedores: cargalo ahí y volvé a subir el listado.` };
    }
    return { c, clase, estado, cheque, proveedor, que: "cambia", accion, texto: `${ESTADOS_CHEQUE[cheque.estado]?.nombre || cheque.estado} → ${nombre}${accion === "entregado" ? ` a ${proveedor.nombre}` : ""}` };
  });
  return { filas };
}

/** El cheque nuevo de Gypi para un renglón "nuevo" del listado (sin operación). */
export function chequeNuevo(f, { cuentaBanco = null } = {}) {
  const { c, clase, estado, proveedor } = f;
  return {
    origen: "listado", id_banco: c.id_banco, clase, tipo: "echeq_diferido", estado, estado_fecha: estado === "pendiente" || estado === "en_cartera" ? null : (c.fecha_mod || c.fecha_pago),
    banco: clase === "propio" ? txt(c.banco, 60) || null : null, numero: c.numero || null,
    librador: clase === "tercero" ? `Cuenta ${c.cuenta_emisor}`.slice(0, 120) : null,
    beneficiario: clase === "propio" ? c.beneficiario || null : null,
    proveedor_id: proveedor?.id ? Number(proveedor.id) : null,
    entregado_a: estado === "entregado" ? txt(proveedor?.nombre || c.endosado_a) || null : null,
    recibido_de: clase === "tercero" ? `Cuenta ${c.cuenta_emisor}`.slice(0, 120) : null,
    fecha_emision: null, fecha_pago: c.fecha_pago, importe: c.monto,
    cuenta_banco: clase === "propio" ? cuentaBanco : null,
    notas: txt(`Del listado de e-cheq del banco${c.motivo ? ` · ${c.motivo}` : ""}`, 300),
  };
}

/** Resumen para la pantalla: cuántos de cada cosa, por emitidos y recibidos. */
export function resumenListado(filas = []) {
  const r = { propio: 0, tercero: 0, igual: 0, cambia: 0, nuevo: 0, no: 0 };
  for (const f of filas) { r[f.clase]++; r[f.que]++; }
  return r;
}
