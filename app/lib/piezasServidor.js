// app/lib/piezasServidor.js — Guardar las piezas de una OT (parte 17). Lo
// usan las dos formas de cargar: pegar la planilla en 🧩 Piezas
// (/api/piezas, con el pase del usuario) y la carga automática desde la
// carpeta de planillas (/api/piezas/planillas, con service_role filtrado
// por la empresa de la clave del script).
// Las piezas que ya estaban (mismo nombre y número) conservan su id, así las
// etiquetas impresas y los escaneos siguen valiendo.
import { sbGet, sbGetAll, sbPost, sbPatch, sbDelete, sbHeaders } from "./sbHelpers";
import { expandirPiezas, cambiosAlReemplazar, reglasPieza } from "./piezas";
import { planSueltos, claveComponente } from "./sueltosPlanilla";
import { broadcastRefresh } from "./broadcast";
import { modulosACorregir, sueltosDeDestinos, armarDestinos, planBultos, ARMADO } from "./destinosPiezas";

const broadcastBultos = (e) => broadcastRefresh(e, "bultos_ot");

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
 * Deja la hoja de sueltos de la OT como la piden los destinos. Lo cargado a
 * mano no se toca; lo que puso Gypi antes (origen 'planilla', migración 163)
 * se corrige o se borra (salvo si ya está tildado).
 * @returns {Promise<{ ids: number[], creados: number, borrados: number, quedanTildados: number }>}
 */
export async function sincronizarSueltos({ e, ot, items, idsPrevios = [], opts = {} }) {
  const filtroOt = `sueltos_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}`;
  const actuales = (await sbGet(`${filtroOt}&select=id,orden,tipo,codigo,descripcion,medida,cantidad,acopio,carga,origen&order=orden.asc,id.asc`, opts)) || [];
  const propios = [...new Set([...idsPrevios.map(Number), ...actuales.filter((a) => a.origen === "planilla").map((a) => Number(a.id))])];
  const plan = planSueltos(actuales, items, propios);
  for (let i = 0; i < plan.borrar.length; i += LOTE_IDS) {
    await sbDelete(`${filtroOt}&id=in.(${plan.borrar.slice(i, i + LOTE_IDS).join(",")})`, opts);
  }
  for (const c of plan.corregir) {
    await sbPatch(`${filtroOt}&id=eq.${c.id}`, { cantidad: c.cantidad, medida: c.medida }, opts);
  }
  // Los que ya estaban y ahora los maneja Gypi quedan marcados como suyos
  const adoptar = plan.siguen.filter((id) => !actuales.find((a) => Number(a.id) === Number(id))?.origen);
  if (adoptar.length) await sbPatch(`${filtroOt}&id=in.(${adoptar.join(",")})&origen=is.null`, { origen: "planilla" }, opts);
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
      origen: "planilla",
    })), opts)) || [];
  }
  return {
    ids: [...plan.siguen, ...creados.map((c) => c.id)].map(Number),
    creados: creados.length,
    borrados: plan.borrar.length,
    quedanTildados: plan.quedanTildados.length,
  };
}

