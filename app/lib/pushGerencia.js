// app/lib/pushGerencia.js — Aviso al celular para gerencial y administrativo
// de una empresa (Firebase Cloud Messaging). Lo usa el cron del reporte del
// día (parte 26) y el de la flota (parte 30). Sin credenciales de Firebase no manda nada y no falla.
// API modular: firebase-admin 14 sacó el espacio de nombres admin.*
import { getApps, getApp, initializeApp, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { sbGetAll, sbDelete } from "./sbHelpers";
import { logger } from "./logger";

function appFirebase() {
  if (getApps().length > 0) return getApp();
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const raw = rawJson || (rawB64 ? Buffer.from(rawB64, "base64").toString("utf-8") : null);
  if (!raw) return null;
  return initializeApp({ credential: cert(JSON.parse(raw)) });
}

const TOKEN_MUERTO = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/mismatched-credential",
  "messaging/invalid-argument",
]);

// Firebase, o null si no está configurado (entonces no se manda nada)
function obtenerEnvio(messaging) {
  if (messaging) return messaging;
  try {
    const app = appFirebase();
    return app ? getMessaging(app) : null;
  } catch (e) {
    logger.error("[pushGerencia] Firebase no configurado", e);
    return null;
  }
}

/**
 * @param {string} empresaId
 * @param {{ title: string, body: string, data?: Record<string, string> }} mensaje
 * @param {{ messaging?: { send: Function } }} [opts] para pruebas
 * @returns {Promise<number>} avisos entregados
 */
export async function enviarPushGerencia(empresaId, mensaje, { messaging } = {}) {
  const envio = obtenerEnvio(messaging);
  if (!envio) return 0;
  const { data: gerencia } = await sbGetAll(`empleados?empresa_id=eq.${empresaId}&rol=in.(gerencial,administrativo)&activo=eq.true&select=legajo&order=legajo.asc`);
  return enviarPushLegajos(empresaId, gerencia.map((e) => e.legajo), mensaje, { messaging: envio });
}

/**
 * Aviso al celular de ciertos legajos de la empresa (por ejemplo, el
 * responsable de un vehículo; Flota, parte 30).
 * @param {string} empresaId
 * @param {Array<string|number>} legajos
 * @param {{ title: string, body: string, data?: Record<string, string> }} mensaje
 * @param {{ messaging?: { send: Function } }} [opts] para pruebas
 * @returns {Promise<number>} avisos entregados
 */
export async function enviarPushLegajos(empresaId, legajos, { title, body, data = {} }, { messaging } = {}) {
  const lista = [...new Set((legajos || []).filter((l) => l !== null && l !== undefined && l !== ""))];
  if (!lista.length) return 0;
  const envio = obtenerEnvio(messaging);
  if (!envio) return 0;
  const { data: tokens } = await sbGetAll(`push_tokens?empresa_id=eq.${empresaId}&legajo=in.(${lista.map((l) => encodeURIComponent(String(l))).join(",")})&select=token&order=token.asc`);
  // FCM solo acepta textos en data
  const datos = Object.fromEntries(Object.entries({ empresa_id: empresaId, ...data }).map(([k, v]) => [k, String(v)]));
  let enviados = 0;
  const muertos = [];
  await Promise.allSettled([...new Set(tokens.map((t) => t.token))].map(async (token) => {
    try {
      await envio.send({
        token,
        notification: { title, body },
        data: datos,
        webpush: { notification: { icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" } },
      });
      enviados++;
    } catch (err) {
      if (TOKEN_MUERTO.has(err?.errorInfo?.code || err?.code)) muertos.push(token);
    }
  }));
  for (const token of muertos) {
    await sbDelete(`push_tokens?token=eq.${encodeURIComponent(token)}`, { silent: true }).catch(() => {});
  }
  return enviados;
}
