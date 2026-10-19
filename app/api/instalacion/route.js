// /api/instalacion — Reporte diario de instalación (seguimiento de OT por
// escaneo, parte 24b; migración 117).
//
// Lo usan los instaladores (empleados.es_instalador, migración 116) y gestión.
//   GET ?ot=X  → módulos de la OT (de sus piezas), cuáles están colocados,
//                pendientes abiertos y el % de instalación
//   GET        → historial: los reportes del instalador (gestión ve todos)
//   POST       → nuevo reporte: módulos colocados hoy, pendientes, comentario
//                y fotos. Los pendientes van a pendientes_obra (los mismos
//                del acta de instalación) y restan del % de su módulo.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { reporteInstalacionBody } from "../../lib/schemas";
import { sbGet, sbGetAll, sbPost } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { avanceInstalacion } from "../../lib/instalacion";
import { hoyArg } from "../../lib/dates";
import { logger } from "../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const json = (body, status = 200) => NextResponse.json(body, { status });
const HISTORIAL = 60;

function faltaMigracion(err) {
  const m = String(err?.message);
  return ["reportes_instalacion", "modulos_instalados", "es_instalador", "reporte_id", "porcentaje"].some((t) => m.includes(t));
}
const SIN_MIGRACION = "Para los reportes de instalación falta correr la migración 117 en Supabase.";