async function upsertDestinos(filas, opts) {
  for (let i = 0; i < filas.length; i += LOTE) {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/destinos_ot?on_conflict=empresa_id,ot,tipo,clave`, {
      method: "POST",
      headers: await sbHeaders(opts, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(filas.slice(i, i + LOTE)),
    });
    if (!r.ok) throw new Error(`POST destinos_ot: ${await r.text()}`);
  }
}

/**
 * Lo que dice la planilla, en destinos_ot: la lista completa de herrajes y
 * perfiles de NECESIDADES (con su SUELTO) y las piezas marcadas SUELTO en
 * DATOS. Lo elegido a mano (suelto, modulo) no se toca.
 * @param {object} p
 * @param {object[]|null} p.componentes de componentesPlanilla (null = la planilla no tiene la lista)
 * @param {string[]|null} p.piezasSueltas nombres de las piezas marcadas SUELTO (null = sin la columna)
 */
export async function guardarDestinosPlanilla({ e, ot, componentes, piezasSueltas, opts = {} }) {
  const filtroOt = `destinos_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}`;
  const ahora = new Date().toISOString();
  if (componentes) {
    await sbPatch(`${filtroOt}&tipo=eq.herraje&en_planilla=eq.true`, { en_planilla: false }, opts);
    const filas = new Map();
    for (const c of componentes.slice(0, 1000)) {
      const clave = claveComponente(c);
      if (!clave.replace(/\|/g, "")) continue;
      filas.set(clave, {
        empresa_id: e, ot, tipo: "herraje", clave,
        datos: { tipo: c.tipo, codigo: c.codigo, descripcion: c.descripcion, medida: c.medida, cantidad: c.cantidad },
        planilla_suelto: !!c.suelto, en_planilla: true, updated_at: ahora,
      });
    }
    await upsertDestinos([...filas.values()], opts);
  }
  await sbPatch(`${filtroOt}&tipo=eq.pieza&planilla_suelto=eq.true`, { planilla_suelto: false }, opts);
  const nombres = [...new Set((piezasSueltas || []).map((n) => String(n).slice(0, 300)).filter(Boolean))];
  if (nombres.length) {
    await upsertDestinos(nombres.map((clave) => ({ empresa_id: e, ot, tipo: "pieza", clave, planilla_suelto: true, en_planilla: true, updated_at: ahora })), opts);
  }
}

/** Piezas y destinos de la OT. */
export async function leerDestinos({ e, ot, opts = {} }) {
  const filtro = `empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}`;
  const [{ data: piezas }, { data: destinos }] = await Promise.all([
    sbGetAll(`piezas_ot?${filtro}&select=id,nombre,modulo,material,l1,l2&order=id.asc`, { sesion: opts.sesion, maxFilas: 5000 }),
    sbGetAll(`destinos_ot?${filtro}&select=tipo,clave,datos,planilla_suelto,en_planilla,suelto,modulo&order=id.asc`, { sesion: opts.sesion, maxFilas: 5000 }),
  ]);
  return { piezas: piezas || [], destinos: destinos || [] };
}

/**
 * Aplica los destinos: las piezas sin módulo asignadas pasan a ser de ese
 * módulo en piezas_ot (así sus etiquetas de módulo y el escaneo de Armado
 * las incluyen) y 📦 Sueltos queda con lo que va suelto.
 */
export async function aplicarDestinos({ e, ot, idsPrevios = [], opts = {} }) {
  const { piezas, destinos } = await leerDestinos({ e, ot, opts });
  const filtroOt = `piezas_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}`;
  const corregir = modulosACorregir(piezas, destinos);
  for (const [nombre, modulo] of Object.entries(corregir)) {
    await sbPatch(`${filtroOt}&nombre=eq.${encodeURIComponent(nombre)}`, { modulo }, opts);
  }
  const s = await sincronizarSueltos({ e, ot, items: sueltosDeDestinos(piezas, destinos), idsPrevios, opts });
  const armados = armarDestinos(piezas, destinos).modulos.filter((m) => m.destino === ARMADO).map((m) => m.modulo);
  const bultos = await sincronizarBultos({ e, ot, modulos: armados, opts });
  return { modulos: Object.keys(corregir).length, sueltos: s, bultos };
}

/**
 * Un bulto por módulo armado en 🚚 Carga (planBultos). No toca nada si la OT
 * tiene bultos armados a mano o si la carga ya está firmada.
 * @returns {Promise<{ creados: number, borrados: number } | null>}
 */
export async function sincronizarBultos({ e, ot, modulos, opts = {} }) {
  const otq = encodeURIComponent(ot);
  const [carga] = (await sbGet(`cargas_ot?empresa_id=eq.${e}&ot=eq.${otq}&select=firma_carga_at&limit=1`, opts)) || [];
  if (carga?.firma_carga_at) return null;
  const bultos = (await sbGet(`bultos_ot?empresa_id=eq.${e}&ot=eq.${otq}&select=id,numero,contenido,cargado&order=numero.asc`, opts)) || [];
  const plan = planBultos(bultos, modulos.slice(0, 999));
  if (!plan) return null;
  for (let i = 0; i < plan.borrar.length; i += LOTE_IDS) {
    await sbDelete(`bultos_ot?empresa_id=eq.${e}&ot=eq.${otq}&id=in.(${plan.borrar.slice(i, i + LOTE_IDS).join(",")})`, opts);
  }
  // De menor a mayor: cada número nuevo es menor o igual al viejo, no choca
  for (const r of plan.renumerar) await sbPatch(`bultos_ot?empresa_id=eq.${e}&id=eq.${r.id}`, { numero: r.numero }, opts);
  if (plan.crear.length) {
    await sbPost("bultos_ot", plan.crear.map((b) => ({ empresa_id: e, ot, numero: b.numero, contenido: b.contenido, creado_por: null })), opts);
  }
  if (plan.crear.length || plan.borrar.length || plan.renumerar.length) broadcastBultos(e);
  return { creados: plan.crear.length, borrados: plan.borrar.length };
}
