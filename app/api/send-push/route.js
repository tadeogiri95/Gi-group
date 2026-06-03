// ═══════════════════════════════════════════════════════════
// /api/send-push — Bloque 4: FCM HTTP v1 + limpieza tokens inválidos
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import admin from "firebase-admin";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Inicializar firebase-admin (singleton) ───
function getAdminApp() {
  if (admin.apps.length > 0) return admin.app();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT no configurada");
  let credentials;
  try {
    credentials = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT no es JSON válido");
  }
  return admin.initializeApp({
    credential: admin.credential.cert(credentials),
  });
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

async function sbDelete(path) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
  } catch (e) {
    console.error("[send-push] Error borrando token:", e.message);
  }
}

// Borra un token específico de la tabla push_tokens
async function eliminarTokenInvalido(token) {
  await sbDelete(`push_tokens?token=eq.${encodeURIComponent(token)}`);
  console.log("[send-push] Token inválido eliminado:", token.slice(0, 20) + "...");
}

export async function POST(request) {
  try {
    const { legajo, rol, title, body, data = {} } = await request.json();

    if (!title || !body) {
      return NextResponse.json({ error: "title y body requeridos" }, { status: 400 });
    }

    const empresaId = data.empresa_id || null;

    // Buscar nombre de empresa si viene empresa_id
    let empresaNombre = null;
    if (empresaId) {
      try {
        const emp = await sbGet(`empresa?id=eq.${empresaId}&select=nombre_corto,nombre`);
        if (emp?.[0]) empresaNombre = emp[0].nombre_corto || emp[0].nombre;
      } catch {}
    }

    // Buscar tokens destino
    let tokens = [];
    if (legajo) {
      let query = `push_tokens?legajo=eq.${legajo}&select=token`;
      if (empresaId) query += `&empresa_id=eq.${empresaId}`;
      tokens = await sbGet(query);
    } else if (rol) {
      let empQuery = `empleados?rol=eq.${rol}&activo=eq.true&select=legajo`;
      if (empresaId) empQuery += `&empresa_id=eq.${empresaId}`;
      const empleados = await sbGet(empQuery);
      const legajos = empleados.map(e => e.legajo);
      if (legajos.length > 0) {
        let tokQuery = `push_tokens?legajo=in.(${legajos.join(",")})&select=token`;
        if (empresaId) tokQuery += `&empresa_id=eq.${empresaId}`;
        tokens = await sbGet(tokQuery);
      }
    }

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, message: "Sin tokens registrados" });
    }

    // Inicializar admin
    let app;
    try {
      app = getAdminApp();
    } catch (err) {
      console.error("[send-push] Error init admin:", err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    const messaging = admin.messaging(app);

    // Preparar data payload (todo string, requisito de FCM)
    const dataPayload = {};
    Object.entries({ ...data, title, body, ...(empresaNombre ? { empresa_nombre: empresaNombre } : {}) }).forEach(([k, v]) => {
      if (v != null) dataPayload[k] = String(v);
    });

    // Enviar uno a uno para poder identificar tokens inválidos
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
          // Tokens inválidos: limpiar de la DB
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

    // Eliminar tokens inválidos detectados
    for (const tk of tokensInvalidos) {
      await eliminarTokenInvalido(tk);
      removed++;
    }

    return NextResponse.json({
      ok: true,
      sent,
      total: tokens.length,
      removed,
    });
  } catch (err) {
    console.error("[send-push] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}