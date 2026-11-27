// POST /api/piezas/paso — Escaneo de cada pieza en cada etapa (Órdenes de
// Producción, parte 18; migración 110).
//
// Body: { accion, ... } (cualquier empleado)
//   escanear → el QR de la etiqueta de la pieza ("OT M-7495 - PIEZA - 1234")
//              y la etapa (código de una etapa de la empresa que se escanea
//              por pieza; migración 112). Anota que la pieza
//              pasó por esa etapa. Si con esta pasaron todas las piezas de la
//              OT que llevan esa etapa, marca la etapa de la OT como terminada
//              (avance_etapas; la firma la sigue poniendo el responsable).
//              Puede venir de la cola sin señal: momento = cuándo se escaneó.
//              El QR puede ser el de una etiqueta de módulo ("OT M-7495 -
//              MODULO - M.izq"): pasan por la etapa todas las piezas de ese
//              módulo de una vez (así se escanea el Armado).
//              Si la OT está en pausa (151) se anota igual y la respuesta
//              trae la pausa, para que el operario vea un aviso amarillo.
//              Lo mismo si la OT está cerrada o terminada en la planilla (27/11).
//   deshacer → saca el escaneo (el mismo operario hasta 30 minutos después,
//              o gestión). No toca el avance de la etapa.
//   deshacer_modulo → lo mismo para todas las piezas de un módulo.
// Canto por lados (25/11, migración 209): en la etapa que tiene entre sus
// columnas los lados del panel (L1A, L1B, L2A, L2B) cada escaneo es un lado
// con canto (lados_pieza). La pieza queda pegada (pasos_pieza) recién con el
// último lado: 4 piezas de 3 lados = 12 escaneos. Deshacer saca el último lado.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { validateBody, safeErrorMessage } from "../../../lib/validate";
import { pasoPiezaBody } from "../../../lib/schemas";
import { sbGet, sbPost, sbDelete, sbHeaders } from "../../../lib/sbHelpers";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { broadcastRefresh } from "../../../lib/broadcast";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { leerQrPieza, leerQrModulo, etapasSalteadas, etapaPorLados, columnasDeTexto, escaneosPorPieza } from "../../../lib/piezas";
import { falta209 } from "../../../lib/piezasServidor";
import { leerBarrasPiezaNumero } from "../../../lib/codigoBarras";
import { normalizarOt } from "../../../lib/escaneoCarga";
import { logger } from "../../../lib/logger";

const MINUTOS_DESHACER = 30;
const DIAS_COLA = 7;

function faltaMigracion(err) {
  const m = String(err?.message);
  return (m.includes("pasos_pieza") || m.includes("piezas_ot")) && /does not exist|could not find|PGRST205|42P01/i.test(m);
}
const falta112 = (err) => /por_pieza/.test(String(err?.message));
const faltaLados = (err) => /lados_pieza/.test(String(err?.message)) && /does not exist|could not find|PGRST205|42P01/i.test(String(err?.message));

const CAMPOS_PIEZA = "id,ot,nombre,unidad,de,etapas";

/** Piezas con sus lados con canto; sin la migración 209, sin los lados (cuentan 1). */
async function leerPiezasOt(filtro, opts) {
  try {
    return (await sbGet(`${filtro}&select=${CAMPOS_PIEZA},lados`, opts)) || [];
  } catch (err) {
    if (!falta209(err)) throw err;
    return (await sbGet(`${filtro}&select=${CAMPOS_PIEZA}`, opts)) || [];
  }
}

/** Lados ya escaneados de cada pieza en la etapa: Map id → cantidad; null sin la migración 209. */
async function ladosEscaneados(sesion, ids, etapa, opts) {
  if (!ids.length) return new Map();
  try {
    const filas = (await sbGet(`lados_pieza?empresa_id=eq.${sesion.empresa_id}&etapa=eq.${etapa}&pieza_id=in.(${ids.join(",")})&select=pieza_id`, opts)) || [];
    const m = new Map();
    for (const f of filas) m.set(Number(f.pieza_id), (m.get(Number(f.pieza_id)) || 0) + 1);
    return m;
  } catch (err) {
    if (faltaLados(err)) return null;
    throw err;
  }
}

