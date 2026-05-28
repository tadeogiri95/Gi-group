// lib/supabase.js

let _token = null;
let _empresaId = null;
let _onUnauthorized = null;

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

export function setEmpresaId(id) {
  _empresaId = id;
}

export function onUnauthorized(callback) {
  _onUnauthorized = callback;
}

async function req(method, path, body) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Si no hay token, inyectar empresa_id en el path o body como fallback
  let finalPath = path;
  let finalBody = body;

  if (!token && _empresaId) {
    // Para GET: agregar empresa_id al path si no está ya
    if ((!method || method === "GET") && !path.includes("empresa_id=")) {
      finalPath = path.includes("?")
        ? path + `&empresa_id=eq.${_empresaId}`
        : path + `?empresa_id=eq.${_empresaId}`;
    }
    // Para POST: agregar empresa_id al body
    if (method === "POST" && body) {
      finalBody = { ...body, empresa_id: _empresaId };
    }
  }

  const res = await fetch("/api/data", {
    method: "POST",
    headers,
    body: JSON.stringify({ method, path: finalPath, body: finalBody }),
  });

  const json = await res.json();

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
