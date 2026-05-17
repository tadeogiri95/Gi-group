// ═══════════════════════════════════════════════════════════════
// GI GROUP — API Route para enviar Push Notifications
// Este archivo VA EN: app/api/send-push/route.js
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

const SUPABASE_URL = "https://olhrkpaxadrtvhbewkff.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9saHJrcGF4YWRydHZoYmV3a2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDQ0OTksImV4cCI6MjA5NDQ4MDQ5OX0.oMs25ZKlOASVXfg0xSHvaUxDd3d5_cX3ZzdXZ1JtAi0";

// ─── Obtener access token de Google usando service account ───
async function getAccessToken() {
  // Usamos las credenciales de la variable de entorno
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");

  if (!serviceAccount.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT no configurado en Vercel");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  // Crear JWT firmado con RS256
  const { createSign } = await import("crypto");

  const encodeB64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const headerB64 = encodeB64(header);
  const payloadB64 = encodeB64(payload);
  const signInput = `${headerB64}.${payloadB64}`;

  const sign = createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(serviceAccount.private_key, "base64url");

  const jwt = `${signInput}.${signature}`;

  // Intercambiar JWT por access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("No se pudo obtener access token: " + JSON.stringify(tokenData));
  }

  return tokenData.access_token;
}

// ─── Enviar push via FCM v1 HTTP API ─────────────────────────
async function sendFCMNotification(accessToken, fcmToken, title, body, data = {}) {
  const projectId = "gi-group-app-676a0";

  const message = {
    message: {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      webpush: {
        notification: {
          title,
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          vibrate: [200, 100, 200],
          tag: data.tag || "gi-group",
          requireInteraction: true,
        },
        fcm_options: {
          link: data.url || "https://gi-group-app.vercel.app",
        },
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    }
  );

  const result = await res.json();
  return { ok: res.ok, status: res.status, result };
}

// ─── API Route Handler ───────────────────────────────────────
export async function POST(request) {
  try {
    const { legajo, rol, title, body, data } = await request.json();

    if (!title || !body) {
      return NextResponse.json(
        { ok: false, error: "Faltan title y body" },
        { status: 400 }
      );
    }

    // Obtener tokens de los destinatarios
    let tokens = [];

    if (legajo) {
      // Enviar a un legajo específico
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/push_tokens?legajo=eq.${legajo}&select=token`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      tokens = (await res.json()).map((t) => t.token);
    } else if (rol) {
      // Enviar a todos los de un rol (buscar legajos con ese rol, luego sus tokens)
      const empRes = await fetch(
        `${SUPABASE_URL}/rest/v1/empleados?rol=eq.${rol}&select=legajo`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const empleados = await empRes.json();
      const legajos = empleados.map((e) => e.legajo);

      if (legajos.length > 0) {
        const tokRes = await fetch(
          `${SUPABASE_URL}/rest/v1/push_tokens?legajo=in.(${legajos.join(",")}))&select=token,legajo`,
          {
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
          }
        );
        tokens = (await tokRes.json()).map((t) => t.token);
      }
    }

    if (tokens.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        message: "No hay dispositivos registrados para este destinatario",
      });
    }

    // Obtener access token de Google
    const accessToken = await getAccessToken();

    // Enviar a cada token
    const results = [];
    const failedTokens = [];

    for (const token of tokens) {
      const result = await sendFCMNotification(accessToken, token, title, body, data || {});
      results.push(result);

      // Si el token es inválido, marcarlo para eliminación
      if (!result.ok && result.status === 404) {
        failedTokens.push(token);
      }
    }

    // Limpiar tokens inválidos
    if (failedTokens.length > 0) {
      for (const ft of failedTokens) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/push_tokens?token=eq.${encodeURIComponent(ft)}`,
          {
            method: "DELETE",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
          }
        );
      }
    }

    const sent = results.filter((r) => r.ok).length;

    return NextResponse.json({
      ok: true,
      sent,
      total: tokens.length,
      failed: tokens.length - sent,
    });
  } catch (err) {
    console.error("[send-push] Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
