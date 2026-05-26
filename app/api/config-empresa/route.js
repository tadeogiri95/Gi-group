// ═══════════════════════════════════════════════════════════
// API: /api/config-empresa/route.js
// CRUD de divisiones, etapas y logo por empresa
// ═══════════════════════════════════════════════════════════
import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPost(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbDelete(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(await r.text());
}

// GET — Cargar divisiones y etapas de una empresa
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresaId = searchParams.get("empresa_id");
    if (!empresaId) return NextResponse.json({ error: "empresa_id requerido" }, { status: 400 });

    const [divisiones, etapas] = await Promise.all([
      sbGet(`divisiones?empresa_id=eq.${empresaId}&activa=eq.true&order=orden.asc`),
      sbGet(`etapas?empresa_id=eq.${empresaId}&activa=eq.true&order=orden.asc`),
    ]);

    return NextResponse.json({ divisiones: divisiones || [], etapas: etapas || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — Crear división o etapa, o subir logo
export async function POST(request) {
  try {
    const body = await request.json();
    const { action, empresa_id } = body;
    if (!empresa_id) return NextResponse.json({ error: "empresa_id requerido" }, { status: 400 });

    if (action === "add_division") {
      const { clave, label, icon, color, orden } = body;
      if (!clave || !label) return NextResponse.json({ error: "clave y label requeridos" }, { status: 400 });
      const result = await sbPost("divisiones", { empresa_id, clave, label, icon: icon || "📦", color: color || "#F97316", orden: orden || 99 });
      return NextResponse.json({ division: result[0] });
    }

    if (action === "add_etapa") {
      const { codigo, nombre, icon, color, orden } = body;
      if (!codigo || !nombre) return NextResponse.json({ error: "codigo y nombre requeridos" }, { status: 400 });
      const result = await sbPost("etapas", { empresa_id, codigo, nombre, icon: icon || "🔨", color: color || "#F97316", orden: orden || 99 });
      return NextResponse.json({ etapa: result[0] });
    }

    if (action === "save_logo") {
      const { logo_url } = body;
      await sbPatch(`empresa?id=eq.${empresa_id}`, { logo_url });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action inválido" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH — Actualizar división o etapa
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { action, id } = body;
    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    if (action === "update_division") {
      const { label, icon, color, orden, activa } = body;
      const updates = {};
      if (label !== undefined) updates.label = label;
      if (icon !== undefined) updates.icon = icon;
      if (color !== undefined) updates.color = color;
      if (orden !== undefined) updates.orden = orden;
      if (activa !== undefined) updates.activa = activa;
      const result = await sbPatch(`divisiones?id=eq.${id}`, updates);
      return NextResponse.json({ division: result[0] });
    }

    if (action === "update_etapa") {
      const { nombre, icon, color, codigo, orden, activa } = body;
      const updates = {};
      if (nombre !== undefined) updates.nombre = nombre;
      if (icon !== undefined) updates.icon = icon;
      if (color !== undefined) updates.color = color;
      if (codigo !== undefined) updates.codigo = codigo;
      if (orden !== undefined) updates.orden = orden;
      if (activa !== undefined) updates.activa = activa;
      const result = await sbPatch(`etapas?id=eq.${id}`, updates);
      return NextResponse.json({ etapa: result[0] });
    }

    return NextResponse.json({ error: "action inválido" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — Eliminar (soft delete → activa=false)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const id = searchParams.get("id");
    if (!id || !type) return NextResponse.json({ error: "type e id requeridos" }, { status: 400 });

    if (type === "division") {
      await sbPatch(`divisiones?id=eq.${id}`, { activa: false });
    } else if (type === "etapa") {
      await sbPatch(`etapas?id=eq.${id}`, { activa: false });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
