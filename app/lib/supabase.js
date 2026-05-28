// ═══════════════════════════════════════════════════════════
// lib/supabase.js — ETAPA 2: Cliente con autenticación por token
//
// Cambios respecto a la versión anterior:
// - Guarda el token de sesión que viene del login
// - Lo manda en el header Authorization de cada request
// - Si el servidor responde 401, fuerza logout
// ═══════════════════════════════════════════════════════════

// ─── Manejo del token ───
let _token = null;
let _onUnauthorized = null; // callback para forzar logout

export function setToken(token) {
  _token = token;
  if (token) {
    try { localStorage.setItem("gypi_token", token); } catch (e) {}
  } else {
    try { localStorage.removeItem("gypi_token"); } catch (e) {}
  }
}

export function getToken() {
  if (_token) return _token;
  try { _token = localStorage.getItem("gypi_token"); } catch (e) {}
  return _token;
}

export function clearToken() {
  _token = null;
  try { localStorage.removeItem("gypi_token"); } catch (e) {}
}

export function onUnauthorized(callback) {
  _onUnauthorized = callback;
}

// ─── Request con token ───
async function req(method, path, body) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch("/api/data", {
    method: "POST",
    headers,
    body: JSON.stringify({ method, path, body }),
  });

  const json = await res.json();

  // Si el servidor dice 401, la sesión expiró → forzar logout
  if (res.status === 401) {
    clearToken();
    if (_onUnauthorized) _onUnauthorized();
    throw new Error("Sesión expirada. Iniciá sesión de nuevo.");
  }

  if (!res.ok || json.error) {
    throw new Error(json.error || `Error ${res.status}`);
  }
  return json.data;
}

export const sb = {
  get: (path) => req("GET", path),
  post: (path, data) => req("POST", path, data),
  patch: (path, data) => req("PATCH", path, data),
  del: (path) => req("DELETE", path),
};
