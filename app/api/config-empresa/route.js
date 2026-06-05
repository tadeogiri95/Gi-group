// ═══════════════════════════════════════════════════════════
// API: /api/config-empresa/route.js — VERSIÓN SEGURA
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// Se elimina validarToken local y getEmpresaIdFromRequest.
// ═══════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Helper: extraer empresa_id del request via auth compartido ───
async function getEmpresaIdFromRequest(request) {
  const sesion = await validarToken(request);
  return sesion?.empresa_id || null;
}

// ─── REST helpers ───
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

async function perteneceAEmpresa(tabla, id, empresaId) {
  const rows = await sbGet(`${tabla}?id=eq.${id}&select=empresa_id`);
  return rows.length > 0 && rows[0].empresa_id === empresaId;
}

// ═══ GET ═══
export async function GET(request) {
  try {
    const empresaId = await getEmpresaIdFromRequest(request);
    if (!empresaId) return respuestaNoAutorizado();

    const [divisiones, etapas] = await Promise.all([
      sbGet(`divisiones?empresa_id=eq.${empresaId}&activa=eq.true&order=orden.asc`),
      sbGet(`etapas?empresa_id=eq.${empresaId}&activa=eq.true&order=orden.asc`),
    ]);
    return NextResponse.json({ divisiones: divisiones || [], etapas: etapas || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ═══ POST ═══
export async function POST(request) {
  try {
    const empresaId = await getEmpresaIdFromRequest(request);
    if (!empresaId) return respuestaNoAutorizado();

    const body = await request.json();
    const { action } = body;

    if (action === "add_division") {
      const { clave, label, icon, color, orden } = body;
      if (!clave || !label) return NextResponse.json({ error: "clave y label requeridos" }, { status: 400 });
      const result = await sbPost("divisiones", {
        empresa_id: empresaId, clave, label,
        icon: icon || "📦", color: color || "#F97316", orden: orden || 99,
      });
      return NextResponse.json({ division: result[0] });
    }

    if (action === "add_etapa") {
      const { codigo, nombre, icon, color, orden } = body;
      if (codigo === undefined || !nombre) return NextResponse.json({ error: "codigo y nombre requeridos" }, { status: 400 });
      const result = await sbPost("etapas", {
        empresa_id: empresaId, codigo, nombre,
        icon: icon || "🔨", color: color || "#F97316", orden: orden || 99,
      });
      return NextResponse.json({ etapa: result[0] });
    }

    if (action === "save_logo") {
      const { logo_url } = body;
      await sbPatch(`empresa?id=eq.${empresaId}`, { logo_url });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action inválido" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ═══ PATCH ═══
export async function PATCH(request) {
  try {
    const empresaId = await getEmpresaIdFromRequest(request);
    if (!empresaId) return respuestaNoAutorizado();

    const body = await request.json();
    const { action, id } = body;
    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    if (action === "update_division") {
      if (!(await perteneceAEmpresa("divisiones", id, empresaId)))
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      const { label, icon, color, orden, activa } = body;
      const updates = {};
      if (label !== undefined) updates.label = label;
      if (icon !== undefined) updates.icon = icon;
      if (color !== undefined) updates.color = color;
      if (orden !== undefined) updates.orden = orden;
      if (activa !== undefined) updates.activa = activa;
      const result = await sbPatch(`divisiones?id=eq.${id}&empresa_id=eq.${empresaId}`, updates);
      return NextResponse.json({ division: result[0] });
    }

    if (action === "update_etapa") {
      if (!(await perteneceAEmpresa("etapas", id, empresaId)))
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      const { nombre, icon, color, codigo, orden, activa } = body;
      const updates = {};
      if (nombre !== undefined) updates.nombre = nombre;
      if (icon !== undefined) updates.icon = icon;
      if (color !== undefined) updates.color = color;
      if (codigo !== undefined) updates.codigo = codigo;
      if (orden !== undefined) updates.orden = orden;
      if (activa !== undefined) updates.activa = activa;
      const result = await sbPatch(`etapas?id=eq.${id}&empresa_id=eq.${empresaId}`, updates);
      return NextResponse.json({ etapa: result[0] });
    }

    return NextResponse.json({ error: "action inválido" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ═══ DELETE ═══
export async function DELETE(request) {
  try {
    const empresaId = await getEmpresaIdFromRequest(request);
    if (!empresaId) return respuestaNoAutorizado();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const id = searchParams.get("id");
    if (!id || !type) return NextResponse.json({ error: "type e id requeridos" }, { status: 400 });

    const tabla = type === "division" ? "divisiones" : type === "etapa" ? "etapas" : null;
    if (!tabla) return NextResponse.json({ error: "type inválido" }, { status: 400 });

    if (!(await perteneceAEmpresa(tabla, id, empresaId)))
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    await sbPatch(`${tabla}?id=eq.${id}&empresa_id=eq.${empresaId}`, { activa: false });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
