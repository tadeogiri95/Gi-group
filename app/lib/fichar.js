// ═══════════════════════════════════════════════════════════
// app/lib/fichar.js — Helpers de fichaje (client-side)
//
// ENTREGA 2D: Extraído de [slug]/page.js líneas 196-227.
// Usado por ChatScreen y HomeEmp.
// ═══════════════════════════════════════════════════════════

import { getToken, clearToken } from "./supabase";
import { haversine } from "./calc";

export async function ficharServer(accion, opciones = {}) {
  const token = getToken();
  if (!token) throw new Error("Sin sesión");
  const res = await fetch("/api/fichar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ accion, ...opciones }),
  });
  if (res.status === 401) { clearToken(); throw new Error("Sesión expirada"); }
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.error || "Error al fichar");
    err.tipo = data.tipo;
    err.tardanza = data.tardanza;
    err.tarea_id = data.tarea_id;
    throw err;
  }
  return data;
}

export async function obtenerGeo(empleado) {
  if (!navigator?.geolocation) return { lat: null, lng: null, distancia: null, msg: null };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (empleado?.geo_lat && empleado?.geo_lng) {
          const dist = haversine(lat, lng, empleado.geo_lat, empleado.geo_lng);
          const dentro = dist <= (empleado.geo_radio || 200);
          resolve({
            lat, lng, distancia: Math.round(dist),
            msg: dentro ? `📍 A ${Math.round(dist)}m de la base` : `⚠️ A ${Math.round(dist)}m (fuera del radio)`,
          });
        } else {
          resolve({ lat, lng, distancia: null, msg: "📍 Ubicación registrada" });
        }
      },
      () => resolve({ lat: null, lng: null, distancia: null, msg: null }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}
