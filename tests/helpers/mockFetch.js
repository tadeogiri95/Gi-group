// tests/helpers/mockFetch.js — Mock liviano de fetch para tests HTTP de
// API routes, sin pegarle a una Supabase real.
//
// Uso:
//   global.fetch = createFetchMock([
//     { match: (url, opts) => url.includes("/rpc/algo"), respond: () => ({ status: 200, body: 0 }) },
//   ]);
//
// Las dos llamadas fire-and-forget que hace toda ruta autenticada/auditada
// (logAudit → audit_log, broadcastRefresh → realtime broadcast) se ignoran
// silenciosamente si no hay handler — ambas tienen .catch(() => {}) en el
// código real, así que no hace falta mockearlas explícitamente.
const RUTAS_FIRE_AND_FORGET = [/\/rest\/v1\/audit_log/, /\/realtime\/v1\/api\/broadcast/, /api\.resend\.com/];

export function createFetchMock(handlers) {
  return async function mockedFetch(url, opts = {}) {
    const urlStr = typeof url === "string" ? url : url.toString();
    for (const h of handlers) {
      if (h.match(urlStr, opts)) {
        const result = await h.respond(urlStr, opts);
        const status = result.status ?? 200;
        // Los status 204/205/304 no admiten body (ni siquiera "") según el
        // spec de Response — null es el único valor válido para esos casos.
        const sinBody = result.body === undefined || [204, 205, 304].includes(status);
        const bodyStr = sinBody ? null : (typeof result.body === "string" ? result.body : JSON.stringify(result.body));
        return new Response(bodyStr, { status, headers: result.headers });
      }
    }
    if (RUTAS_FIRE_AND_FORGET.some((re) => re.test(urlStr))) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`[mockFetch] Sin handler para: ${opts.method || "GET"} ${urlStr}`);
  };
}

// Handlers compartidos para que validarToken() (app/lib/auth.js) pase limpio:
// chequeo de revocación de sesión + chequeo de email_verificado.
export function authPassHandlers() {
  return [
    {
      match: (url) => /\/rest\/v1\/sesiones\?token_hash=eq\./.test(url),
      respond: () => ({ status: 200, body: [{ id: "sesion-1" }] }),
    },
    {
      match: (url) => /\/rest\/v1\/empresa\?id=eq\..*select=email_verificado/.test(url),
      respond: () => ({ status: 200, body: [{ email_verificado: true }] }),
    },
  ];
}
