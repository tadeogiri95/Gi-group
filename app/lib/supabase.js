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

// ─── Renovar el pase (refresh) ───
// Confía en la httpOnly cookie gypi_refresh — no necesita el token en memoria.
//
// Devuelve "ok", "vencida" (el servidor dijo 401: la sesión terminó de verdad)
// o "error" (sin red o problema pasajero del servidor: NO se cierra la sesión).
//
// Varias pestañas (o la app instalada y el navegador) comparten las cookies:
// si renuevan al mismo tiempo, una gana y la otra presentaba un pase ya usado
// y se cerraba la sesión. Con navigator.locks renueva una pestaña por vez, y
// si otra acaba de renovar, se usa ese pase sin volver a pedir uno.
const LLAVE_RENOVADO = "gypi_refresh_at";
const RECIENTE_MS = 15_000;

function marcaRenovado() {
  try { return Number(localStorage.getItem(LLAVE_RENOVADO)) || 0; } catch { return 0; }
}

async function pedirRefresh() {
  let res;
  try {
    res = await fetch("/api/refresh-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
  } catch {
    return "error";
  }
  if (res.status === 401 || res.status === 400) return "vencida";
  if (!res.ok) return "error";
  try {
    const data = await res.json();
    if (!data.token) return "error";
    setToken(data.token);
    try { localStorage.setItem(LLAVE_RENOVADO, String(Date.now())); } catch {}
    return "ok";
  } catch {
    return "error";
  }
}

async function renovarUnaVez() {
  const pedidoEn = Date.now();
  const conLlave = async () => {
    // Otra pestaña renovó mientras esperábamos: las cookies ya son nuevas.
    // El pase en memoria de esta pestaña queda viejo, pero el servidor lee
    // primero la cookie, así que no hace falta.
    const marca = marcaRenovado();
    if (marca >= pedidoEn - 1000 && Date.now() - marca < RECIENTE_MS) return "ok";
    let r = await pedirRefresh();
    // Un problema pasajero: un reintento corto antes de rendirse.
    if (r === "error") {
      await new Promise((ok) => setTimeout(ok, 1500));
      r = await pedirRefresh();
    }
    return r;
  };
  try {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      return await navigator.locks.request("gypi-refresh", conLlave);
    }
  } catch {
    // sin Web Locks: se renueva igual (el servidor da 2 minutos de gracia)
  }
  return conLlave();
}

async function intentarRefresh() {
  if (_refreshing) {
    try { return await _refreshing; } catch { return "error"; }
  }
  _refreshing = renovarUnaVez().finally(() => { _refreshing = null; });
  try { return await _refreshing; } catch { return "error"; }
}

// Para restaurar la sesión al abrir la app (F1-03)
export const refrescarSesion = intentarRefresh;

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
    const renovado = await intentarRefresh();
    if (renovado === "error") {
      // Sin red o el servidor tuvo un problema pasajero: la sesión sigue.
      throw new Error("No se pudo conectar con el servidor. Intentá de nuevo en unos segundos.");
    }
    if (renovado === "ok") {
      // Reintentar el request original con el nuevo token
      const newToken = getToken();
      const retryHeaders = { "Content-Type": "application/json" };
      if (newToken) retryHeaders["Authorization"] = `Bearer ${newToken}`;
      const retryCsrf = getCsrfToken();
      if (retryCsrf) retryHeaders["x-csrf-token"] = retryCsrf;

      let retryRes;
      try {
        retryRes = await fetch("/api/data", {
          method: "POST",
          headers: retryHeaders,
          credentials: "include",
          body: JSON.stringify({ method, path, body, cursor }),
        });
      } catch {
        throw new Error("Error de red. Verificá tu conexión.");
      }
      let retryJson;
      try { retryJson = await retryRes.json(); }
      catch { throw new Error(`Error del servidor (${retryRes.status}). Intentá de nuevo.`); }
      if (retryRes.status !== 401) {
        // Cualquier otro error del reintento es del pedido, no de la sesión:
        // antes caía al cierre de sesión aunque fuera, p. ej., un dato inválido.
        if (retryRes.status === 402) {
          const err = new Error(retryJson.error || "Función bloqueada por tu plan");
          err.paywall = true;
          err.upgrade_a = retryJson.upgrade_a;
          throw err;
        }
        if (!retryRes.ok || retryJson.error) throw new Error(retryJson.error || `Error ${retryRes.status}`);
        return raw ? retryJson : retryJson.data;
      }
    }

    // La sesión venció de verdad → logout
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
  // Con FormData (subir archivos) el navegador pone el Content-Type con su boundary
  const esArchivo = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const headers = { ...(esArchivo ? {} : { "Content-Type": "application/json" }), ...opts.headers };
  if (token && !headers["Authorization"]) headers["Authorization"] = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;
  return fetch(url, { ...opts, headers, credentials: "include" });
}

// Trae todas las páginas de un GET — el proxy /api/data capea cada request
// en 1000 filas, así que un rango de un mes con muchos empleados se truncaba
// en silencio. Devuelve { data, truncado }: truncado=true si se alcanzó
// maxFilas y puede haber más (el caller debe avisarlo en la UI).
export async function sbGetAll(path, { pageSize = 1000, maxFilas = 5000 } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const data = [];
  let offset = 0;
  while (offset < maxFilas) {
    const page = await req("GET", `${path}${sep}limit=${pageSize}&offset=${offset}`);
    data.push(...(page || []));
    if (!page || page.length < pageSize) return { data, truncado: false };
    offset += pageSize;
  }
  return { data, truncado: true };
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
