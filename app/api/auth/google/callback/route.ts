// GET /api/auth/google/callback?code=...&state=...
//
// Vuelta del consentimiento de Google. Valida el state (CSRF), intercambia
// el code por un id_token, y según el intent crea una empresa nueva
// (registro) o resuelve un empleado existente dentro de un tenant (login).
// Nunca setea la sesión real acá — solo emite un código de intercambio de
// un solo uso y redirige; /api/auth/google/exchange hace el resto (mismo
// patrón que /api/superadmin/impersonate + impersonate-exchange).

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { verifyOAuthState, signOAuthExchangeCode } from "../../../../lib/jwt";
import { crearEmpresaConAdmin, generarSlugUnico, EmpresaSignupError } from "../../../../lib/empresaSignup";
import { slug as slugSchema } from "../../../../lib/schemas";
import { ventana15min } from "../../../../lib/rateLimit";
import { sendBienvenida } from "../../../../lib/email";
import { logger } from "../../../../lib/logger";
import { logEvent, EVT } from "../../../../lib/analytics";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
const OAUTH_STATE_COOKIE = "gypi_oauth_state";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

// Rate limit fail-closed, mismo patrón que login-empresa/registro-empresa,
// prefijo propio para no compartir cupo con esos dos.
const MAX_OAUTH_ATTEMPTS = 10;
async function checkOAuthRateLimit(ip: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return false;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_login_attempt`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip: `oauth:${ip}`, p_ventana: ventana15min() }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      logger.warn("checkOAuthRateLimit: DB no disponible — bloqueando por seguridad", { ip, status: res.status });
      return true;
    }
    const count = await res.json();
    return typeof count === "number" && count > MAX_OAUTH_ATTEMPTS;
  } catch (e) {
    logger.warn("checkOAuthRateLimit: excepción — bloqueando por seguridad", { ip, error: (e as Error)?.message });
    return true;
  }
}

async function sb(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY!,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

interface GoogleIdTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

interface EmpleadoMatch {
  id: string;
  legajo: number;
  rol: string;
}

async function exchangeCodeForIdToken(code: string, redirectUri: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("token_exchange_failed");
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("sin id_token");
  return data.id_token;
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenPayload> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: GOOGLE_CLIENT_ID,
  });
  if (!payload.sub) throw new Error("id_token sin sub");
  return payload as unknown as GoogleIdTokenPayload;
}

function redirectError(slug: string | null, motivo: string): NextResponse {
  const url = new URL(slug ? `/${slug}` : "/", APP_BASE);
  url.searchParams.set("oauth_error", motivo);
  const res = NextResponse.redirect(url.toString(), { status: 302 });
  res.cookies.set({ name: OAUTH_STATE_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}

function redirectSuccess(slug: string, code: string): NextResponse {
  const url = new URL(`/${slug}`, APP_BASE);
  url.searchParams.set("oauth", code);
  const res = NextResponse.redirect(url.toString(), { status: 302 });
  res.cookies.set({ name: OAUTH_STATE_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SB_URL || !SB_KEY) {
    return redirectError(null, "no_configurado");
  }

  const { searchParams } = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (await checkOAuthRateLimit(ip)) {
    return redirectError(null, "demasiados_intentos");
  }

  // El usuario canceló el consentimiento, o Google reportó otro error.
  if (searchParams.get("error")) {
    return redirectError(null, "cancelado");
  }

  const code = searchParams.get("code");
  const rawState = searchParams.get("state");
  if (!code || !rawState) {
    return redirectError(null, "solicitud_invalida");
  }

  // ─── Validar state: firma JWT + nonce contra la cookie httpOnly ───
  const state = await verifyOAuthState(rawState);
  const cookieNonce = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !cookieNonce || state.nonce !== cookieNonce) {
    return redirectError(state?.slug || null, "state_invalido");
  }
  // Defensa en profundidad: el slug ya fue validado al firmar el state en
  // google/start, pero se revalida antes de usarlo en una URL de redirect.
  if (state.slug !== null) {
    const parsedSlug = slugSchema.safeParse(state.slug);
    if (!parsedSlug.success) return redirectError(null, "state_invalido");
  }
  const { intent, slug: stateSlug } = state;

  try {
    const idToken = await exchangeCodeForIdToken(code, `${APP_BASE}/api/auth/google/callback`);
    const googlePayload = await verifyGoogleIdToken(idToken);

    if (googlePayload.email_verified !== true || !googlePayload.email) {
      return redirectError(stateSlug, "email_no_verificado");
    }
    const googleEmail = googlePayload.email.toLowerCase();

    // ═══ INTENT: registro — crear empresa nueva ═══
    if (intent === "registro") {
      const primerNombre = (googlePayload.name || googleEmail.split("@")[0]).split(" ")[0];
      const nombreEmpresa = `Empresa de ${primerNombre}`;
      const nombreCorto = nombreEmpresa.length > 12 ? nombreEmpresa.slice(0, 12) : nombreEmpresa;
      const slug = await generarSlugUnico(nombreEmpresa);

      let emp, adminEmp;
      try {
        ({ emp, adminEmp } = await crearEmpresaConAdmin({
          nombreEmpresa,
          nombreCorto,
          adminEmail: googleEmail,
          adminPassword: null,
          rubro: "general",
          slug,
          adminNombre: googlePayload.name || primerNombre,
          emailVerifyToken: null,
        }));
      } catch (e) {
        if (e instanceof EmpresaSignupError) {
          return redirectError(null, e.code === "SLUG_TAKEN" ? "slug_en_uso" : "email_en_uso");
        }
        throw e;
      }

      // Google ya verificó el email — la RPC hardcodea email_verificado:false,
      // así que se corrige acá. Best-effort (logueado, no aborta el signup si falla).
      const [, googleIdPatch] = await Promise.allSettled([
        sb(`empresa?id=eq.${emp.id}`, { method: "PATCH", body: JSON.stringify({ email_verificado: true }) }),
        sb(`empleados?id=eq.${adminEmp.id}`, { method: "PATCH", body: JSON.stringify({ google_id: googlePayload.sub }) }),
      ]);
      if (googleIdPatch.status === "rejected") {
        logger.error("No se pudo setear google_id en el admin recién creado", googleIdPatch.reason);
      }

      // La empresa arranca en plan Free — el admin inicia la prueba Pro de 14
      // días cuando quiera desde el botón en el dashboard.
      sendBienvenida({ to: googleEmail, nombre: adminEmp.nombre, empresa: emp.nombre, slug: emp.slug, empresaId: emp.id });
      logEvent(EVT.REGISTRO, { empresa_id: emp.id, plan: "free", meta: { rubro: "general", slug: emp.slug, via: "google" } });

      const { token: exchangeCode } = await signOAuthExchangeCode({
        empleadoId: adminEmp.id, empresaId: emp.id, legajo: 1, rol: "gerencial",
      });
      return redirectSuccess(emp.slug, exchangeCode);
    }

    // ═══ INTENT: login — resolver empleado dentro de un tenant existente ═══
    if (!stateSlug) return redirectError(null, "solicitud_invalida");

    const empresaRes = await sb(`empresa?slug=eq.${encodeURIComponent(stateSlug)}&select=id,slug,activa&limit=1`);
    const empresaRows = (await empresaRes.json()) as { id: string; slug: string; activa: boolean }[];
    const empresa = empresaRows[0];
    if (!empresa || empresa.activa === false) {
      return redirectError(stateSlug, "empresa_no_encontrada");
    }

    // 1. Buscar por google_id ya linkeado
    const porGoogleIdRes = await sb(
      `empleados?empresa_id=eq.${empresa.id}&google_id=eq.${encodeURIComponent(googlePayload.sub)}&activo=eq.true&select=id,legajo,rol&limit=1`
    );
    const porGoogleId = (await porGoogleIdRes.json()) as EmpleadoMatch[];
    let empleado: EmpleadoMatch | undefined = porGoogleId[0];

    // 2. Si no hay, intentar auto-link por email (primer login con Google de
    //    una cuenta que ya tenía password)
    if (!empleado) {
      const porEmailRes = await sb(
        `empleados?empresa_id=eq.${empresa.id}&email=eq.${encodeURIComponent(googleEmail)}&google_id=is.null&activo=eq.true&select=id,legajo,rol&limit=1`
      );
      const porEmail = (await porEmailRes.json()) as EmpleadoMatch[];
      empleado = porEmail[0];
      if (empleado) {
        await sb(`empleados?id=eq.${empleado.id}`, { method: "PATCH", body: JSON.stringify({ google_id: googlePayload.sub }) });
      }
    }

    if (!empleado) {
      return redirectError(stateSlug, "no_account");
    }

    const { token: exchangeCode } = await signOAuthExchangeCode({
      empleadoId: empleado.id, empresaId: empresa.id, legajo: empleado.legajo, rol: empleado.rol,
    });
    return redirectSuccess(empresa.slug, exchangeCode);
  } catch (e) {
    logger.error("Error en google/callback", e as Error);
    return redirectError(stateSlug, "error_interno");
  }
}
