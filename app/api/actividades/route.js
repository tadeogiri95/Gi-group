import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Service role client (bypasea RLS — solo para API routes server-side)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/actividades?empleado_id=xxx&fecha=2025-01-15
// GET /api/actividades?division=herreria&fecha=2025-01-15  (gerencia)
// GET /api/actividades?activa=true&empleado_id=xxx
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const empleado_id = searchParams.get("empleado_id");
  const division = searchParams.get("division");
  const fecha = searchParams.get("fecha") || new Date().toISOString().slice(0, 10);
  const activa = searchParams.get("activa");

  try {
    // Caso 1: Obtener tarea activa del operario
    if (activa === "true" && empleado_id) {
      const { data, error } = await supabase
        .from("registro_actividades")
        .select("*, catalogo_etapas!inner(nombre, icon, color)")
        .eq("empleado_id", empleado_id)
        .is("hora_fin", null)
        .maybeSingle();

      if (error) throw error;
      return NextResponse.json({ activa: data });
    }

    // Caso 2: Historial del día de un operario
    if (empleado_id) {
      const { data, error } = await supabase
        .from("registro_actividades")
        .select("*")
        .eq("empleado_id", empleado_id)
        .eq("fecha", fecha)
        .order("hora_inicio", { ascending: false });

      if (error) throw error;
      return NextResponse.json({ registros: data });
    }

    // Caso 3: Vista gerencia — resumen del equipo
    if (division) {
      const { data, error } = await supabase
        .from("v_resumen_diario")
        .select("*")
        .eq("division", division)
        .eq("fecha", fecha);

      if (error) throw error;
      return NextResponse.json({ equipo: data });
    }

    return NextResponse.json({ error: "Parámetros faltantes" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/actividades — Iniciar nueva tarea
export async function POST(req) {
  try {
    const body = await req.json();
    const {
      empleado_id, legajo, codigo_proyecto,
      etapa, tipo, causa, division
    } = body;

    // Validaciones server-side
    if (!empleado_id || !legajo || etapa == null || !tipo || !division) {
      return NextResponse.json({ error: "Campos obligatorios faltantes" }, { status: 400 });
    }
    if (etapa === 0 && !causa) {
      return NextResponse.json({ error: "Etapa 0 requiere causa" }, { status: 400 });
    }
    if (etapa > 0 && !codigo_proyecto) {
      return NextResponse.json({ error: "Etapas productivas requieren código de proyecto" }, { status: 400 });
    }

    const ahora = new Date().toISOString();

    // El trigger trg_cerrar_tarea_previa se encarga de cerrar la anterior
    const { data, error } = await supabase
      .from("registro_actividades")
      .insert({
        empleado_id,
        legajo,
        fecha: ahora.slice(0, 10),
        hora_inicio: ahora,
        hora_fin: null,
        codigo_proyecto: etapa === 0 ? null : codigo_proyecto,
        etapa,
        tipo,
        causa: etapa === 0 ? causa : null,
        division,
        duracion_min: null,
        observaciones: null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ registro: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/actividades — Finalizar tarea activa
export async function PATCH(req) {
  try {
    const { id, observaciones } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const ahora = new Date().toISOString();

    const { data, error } = await supabase
      .from("registro_actividades")
      .update({
        hora_fin: ahora,
        // duracion_min se calcula automáticamente via trigger
        ...(observaciones ? { observaciones } : {}),
      })
      .eq("id", id)
      .is("hora_fin", null) // Solo si está activa
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ registro: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}