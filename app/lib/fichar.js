// ═══════════════════════════════════════════════════════════
// app/lib/fichar.js — Helpers de fichaje (client-side)
//
// ENTREGA 2D: Extraído de [slug]/page.js líneas 196-227.
// Usado por ChatScreen y HomeEmp.
// ═══════════════════════════════════════════════════════════

import { getToken, clearToken, getCsrfToken } from "./supabase";
import { haversine } from "./calc";
import { enviarOEncolar, horaDeOp } from "./colaOffline";

// Reintentos solo ante fallo de RED (fetch() no llega a completarse — sin
// señal, típico en planta industrial). Un rechazo lógico del servidor (4xx/5xx
// con response real) nunca reintenta acá, se resuelve abajo como siempre.
// opciones (incluye geo_lat/geo_lng ya capturados) se manda igual en cada
// intento — no hace falta volver a pedir GPS.
const REINTENTOS_RED = [800, 1600];

// Un intento de envío con reintentos de red. Tira solo si nunca llegó al servidor.
async function enviarFichaje(op) {
  // La sesión viaja en la cookie httpOnly; el token en memoria es solo un
  // respaldo y se pierde al recargar la página.
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;
  const body = JSON.stringify(op.body);
  for (let intento = 0; ; intento++) {
    try {
      const res = await fetch(op.url || "/api/fichar", { method: "POST", headers, body });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } catch (e) {
      if (intento >= REINTENTOS_RED.length) throw e;
      await new Promise((r) => setTimeout(r, REINTENTOS_RED[intento]));
    }
  }
}

/**
 * Ficha ingreso o egreso. Con `empleadoId`, si no hay señal lo guarda en el
 * celular con la hora real y lo manda solo al volver la conexión (ítem 21):
 * devuelve { ok: true, encolado: true, hora }.
 */
export async function ficharServer(accion, opciones = {}) {
  const { empleadoId, ...resto } = opciones;
  const body = { accion, ...resto };

  let r;
  if (empleadoId) {
    r = await enviarOEncolar({
      empleadoId, tipo: "fichar", url: "/api/fichar", body, enviar: enviarFichaje,
      // Una salida guardada sin señal cierra la tarea en curso a esa hora (no se le puede preguntar después)
      paraCola: (b) => (b.accion === "egreso" ? { ...b, forzar_cierre_tarea: true } : b),
    });
    if (r.encolado) return { ok: true, encolado: true, hora: horaDeOp(r.op) };
  } else {
    try {
      r = await enviarFichaje({ url: "/api/fichar", body });
    } catch {
      const err = new Error("Sin conexión a internet. Probá de nuevo cuando tengas señal.");
      err.tipo = "sin_conexion";
      throw err;
    }
  }

  if (r.status === 401) {
    clearToken();
    const err = new Error("Tu sesión venció. Volvé a iniciar sesión.");
    err.tipo = "sesion_expirada";
    throw err;
  }
  const data = r.data || {};
  if (!data.ok) {
    const err = new Error(data.error || "No se pudo fichar. Intentá de nuevo.");
    err.tipo = data.tipo || "error_servidor";
    err.tardanza = data.tardanza;
    err.tarea_id = data.tarea_id;
    err.pendiente = data.pendiente;
    err.fin_grilla = data.fin_grilla;
    throw err;
  }
  return data;
}

// timeoutMs: el chat espera hasta 15 s; el botón grande de fichar, 8 s (D6),
// mostrando un contador para que el operario sepa que está buscando.
export async function obtenerGeo(empleado, { timeoutMs = 15000 } = {}) {
  if (!navigator?.geolocation) return { lat: null, lng: null, distancia: null, msg: null };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Precisión en metros que informa el teléfono (bajo techo suele ser 50–500 m)
        const precision = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null;
        if (empleado?.geo_lat && empleado?.geo_lng) {
          const dist = haversine(lat, lng, empleado.geo_lat, empleado.geo_lng);
          const dentro = dist <= (empleado.geo_radio || 200);
          resolve({
            lat, lng, precision, distancia: Math.round(dist),
            msg: dentro ? `📍 A ${Math.round(dist)}m de la base` : `⚠️ A ${Math.round(dist)}m (fuera del radio)`,
          });
        } else {
          resolve({ lat, lng, precision, distancia: null, msg: "📍 Ubicación registrada" });
        }
      },
      (err) => {
        const motivos = { 1: "Permiso de ubicación denegado", 2: "No se pudo obtener ubicación", 3: "Tiempo agotado obteniendo ubicación" };
        resolve({ lat: null, lng: null, distancia: null, msg: `⚠️ ${motivos[err.code] || "Error GPS"}`, error: true });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}
