// ═══════════════════════════════════════════════════════════════
// GI GROUP — Service Worker para Push Notifications
// Este archivo VA EN: public/firebase-messaging-sw.js
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

// Maneja notificaciones cuando la app está en segundo plano o cerrada
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Push recibida en background:', payload);

  const { title, body, icon, badge, data } = payload.notification || {};
  const notifTitle = title || payload.data?.title || 'GI Group';
  const notifBody = body || payload.data?.body || 'Tenés una nueva notificación';

  const options = {
    body: notifBody,
    icon: icon || '/icon-192.png',
    badge: badge || '/icon-192.png',
    tag: payload.data?.tag || 'gi-group-default',
    vibrate: [200, 100, 200],
    data: {
      url: payload.data?.url || '/',
      ...payload.data,
    },
    actions: payload.data?.actions ? JSON.parse(payload.data.actions) : [],
  };

  return self.registration.showNotification(notifTitle, options);
});

// Cuando el usuario toca la notificación, abre la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si ya hay una ventana abierta, enfocala
      for (const client of windowClients) {
        if (client.url.includes('gi-group-app.vercel.app') && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrí una nueva
      return clients.openWindow(urlToOpen);
    })
  );
});
