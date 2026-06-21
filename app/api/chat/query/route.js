// ═══════════════════════════════════════════════════════════
// /api/chat/query — Ejecuta consultas de datos para el bot IA
//
// Recibe un tipo de consulta + parámetros, ejecuta en Supabase
// scoped por empresa_id de la sesión, devuelve datos formateados.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { hoyArg } from "../../../lib/dates";
import { sanitizePostgrestParam } from "../../../lib/validate";
import { chatQueryBody } from "../../../lib/schemas";
import { checkRateLimit } from "../../../lib/rateLimitMemory";

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

const HOY = () => hoyArg();
const MES_INICIO = () => hoyArg().slice(0, 7) + "-01";

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
      `fichadas?empresa_id=eq.${empresaId}&fecha=eq.${fecha}&select=legajo,ingreso,egreso,horas_trabajadas,horas_extra&order=ingreso.asc&limit=60`
    );
    if (!fichs.length) return `No hay fichadas para ${fecha}.`;
    const emps = await sbQuery(`empleados?empresa_id=eq.${empresaId}&select=legajo,nombre`);
    const empMap = Object.fromEntries(emps.map(e => [e.legajo, e.nombre]));
    return fichs.map(f => (
      `${empMap[f.legajo] || `L-${f.legajo}`}: ${f.ingreso?.slice(0,5) || "?"} → ${f.egreso?.slice(0,5) || "en planta"}${f.horas_trabajadas ? ` (${f.horas_trabajadas}h)` : ""}${parseFloat(f.horas_extra) > 0 ? ` [+${f.horas_extra}h extra]` : ""}`
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
      `proyectos?empresa_id=eq.${empresaId}&estado=eq.activo&select=ot,cliente,proyecto&order=ot.asc&limit=30`
    );
    if (!proys.length) return "No hay proyectos activos.";
    return proys.map(p => { const nombre = p.cliente || p.proyecto; return `OT ${p.ot}${nombre ? ` — ${nombre}` : ""}`; }).join("\n");
  },

  // ═══ QUERIES GERENCIALES (nuevas) ═══

  horas_empleado: async (empresaId, params) => {
    const desde = params?.desde || MES_INICIO();
    const hasta = params?.hasta || HOY();
    const nombre = params?.nombre_o_legajo;
    if (!nombre) return "Necesito el nombre o legajo del empleado.";

    const isLegajo = /^\d+$/.test(nombre);
    let empQ = `empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=id,nombre,legajo,division`;
    empQ += isLegajo ? `&legajo=eq.${nombre}` : `&nombre=ilike.*${nombre}*`;
    const emps = await sbQuery(empQ + "&limit=5");
    if (!emps.length) return `No encontré empleado con ${isLegajo ? "legajo" : "nombre"} "${nombre}".`;

    const resultados = [];
    for (const emp of emps) {
      const fichs = await sbQuery(
        `fichadas?empresa_id=eq.${empresaId}&empleado_id=eq.${emp.id}&fecha=gte.${desde}&fecha=lte.${hasta}&select=fecha,horas_trabajadas,horas_extra,llegada_tarde&order=fecha.asc`
      );
      const totalHoras = fichs.reduce((s, f) => s + (parseFloat(f.horas_trabajadas) || 0), 0);
      const totalExtra = fichs.reduce((s, f) => s + (parseFloat(f.horas_extra) || 0), 0);
      const tardanzas = fichs.filter(f => f.llegada_tarde).length;
      resultados.push(`${emp.nombre} (L-${emp.legajo}, ${emp.division || "sin div."}): ${fichs.length} días fichados, ${totalHoras.toFixed(1)}h trabajadas, ${totalExtra.toFixed(1)}h extra, ${tardanzas} tardanzas — período ${desde} a ${hasta}`);
    }
    return resultados.join("\n");
  },

  ausencias_semana: async (empresaId, params) => {
    const hasta = params?.hasta || HOY();
    const desde = params?.desde || (() => {
      const d = new Date(hasta);
      d.setDate(d.getDate() - 7);
      return d.toISOString().slice(0, 10);
    })();

    const emps = await sbQuery(
      `empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=id,nombre,legajo,diagrama,division`
    );
    const fichs = await sbQuery(
      `fichadas?empresa_id=eq.${empresaId}&fecha=gte.${desde}&fecha=lte.${hasta}&select=empleado_id,fecha`
    );
    const fichMap = {};
    fichs.forEach(f => {
      if (!fichMap[f.empleado_id]) fichMap[f.empleado_id] = new Set();
      fichMap[f.empleado_id].add(f.fecha);
    });

    const DIAS_SEM = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
    const ausentes = [];
    for (const emp of emps) {
      const diag = emp.diagrama || {};
      const diasFalta = [];
      const d = new Date(desde);
      const fin = new Date(hasta);
      while (d <= fin) {
        const ds = d.toISOString().slice(0, 10);
        const diaKey = DIAS_SEM[d.getDay()];
        if (diag[diaKey] && diag[diaKey].in) {
          if (!fichMap[emp.id]?.has(ds)) diasFalta.push(ds);
        }
        d.setDate(d.getDate() + 1);
      }
      if (diasFalta.length > 0) {
        ausentes.push(`${emp.nombre} (L-${emp.legajo}, ${emp.division || "?"}): ${diasFalta.length} falta(s) — ${diasFalta.join(", ")}`);
      }
    }
    if (!ausentes.length) return `No hubo ausencias entre ${desde} y ${hasta}.`;
    return ausentes.sort((a, b) => b.split(": ")[1] - a.split(": ")[1]).join("\n");
  },

  productividad_promedio: async (empresaId, params) => {
    const desde = params?.desde || MES_INICIO();
    const hasta = params?.hasta || HOY();
    const data = await sbQuery(
      `v_resumen_diario?empresa_id=eq.${empresaId}&fecha=gte.${desde}&fecha=lte.${hasta}&select=fecha,minutos_productivos,minutos_espera`
    );
    if (!data.length) return `Sin datos de productividad entre ${desde} y ${hasta}.`;

    const porDia = {};
    data.forEach(r => {
      if (!porDia[r.fecha]) porDia[r.fecha] = { prod: 0, espera: 0 };
      porDia[r.fecha].prod += parseFloat(r.minutos_productivos) || 0;
      porDia[r.fecha].espera += parseFloat(r.minutos_espera) || 0;
    });

    const lineas = Object.entries(porDia).sort(([a], [b]) => a.localeCompare(b)).map(([fecha, d]) => {
      const total = d.prod + d.espera;
      const pct = total > 0 ? Math.round(d.prod * 100 / total) : 0;
      return `${fecha}: ${pct}% productivo (${Math.round(d.prod)}min prod / ${Math.round(d.espera)}min espera)`;
    });

    const totalProd = Object.values(porDia).reduce((s, d) => s + d.prod, 0);
    const totalEspera = Object.values(porDia).reduce((s, d) => s + d.espera, 0);
    const pctGlobal = (totalProd + totalEspera) > 0 ? Math.round(totalProd * 100 / (totalProd + totalEspera)) : 0;

    return lineas.join("\n") + `\n\nPromedio general: ${pctGlobal}% productivo`;
  },

  ranking_tardanzas: async (empresaId, params) => {
    const [anioHoy, mesHoy] = hoyArg().split("-").map(Number);
    const mes = params?.mes || mesHoy;
    const anio = params?.anio || anioHoy;
    const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
    const hastaDate = new Date(anio, mes, 0);
    const hasta = hastaDate.toISOString().slice(0, 10);

    const fichs = await sbQuery(
      `fichadas?empresa_id=eq.${empresaId}&fecha=gte.${desde}&fecha=lte.${hasta}&llegada_tarde=eq.true&select=empleado_id,legajo,minutos_tarde`
    );
    if (!fichs.length) return `No hay tardanzas registradas en ${mes}/${anio}.`;

    const emps = await sbQuery(`empleados?empresa_id=eq.${empresaId}&select=id,nombre,legajo,division`);
    const empMap = Object.fromEntries(emps.map(e => [e.id, e]));

    const byEmp = {};
    fichs.forEach(f => {
      if (!byEmp[f.empleado_id]) byEmp[f.empleado_id] = { count: 0, minTotal: 0 };
      byEmp[f.empleado_id].count++;
      byEmp[f.empleado_id].minTotal += f.minutos_tarde || 0;
    });

    return Object.entries(byEmp)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([id, d]) => {
        const emp = empMap[id];
        return `${emp?.nombre || `ID-${id}`} (L-${emp?.legajo || "?"}, ${emp?.division || "?"}): ${d.count} tardanzas, ${d.minTotal}min acumulados`;
      }).join("\n");
  },

  horas_extra_mes: async (empresaId, params) => {
    const [anioHoy2, mesHoy2] = hoyArg().split("-").map(Number);
    const mes = params?.mes || mesHoy2;
    const anio = params?.anio || anioHoy2;
    const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
    const hastaDate = new Date(anio, mes, 0);
    const hasta = hastaDate.toISOString().slice(0, 10);

    const fichs = await sbQuery(
      `fichadas?empresa_id=eq.${empresaId}&fecha=gte.${desde}&fecha=lte.${hasta}&horas_extra=gt.0&select=empleado_id,horas_extra`
    );
    if (!fichs.length) return `No hay horas extra registradas en ${mes}/${anio}.`;

    const emps = await sbQuery(`empleados?empresa_id=eq.${empresaId}&select=id,nombre,legajo,division`);
    const empMap = Object.fromEntries(emps.map(e => [e.id, e]));

    const byEmp = {};
    fichs.forEach(f => {
      if (!byEmp[f.empleado_id]) byEmp[f.empleado_id] = 0;
      byEmp[f.empleado_id] += parseFloat(f.horas_extra) || 0;
    });

    return Object.entries(byEmp)
      .sort(([, a], [, b]) => b - a)
      .map(([id, total]) => {
        const emp = empMap[id];
        return `${emp?.nombre || `ID-${id}`} (L-${emp?.legajo || "?"}, ${emp?.division || "?"}): ${total.toFixed(1)}h extra`;
      }).join("\n");
  },

  ots_activas: async (empresaId, params) => {
    const dias = params?.dias || 7;
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const desdeStr = desde.toISOString().slice(0, 10);

    const regs = await sbQuery(
      `registro_actividades?empresa_id=eq.${empresaId}&fecha=gte.${desdeStr}&etapa=gt.0&select=codigo_proyecto,legajo,duracion_min,fecha&order=fecha.desc&limit=200`
    );
    if (!regs.length) return `No hay actividad productiva en los últimos ${dias} días.`;

    const emps = await sbQuery(`empleados?empresa_id=eq.${empresaId}&select=legajo,nombre`);
    const empMap = Object.fromEntries(emps.map(e => [e.legajo, e.nombre]));

    const proys = await sbQuery(`proyectos?empresa_id=eq.${empresaId}&estado=eq.activo&select=ot,cliente,proyecto`);
    const proyMap = Object.fromEntries(proys.map(p => [p.ot, p.cliente || p.proyecto]));

    const byOt = {};
    regs.forEach(r => {
      const k = r.codigo_proyecto || "SIN_OT";
      if (!byOt[k]) byOt[k] = { empleados: new Set(), min: 0, ultFecha: r.fecha };
      byOt[k].empleados.add(r.legajo);
      byOt[k].min += parseFloat(r.duracion_min) || 0;
      if (r.fecha > byOt[k].ultFecha) byOt[k].ultFecha = r.fecha;
    });

    return Object.entries(byOt)
      .sort(([, a], [, b]) => b.min - a.min)
      .map(([ot, d]) => {
        const nombre = proyMap[ot] ? ` — ${proyMap[ot]}` : "";
        const empNames = [...d.empleados].map(l => empMap[l] || `L-${l}`).join(", ");
        return `OT ${ot}${nombre}: ${Math.round(d.min)}min, ${d.empleados.size} operario(s) [${empNames}], última actividad: ${d.ultFecha}`;
      }).join("\n");
  },
};

