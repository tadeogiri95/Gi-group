// GET /firebase-config.js — Configuración de Firebase para el service worker
// (F0-11/H6, ítem 33): el service worker no puede leer variables de entorno,
// así que la toma de acá con importScripts. Ver app/lib/firebaseConfig.js.
import { configFirebase } from "../lib/firebaseConfig";

export function GET() {
  return new Response(`self.GYPI_FIREBASE_CONFIG = ${JSON.stringify(configFirebase())};\n`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
