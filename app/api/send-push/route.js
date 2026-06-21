// ═══════════════════════════════════════════════════════════
// /api/send-push — FCM HTTP v1 + limpieza tokens inválidos
//
// ENTREGA 1C: Protegido con auth. empresa_id forzado desde sesión.
// Antes: cualquiera podía enviar push a cualquier empresa.
// Ahora: requiere sesión válida, empresa_id sale del token.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import admin from "firebase-admin";
import { sbGet, sbDelete } from "../../lib/sbHelpers";
import { sendPushBody } from "../../lib/schemas";
import { validateBody, safeErrorMessage } from "../../lib/validate";

function getAdminApp() {
  if (admin.apps.length > 0) return admin.app();

  // Acepta la credencial en JSON directo (FIREBASE_SERVICE_ACCOUNT)
  // o en base64 (FIREBASE_SERVICE_ACCOUNT_B64) para compatibilidad con Vercel
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const rawB64  = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const raw = rawJson || (rawB64 ? Buffer.from(rawB64, "base64").toString("utf-8") : null);

  if (!raw) throw new Error("Falta FIREBASE_SERVICE_ACCOUNT o FIREBASE_SERVICE_ACCOUNT_B64");

  let credentials;
  try {
    credentials = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("Las credenciales de Firebase no son JSON válido");
  }
  return admin.initializeApp({
    credential: admin.credential.cert(credentials),
  });
}

async function eliminarTokenInvalido(token) {
  await sbDelete(`push_tokens?token=eq.${encodeURIComponent(token)}`, { silent: true });
  console.log("[send-push] Token inválido eliminado:", token.slice(0, 20) + "...");
}

export async function POST(request) {
  try {
    // ═══ CAMBIO 1C: Auth obligatoria ═══
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado();

    // ═══ CAMBIO 1C: empresa_id SIEMPRE de la sesión, nunca del body ═══
    const empresaId = sesion.empresa_id;

    const rawBody = await request.json();
    const parsed = validateBody(sendPushBody, rawBody);
    if (parsed.response) return parsed.response;
    const { legajo, rol, title, body, data = {} } = parsed.data;

    // Buscar nombre de empresa
    let empresaNombre = null;
    try {
      const emp = await sbGet(`empresa?id=eq.${empresaId}&select=nombre_corto,nombre`);
      if (emp?.[0]) empresaNombre = emp[0].nombre_corto || emp[0].nombre;
    } catch {}

    // Buscar tokens destino (siempre filtrado por empresa de la sesión)
    let tokens = [];
    if (legajo) {
      tokens = await sbGet(`push_tokens?legajo=eq.${legajo}&empresa_id=eq.${empresaId}&select=token`);
    } else if (rol) {
      const empleados = await sbGet(`empleados?rol=eq.${rol}&activo=eq.true&empresa_id=eq.${empresaId}&select=legajo`);
      const legajos = empleados.map(e => e.legajo);
      if (legajos.length > 0) {
        tokens = await sbGet(`push_tokens?legajo=in.(${legajos.join(",")})&empresa_id=eq.${empresaId}&select=token`);
      }
    }

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, message: "Sin tokens registrados" });
    }

    let app;
    try {
      app = getAdminApp();
    } catch (err) {
      console.error("[send-push] Error init admin:", err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    const messaging = admin.messaging(app);

    const dataPayload = {};
    Object.entries({ ...data, empresa_id: empresaId, title, body, ...(empresaNombre ? { empresa_nombre: empresaNombre } : {}) }).forEach(([k, v]) => {
      if (v != null) dataPayload[k] = String(v);
    });

    let sent = 0;
    let removed = 0;
    const tokensInvalidos = [];

    await Promise.allSettled(
      tokens.map(async (t) => {
        try {
          await messaging.send({
            token: t.token,
            notification: { title, body },
            data: dataPayload,
            webpush: {
              notification: {
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
              },
            },
          });
          sent++;
        } catch (err) {
          const code = err?.errorInfo?.code || err?.code || "";
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token" ||
            code === "messaging/invalid-argument"
          ) {
            tokensInvalidos.push(t.token);
          } else {
            console.error("[send-push] Error FCM:", code, err.message);
          }
        }
      })
    );

    if (tokensInvalidos.length > 0) {
      const encoded = tokensInvalidos.map((t) => encodeURIComponent(t)).join(",");
      await sbDelete(`push_tokens?token=in.(${encoded})`, { silent: true });
      removed = tokensInvalidos.length;
    }

    return NextResponse.json({ ok: true, sent, total: tokens.length, removed });
  } catch (err) {
    console.error("[send-push] Error:", err.message);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
