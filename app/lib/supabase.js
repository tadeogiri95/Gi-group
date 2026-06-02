// lib/supabase.js — VERSIÓN SEGURA
// El cliente NO inyecta empresa_id. El servidor (/api/data) lo fuerza
// desde la sesión validada del token.

let _token = null;
let _onUnauthorized = null;

export function setToken(token) {
  _token = token;
  if (token) { try { localStorage.setItem("gypi_token", token); } catch (e) {} }
  else { try { localStorage.removeItem("gypi_token"); } catch (e) {} }
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

// Se mantiene como no-op para no romper imports existentes.
// El empresa_id ahora se fuerza siempre desde el token en el servidor.
export function setEmpresaId(_id) { /* no-op por seguridad */ }

export function onUnauthorized(callback) {
  _onUnauthorized = callback;
}

async function req(method, path, body) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch("/api/data", {
      method: "POST",
      headers,
      body: JSON.stringify({ method, path, body }),
    });
  } catch {
    throw new Error("Error de red. Verificá tu conexión.");
  }

  let json;
  try { json = await res.json(); }
  catch { throw new Error(`Error del servidor (${res.status}). Intentá de nuevo.`); }

  if (res.status === 401) {
    const isRead = !method || method === "GET";
    if (isRead) {
      clearToken();
      if (_onUnauthorized) _onUnauthorized();
    }
    throw new Error(isRead ? "Sesión expirada. Iniciá sesión de nuevo." : "Error de autorización. Intentá de nuevo o recargá la página.");
  }
if (res.status === 402) {
    const err = new Error(json.error || "Función bloqueada por tu plan");
    err.paywall = true;
    err.upgrade_a = json.upgrade_a;
    throw err;
  }

  if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);
  return json.data;
}

export const sb = {
  get: (path) => req("GET", path),
  post: (path, data) => req("POST", path, data),
  patch: (path, data) => req("PATCH", path, data),
  del: (path) => req("DELETE", path),
};