// ═══════════════════════════════════════════════════════════
// lib/supabase.js — VERSIÓN SEGURA
//
// ENTREGA 1E: Agrega auto-refresh de token.
// Cuando un request devuelve 401, intenta usar el refresh_token
// para obtener un nuevo access token ANTES de hacer logout.
// Si el refresh también falla, ahí sí → logout.
// ═══════════════════════════════════════════════════════════

let _token = null;
let _refreshToken = null;
let _onUnauthorized = null;
let _refreshing = null; // Promise en curso para evitar refresh concurrentes

// Tokens sólo en memoria — los httpOnly cookies son la fuente de verdad.
// Nunca se persisten en localStorage para no exponerlos a XSS.

export function setToken(token) {
  _token = token || null;
}

export function getToken() {
  return _token;
}

export function setRefreshToken(token) {
  _refreshToken = token || null;
}

export function getRefreshToken() {
  return _refreshToken;
}

export function clearToken() {
  _token = null;
  _refreshToken = null;
  // Limpiar valores legacy que puedan haber quedado en localStorage
  try { localStorage.removeItem("gypi_token"); } catch (e) {}
  try { localStorage.removeItem("gypi_refresh_token"); } catch (e) {}
}

export function setEmpresaId(_id) { /* no-op por seguridad */ }

export function onUnauthorized(callback) {
  _onUnauthorized = callback;
}

// ─── Intentar refresh del token ───
// Confía en la httpOnly cookie gypi_refresh — no necesita el token en memoria
async function intentarRefresh() {
  if (_refreshing) {
    try { return await _refreshing; } catch { return false; }
  }

  _refreshing = (async () => {
    try {
      const res = await fetch("/api/refresh-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      _refreshing = null;
    }
  })();

  return _refreshing;
}

export function getCsrfToken() {
  try {
    const match = document.cookie.match(/(?:^|;\s*)gypi_csrf=([^;]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

async function req(method, path, body, { cursor, raw } = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;

  let res;
  try {
    res = await fetch("/api/data", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ method, path, body, cursor }),
    });
  } catch {
    throw new Error("Error de red. Verificá tu conexión.");
  }

  let json;
  try { json = await res.json(); }
  catch { throw new Error(`Error del servidor (${res.status}). Intentá de nuevo.`); }

  // ═══ CAMBIO 1E: Auto-refresh en 401 ═══
  if (res.status === 401) {
    const refreshed = await intentarRefresh();
    if (refreshed) {
      // Reintentar el request original con el nuevo token
      const newToken = getToken();
      const retryHeaders = { "Content-Type": "application/json" };
      if (newToken) retryHeaders["Authorization"] = `Bearer ${newToken}`;
      const retryCsrf = getCsrfToken();
      if (retryCsrf) retryHeaders["x-csrf-token"] = retryCsrf;

      try {
        const retryRes = await fetch("/api/data", {
          method: "POST",
          headers: retryHeaders,
          credentials: "include",
          body: JSON.stringify({ method, path, body, cursor }),
        });
        const retryJson = await retryRes.json();
        if (retryRes.ok && !retryJson.error) return raw ? retryJson : retryJson.data;
        // Si el retry también falla, caer al logout
      } catch {
        // Fallo en retry, caer al logout
      }
    }

    // Refresh falló o no hay refresh token → logout
    const isRead = !method || method === "GET";
    clearToken();
    if (_onUnauthorized) _onUnauthorized();
    throw new Error(
      isRead
        ? "Sesión expirada. Iniciá sesión de nuevo."
        : "Error de autorización. Intentá de nuevo o recargá la página."
    );
  }

  if (res.status === 402) {
    const err = new Error(json.error || "Función bloqueada por tu plan");
    err.paywall = true;
    err.upgrade_a = json.upgrade_a;
    throw err;
  }

  if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);
  return raw ? json : json.data;
}

/**
 * Wrapper for direct API calls (outside of /api/data proxy).
 * Adds auth token + CSRF header automatically.
 */
export async function apiFetch(url, opts = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token && !headers["Authorization"]) headers["Authorization"] = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;
  return fetch(url, { ...opts, headers, credentials: "include" });
}

export const sb = {
  get: (path) => req("GET", path),
  // getPage: paginación keyset — requiere que `path` incluya order=columna.dir.
  // Devuelve { data, nextCursor }; pasar nextCursor como cursor para la página siguiente.
  getPage: (path, cursor) => req("GET", path, undefined, { cursor, raw: true }),
  post: (path, data) => req("POST", path, data),
  patch: (path, data) => req("PATCH", path, data),
  del: (path) => req("DELETE", path),
};
