// ═══════════════════════════════════════════════════════════════
// GI GROUP — Librería de Push Notifications (cliente)
// Este archivo VA EN: lib/push.js
// ═══════════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCeMnmMN5O1wnVHQOB5TPFpQk1rx82CYMA",
  authDomain: "gi-group-app-676a0.firebaseapp.com",
  projectId: "gi-group-app-676a0",
  storageBucket: "gi-group-app-676a0.firebasestorage.app",
  messagingSenderId: "1060867248487",
  appId: "1:1060867248487:web:b7e260f3e2cadbce9fdfc2",
};

const VAPID_KEY = "BCuvsBllQQqqzZxJq2amhhImr3NzrTyC0BfFlJjDKrpk-GDEz8DYYTgMtc-t5IEOwB2yDPBngnALeI2e2yYJvdE";

const SUPABASE_URL = "https://olhrkpaxadrtvhbewkff.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9saHJrcGF4YWRydHZoYmV3a2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDQ0OTksImV4cCI6MjA5NDQ4MDQ5OX0.oMs25ZKlOASVXfg0xSHvaUxDd3d5_cX3ZzdXZ1JtAi0";

let firebaseApp = null;
let messaging = null;

// ─── Inicializar Firebase (lazy) ─────────────────────────────
async function getMessaging() {
  if (messaging) return messaging;

  const { initializeApp, getApps } = await import("firebase/app");
  const { getMessaging: getMsg, isSupported } = await import("firebase/messaging");

  const supported = await isSupported();
  if (!supported) {
    console.warn("[Push] Este navegador no soporta push notifications");
    return null;
  }

  if (!getApps().length) {
    firebaseApp = initializeApp(FIREBASE_CONFIG);
  } else {
    firebaseApp = getApps()[0];
  }

  messaging = getMsg(firebaseApp);
  return messaging;
}

// ─── Registrar Service Worker ────────────────────────────────
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

// ─── Pedir permiso y obtener token ───────────────────────────
export async function requestPushPermission(legajo) {
  try {
    // 1. Pedir permiso al usuario
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("[Push] Permiso denegado");
      return { ok: false, reason: "denied" };
    }

    // 2. Registrar SW
    const swReg = await registerSW();
    if (!swReg) return { ok: false, reason: "sw_failed" };

    // 3. Obtener token FCM
    const msg = await getMessaging();
    if (!msg) return { ok: false, reason: "unsupported" };

    const { getToken } = await import("firebase/messaging");
    const token = await getToken(msg, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (!token) return { ok: false, reason: "no_token" };

    console.log("[Push] Token obtenido:", token.substring(0, 20) + "...");

    // 4. Guardar token en Supabase vinculado al legajo
    await saveTokenToSupabase(legajo, token);

    return { ok: true, token };
  } catch (err) {
    console.error("[Push] Error:", err);
    return { ok: false, reason: err.message };
  }
}

// ─── Guardar token en Supabase ───────────────────────────────
async function saveTokenToSupabase(legajo, token) {
  try {
    // Primero intentar actualizar si ya existe
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_tokens?legajo=eq.${legajo}&token=eq.${encodeURIComponent(token)}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const existing = await checkRes.json();

    if (existing.length > 0) {
      // Actualizar timestamp
      await fetch(
        `${SUPABASE_URL}/rest/v1/push_tokens?legajo=eq.${legajo}&token=eq.${encodeURIComponent(token)}`,
        {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ updated_at: new Date().toISOString() }),
        }
      );
    } else {
      // Insertar nuevo
      await fetch(`${SUPABASE_URL}/rest/v1/push_tokens`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ legajo, token }),
      });
    }
    console.log("[Push] Token guardado en Supabase para legajo:", legajo);
  } catch (err) {
    console.error("[Push] Error guardando token:", err);
  }
}

// ─── Escuchar notificaciones en primer plano ─────────────────
export async function onForegroundMessage(callback) {
  try {
    const msg = await getMessaging();
    if (!msg) return;

    const { onMessage } = await import("firebase/messaging");
    onMessage(msg, (payload) => {
      console.log("[Push] Notificación en foreground:", payload);
      callback(payload);
    });
  } catch (err) {
    console.error("[Push] Error en foreground listener:", err);
  }
}

// ─── Enviar push a un legajo (llama a nuestra API route) ─────
export async function sendPushToLegajo(legajo, title, body, data = {}) {
  try {
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legajo, title, body, data }),
    });
    const result = await res.json();
    console.log("[Push] Enviada a legajo", legajo, ":", result);
    return result;
  } catch (err) {
    console.error("[Push] Error enviando:", err);
    return { ok: false, error: err.message };
  }
}

// ─── Enviar push a todos los de un rol ───────────────────────
export async function sendPushToRole(rol, title, body, data = {}) {
  try {
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rol, title, body, data }),
    });
    const result = await res.json();
    console.log("[Push] Enviada a rol", rol, ":", result);
    return result;
  } catch (err) {
    console.error("[Push] Error enviando a rol:", err);
    return { ok: false, error: err.message };
  }
}

// ─── Verificar si push está soportado ────────────────────────
export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

// ─── Verificar estado actual del permiso ─────────────────────
export function getPushPermissionStatus() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission; // "granted" | "denied" | "default"
}
