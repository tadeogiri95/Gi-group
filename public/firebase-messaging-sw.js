// ═══════════════════════════════════════════════════════════════
// Gypi — Service Worker
// · Sección 1: caché offline (app que abre sin señal, ítem 21)
// · Sección 2: push notifications via Firebase
// ═══════════════════════════════════════════════════════════════

// ─── 1. Caché offline (ítem 21) ──────────────────────────────────
// · Páginas: red primero; sin señal, la última versión guardada de esa misma
//   página (y si no hay, offline.html).
// · /_next/static: archivos con hash, nunca cambian → caché primero.
// · GET /api/me y /api/empresa: red primero con respaldo, para que la app
//   abra sin señal con la sesión y la empresa del último uso. Se borra al
//   cerrar sesión (CACHE_DATOS, ver app/lib/registrarSW.js).
// · El resto de la API pasa directo (fichar y tareas sin señal los guarda la
//   app en su propia cola y los manda al volver la conexión).
const CACHE_PAGINAS = "gypi-paginas-v2";
const CACHE_ESTATICOS = "gypi-estaticos-v2";
const CACHE_DATOS = "gypi-datos-v1";
const CACHES_VIGENTES = [CACHE_PAGINAS, CACHE_ESTATICOS, CACHE_DATOS];
const OFFLINE_URL = "/offline.html";
const MAX_ESTATICOS = 300;
const MAX_PAGINAS = 20;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_PAGINAS).then(c => c.addAll([OFFLINE_URL, "/icons/icon-192.png", "/manifest.json"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !CACHES_VIGENTES.includes(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function recortar(nombre, max) {
  const cache = await caches.open(nombre);
  const claves = await cache.keys();
  for (let i = 0; i < claves.length - max; i++) await cache.delete(claves[i]);
}

async function redPrimero(request, nombreCache, max) {
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") {
      const copia = res.clone();
      caches.open(nombreCache).then(c => c.put(request, copia)).then(() => recortar(nombreCache, max)).catch(() => {});
    }
    return res;
  } catch (err) {
    const guardada = await caches.match(request, { cacheName: nombreCache });
    if (guardada) return guardada;
    throw err;
  }
}

async function cachePrimero(request) {
  const guardada = await caches.match(request, { cacheName: CACHE_ESTATICOS });
  if (guardada) return guardada;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    const copia = res.clone();
    caches.open(CACHE_ESTATICOS).then(c => c.put(request, copia)).then(() => recortar(CACHE_ESTATICOS, MAX_ESTATICOS)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(cachePrimero(req));
    return;
  }
  if (url.pathname === "/api/me" || url.pathname === "/api/empresa") {
    e.respondWith(redPrimero(req, CACHE_DATOS, 10));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(
      redPrimero(req, CACHE_PAGINAS, MAX_PAGINAS).catch(() => caches.match(OFFLINE_URL))
    );
  }
});

// ─── 2. Firebase push notifications ────────────────────────────
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCeMnmMN5O1wnVHQOB5TPFpQk1rx82CYMA",
  authDomain: "gi-group-app-676a0.firebaseapp.com",
  projectId: "gi-group-app-676a0",
  storageBucket: "gi-group-app-676a0.firebasestorage.app",
  messagingSenderId: "1060867248487",
  appId: "1:1060867248487:web:b7e260f3e2cadbce9fdfc2",
});

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