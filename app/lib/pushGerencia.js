// app/lib/pushGerencia.js — Aviso al celular para gerencial y administrativo
// de una empresa (Firebase Cloud Messaging). Lo usa el cron del reporte del
// día (parte 26). Sin credenciales de Firebase no manda nada y no falla.
import admin from "firebase-admin";
import { sbGetAll, sbDelete } from "./sbHelpers";
import { logger } from "./logger";

function appFirebase() {
  if (admin.apps.length > 0) return admin.app();
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const raw = rawJson || (rawB64 ? Buffer.from(rawB64, "base64").toString("utf-8") : null);
  if (!raw) return null;
  return admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

const TOKEN_MUERTO = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/mismatched-credential",
  "messaging/invalid-argument",
]);

/**
 * @param {string} empresaId
 * @param {{ title: string, body: string, data?: Record<string, string> }} mensaje
 * @param {{ messaging?: { send: Function } }} [opts] para pruebas
 * @returns {Promise<number>} avisos entregados
 */
export async function enviarPushGerencia(empresaId, { title, body, data = {} }, { messaging } = {}) {
  let envio = messaging;
  if (!envio) {
    try {
      const app = appFirebase();
      if (!app) return 0;
      envio = admin.messaging(app);
    } catch (e) {
      logger.error("[pushGerencia] Firebase no configurado", e);
      return 0;
    }
  }
  const { data: gerencia } = await sbGetAll(`empleados?empresa_id=eq.${empresaId}&rol=in.(gerencial,administrativo)&activo=eq.true&select=legajo&order=legajo.asc`);
  if (!gerencia.length) return 0;
  const { data: tokens } = await sbGetAll(`push_tokens?empresa_id=eq.${empresaId}&legajo=in.(${gerencia.map((e) => e.legajo).join(",")})&select=token&order=token.asc`);
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
