// app/lib/piezasServidor.js — Guardar las piezas de una OT (parte 17). Lo
// usan las dos formas de cargar: pegar la planilla en 🧩 Piezas
// (/api/piezas, con el pase del usuario) y la carga automática desde la
// carpeta de planillas (/api/piezas/planillas, con service_role filtrado
// por la empresa de la clave del script).
// Las piezas que ya estaban (mismo nombre y número) conservan su id, así las
// etiquetas impresas y los escaneos siguen valiendo.
import { sbGet, sbGetAll, sbPost, sbPatch, sbDelete, sbHeaders } from "./sbHelpers";
import { expandirPiezas, cambiosAlReemplazar, reglasPieza } from "./piezas";
import { planSueltos } from "./sueltosPlanilla";

const LOTE = 500;
const LOTE_IDS = 200;

/** Deja solo las etapas de la empresa que se escanean por pieza, en su orden. */
export async function ordenarEtapas(e, opts = {}) {
  const etapas = (await sbGet(`etapas?empresa_id=eq.${e}&select=codigo,nombre,orden,activa,por_pieza,columna_pieza`, opts)) || [];
  const orden = reglasPieza(etapas).map((r) => r.codigo);
  return (lista) => orden.filter((c) => (lista || []).includes(c));
}

/** Las reglas de etapas por pieza de la empresa (para leerPiezas en el servidor). */
export async function reglasDeEmpresa(e, opts = {}) {
  const etapas = (await sbGet(`etapas?empresa_id=eq.${e}&select=codigo,nombre,orden,activa,por_pieza,columna_pieza`, opts)) || [];
  return reglasPieza(etapas);
}

async function upsertPiezas(filas, opts) {
  for (let i = 0; i < filas.length; i += LOTE) {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/piezas_ot?on_conflict=empresa_id,ot,nombre,unidad`, {
      method: "POST",
      headers: await sbHeaders(opts, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(filas.slice(i, i + LOTE)),
    });
    if (!r.ok) throw new Error(`POST piezas_ot: ${await r.text()}`);
  }
}

/**
 * Reemplaza las piezas de la OT por las de la planilla.
 * protegerEscaneadas: las que ya no vienen pero tienen algún escaneo no se
 * borran (carga automática: nadie está mirando para confirmar).
 * @returns {Promise<{ piezas: number, nuevas: number, siguen: number, salen: number, noBorradas: number }>}
 */
export async function guardarPiezas({ e, ot, renglones, opts = {}, empleadoId = null, protegerEscaneadas = false }) {
  const filtroOt = `piezas_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}`;
  const ordenar = await ordenarEtapas(e, opts);
  const { data: actuales } = await sbGetAll(`${filtroOt}&select=id,nombre,unidad&order=id.asc`, { sesion: opts.sesion, maxFilas: 5000 });
  const piezas = expandirPiezas(renglones);
  const cambios = cambiosAlReemplazar(actuales, piezas);
  const ahora = new Date().toISOString();
  // Mismas claves en todas las filas (PostgREST lo exige en un lote)
  await upsertPiezas(piezas.map((p) => ({
    empresa_id: e,
    ot,
    renglon: p.renglon,
    nombre: p.nombre,
    modulo: p.modulo,
    material: p.material,
    l1: p.l1,
    l2: p.l2,
    unidad: p.unidad,
    de: p.de,
    etapas: ordenar(p.etapas),
    cargada_at: ahora,
    creado_por: empleadoId,
  })), opts);

  let noBorradas = 0;
  if (cambios.salen) {
    if (!protegerEscaneadas) {
      // Lo que no vino en esta carga ya no está en la planilla
      await sbDelete(`${filtroOt}&cargada_at=lt.${encodeURIComponent(ahora)}`, opts);
    } else {
      const quedan = new Set(piezas.map((p) => `${p.nombre}\u0000${p.unidad}`));
      const salen = actuales.filter((p) => !quedan.has(`${p.nombre}\u0000${p.unidad}`)).map((p) => p.id);
      const escaneadas = new Set();
      for (let i = 0; i < salen.length; i += LOTE_IDS) {
        const ids = salen.slice(i, i + LOTE_IDS).join(",");
        const pasos = (await sbGet(`pasos_pieza?empresa_id=eq.${e}&pieza_id=in.(${ids})&select=pieza_id`, opts)) || [];
        for (const p of pasos) escaneadas.add(p.pieza_id);
      }
      const borrar = salen.filter((id) => !escaneadas.has(id));
      noBorradas = salen.length - borrar.length;
      for (let i = 0; i < borrar.length; i += LOTE_IDS) {
        await sbDelete(`${filtroOt}&id=in.(${borrar.slice(i, i + LOTE_IDS).join(",")})`, opts);
      }
    }
  }
  return { piezas: piezas.length, ...cambios, noBorradas };
}

/**
 * Deja la hoja de sueltos de la OT como la pide la planilla (carga
 * automática, con las columnas SUELTO). Lo cargado a mano no se toca; lo que
 * cargó la planilla antes se corrige o se borra (salvo si ya está tildado).
 * @returns {Promise<{ ids: number[], creados: number, borrados: number, quedanTildados: number }>}
 */
export async function sincronizarSueltos({ e, ot, items, idsPrevios = [], opts = {} }) {
  const filtroOt = `sueltos_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}`;
  const actuales = (await sbGet(`${filtroOt}&select=id,orden,tipo,codigo,descripcion,medida,cantidad,acopio,carga&order=orden.asc,id.asc`, opts)) || [];
  const plan = planSueltos(actuales, items, idsPrevios);
  for (let i = 0; i < plan.borrar.length; i += LOTE_IDS) {
    await sbDelete(`${filtroOt}&id=in.(${plan.borrar.slice(i, i + LOTE_IDS).join(",")})`, opts);
  }
  for (const c of plan.corregir) {
    await sbPatch(`${filtroOt}&id=eq.${c.id}`, { cantidad: c.cantidad, medida: c.medida }, opts);
  }
  let creados = [];
  if (plan.crear.length) {
    const base = actuales.reduce((m, a) => Math.max(m, Number(a.orden) || 0), -1) + 1;
    // Mismas claves en todas las filas (PostgREST lo exige en un lote)
    creados = (await sbPost("sueltos_ot", plan.crear.map((item, i) => ({
      empresa_id: e,
      ot,
      orden: base + i,
      tipo: item.tipo ?? null,
      codigo: item.codigo ?? null,
      descripcion: item.descripcion ?? null,
      medida: item.medida ?? null,
      cantidad: item.cantidad ?? 1,
      va_con: item.va_con ?? null,
      creado_por: null,
    })), opts)) || [];
  }
  return {
    ids: [...plan.siguen, ...creados.map((c) => c.id)].map(Number),
    creados: creados.length,
    borrados: plan.borrar.length,
    quedanTildados: plan.quedanTildados.length,
  };
}