/** Cuántas filas cumplen el filtro (sin traerlas). */
async function contar(path, opts) {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}&select=id&limit=1`, {
    headers: await sbHeaders(opts, { Prefer: "count=exact" }),
  });
  if (!r.ok) throw new Error(`GET ${path}: ${await r.text()}`);
  const total = Number(String(r.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

/** El momento que trae la cola sin señal, si es creíble; si no, ahora. */
function momentoValido(momento, ahora) {
  const t = Date.parse(momento || "");
  if (!Number.isFinite(t) || t > ahora + 5 * 60000 || t < ahora - DIAS_COLA * 86400000) return new Date(ahora).toISOString();
  return new Date(t).toISOString();
}

async function terminarEtapa(sesion, ot, etapa, opts) {
  const e = sesion.empresa_id;
  const filtro = `avance_etapas?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&etapa=eq.${etapa.codigo}`;
  const [actual] = (await sbGet(`${filtro}&select=id,estado&limit=1`, opts)) || [];
  // Ya terminada, firmada o "no aplica": no se toca
  if (!actual) {
    const ahora = new Date().toISOString();
    try {
      await sbPost("avance_etapas", {
        empresa_id: e, ot, etapa: etapa.codigo, estado: "terminada",
        terminada_por: sesion.empleado_id || null, terminada_at: ahora, updated_at: ahora,
      }, opts);
      broadcastRefresh(e, "avance_etapas");
    } catch (err) {
      // Dos escaneos a la vez terminaron la etapa: la otra fila ya quedó
      logger.warn?.("[piezas/paso] no se pudo terminar la etapa", { ot, etapa: etapa.codigo, error: err?.message });
    }
  }
  return { codigo: etapa.codigo, nombre: etapa.nombre };
}

/** { pausa } si la OT está en pausa (151), para avisarle al operario; {} si no o sin la migración. */
async function pausaDe(sesion, ot, opts) {
  try {
    const [p] = (await sbGet(`pausas_ot?empresa_id=eq.${sesion.empresa_id}&ot=eq.${encodeURIComponent(ot)}&hasta=is.null&select=motivo,detalle,desde&limit=1`, opts)) || [];
    return p ? { pausa: p } : {};
  } catch {
    return {};
  }
}

/**
 * { otCerrada: "cerrada" | "terminada" } si la OT ya está cerrada en Gypi o
 * figura terminada en la planilla (27/11, Tadeo: escaneos de una OT que no se
 * trabaja); se anota igual, con aviso amarillo. {} si no o si no se pudo leer.
 */
async function cerradaDe(sesion, ot, opts) {
  try {
    const [p] = (await sbGet(`proyectos?empresa_id=eq.${sesion.empresa_id}&ot=eq.${encodeURIComponent(ot)}&select=estado,terminado_planilla&limit=1`, opts)) || [];
    if (p?.estado === "cerrado") return { otCerrada: "cerrada" };
    if (p?.terminado_planilla === true) return { otCerrada: "terminada" };
    return {};
  } catch {
    return {};
  }
}

/** Avisos de la OT para el operario: en pausa y/o ya cerrada. */
async function avisosOt(sesion, ot, opts) {
  const [pausa, cerrada] = await Promise.all([pausaDe(sesion, ot, opts), cerradaDe(sesion, ot, opts)]);
  return { ...pausa, ...cerrada };
}

/** La etapa elegida, si se escanea por pieza; si no, la respuesta de error. */
async function etapaPorPieza(sesion, codigo, opts) {
  const [etapa] = (await sbGet(`etapas?empresa_id=eq.${sesion.empresa_id}&codigo=eq.${codigo}&select=codigo,nombre,activa,por_pieza,columna_pieza&limit=1`, opts)) || [];
  if (!etapa || !etapa.por_pieza || etapa.activa === false) {
    return { response: NextResponse.json({ error: "Esa etapa ya no se escanea por pieza. Elegí otra (Más → Producción → Etapas)." }, { status: 400 }) };
  }
  return { etapa: { ...etapa, porLados: etapaPorLados(columnasDeTexto(etapa.columna_pieza)) } };
}

/** ¿Pasaron todas las piezas de la OT que llevan esta etapa? Si sí, la etapa queda terminada. */
async function progresoEtapa(sesion, ot, etapa, opts) {
  const e = sesion.empresa_id;
  const otq = encodeURIComponent(ot);
  const [total, pasaron] = await Promise.all([
    contar(`piezas_ot?empresa_id=eq.${e}&ot=eq.${otq}&etapas=cs.%7B${etapa.codigo}%7D`, opts),
    contar(`pasos_pieza?empresa_id=eq.${e}&ot=eq.${otq}&etapa=eq.${etapa.codigo}&requerida=eq.true`, opts),
  ]);
  const progreso = { pasaron: Math.min(pasaron, total), total };
  const etapaTerminada = total > 0 && pasaron >= total ? await terminarEtapa(sesion, ot, etapa, opts) : null;
  return { progreso, etapaTerminada };
}

/** Piezas de un módulo de la OT (el módulo sale del nombre de la pieza en la planilla). */
async function piezasDelModulo(sesion, ot, modulo, opts) {
  return (await sbGet(`piezas_ot?empresa_id=eq.${sesion.empresa_id}&ot=eq.${encodeURIComponent(ot)}&modulo=eq.${encodeURIComponent(modulo)}&select=id,ot,etapas&order=id.asc`, opts)) || [];
}

async function escanearModulo(sesion, datos, lectura) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(lectura.ot)}&select=ot&limit=1`, opts)) || [];
  const ot = proyecto?.ot || lectura.ot;
  const piezas = await piezasDelModulo(sesion, ot, lectura.modulo, opts);
  if (!piezas.length) {
    return NextResponse.json({ error: `El módulo ${lectura.modulo} no tiene piezas en la OT ${ot} (puede que se haya vuelto a pegar la planilla). Reimprimí su etiqueta.` }, { status: 404 });
  }
  const { etapa, response } = await etapaPorPieza(sesion, datos.etapa, opts);
  if (response) return response;
  const ids = piezas.map((p) => p.id);
  const hechos = new Set(((await sbGet(`pasos_pieza?empresa_id=eq.${e}&etapa=eq.${datos.etapa}&pieza_id=in.(${ids.join(",")})&select=pieza_id`, opts)) || []).map((p) => Number(p.pieza_id)));
  const nuevas = piezas.filter((p) => !hechos.has(Number(p.id)));
  const requeridas = piezas.filter((p) => (p.etapas || []).map(Number).includes(datos.etapa)).length;
  const modulo = { ot, nombre: lectura.modulo, piezas: piezas.length, nuevas: nuevas.length, requeridas };
  if (!nuevas.length) {
    return NextResponse.json({ ok: true, ya: true, modulo, etapa: datos.etapa, etapaNombre: etapa.nombre, progreso: null, etapaTerminada: null });
  }
  const momento = momentoValido(datos.momento, Date.now());
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pasos_pieza?on_conflict=pieza_id,etapa`, {
    method: "POST",
    headers: await sbHeaders(opts, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify(nuevas.map((p) => ({
      empresa_id: e, ot, pieza_id: p.id, etapa: datos.etapa,
      requerida: (p.etapas || []).map(Number).includes(datos.etapa),
      empleado_id: sesion.empleado_id || null, created_at: momento,
    }))),
  });
  if (!r.ok) throw new Error(`POST pasos_pieza: ${await r.text()}`);
  broadcastRefresh(e, "pasos_pieza");
  const { progreso, etapaTerminada } = requeridas ? await progresoEtapa(sesion, ot, etapa, opts) : { progreso: null, etapaTerminada: null };
  return NextResponse.json({ ok: true, ya: false, modulo, etapa: datos.etapa, etapaNombre: etapa.nombre, progreso, etapaTerminada, ...(await avisosOt(sesion, ot, opts)) });
}

async function escanear(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const deModulo = leerQrModulo(datos.codigo);
  if (deModulo) return escanearModulo(sesion, datos, deModulo);
  // El QR de la etiqueta, o el número de pieza escrito a mano ("N° 1234")
  const lectura = leerQrPieza(datos.codigo) || (/^\d{1,15}$/.test(datos.codigo) ? { ot: null, id: Number(datos.codigo) } : null);
  if (!lectura) {
    // Pieza que se llama solo con un número, sin módulo (24/11): "M7541-32"
    // es la pieza "32" de la OT M-7541 si la OT la tiene (si no, puede ser el
    // código de una sub-OT, que se escribe igual)
    const numero = leerBarrasPiezaNumero(datos.codigo);
    if (numero) {
      const renglon = await unidadesDelRenglon(sesion, numero.ot, numero.nombre, opts);
      if (renglon.piezas.length) return escanearRenglon(sesion, datos, numero, renglon);
      return NextResponse.json({ error: `Ese código no es de una pieza ni de un módulo. Si es la pieza ${numero.nombre} de la OT ${numero.ot}, revisá que la planilla esté pegada en 🧩 Piezas.` }, { status: 404 });
    }
    return NextResponse.json({ error: "Ese código no es de una pieza ni de un módulo. Escaneá la etiqueta de la pieza o del módulo." }, { status: 400 });
  }
  if (lectura.nombre && !lectura.unidad) return escanearRenglon(sesion, datos, lectura);
  if (lectura.nombre) return escanearPiezaPlanilla(sesion, datos, lectura);
  const [pieza] = await leerPiezasOt(`piezas_ot?id=eq.${lectura.id}&empresa_id=eq.${e}&limit=1`, opts);
  // Número escrito a mano que no existe: casi siempre es un error al tipear,
  // no una planilla vuelta a pegar (auditoría 01/11)
  if (!pieza && !lectura.ot) {
    return NextResponse.json({ error: `No hay ninguna pieza con el N° ${lectura.id}. Revisá el número de la etiqueta.` }, { status: 404 });
  }
  // "OT X - PIEZA - 11": si no hay pieza N° 11 en esa OT, es la pieza que se llama "11"
  if (lectura.ot && (!pieza || normalizarOt(pieza.ot) !== normalizarOt(lectura.ot))) {
    const renglon = await unidadesDelRenglon(sesion, lectura.ot, String(lectura.id), opts);
    if (renglon.piezas.length) return escanearRenglon(sesion, datos, { ot: lectura.ot, nombre: String(lectura.id) }, renglon);
  }
  if (!pieza || (lectura.ot && normalizarOt(pieza.ot) !== normalizarOt(lectura.ot))) {
    return NextResponse.json({ error: "Esa pieza ya no está en la OT (puede que se haya vuelto a pegar la planilla). Reimprimí su etiqueta." }, { status: 404 });
  }
  return anotarPieza(sesion, datos, pieza);
}

/** Las unidades de un renglón de la OT (mismo nombre), en orden: { ot, piezas }. */
async function unidadesDelRenglon(sesion, otQr, nombre, opts) {
  const e = sesion.empresa_id;
  const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(otQr)}&select=ot&limit=1`, opts)) || [];
  const ot = proyecto?.ot || otQr;
  const piezas = await leerPiezasOt(`piezas_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&nombre=eq.${encodeURIComponent(nombre)}&order=unidad.asc`, opts);
  return { ot, piezas };
}

