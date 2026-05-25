import { NextResponse } from "next/server";

// ─── Supabase server-side ───
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ─── POST /api/data ───
export async function POST(request) {
  try {
    const { method, path, body } = await request.json();

    if (!path) {
      return NextResponse.json({ error: "Path requerido" }, { status: 400 });
    }

    const tablasBloqueadas = ["auth", "storage"];
    const tabla = path.split("?")[0].split("/")[0];
    if (tablasBloqueadas.includes(tabla)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const opts = {};
    if (method === "POST") {
      opts.method = "POST";
      opts.body = JSON.stringify(body);
    } else if (method === "PATCH") {
      opts.method = "PATCH";
      opts.body = JSON.stringify(body);
    } else if (method === "DELETE") {
      opts.method = "DELETE";
    }

    const data = await sbFetch(path, opts);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[data] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
