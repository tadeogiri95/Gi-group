// ═══════════════════════════════════════════════════════════════
// Gypi — Service Worker para Push Notifications (Bloque 4)
// Claves Firebase públicas por diseño (la seguridad la dan las
// Security Rules + service account del backend)
// ═══════════════════════════════════════════════════════════════

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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  const origin = self.location.origin;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(origin) && 'focus' in client) {
          if (urlToOpen !== '/' && 'navigate' in client) {
            return client.navigate(urlToOpen).then(() => client.focus());
          }
          return client.focus();
        }
      }
      return clients.openWindow(urlToOpen);
    })
  );
});