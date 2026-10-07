// app/lib/firebaseConfig.js — Proyecto Firebase de las notificaciones push
// (F0-11/H6, ítem 33). Con las NEXT_PUBLIC_FIREBASE_* del proyecto propio de
// Gypi cargadas en Vercel se usa ese; sin ellas, sigue el del piloto.
// La configuración web de Firebase es pública por diseño: no es un secreto.

// Proyecto del piloto, hasta que estén las variables del proyecto de Gypi
const PILOTO = {
  apiKey: "AIzaSyCeMnmMN5O1wnVHQOB5TPFpQk1rx82CYMA",
  authDomain: "gi-group-app-676a0.firebaseapp.com",
  projectId: "gi-group-app-676a0",
  storageBucket: "gi-group-app-676a0.firebasestorage.app",
  messagingSenderId: "1060867248487",
  appId: "1:1060867248487:web:b7e260f3e2cadbce9fdfc2",
};

// Las NEXT_PUBLIC_* se leen una por una (Next las reemplaza en el código del navegador)
export function configFirebase(env = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}) {
  const propia = {
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  return propia.apiKey && propia.projectId && propia.messagingSenderId && propia.appId ? propia : PILOTO;
}

