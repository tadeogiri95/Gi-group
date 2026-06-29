// GET /api/auth/google/start?intent=registro|login&slug=xxx
//
// Punto de entrada de "Continuar con Google". Genera el state CSRF (JWT
// firmado + nonce en cookie httpOnly) y redirige al consentimiento de Google.
// El callback (google/callback/route.ts) verifica ambos antes de confiar en
// el intent/slug que vuelven desde Google.

import { NextRequest, NextResponse } from "next/server";
import { signOAuthState } from "../../../../lib/jwt";
import { slug as slugSchema } from "../../../../lib/schemas";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
const OAUTH_STATE_COOKIE = "gypi_oauth_state";

function generarNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "Google OAuth no está configurado" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const intent = searchParams.get("intent");
  if (intent !== "registro" && intent !== "login") {
    return NextResponse.json({ error: "Parámetro intent inválido" }, { status: 400 });
  }

  let slug: string | null = null;
  // slug es opcional para intent=login: si no viene (ej. "Iniciar sesión con
  // Google" desde la landing, sin saber a qué empresa pertenece), el callback
  // resuelve el tenant buscando el empleado en todas las empresas.
  if (intent === "login") {
    const rawSlug = searchParams.get("slug");
    if (rawSlug) {
      const parsedSlug = slugSchema.safeParse(rawSlug);
      if (!parsedSlug.success) {
        return NextResponse.json({ error: "Parámetro slug inválido" }, { status: 400 });
      }
      slug = parsedSlug.data;
    }
  }

  const nonce = generarNonce();
  const state = await signOAuthState({ intent, slug, nonce });

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  googleUrl.searchParams.set("redirect_uri", `${APP_BASE}/api/auth/google/callback`);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(googleUrl.toString(), { status: 302 });
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: nonce,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
