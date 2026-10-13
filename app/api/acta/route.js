// POST /api/acta — Acta de conformidad de instalación de cada OT (Órdenes de
// Producción, parte 11; ítem 39; migración 105).
//
// Body: { accion, ... }. Lo hace cualquiera de la empresa (el instalador),
// salvo reabrir, que es de gestión.
//   descarga            → tilde de cada bulto al bajarlo en obra
//   checklist           → los puntos del checklist de instalación tildados
//   observaciones       → texto libre para el acta
//   pendiente_agregar / pendiente_borrar
//   pendiente_resolver  → se puede tildar también con el acta firmada
//   firmar              → nombre del cliente y su firma (imagen subida por
//                         /api/upload). Con el checklist completo, o con lo
//                         que falta anotado como pendiente.
//   reabrir             → gestión: borra la firma para corregir el acta
// Con el acta firmada, todo queda cerrado salvo resolver pendientes.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { actaBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { CLAVE_CHECKLIST_INSTALACION, estadoActa } from "../../lib/acta";
import { normalizarChecklist } from "../../lib/avance";
import { logger } from "../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function faltaMigracion(err) {
  const m = String(err?.message);
  return m.includes("actas_ot") || m.includes("pendientes_obra") || m.includes("descargado");
}

const json = (body, status = 200) => NextResponse.json(body, { status });
const CERRADA = "El acta ya está firmada. Para cambiarla, un encargado tiene que reabrirla.";

async function procesar(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const quien = sesion.empleado_id || null;
  const ahora = new Date().toISOString();
  // Solo imágenes subidas por /api/upload para esta empresa
  const esDeLaApp = (url) => !url || url.startsWith(`${SB_URL}/storage/v1/object/public/reportes-obra/${e}/`);

  // ─── La OT (por su número, por el bulto o por el pendiente) ───
  let ot = datos.ot;
  let fila = null;
  if (datos.accion === "descarga") {
    [fila] = (await sbGet(`bultos_ot?id=eq.${datos.id}&empresa_id=eq.${e}&select=id,ot&limit=1`, opts)) || [];
    if (!fila) return json({ error: "No encontré ese bulto" }, 404);
    ot = fila.ot;
  } else if (datos.accion === "pendiente_borrar" || datos.accion === "pendiente_resolver") {
    [fila] = (await sbGet(`pendientes_obra?id=eq.${datos.id}&empresa_id=eq.${e}&select=id,ot&limit=1`, opts)) || [];
    if (!fila) return json({ error: "No encontré ese pendiente" }, 404);
    ot = fila.ot;
  } else {
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=id,ot&limit=1`, opts)) || [];
    if (!proyecto) return json({ error: "No encontré esa OT" }, 404);
    ot = proyecto.ot;
  }
  const otq = encodeURIComponent(ot);
  const filtroActa = `actas_ot?empresa_id=eq.${e}&ot=eq.${otq}`;
  const [acta] = (await sbGet(`${filtroActa}&select=*&limit=1`, opts)) || [];
  const firmada = !!acta?.firmada_at;

  const guardarActa = async (cambios) => {
    const nueva = { ...cambios, updated_at: ahora };
    const [res] = acta
      ? (await sbPatch(filtroActa, nueva, opts)) || []
      : (await sbPost("actas_ot", { empresa_id: e, ot, ...nueva }, opts)) || [];
    broadcastRefresh(e, "actas_ot");
    return json({ ok: true, acta: res || null });
  };

  if (datos.accion === "reabrir") {
    if (!ROLES_GESTION.has(sesion.rol)) return json({ error: "Solo un encargado puede reabrir el acta" }, 403);
    if (!acta) return json({ ok: true, acta: null });
    return guardarActa({ firma_url: null, firmada_por: null, firmada_at: null, instalador: null });
  }

  if (datos.accion === "pendiente_resolver") {
    const cambios = datos.valor ? { resuelto: true, resuelto_por: quien, resuelto_at: ahora } : { resuelto: false, resuelto_por: null, resuelto_at: null };
    const [res] = (await sbPatch(`pendientes_obra?id=eq.${fila.id}&empresa_id=eq.${e}`, cambios, opts)) || [];
    broadcastRefresh(e, "pendientes_obra");
    return json({ ok: true, pendiente: res || null });
  }

  if (firmada) return json({ error: CERRADA }, 409);

  switch (datos.accion) {
    case "descarga": {
      const cambios = datos.valor ? { descargado: true, descargado_por: quien, descargado_at: ahora } : { descargado: false, descargado_por: null, descargado_at: null };
      const [res] = (await sbPatch(`bultos_ot?id=eq.${fila.id}&empresa_id=eq.${e}`, cambios, opts)) || [];
      broadcastRefresh(e, "bultos_ot");
      return json({ ok: true, bulto: res || null });
    }
    case "checklist":
      return guardarActa({ checklist: normalizarChecklist(datos.items) });
    case "observaciones":
      return guardarActa({ observaciones: datos.texto });
    case "pendiente_agregar": {
      if (!esDeLaApp(datos.foto_url)) return json({ error: "La foto tiene que subirse desde la app" }, 400);
      const [res] = (await sbPost("pendientes_obra", {
        empresa_id: e, ot, descripcion: datos.descripcion, fecha: datos.fecha, foto_url: datos.foto_url, creado_por: quien,
      }, opts)) || [];
      broadcastRefresh(e, "pendientes_obra");
      return json({ ok: true, pendiente: res || null });
    }
    case "pendiente_borrar":
      await sbDelete(`pendientes_obra?id=eq.${fila.id}&empresa_id=eq.${e}`, opts);
      broadcastRefresh(e, "pendientes_obra");
      return json({ ok: true });
    case "firmar": {
      if (!esDeLaApp(datos.firma_url)) return json({ error: "La firma tiene que hacerse desde la app" }, 400);
      const [pendientes, config, empleado] = await Promise.all([
        sbGet(`pendientes_obra?empresa_id=eq.${e}&ot=eq.${otq}&select=id,resuelto`, opts),
        sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CHECKLIST_INSTALACION}&select=valor&limit=1`, { ...opts, silent: true, fallback: [] }),
        quien ? sbGet(`empleados?id=eq.${quien}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] }) : [],
      ]);
      const estado = estadoActa({ pendientes: pendientes || [], acta, checklist: config?.[0]?.valor?.lista });
      if (!estado.puedeFirmar) {
        return json({ error: `Faltan ${estado.checklistFaltan.length} puntos del checklist. Tildalos o anotá lo que queda como pendiente.` }, 400);
      }
      return guardarActa({
        cliente_nombre: datos.cliente_nombre,
        firma_url: datos.firma_url,
        firmada_por: quien,
        firmada_at: ahora,
        instalador: empleado?.[0]?.nombre || null,
      });
    }
    default:
      return json({ error: "Acción desconocida" }, 400);
  }
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(actaBody, raw);
    if (parsed.response) return parsed.response;
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;
    try {
      return await procesar(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) return json({ error: "Para el acta de instalación falta correr la migración 105 en Supabase." }, 409);
      throw err;
    }
  } catch (err) {
    logger.error("[acta] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
