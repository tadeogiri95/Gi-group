// ═══════════════════════════════════════════════════════════
// /api/chat/query — Ejecuta consultas de datos para el bot IA
//
// Recibe un tipo de consulta + parámetros, ejecuta en Supabase
// scoped por empresa_id de la sesión, devuelve datos formateados.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbQuery(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  return res.json();
}

const HOY = () => new Date().toISOString().slice(0, 10);

const QUERIES = {
  proyectos_hoy: async (empresaId, params) => {
    const fecha = params?.fecha || HOY();
    const regs = await sbQuery(
      `registro_actividades?empresa_id=eq.${empresaId}&fecha=eq.${fecha}&etapa=gt.0&select=codigo_proyecto,empleado_id,legajo,duracion_min,etapa,observaciones&order=hora_inicio.desc&limit=50`
    );
    if (!regs.length) return "No hay registros de producción para esa fecha.";
    const byProj = {};
    regs.forEach(r => {
      const k = r.codigo_proyecto || "SIN_OT";
      if (!byProj[k]) byProj[k] = { empleados: new Set(), minutos: 0, registros: 0 };
      byProj[k].empleados.add(r.legajo);
      byProj[k].minutos += parseFloat(r.duracion_min) || 0;
      byProj[k].registros++;
    });
    return Object.entries(byProj).map(([ot, d]) => (
      `OT ${ot}: ${d.empleados.size} empleado(s), ${Math.round(d.minutos)}min, ${d.registros} registros`
    )).join("\n");
  },

  quien_trabajo_proyecto: async (empresaId, params) => {
    const ot = params?.ot || params?.codigo_proyecto;
    if (!ot) return "Necesito el código OT del proyecto.";
    const regs = await sbQuery(
      `registro_actividades?empresa_id=eq.${empresaId}&codigo_proyecto=eq.${ot}&select=legajo,fecha,duracion_min,etapa,observaciones&order=fecha.desc&limit=30`
    );
    if (!regs.length) return `No encontré registros para OT ${ot}.`;
    const emps = await sbQuery(
      `empleados?empresa_id=eq.${empresaId}&select=legajo,nombre,division`
    );
    const empMap = Object.fromEntries(emps.map(e => [e.legajo, e]));
    const byEmp = {};
    regs.forEach(r => {
      if (!byEmp[r.legajo]) byEmp[r.legajo] = { nombre: empMap[r.legajo]?.nombre || `L-${r.legajo}`, division: empMap[r.legajo]?.division || "", min: 0, ultFecha: r.fecha };
      byEmp[r.legajo].min += parseFloat(r.duracion_min) || 0;
    });
    return Object.values(byEmp).map(e => (
      `${e.nombre} (${e.division || "sin div."}): ${Math.round(e.min)}min — última vez: ${e.ultFecha}`
    )).join("\n");
  },

  ultimo_responsable_tarea: async (empresaId, params) => {
    const ot = params?.ot || params?.codigo_proyecto;
    const etapa = params?.etapa;
    let q = `registro_actividades?empresa_id=eq.${empresaId}&etapa=gt.0&order=hora_inicio.desc&limit=1&select=legajo,codigo_proyecto,etapa,fecha,hora_inicio,observaciones`;
    if (ot) q += `&codigo_proyecto=eq.${ot}`;
    if (etapa) q += `&etapa=eq.${etapa}`;
    const regs = await sbQuery(q);
    if (!regs.length) return "No encontré registros con esos filtros.";
    const r = regs[0];
    const emps = await sbQuery(`empleados?empresa_id=eq.${empresaId}&legajo=eq.${r.legajo}&select=nombre,division`);
    const emp = emps[0];
    return `Último: ${emp?.nombre || `L-${r.legajo}`} (${emp?.division || "?"}) — OT ${r.codigo_proyecto || "?"}, etapa ${r.etapa}, fecha ${r.fecha}${r.observaciones ? ` — obs: ${r.observaciones}` : ""}`;
  },

  reporte_instalacion: async (empresaId, params) => {
    const ot = params?.ot || params?.codigo_proyecto;
    const fecha = params?.fecha;
    let q = `reportes_obra?empresa_id=eq.${empresaId}&order=created_at.desc&limit=5&select=id,nombre,legajo,fecha,texto_original,progreso`;
    if (ot) q += `&texto_original=ilike.*${ot}*`;
    if (fecha) q += `&fecha=eq.${fecha}`;
    const reps = await sbQuery(q);
    if (!reps.length) return "No encontré reportes de instalación con esos filtros.";
    return reps.map(r => (
      `[${r.fecha}] ${r.nombre || `L-${r.legajo}`}: ${(r.texto_original || "").slice(0, 200)}`
    )).join("\n---\n");
  },

  fichadas_hoy: async (empresaId, params) => {
    const fecha = params?.fecha || HOY();
    const fichs = await sbQuery(
      `fichadas?empresa_id=eq.${empresaId}&fecha=eq.${fecha}&select=legajo,ingreso,egreso,horas_trabajadas&order=ingreso.asc&limit=60`
    );
    if (!fichs.length) return `No hay fichadas para ${fecha}.`;
    const emps = await sbQuery(`empleados?empresa_id=eq.${empresaId}&select=legajo,nombre`);
    const empMap = Object.fromEntries(emps.map(e => [e.legajo, e.nombre]));
    return fichs.map(f => (
      `${empMap[f.legajo] || `L-${f.legajo}`}: ${f.ingreso?.slice(0,5) || "?"} → ${f.egreso?.slice(0,5) || "en planta"}${f.horas_trabajadas ? ` (${f.horas_trabajadas}h)` : ""}`
    )).join("\n");
  },

  solicitudes_pendientes: async (empresaId) => {
    const sols = await sbQuery(
      `solicitudes?empresa_id=eq.${empresaId}&estado=eq.pendiente&select=id,nombre_empleado,tipo,motivo,fecha,created_at&order=created_at.desc&limit=10`
    );
    if (!sols.length) return "No hay solicitudes pendientes.";
    return sols.map(s => (
      `#${s.id} [${s.tipo}] ${s.nombre_empleado}: "${s.motivo}" — ${s.fecha}`
    )).join("\n");
  },

  empleados_division: async (empresaId, params) => {
    const div = params?.division;
    let q = `empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=nombre,legajo,division,rol&order=nombre.asc&limit=50`;
    if (div) q += `&division=ilike.*${div}*`;
    const emps = await sbQuery(q);
    if (!emps.length) return "No encontré empleados con ese filtro.";
    return emps.map(e => `${e.nombre} (L-${e.legajo}) — ${e.division || "sin div."} [${e.rol}]`).join("\n");
  },

  proyectos_activos: async (empresaId) => {
    const proys = await sbQuery(
      `proyectos?empresa_id=eq.${empresaId}&estado=eq.activo&select=codigo,nombre&order=codigo.asc&limit=30`
    );
    if (!proys.length) return "No hay proyectos activos.";
    return proys.map(p => `OT ${p.codigo}${p.nombre ? ` — ${p.nombre}` : ""}`).join("\n");
  },
};

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado();

    const { query_type, params } = await request.json();

    if (!query_type || !QUERIES[query_type]) {
      return NextResponse.json({ error: "Tipo de consulta no válido" }, { status: 400 });
    }

    const resultado = await QUERIES[query_type](sesion.empresa_id, params || {});
    return NextResponse.json({ resultado });
  } catch (err) {
    return NextResponse.json({ error: "Error al consultar datos" }, { status: 500 });
  }
}
