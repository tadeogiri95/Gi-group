// app/lib/finanzasPases.js — Mi caja: pasar plata de una persona a otra
// (pedido 10/11). Ezequiel anota "Le pasé $200.000 a Mayco"; a Mayco le
// llega un aviso y en su Mi caja confirma "Sí, la recibí" o "No la recibí".
//
//   - Mientras Mayco no confirma no se anota nada: ni cambia un saldo ni
//     baja al libro. El pase pendiente vive en config_sistema
//     (finanzas_pases_caja = { pases: [...] }), sin migración.
//   - Cuando Mayco confirma se crea la TRANSFERENCIA ENTRE CAJAS (la caja de
//     Mayco al debe, la de Ezequiel al haber), confirmada: los dos están de
//     acuerdo y no le queda al dueño para revisar.
//   - Si Mayco dice que no la recibió no se anota nada y se avisa a
//     Ezequiel y a los dueños. Ezequiel puede cancelar el suyo mientras
//     está pendiente.
//   - Solo entre cajas de la misma moneda, activas y con responsable.
import { validarTransferencia } from "./finanzasTesoreria";

export const CLAVE_PASES = "finanzas_pases_caja";
export const ORIGEN_PASE = "mi_caja_pase";
// Los resueltos se guardan un tiempo para el historial; los pendientes, siempre
const MAX_RESUELTOS = 200;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** La lista guardada, limpia. */
export function leerPases(valor) {
  const lista = Array.isArray(valor?.pases) ? valor.pases : [];
  return lista.filter((p) => p && typeof p === "object" && p.id && p.desde && p.hacia);
}

/** Guarda la lista: todos los pendientes y los últimos resueltos. */
export function guardarPases(pases = []) {
  const pendientes = pases.filter((p) => p.estado === "pendiente");
  const resueltos = pases.filter((p) => p.estado !== "pendiente")
    .sort((a, b) => String(b.resuelto_at || "").localeCompare(String(a.resuelto_at || "")))
    .slice(0, MAX_RESUELTOS);
  return { pases: [...pendientes, ...resueltos] };
}

/** A qué cajas le puede pasar plata: las de otras personas, activas y de la misma moneda. */
export function destinosPase(caja, tesoreria = [], personal = []) {
  if (!caja) return [];
  const nombre = new Map(personal.map((p) => [p.id, p.nombre]));
  return tesoreria
    .filter((t) => t.activa !== false && t.responsable_id && t.cuenta !== caja.cuenta && t.responsable_id !== caja.responsable_id)
    .filter((t) => (t.moneda === "USD") === (caja.moneda === "USD"))
    .map((t) => ({ cuenta: t.cuenta, nombre: t.nombre, moneda: t.moneda === "USD" ? "USD" : "ARS", responsable_id: t.responsable_id, persona: nombre.get(t.responsable_id) || t.nombre }))
    .sort((a, b) => a.persona.localeCompare(b.persona, "es"));
}

/**
 * Un pase nuevo, pendiente de que el otro confirme.
 * @returns {{ pase?: object, errores: string[] }}
 */
export function validarPase(f = {}, { caja, destinos = [], quien = null, hoy, id, ahora } = {}) {
  const errores = [];
  if (!caja) errores.push("Esa caja no está a tu cargo");
  const hacia = destinos.find((d) => d.cuenta === f.hacia);
  if (!hacia) errores.push("Elegí a quién le pasaste la plata");
  const importe = centavos(f.importe);
  if (!(importe > 0) || importe >= 1e11) errores.push("El importe tiene que ser mayor a cero");
  if (!FECHA.test(String(f.fecha || ""))) errores.push("Falta la fecha");
  else if (hoy && f.fecha > hoy) errores.push("La fecha no puede ser más adelante que hoy");
  const usd = caja?.moneda === "USD";
  const tc = usd ? Number(f.tipo_cambio) : null;
  if (usd && !(tc > 0)) errores.push("En dólares falta el tipo de cambio");
  if (errores.length) return { errores };
  return {
    errores,
    pase: {
      id, estado: "pendiente", fecha: f.fecha, importe, moneda: usd ? "USD" : "ARS", tipo_cambio: tc,
      desde: caja.cuenta, desde_nombre: caja.nombre, de_id: caja.responsable_id || null, de_nombre: quien,
      hacia: hacia.cuenta, hacia_nombre: hacia.nombre, para_id: hacia.responsable_id, para_nombre: hacia.persona,
      nota: txt(f.descripcion, 200), creado_at: ahora,
    },
  };
}

/** La TRANSFERENCIA ENTRE CAJAS que queda cuando el que recibe confirma. */
export function operacionDePase(pase, tesoreria = []) {
  const { op, errores } = validarTransferencia({
    desde: pase.desde, hacia: pase.hacia, importe: pase.importe, fecha: pase.fecha, tipo_cambio: pase.tipo_cambio,
    descripcion: pase.nota || "",
  }, tesoreria);
  if (!op) return { errores };
  return { errores, op: { ...op, origen: ORIGEN_PASE, origen_id: String(pase.id).slice(0, 60), estado: "confirmada" } };
}

/** Lo que ve cada uno: lo que le pasaron y espera su sí, y lo que pasó él y espera al otro. */
export function pasesDe(pases = [], cuentas = []) {
  const mias = new Set(cuentas);
  const pend = pases.filter((p) => p.estado === "pendiente");
  const vista = (p) => ({ id: p.id, fecha: p.fecha, importe: p.importe, moneda: p.moneda, nota: p.nota || "", de_nombre: p.de_nombre || p.desde_nombre, para_nombre: p.para_nombre || p.hacia_nombre, desde: p.desde, hacia: p.hacia });
  return {
    para_confirmar: pend.filter((p) => mias.has(p.hacia)).map(vista),
    esperando: pend.filter((p) => mias.has(p.desde) && !mias.has(p.hacia)).map(vista),
  };
}
