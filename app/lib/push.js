// ═══════════════════════════════════════════════════════════
// lib/push.js — Push Notifications (Bloque 4)
// Config Firebase desde NEXT_PUBLIC_* env vars
// ═══════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

let firebaseApp = null;
let messaging = null;

async function getMessaging() {
  if (messaging) return messaging;
  const { initializeApp, getApps } = await import("firebase/app");
  const { getMessaging: getMsg, isSupported } = await import("firebase/messaging");
  const supported = await isSupported();
  if (!supported) {
    console.warn("[Push] Este navegador no soporta push notifications");
    return null;
  }
  firebaseApp = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  messaging = getMsg(firebaseApp);
  return messaging;
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    console.log("[Push] SW registrado:", reg.scope);
    return reg;
  } catch (err) {
    console.error("[Push] Error registrando SW:", err);
    return null;
  }
}

export async function requestPushPermission(legajo, empresaId) {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };

    const swReg = await registerSW();
    if (!swReg) return { ok: false, reason: "sw_failed" };

    const msg = await getMessaging();
    if (!msg) return { ok: false, reason: "unsupported" };

    const { getToken } = await import("firebase/messaging");
    const token = await getToken(msg, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) return { ok: false, reason: "no_token" };

    await saveTokenViaAPI(legajo, token, empresaId);
    return { ok: true, token };
  } catch (err) {
    console.error("[Push] Error:", err);
    return { ok: false, reason: err.message };
  }
}

async function saveTokenViaAPI(legajo, token, empresaId) {
  const { getCsrfToken } = await import("./supabase");
  const headers = { "Content-Type": "application/json" };
  const csrf = getCsrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;

  try {
    const checkRes = await fetch("/api/data", {
      method: "POST",
      headers,
      body: JSON.stringify({
        method: "GET",
        path: `push_tokens?legajo=eq.${legajo}&token=eq.${encodeURIComponent(token)}`,
      }),
    });
    const checkData = await checkRes.json();
    const existing = checkData.data || [];

    const body = { legajo, token };
    if (empresaId) body.empresa_id = empresaId;

    if (existing.length > 0) {
      await fetch("/api/data", {
        method: "POST",
        headers,
        body: JSON.stringify({
          method: "PATCH",
          path: `push_tokens?legajo=eq.${legajo}&token=eq.${encodeURIComponent(token)}`,
          body: { updated_at: new Date().toISOString() },
        }),
      });
    } else {
      await fetch("/api/data", {
        method: "POST",
        headers,
        body: JSON.stringify({
          method: "POST",
          path: "push_tokens",
          body,
        }),
      });
    }
    console.log("[Push] Token guardado para legajo:", legajo);
  } catch (err) {
    console.error("[Push] Error guardando token:", err);
  }
}

export async function onForegroundMessage(callback) {
  try {
    const msg = await getMessaging();
    if (!msg) return;
    const { onMessage } = await import("firebase/messaging");
    onMessage(msg, (payload) => callback(payload));
  } catch (err) {
    console.error("[Push] Error en foreground listener:", err);
  }
}

export async function sendPushToLegajo(legajo, title, body, data = {}) {
  try {
    const { getCsrfToken } = await import("./supabase");
    const hdrs = { "Content-Type": "application/json" };
    const csrf = getCsrfToken();
    if (csrf) hdrs["x-csrf-token"] = csrf;
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ legajo, title, body, data }),
    });
    return await res.json();
  } catch (err) {
    console.error("[Push] Error enviando:", err);
    return { ok: false, error: err.message };
  }
}

export async function sendPushToRole(rol, title, body, data = {}) {
  try {
    const { getCsrfToken } = await import("./supabase");
    const hdrs = { "Content-Type": "application/json" };
    const csrf = getCsrfToken();
    if (csrf) hdrs["x-csrf-token"] = csrf;
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ rol, title, body, data }),
    });
    return await res.json();
  } catch (err) {
    console.error("[Push] Error enviando a rol:", err);
    return { ok: false, error: err.message };
  }
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function getPushPermissionStatus() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}