// Queries que solo gerencial/administrativo puede ejecutar
const GERENCIAL_ONLY = new Set([
  "fichadas_hoy", "solicitudes_pendientes", "empleados_division",
  "horas_empleado", "ausencias_semana", "productividad_promedio",
  "ranking_tardanzas", "horas_extra_mes", "ots_activas",
]);

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado();

    const rl = checkRateLimit(`chat:${sesion.empresa_id}`, 30, 60_000);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Esperá un momento." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
      );
    }

    const rawBody = await request.json();
    const parsed = chatQueryBody.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const { query_type, params: rawParams } = parsed.data;

    if (!QUERIES[query_type]) {
      return NextResponse.json({ error: "Tipo de consulta no válido" }, { status: 400 });
    }

    if (GERENCIAL_ONLY.has(query_type) && !["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Esta consulta requiere rol gerencial." }, { status: 403 });
    }

    const params = {};
    for (const [k, v] of Object.entries(rawParams || {})) {
      params[k] = typeof v === "string" ? sanitizePostgrestParam(v) : v;
    }

    const resultado = await QUERIES[query_type](sesion.empresa_id, params);
    return NextResponse.json({ resultado });
  } catch (err) {
    return NextResponse.json({ error: "Error al consultar datos" }, { status: 500 });
  }
}
