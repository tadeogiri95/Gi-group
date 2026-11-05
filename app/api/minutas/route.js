// /api/minutas — Minuta de la reunión de Buenos Días (Minuta, parte M1;
// migración 150; diseño en notes/diseno-minuta-buenos-dias.md).
//
// Solo gerencia (rol gerencial) y supervisores (desde 05/11), con el módulo Minutas prendido.
//   GET ?fecha=AAAA-MM-DD → la minuta de ese día con sus renglones (o null)
//   GET                   → historial: las últimas minutas, sin renglones
//   GET ?precarga=AAAA-MM-DD → lo que Gypi sugiere para ese día (parte M2):
//         producción terminada, en curso y a iniciar según el plan, actas,
//         instalaciones en curso y pendientes. Solo lee.
//   POST { accion: "guardar", fecha, minuta, items, cerrar? }
//         → crea o actualiza la minuta del día y deja exactamente esos
//           renglones (los que se sacaron se borran). Con cerrar anota la
//           hora de cierre y la cierra. Una cerrada no se edita hasta reabrirla.
//   POST { accion: "reabrir", fecha } → la vuelve a abrir para corregirla
// Seguimiento (parte M3):
//   GET ?seguimiento=AAAA-MM-DD → lo que sigue abierto de las minutas del
//         último mes (contingencias, pendientes, post-venta, estacionamiento)
//         y no pasó todavía a una minuta posterior
//   GET ?revision=AAAA-MM-DD → la minuta anterior con sus alertas, fechas
//         objetivo y compras, y el estado de esos pedidos (revisión de ayer, 155)
//   GET ?ot=X              → los renglones de esa OT en todas las minutas (Detalle de OT)
//   GET ?feedback=AAAA-MM-DD → el feedback desde ese día (revisión del jueves)
//   GET ?reporte=AAAA-MM-DD&hasta=AAAA-MM-DD → las minutas del período con
//                             sus renglones y el precio de las OT terminadas
//                             (informe consolidado del día, semana o mes)
//   POST { accion: "resolver", id, resuelto } → ✓ Resuelto (o revisado); se
//         puede aunque la minuta esté cerrada: es el seguimiento
// Los pendientes de instalación necesitan responsable y fecha objetivo.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { minutasBody } from "../../lib/schemas";
import { sbGet, sbGetAll, sbPost, sbPatch, sbDelete, sbHeaders } from "../../lib/sbHelpers";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { SECCIONES_SEGUIMIENTO, faltantesMinuta, hora, sigueAbierto } from "../../lib/minutas";
import { precargaMinuta } from "../../lib/minutasPrecargaServidor";
import { logger } from "../../lib/logger";
import { comoDueno } from "../../lib/alcance";

const json = (body, status = 200) => NextResponse.json(body, { status });
const HISTORIAL = 90;
// Reportes: hasta un trimestre de una vez
const DIAS_REPORTE = 100;
// Hasta cuántos días atrás se busca lo que sigue abierto
const DIAS_SEGUIMIENTO = 30;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function faltaMigracion(err) {
  const m = String(err?.message);
  return /minutas|minuta_items/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}
const SIN_MIGRACION = "Para usar la Minuta falta correr la migración 150 en Supabase.";
const SIN_REVISION = "Se guardó la minuta, pero no la revisión de ayer: falta correr la migración 155 en Supabase.";

/** Sesión de gerencia con el módulo prendido, o la respuesta de error. */
async function entrar(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!(await comoDueno(sesion))) return { response: json({ error: "La minuta es del Dueño y los supervisores" }, 403) };
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return { response: sinPlan };
  const sinModulo = await requireModulo(sesion.empresa_id, "minutas");
  if (sinModulo) return { response: sinModulo };
  return { sesion };
}

async function minutaDe(sesion, fecha) {
  const [m] = (await sbGet(`minutas?empresa_id=eq.${sesion.empresa_id}&fecha=eq.${fecha}&select=*&limit=1`, { sesion })) || [];
  return m || null;
}