/**
 * QR del renglón (04/11, Tadeo): "OT M-7495 - PIEZA - M.izq-11", el mismo
 * para las 7 unidades. Cada escaneo anota en la etapa la siguiente unidad que
 * falta y dice cuántas van (3 de 7); con todas, avisa que ya estaban.
 */
async function escanearRenglon(sesion, datos, lectura, renglon = null) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  let { ot, piezas } = renglon || (await unidadesDelRenglon(sesion, lectura.ot, lectura.nombre, opts));
  // Código de barras con sub-OT ("M7498-36-GB2P-11"): la otra lectura posible
  for (const otra of piezas.length ? [] : lectura.otras || []) {
    const r = await unidadesDelRenglon(sesion, otra.ot, otra.nombre, opts);
    if (r.piezas.length) { ({ ot, piezas } = r); break; }
  }
  // Código de barras de un módulo, (OT)-(Módulo) (07/11): "M7819-GB2P" no es
  // una pieza; si la OT tiene ese módulo, pasan todas sus piezas
  if (!piezas.length && !renglon) {
    for (const l of [lectura, ...(lectura.otras || [])]) {
      const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(l.ot)}&select=ot&limit=1`, opts)) || [];
      if (!proyecto) continue;
      if ((await piezasDelModulo(sesion, proyecto.ot, l.nombre, opts)).length) return escanearModulo(sesion, datos, { ot: proyecto.ot, modulo: l.nombre });
    }
  }
  if (!piezas.length) {
    return NextResponse.json({ error: `La OT ${ot} no tiene la pieza ${lectura.nombre}. Revisá que la planilla esté pegada en 🧩 Piezas y que la OT y el nombre estén escritos igual.` }, { status: 404 });
  }
  const ids = piezas.map((p) => p.id);
  const hechos = new Set(((await sbGet(`pasos_pieza?empresa_id=eq.${e}&etapa=eq.${datos.etapa}&pieza_id=in.(${ids.join(",")})&select=pieza_id`, opts)) || []).map((p) => Number(p.pieza_id)));
  const siguiente = piezas.find((p) => !hechos.has(Number(p.id)));
  if (!siguiente) {
    const { etapa, response } = await etapaPorPieza(sesion, datos.etapa, opts);
    if (response) return response;
    const ultima = piezas[piezas.length - 1];
    return NextResponse.json({
      ok: true, ya: true, pieza: { id: ultima.id, ot: ultima.ot, nombre: ultima.nombre, unidad: ultima.unidad, de: ultima.de },
      etapa: datos.etapa, etapaNombre: etapa.nombre, requerida: (ultima.etapas || []).map(Number).includes(datos.etapa),
      faltan: [], progreso: null, etapaTerminada: null, conteo: { pasaron: piezas.length, de: piezas.length },
    });
  }
  return anotarPieza(sesion, datos, siguiente, { piezas, hechos });
}

/**
 * QR armado en la planilla de Excel: "OT M-7495 - PIEZA - M.izq-11 - 2 DE 4".
 * Se busca la pieza por OT + nombre + cuál de la cantidad (igual que al volver
 * a pegar la planilla, que reconoce las piezas por nombre y unidad).
 */
async function escanearPiezaPlanilla(sesion, datos, lectura) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(lectura.ot)}&select=ot&limit=1`, opts)) || [];
  const ot = proyecto?.ot || lectura.ot;
  const [pieza] = await leerPiezasOt(`piezas_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&nombre=eq.${encodeURIComponent(lectura.nombre)}&unidad=eq.${lectura.unidad}&limit=1`, opts);
  if (!pieza) {
    return NextResponse.json({ error: `La OT ${ot} no tiene la pieza ${lectura.nombre} (${lectura.unidad} de ${lectura.de}). Revisá que la planilla esté pegada en 🧩 Piezas y que la OT y el nombre estén escritos igual.` }, { status: 404 });
  }
  return anotarPieza(sesion, datos, pieza);
}

