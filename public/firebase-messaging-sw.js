// ═══════════════════════════════════════════════════════════════
// Gypi — Service Worker
// · Sección 1: caché offline (network-first con fallback)
// · Sección 2: push notifications via Firebase
// ═══════════════════════════════════════════════════════════════

// ─── 1. Caché offline ───────────────────────────────────────────
const CACHE_NAME = "gypi-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Interceptar solo requests de navegación — los requests de API
// y assets pasan directo para no interferir con el polling de datos.
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE_URL)));
});

// ─── 2. Firebase push notifications ────────────────────────────
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Proyecto Firebase: lo define el servidor (variables de entorno, ítem 33)
importScripts('/firebase-config.js');
firebase.initializeApp(self.GYPI_FIREBASE_CONFIG);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Push recibida en background:', payload);

  const { title, body, icon, badge } = payload.notification || {};
  const empresaNombre = payload.data?.empresa_nombre;
  const baseTitle = title || payload.data?.title || 'Gypi';
  const notifTitle = empresaNombre ? `${empresaNombre} · ${baseTitle}` : baseTitle;
  const notifBody = body || payload.data?.body || 'Tenés una nueva notificación';

  const options = {
    body: notifBody,
    icon: icon || '/icons/icon-192.png',
    badge: badge || '/icons/icon-192.png',
    tag: payload.data?.tag || 'gypi-default',
    vibrate: [200, 100, 200],
    data: {
      url: payload.data?.url || '/',
      ...payload.data,
    },
    actions: payload.data?.actions ? JSON.parse(payload.data.actions) : [],
  };

  return self.registration.showNotification(notifTitle, options);
});

// F2-08: solo se abren URLs del mismo origen. Cualquier otra cosa (otro
// dominio, "//sitio", "javascript:") se reemplaza por la home de la app.
function urlSegura(raw) {
  try {
    const u = new URL(raw || '/', self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = urlSegura(event.notification.data?.url);
  const origin = self.location.origin;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(origin) && 'focus' in client) {
          if (urlToOpen !== origin + '/' && 'navigate' in client) {
            return client.navigate(urlToOpen).then(() => client.focus());
          }
          return client.focus();
        }
      }
      return clients.openWindow(urlToOpen);
    })
  );
});