/** Sesión válida de alguien que puede reportar instalación, o la respuesta de error. */
async function entrar(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return { response: sinPlan };
  const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
  if (sinModulo) return { response: sinModulo };
  const gestion = ROLES_GESTION.has(sesion.rol);
  if (!gestion) {
    const [yo] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=es_instalador&limit=1`, { sesion })) || [];
    if (!yo?.es_instalador) return { response: json({ error: "Los reportes de instalación son de los instaladores" }, 403) };
  }
  return { sesion, gestion };
}

/** Estado de instalación de una OT: módulos, colocados, pendientes y %. */
async function estadoOt(sesion, ot) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const otq = encodeURIComponent(ot);
  const [{ data: piezas }, instalados, pendientes] = await Promise.all([
    sbGetAll(`piezas_ot?empresa_id=eq.${e}&ot=eq.${otq}&select=id,nombre,modulo,l1,l2,unidad,de&order=renglon.asc,unidad.asc`, opts),
    sbGet(`modulos_instalados?empresa_id=eq.${e}&ot=eq.${otq}&select=modulo,created_at`, opts),
    sbGet(`pendientes_obra?empresa_id=eq.${e}&ot=eq.${otq}&select=id,descripcion,modulo,piezas,porcentaje,resuelto,created_at&order=created_at.asc`, opts),
  ]);
  const avance = avanceInstalacion({ piezas, instalados: (instalados || []).map((m) => m.modulo), pendientes: pendientes || [] });
  return { avance, piezas, pendientes: (pendientes || []).filter((p) => !p.resuelto) };
}

export async function GET(request) {
  try {
    const { sesion, gestion, response } = await entrar(request);
    if (response) return response;
    const e = sesion.empresa_id;
    const ot = new URL(request.url).searchParams.get("ot");
    try {
      if (ot) {
        const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=ot,cliente,obra&limit=1`, { sesion })) || [];
        if (!proyecto) return json({ error: "No encontré esa OT" }, 404);
        const { avance, pendientes } = await estadoOt(sesion, proyecto.ot);
        return json({ ok: true, proyecto, ...avance, pendientes });
      }
      const filtro = gestion ? "" : `&empleado_id=eq.${sesion.empleado_id}`;
      const reportes = (await sbGet(`reportes_instalacion?empresa_id=eq.${e}${filtro}&select=*&order=created_at.desc&limit=${HISTORIAL}`, { sesion })) || [];
      const ids = reportes.map((r) => r.id);
      const quienes = [...new Set(reportes.map((r) => r.empleado_id).filter(Boolean))];
      const [pendientes, empleados] = await Promise.all([
        ids.length ? sbGet(`pendientes_obra?empresa_id=eq.${e}&reporte_id=in.(${ids.join(",")})&select=id,reporte_id,descripcion,modulo,resuelto`, { sesion }) : [],
        quienes.length ? sbGet(`empleados?empresa_id=eq.${e}&id=in.(${quienes.join(",")})&select=id,nombre`, { sesion }) : [],
      ]);
      const nombre = new Map((empleados || []).map((x) => [x.id, x.nombre]));
      return json({
        ok: true,
        reportes: reportes.map((r) => ({
          ...r,
          empleado: nombre.get(r.empleado_id) || null,
          pendientes: (pendientes || []).filter((p) => p.reporte_id === r.id),
        })),
      });
    } catch (err) {
      if (faltaMigracion(err)) return json({ error: SIN_MIGRACION }, 409);
      throw err;
    }
  } catch (err) {
    logger.error("[instalacion] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await entrar(request);
    if (response) return response;
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(reporteInstalacionBody, raw);
    if (parsed.response) return parsed.response;
    const datos = parsed.data;
    const e = sesion.empresa_id;
    const opts = { sesion };
    const quien = sesion.empleado_id || null;
    // Fotos solo subidas por /api/upload para esta empresa
    if (!datos.fotos.every((u) => u.startsWith(`${SB_URL}/storage/v1/object/public/reportes-obra/${e}/`))) {
      return json({ error: "Las fotos tienen que subirse desde la app" }, 400);
    }
    if (!datos.modulos.length && !datos.pendientes.length && !datos.comentario) {
      return json({ error: "Anotá al menos un módulo colocado, un pendiente o un comentario" }, 400);
    }
    try {
      const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(datos.ot)}&select=ot&limit=1`, opts)) || [];
      if (!proyecto) return json({ error: "No encontré esa OT" }, 404);
      const ot = proyecto.ot;

      // Solo módulos y piezas de esta OT; los ya colocados no se repiten
      const { avance: antes, piezas, pendientes: abiertos } = await estadoOt(sesion, ot);
      const deLaOt = new Map(antes.modulos.map((m) => [m.modulo, m]));
      const nuevos = [...new Set(datos.modulos)].filter((m) => deLaOt.has(m) && !deLaOt.get(m).instalado);
      const ajenos = datos.modulos.filter((m) => !deLaOt.has(m));
      if (ajenos.length) return json({ error: `Estos módulos no son de la OT ${ot}: ${ajenos.join(", ")}` }, 400);
      for (const p of datos.pendientes) {
        if (p.modulo && !deLaOt.has(p.modulo)) return json({ error: `El módulo ${p.modulo} no es de la OT ${ot}` }, 400);
        if (p.piezas) {
          const suyas = new Set((deLaOt.get(p.modulo)?.piezas || []).map((x) => Number(x.id)));
          if (!p.modulo || !p.piezas.every((id) => suyas.has(id))) return json({ error: "Las piezas pendientes tienen que ser del módulo elegido" }, 400);
        }
      }

      // Un pendiente sin piezas elegidas resta su % (1 si no se dice otro)
      const filasPendientes = datos.pendientes.map((p) => ({
        descripcion: p.descripcion, modulo: p.modulo, piezas: p.modulo ? p.piezas : null,
        porcentaje: p.modulo && !p.piezas ? p.porcentaje : null,
      }));
      // El % que queda la OT con este reporte
      const { porcentaje } = avanceInstalacion({
        piezas,
        instalados: [...antes.modulos.filter((m) => m.instalado).map((m) => m.modulo), ...nuevos],
        pendientes: [...abiertos, ...filasPendientes],
      });

      const [reporte] = (await sbPost("reportes_instalacion", {
        empresa_id: e, ot, fecha: hoyArg(), empleado_id: quien, modulos: nuevos, comentario: datos.comentario, fotos: datos.fotos, avance: porcentaje,
      }, opts)) || [];
      if (nuevos.length) {
        await sbPost("modulos_instalados", nuevos.map((modulo) => ({ empresa_id: e, ot, modulo, reporte_id: reporte?.id ?? null, instalado_por: quien })), opts);
      }
      if (filasPendientes.length) {
        await sbPost("pendientes_obra", filasPendientes.map((p) => ({ empresa_id: e, ot, ...p, reporte_id: reporte?.id ?? null, creado_por: quien })), opts);
      }
      broadcastRefresh(e, "reportes_instalacion");
      return json({ ok: true, reporte: reporte || null, porcentaje });
    } catch (err) {
      if (faltaMigracion(err)) return json({ error: SIN_MIGRACION }, 409);
      throw err;
    }
  } catch (err) {
    logger.error("[instalacion] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