/**
 * Anota que la pieza pasó por la etapa (si no estaba) y cuenta el avance de la etapa.
 * renglon = { piezas, hechos } cuando se escaneó el código del renglón: la
 * respuesta dice cuántas de la cantidad van (conteo).
 * En la etapa de canto (por lados) anota un lado; la pieza pasa recién con el último.
 */
async function anotarPieza(sesion, datos, pieza, renglon = null) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const { etapa, response } = await etapaPorPieza(sesion, datos.etapa, opts);
  if (response) return response;
  const datosPieza = { id: pieza.id, ot: pieza.ot, nombre: pieza.nombre, unidad: pieza.unidad, de: pieza.de };
  const etapaNombre = etapa.nombre;
  const pasos = (await sbGet(`pasos_pieza?pieza_id=eq.${pieza.id}&empresa_id=eq.${e}&select=etapa,created_at`, opts)) || [];
  const requerida = (pieza.etapas || []).map(Number).includes(datos.etapa);
  const previo = pasos.find((p) => Number(p.etapa) === datos.etapa);
  const conteo = (sumada) => (renglon ? { conteo: { pasaron: renglon.hechos.size + (sumada ? 1 : 0), de: renglon.piezas.length } } : {});
  if (previo) {
    return NextResponse.json({ ok: true, ya: true, pieza: datosPieza, etapa: datos.etapa, etapaNombre, requerida, faltan: [], progreso: null, etapaTerminada: null, momento: previo.created_at, ...conteo(false) });
  }

  const faltan = requerida ? etapasSalteadas(pieza, datos.etapa, pasos) : [];
  const momento = momentoValido(datos.momento, Date.now());
  // Canto por lados (209): un escaneo por lado con canto
  let lados = null;
  const necesarios = escaneosPorPieza(pieza, etapa.porLados);
  if (necesarios > 1) {
    const unidades = renglon?.piezas || [pieza];
    const hechos = await ladosEscaneados(sesion, unidades.map((u) => u.id), datos.etapa, opts);
    if (hechos) {
      await sbPost("lados_pieza", {
        empresa_id: e, ot: pieza.ot, pieza_id: pieza.id, etapa: datos.etapa,
        empleado_id: sesion.empleado_id || null, created_at: momento,
      }, opts);
      broadcastRefresh(e, "lados_pieza");
      const completas = renglon?.hechos || new Set();
      const lado = (hechos.get(Number(pieza.id)) || 0) + 1;
      const total = unidades.reduce((s, u) => s + escaneosPorPieza(u, true), 0);
      const sumados = unidades.reduce((s, u) => {
        const n = escaneosPorPieza(u, true);
        return s + (completas.has(Number(u.id)) ? n : Math.min(n, hechos.get(Number(u.id)) || 0));
      }, 0) + 1;
      lados = { lado: Math.min(lado, necesarios), de: necesarios, hechos: Math.min(sumados, total), total };
      if (lado < necesarios) {
        return NextResponse.json({ ok: true, ya: false, pieza: datosPieza, etapa: datos.etapa, etapaNombre, requerida, faltan, progreso: null, etapaTerminada: null, lados, ...conteo(false), ...(await avisosOt(sesion, pieza.ot, opts)) });
      }
    }
  }
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pasos_pieza?on_conflict=pieza_id,etapa`, {
    method: "POST",
    headers: await sbHeaders(opts, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({
      empresa_id: e, ot: pieza.ot, pieza_id: pieza.id, etapa: datos.etapa, requerida,
      empleado_id: sesion.empleado_id || null, created_at: momento,
    }),
  });
  if (!r.ok) throw new Error(`POST pasos_pieza: ${await r.text()}`);
  broadcastRefresh(e, "pasos_pieza");

  const { progreso, etapaTerminada } = requerida ? await progresoEtapa(sesion, pieza.ot, etapa, opts) : { progreso: null, etapaTerminada: null };
  return NextResponse.json({ ok: true, ya: false, pieza: datosPieza, etapa: datos.etapa, etapaNombre, requerida, faltan, progreso, etapaTerminada, ...(lados ? { lados } : {}), ...conteo(true), ...(await avisosOt(sesion, pieza.ot, opts)) });
}

async function deshacerModulo(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const ids = (await piezasDelModulo(sesion, datos.ot, datos.modulo, opts)).map((p) => p.id);
  if (!ids.length) return NextResponse.json({ ok: true });
  const filtro = `pasos_pieza?empresa_id=eq.${e}&etapa=eq.${datos.etapa}&pieza_id=in.(${ids.join(",")})`;
  const pasos = (await sbGet(`${filtro}&select=id,empleado_id,created_at`, opts)) || [];
  if (!pasos.length) return NextResponse.json({ ok: true });
  const gestion = ROLES_GESTION.has(sesion.rol);
  const propios = pasos.filter((p) => p.empleado_id && p.empleado_id === sesion.empleado_id && Date.now() - Date.parse(p.created_at) <= MINUTOS_DESHACER * 60000);
  const borrar = gestion ? pasos : propios;
  if (!borrar.length) {
    return NextResponse.json({ error: `Solo podés deshacer tus escaneos de los últimos ${MINUTOS_DESHACER} minutos. Pedíselo al encargado.` }, { status: 403 });
  }
  await sbDelete(`pasos_pieza?empresa_id=eq.${e}&id=in.(${borrar.map((p) => p.id).join(",")})`, opts);
  broadcastRefresh(e, "pasos_pieza");
  return NextResponse.json({ ok: true, deshechas: borrar.length });
}

/** El último lado escaneado de la pieza en la etapa (209); null si no hay o falta la migración. */
async function ultimoLado(sesion, piezaId, etapa, opts) {
  try {
    const [l] = (await sbGet(`lados_pieza?pieza_id=eq.${piezaId}&etapa=eq.${etapa}&empresa_id=eq.${sesion.empresa_id}&select=id,empleado_id,created_at&order=created_at.desc,id.desc&limit=1`, opts)) || [];
    return l || null;
  } catch (err) {
    if (faltaLados(err)) return null;
    throw err;
  }
}

async function deshacer(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const filtro = `pasos_pieza?pieza_id=eq.${datos.pieza_id}&etapa=eq.${datos.etapa}&empresa_id=eq.${e}`;
  const [paso] = (await sbGet(`${filtro}&select=id,empleado_id,created_at&limit=1`, opts)) || [];
  // Canto por lados: se saca el último lado (y la pieza deja de estar completa)
  const lado = await ultimoLado(sesion, datos.pieza_id, datos.etapa, opts);
  const escaneo = lado || paso;
  if (!escaneo) return NextResponse.json({ ok: true });
  const propio = escaneo.empleado_id && escaneo.empleado_id === sesion.empleado_id
    && Date.now() - Date.parse(escaneo.created_at) <= MINUTOS_DESHACER * 60000;
  if (!propio && !ROLES_GESTION.has(sesion.rol)) {
    return NextResponse.json({ error: `Solo podés deshacer tus escaneos de los últimos ${MINUTOS_DESHACER} minutos. Pedíselo al encargado.` }, { status: 403 });
  }
  if (paso) {
    await sbDelete(`pasos_pieza?id=eq.${paso.id}&empresa_id=eq.${e}`, opts);
    broadcastRefresh(e, "pasos_pieza");
  }
  if (lado) {
    await sbDelete(`lados_pieza?id=eq.${lado.id}&empresa_id=eq.${e}`, opts);
    broadcastRefresh(e, "lados_pieza");
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(pasoPiezaBody, raw);
    if (parsed.response) return parsed.response;
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModuloSesion(sesion, "actividad");
    if (sinModulo) return sinModulo;
    try {
      const { accion } = parsed.data;
      if (accion === "escanear") return await escanear(sesion, parsed.data);
      if (accion === "deshacer_modulo") return await deshacerModulo(sesion, parsed.data);
      return await deshacer(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para escanear piezas falta correr la migración 110 en Supabase." }, { status: 409 });
      }
      if (falta112(err)) {
        return NextResponse.json({ error: "Para escanear piezas falta correr la migración 112 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[piezas/paso] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
