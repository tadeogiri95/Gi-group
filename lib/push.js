// ═══════════════════════════════════════════════════════════
// lib/push.js — Push Notifications (ACTUALIZADO)
//
// CAMBIO IMPORTANTE:
// Como /api/data ahora EXIGE un token de sesión válido (por el arreglo
// de seguridad multi-tenant), al guardar el token de push hay que
// mandar el Authorization header. Antes no lo mandaba y ahora fallaría.
//
// NOTA: las claves de Firebase de abajo son las que ya tenías. Lo ideal
// a futuro es moverlas a variables de entorno (NEXT_PUBLIC_FIREBASE_*),
// pero por ahora se dejan para no romper nada.
// ═══════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCeMnmMN5O1wnVHQOB5TPFpQk1rx82CYMA",
  authDomain: "gi-group-app-676a0.firebaseapp.com",
  projectId: "gi-group-app-676a0",
  storageBucket: "gi-group-app-676a0.firebasestorage.app",
  messagingSenderId: "1060867248487",
  appId: "1:1060867248487:web:b7e260f3e2cadbce9fdfc2",
};

const VAPID_KEY = "BCuvsBllQQqqzZxJq2amhhImr3NzrTyC0BfFlJjDKrpk-GDEz8DYYTgMtc-t5IEOwB2yDPBngnALeI2e2yYJvdE";

let firebaseApp = null;
let messaging = null;

// Lee el token de sesión guardado por supabase.js
function getSessionToken() {
  try { return localStorage.getItem("gypi_token"); } catch { return null; }
}

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

// Guarda el token push via /api/data — AHORA con Authorization header.
async function saveTokenViaAPI(legajo, token, empresaId) {
  const sessionToken = getSessionToken();
  const headers = { "Content-Type": "application/json" };
  if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;

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
          body: { legajo, token },
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
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
