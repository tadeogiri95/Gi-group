// app/lib/colaOffline.js — Cola en el celular de lo que se hizo sin conexión
// (F4-05, ítem 21): fichar y tareas. Se envía en orden cuando vuelve la señal.
//
// Se guarda en localStorage y no en IndexedDB: son pocas operaciones chicas,
// se leen y escriben de forma sincrónica (sin carreras entre pestañas al
// encolar) y localStorage sobrevive igual al cierre de la app.
import { getToken, getCsrfToken } from "./supabase";
import { horaLocal } from "./offline";

const CLAVE = "gypi_cola_offline";
const CLAVE_FALLIDAS = "gypi_cola_fallidas";
const oyentes = new Set();
let sincronizando = false;

function leer(clave) {
  try { return JSON.parse(localStorage.getItem(clave) || "[]"); } catch { return []; }
}
function escribir(clave, lista) {
  try { localStorage.setItem(clave, JSON.stringify(lista)); } catch { /* sin almacenamiento */ }
  oyentes.forEach((fn) => { try { fn(); } catch { /* oyente roto */ } });
}

export function nuevoOpId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Respaldo para navegadores viejos (UUID v4 con Math.random)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Operaciones sin enviar de este empleado, en orden. */
export function pendientes(empleadoId) {
  return leer(CLAVE).filter((op) => op.empleado_id === empleadoId);
}

/** Operaciones que el servidor rechazó al enviarlas (para mostrarle al empleado). */
export function fallidas(empleadoId) {
  return leer(CLAVE_FALLIDAS).filter((op) => op.empleado_id === empleadoId);
}

export function descartarFallida(opId) {
  escribir(CLAVE_FALLIDAS, leer(CLAVE_FALLIDAS).filter((op) => op.op_id !== opId));
}

export function suscribir(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export function estaSincronizando() {
  return sincronizando;
}

function encolar(op) {
  escribir(CLAVE, [...leer(CLAVE), op]);
}

/** Envío por defecto: POST con la sesión del celular. Tira si no hay red. */
export async function enviarPorDefecto(op) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;
  const res = await fetch(op.url, { method: "POST", headers, credentials: "include", body: JSON.stringify(op.body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Rechazos que igual dejan las cosas como el empleado quería
const YA_ESTABA = new Set(["ya_fichado"]);

/** "ok" | "reintentar" | "rechazada" */
export function clasificar({ status, data }) {
  if (status === 401 || status === 429 || status >= 500) return "reintentar";
  if (data?.ok || YA_ESTABA.has(data?.tipo)) return "ok";
  return "rechazada";
}

/**
 * Manda lo pendiente de este empleado, en orden. Corta en el primer error de
 * red (o sesión vencida / servidor caído) y sigue en la próxima. Lo que el
 * servidor rechaza pasa a "fallidas" con el motivo.
 * @returns {Promise<{ enviadas: number, rechazadas: number, quedan: number }>}
 */
export async function sincronizar(empleadoId, enviar = enviarPorDefecto) {
  if (sincronizando || !empleadoId) return { enviadas: 0, rechazadas: 0, quedan: pendientes(empleadoId).length };
  sincronizando = true;
  escribir(CLAVE, leer(CLAVE)); // avisa a la UI que empezó
  let enviadas = 0, rechazadas = 0;
  try {
    for (const op of pendientes(empleadoId)) {
      let r;
      try { r = await enviar(op); } catch { break; } // sin red: queda para después
      const c = clasificar(r);
      if (c === "reintentar") break;
      escribir(CLAVE, leer(CLAVE).filter((x) => x.op_id !== op.op_id));
      if (c === "ok") enviadas++;
      else {
        rechazadas++;
        escribir(CLAVE_FALLIDAS, [...leer(CLAVE_FALLIDAS), { ...op, error: r.data?.error || "El servidor no lo aceptó." }]);
      }
    }
  } finally {
    sincronizando = false;
    escribir(CLAVE, leer(CLAVE));
  }
  return { enviadas, rechazadas, quedan: pendientes(empleadoId).length };
}

/**
 * Envía ahora o, si no hay conexión (o ya hay cosas esperando, para respetar
 * el orden), lo guarda con la hora en que se hizo.
 * @param {{ empleadoId: string, tipo: string, url: string, body: object, enviar?: Function, paraCola?: (body: object) => object }} p
 * @returns {Promise<{ encolado: true, op: object } | { encolado: false, status: number, data: object }>}
 */
export async function enviarOEncolar({ empleadoId, tipo, url, body, enviar = enviarPorDefecto, paraCola = (b) => b }) {
  const op = { op_id: nuevoOpId(), empleado_id: empleadoId, tipo, url, creado_en: new Date().toISOString() };
  const guardar = () => {
    const o = { ...op, body: { ...paraCola(body), op_id: op.op_id, momento: op.creado_en } };
    encolar(o);
    return { encolado: true, op: o };
  };
  const sinRed = typeof navigator !== "undefined" && navigator.onLine === false;
  if (sinRed || pendientes(empleadoId).length > 0) {
    const r = guardar();
    if (!sinRed) sincronizar(empleadoId, enviar).catch(() => {});
    return r;
  }
  try {
    const r = await enviar({ ...op, body: { ...body, op_id: op.op_id } });
    return { encolado: false, ...r };
  } catch {
    return guardar();
  }
}

/** "08:15" de una operación guardada (hora local de Argentina). */
export function horaDeOp(op) {
  return horaLocal(undefined, new Date(op.creado_en)).hora;
}

/** Fichada de hoy contando las fichadas que todavía no se enviaron. */
export function fichadaConPendientes(fichadaHoy, pendientesFichar, hoy) {
  let f = fichadaHoy ? { ...fichadaHoy } : null;
  for (const op of pendientesFichar) {
    if (op.tipo !== "fichar") continue;
    const { fecha, hora } = horaLocal(undefined, new Date(op.creado_en));
    if (op.body?.accion === "ingreso" && fecha === hoy && !f?.ingreso) f = { ...(f || {}), fecha, ingreso: `${hora}:00`, sinEnviar: true };
    if (op.body?.accion === "egreso" && f?.ingreso && !f.egreso) f = { ...f, egreso: `${hora}:00`, sinEnviar: true };
  }
  return f;
}