async function renglonesDe(sesion, minutaId) {
  return (await sbGet(`minuta_items?empresa_id=eq.${sesion.empresa_id}&minuta_id=eq.${minutaId}&select=*&order=seccion.asc,orden.asc`, { sesion })) || [];
}

/**
 * Precio de las OT terminadas del informe (migración 142; solo lo lee
 * gerencia, que es quien ve las minutas). Sin la migración, sin precios.
 */
/** Cliente, obra y descripción de las OT de los renglones, para nombrar cada OT completa (02/11). */
async function otsDe(sesion, items) {
  const ots = [...new Set(items.filter((it) => it.ot).map((it) => String(it.ot)))];
  if (!ots.length) return [];
  try {
    const lista = ots.slice(0, 500).map((o) => `"${o.replace(/["\\]/g, "")}"`).join(",");
    return (await sbGet(`proyectos?empresa_id=eq.${sesion.empresa_id}&ot=in.(${encodeURIComponent(lista)})&select=ot,cliente,obra,descripcion`, { sesion })) || [];
  } catch (err) {
    logger.warn("[minutas] sin datos de las OT", err);
    return [];
  }
}

async function preciosDe(sesion, items) {
  const ots = [...new Set(items.filter((it) => (it.seccion === "prod_terminada" || it.seccion === "inst_terminada") && it.ot).map((it) => String(it.ot)))];
  if (!ots.length) return {};
  try {
    const lista = ots.map((o) => `"${o.replace(/["\\]/g, "")}"`).join(",");
    const filas = (await sbGet(`precios_ot?empresa_id=eq.${sesion.empresa_id}&ot=in.(${encodeURIComponent(lista)})&precio=not.is.null&select=ot,precio`, { sesion })) || [];
    return Object.fromEntries(filas.map((f) => [String(f.ot), Number(f.precio)]));
  } catch (err) {
    logger.warn("[minutas] sin precios de OT", err);
    return {};
  }
}

/**
 * El feedback del período anterior, del mismo largo (para comparar en el
 * análisis del informe): solo tipo y área.
 */
async function feedbackAnteriorDe(sesion, desde, hasta) {
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1;
  const fin = new Date(Date.parse(`${desde}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const inicio = new Date(Date.parse(`${fin}T12:00:00Z`) - (dias - 1) * 86400000).toISOString().slice(0, 10);
  const minutas = (await sbGet(`minutas?empresa_id=eq.${sesion.empresa_id}&fecha=gte.${inicio}&fecha=lte.${fin}&select=id`, { sesion })) || [];
  if (!minutas.length) return { desde: inicio, hasta: fin, reuniones: 0, items: [] };
  const items = (await sbGet(`minuta_items?empresa_id=eq.${sesion.empresa_id}&seccion=eq.feedback&minuta_id=in.(${minutas.map((m) => m.id).join(",")})&select=tipo,area&limit=2000`, { sesion })) || [];
  return { desde: inicio, hasta: fin, reuniones: minutas.length, items };
}

export async function GET(request) {
  try {
    const { sesion, response } = await entrar(request);
    if (response) return response;
    const q = new URL(request.url).searchParams;
    const fecha = q.get("fecha");
    const precarga = q.get("precarga");
    if (precarga) {
      if (!FECHA.test(precarga)) return json({ error: "Fecha inválida" }, 400);
      return json({ ok: true, sugeridos: await precargaMinuta(sesion.empresa_id, precarga, { sesion }) });
    }
    try {
      const e = sesion.empresa_id;
      const seguimiento = q.get("seguimiento");
      if (seguimiento) {
        // Lo abierto de las minutas del último mes que no pasó a una minuta posterior
        if (!FECHA.test(seguimiento)) return json({ error: "Fecha inválida" }, 400);
        const desde = new Date(Date.parse(`${seguimiento}T12:00:00Z`) - DIAS_SEGUIMIENTO * 86400000).toISOString().slice(0, 10);
        const minutas = (await sbGet(`minutas?empresa_id=eq.${e}&fecha=lt.${seguimiento}&fecha=gte.${desde}&select=id,fecha&order=fecha.desc`, { sesion })) || [];
        if (!minutas.length) return json({ ok: true, anterior: null, items: [] });
        const fechaDe = new Map(minutas.map((m) => [m.id, m.fecha]));
        const todos = (await sbGet(`minuta_items?empresa_id=eq.${e}&minuta_id=in.(${minutas.map((m) => m.id).join(",")})&seccion=in.(${SECCIONES_SEGUIMIENTO.join(",")})&select=*&order=created_at.asc&limit=2000`, { sesion })) || [];
        const siguieron = new Set(todos.map((it) => it.viene_de).filter(Boolean));
        const items = todos.filter((it) => sigueAbierto(it) && !siguieron.has(it.id))
          .map((it) => ({ ...it, fecha: fechaDe.get(it.minuta_id) || null }))
          .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        return json({ ok: true, anterior: minutas[0].fecha, items });
      }
      const revision = q.get("revision");
      if (revision) {
        // Revisión de la minuta anterior (155): sus renglones con alerta, fecha
        // objetivo o compra, y el estado de los pedidos que se crearon desde ahí
        if (!FECHA.test(revision)) return json({ error: "Fecha inválida" }, 400);
        const desde = new Date(Date.parse(`${revision}T12:00:00Z`) - DIAS_SEGUIMIENTO * 86400000).toISOString().slice(0, 10);
        const [ant] = (await sbGet(`minutas?empresa_id=eq.${e}&fecha=lt.${revision}&fecha=gte.${desde}&select=id,fecha&order=fecha.desc&limit=1`, { sesion })) || [];
        if (!ant) return json({ ok: true, anterior: null, items: [], pedidos: [] });
        const items = (await sbGet(`minuta_items?empresa_id=eq.${e}&minuta_id=eq.${ant.id}&seccion=in.(prod_en_curso,inst_en_curso,inst_pendiente,postventa,estacionamiento,compra)&select=*&order=seccion.asc,orden.asc&limit=500`, { sesion })) || [];
        const ids = [...new Set(items.map((it) => it.datos?.pedido_id).filter((x) => /^\d+$/.test(String(x ?? ""))))];
        let pedidos = [];
        if (ids.length) {
          try {
            pedidos = (await sbGet(`pedidos_compra?empresa_id=eq.${e}&id=in.(${ids.join(",")})&select=id,estado`, { sesion })) || [];
          } catch (err) {
            logger.warn("[minutas] sin estado de pedidos", err);
          }
        }
        return json({ ok: true, anterior: ant.fecha, items, pedidos });
      }
      const ot = q.get("ot");
      if (ot) {
        const items = (await sbGet(`minuta_items?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&seccion=neq.revision&select=*&order=created_at.desc&limit=200`, { sesion })) || [];
        const ids = [...new Set(items.map((it) => it.minuta_id))];
        const minutas = ids.length ? (await sbGet(`minutas?empresa_id=eq.${e}&id=in.(${ids.join(",")})&select=id,fecha`, { sesion })) || [] : [];
        const fechaDe = new Map(minutas.map((m) => [m.id, m.fecha]));
        return json({ ok: true, items: items.map((it) => ({ ...it, fecha: fechaDe.get(it.minuta_id) || null })).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))) });
      }
      const reporte = q.get("reporte");
      if (reporte) {
        const hasta = q.get("hasta") || reporte;
        if (!FECHA.test(reporte) || !FECHA.test(hasta) || hasta < reporte) return json({ error: "Período inválido" }, 400);
        if (Date.parse(hasta) - Date.parse(reporte) > DIAS_REPORTE * 86400000) return json({ error: `El período puede ser de hasta ${DIAS_REPORTE} días` }, 400);
        const minutas = (await sbGet(`minutas?empresa_id=eq.${e}&fecha=gte.${reporte}&fecha=lte.${hasta}&select=id,fecha,inicio,cierre,estado,modera,registra,asistentes&order=fecha.asc`, { sesion })) || [];
        if (!minutas.length) return json({ ok: true, minutas: [], items: [] });
        const { data: items } = await sbGetAll(`minuta_items?empresa_id=eq.${e}&minuta_id=in.(${minutas.map((m) => m.id).join(",")})&select=id,minuta_id,seccion,orden,ot,proyecto,cliente,semaforo,texto,responsable,fecha_objetivo,area,tipo,datos,viene_de,resuelto_at&order=id.asc`, { sesion, maxFilas: 20000 });
        return json({ ok: true, minutas, items: items || [], precios: await preciosDe(sesion, items || []), ots: await otsDe(sesion, items || []), feedbackAnterior: await feedbackAnteriorDe(sesion, reporte, hasta) });
      }
      const feedback = q.get("feedback");
      if (feedback) {
        if (!FECHA.test(feedback)) return json({ error: "Fecha inválida" }, 400);
        const minutas = (await sbGet(`minutas?empresa_id=eq.${e}&fecha=gte.${feedback}&select=id,fecha&order=fecha.asc`, { sesion })) || [];
        if (!minutas.length) return json({ ok: true, items: [] });
        const fechaDe = new Map(minutas.map((m) => [m.id, m.fecha]));
        const items = (await sbGet(`minuta_items?empresa_id=eq.${e}&seccion=eq.feedback&minuta_id=in.(${minutas.map((m) => m.id).join(",")})&select=*&order=created_at.asc&limit=500`, { sesion })) || [];
        return json({ ok: true, items: items.map((it) => ({ ...it, fecha: fechaDe.get(it.minuta_id) || null })) });
      }
      if (fecha) {
        if (!FECHA.test(fecha)) return json({ error: "Fecha inválida" }, 400);
        const minuta = await minutaDe(sesion, fecha);
        return json({ ok: true, minuta, items: minuta ? await renglonesDe(sesion, minuta.id) : [] });
      }
      const minutas = (await sbGet(`minutas?empresa_id=eq.${sesion.empresa_id}&select=id,fecha,inicio,cierre,estado,modera,registra,asistentes&order=fecha.desc&limit=${HISTORIAL}`, { sesion })) || [];
      return json({ ok: true, minutas });
    } catch (err) {
      if (faltaMigracion(err)) return json({ error: SIN_MIGRACION }, 409);
      throw err;
    }
  } catch (err) {
    logger.error("[minutas] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}

async function guardar(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const faltan = faltantesMinuta(d.items);
  if (faltan.length) return json({ error: faltan[0], faltan }, 400);
  const ahora = new Date();
  let minuta = await minutaDe(sesion, d.fecha);
  if (minuta?.estado === "cerrada") return json({ error: "Esta minuta ya está cerrada. Tocá \"Reabrir\" para corregirla." }, 409);
  const ids = d.items.map((it) => it.id);
  if (new Set(ids).size !== ids.length) return json({ error: "Hay renglones repetidos" }, 400);
  if (ids.length) {
    // Un renglón es de un solo día: no se mueve de otra minuta
    const otra = minuta ? `&minuta_id=neq.${minuta.id}` : "";
    const ajenos = (await sbGet(`minuta_items?empresa_id=eq.${e}&id=in.(${ids.join(",")})${otra}&select=id&limit=1`, opts)) || [];
    if (ajenos.length) return json({ error: "Un renglón es de otra minuta" }, 400);
  }
  const fila = {
    ...d.minuta,
    updated_at: ahora.toISOString(),
    actualizado_por: sesion.empleado_id || null,
    ...(d.cerrar ? { estado: "cerrada", cerrada_at: ahora.toISOString(), cierre: d.minuta.cierre || hora(ahora) } : {}),
  };
  if (minuta) {
    [minuta] = await sbPatch(`minutas?id=eq.${minuta.id}&empresa_id=eq.${e}`, fila, opts);
  } else {
    try {
      [minuta] = await sbPost("minutas", { ...fila, empresa_id: e, fecha: d.fecha, creado_por: sesion.empleado_id || null }, opts);
    } catch (err) {
      // Dos personas la empezaron a la vez: se guarda sobre la que ya está
      if (!/23505|duplicate key/.test(String(err?.message))) throw err;
      const ya = await minutaDe(sesion, d.fecha);
      if (ya?.estado === "cerrada") return json({ error: "Esta minuta ya está cerrada. Tocá \"Reabrir\" para corregirla." }, 409);
      [minuta] = await sbPatch(`minutas?id=eq.${ya.id}&empresa_id=eq.${e}`, fila, opts);
    }
  }

  // Los que se sacaron se borran; los demás se crean o se actualizan
  await sbDelete(`minuta_items?empresa_id=eq.${e}&minuta_id=eq.${minuta.id}${ids.length ? `&id=not.in.(${ids.join(",")})` : ""}`, opts);
  if (ids.length) {
    const filas = d.items.map((it) => ({ ...it, empresa_id: e, minuta_id: minuta.id, updated_at: ahora.toISOString() }));
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/minuta_items?on_conflict=id`, {
      method: "POST",
      headers: await sbHeaders(opts, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(filas),
    });
    if (!r.ok) {
      const texto = await r.text();
      // Sin la 155 la sección 'revision' no existe: se guarda lo demás y se avisa
      if (!/minuta_items_seccion_check|23514/.test(texto) || !filas.some((f) => f.seccion === "revision")) throw new Error(`POST minuta_items: ${texto}`);
      const sinRevision = filas.filter((f) => f.seccion !== "revision");
      if (sinRevision.length) {
        const r2 = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/minuta_items?on_conflict=id`, {
          method: "POST",
          headers: await sbHeaders(opts, { Prefer: "resolution=merge-duplicates,return=minimal" }),
          body: JSON.stringify(sinRevision),
        });
        if (!r2.ok) throw new Error(`POST minuta_items: ${await r2.text()}`);
      }
      return json({ ok: true, minuta, items: await renglonesDe(sesion, minuta.id), aviso: SIN_REVISION });
    }
  }
  return json({ ok: true, minuta, items: await renglonesDe(sesion, minuta.id) });
}

export async function POST(request) {
  try {
    const { sesion, response } = await entrar(request);
    if (response) return response;
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(minutasBody, raw);
    if (parsed.response) return parsed.response;
    const d = parsed.data;
    try {
      if (d.accion === "guardar") return await guardar(sesion, d);
      if (d.accion === "resolver") {
        const filas = await sbPatch(`minuta_items?id=eq.${d.id}&empresa_id=eq.${sesion.empresa_id}`, {
          resuelto_at: d.resuelto ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
        }, { sesion });
        if (!filas?.length) return json({ error: "No encontré ese renglón (guardá la minuta primero)" }, 404);
        return json({ ok: true, item: filas[0] });
      }
      const minuta = await minutaDe(sesion, d.fecha);
      if (!minuta) return json({ error: "No hay minuta de ese día" }, 404);
      const [abierta] = await sbPatch(`minutas?id=eq.${minuta.id}&empresa_id=eq.${sesion.empresa_id}`, {
        estado: "abierta", cerrada_at: null, updated_at: new Date().toISOString(), actualizado_por: sesion.empleado_id || null,
      }, { sesion });
      return json({ ok: true, minuta: abierta });
    } catch (err) {
      if (faltaMigracion(err)) return json({ error: SIN_MIGRACION }, 409);
      throw err;
    }
  } catch (err) {
    logger.error("[minutas] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
