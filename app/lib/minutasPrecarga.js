// app/lib/minutasPrecarga.js — Lo que Gypi sugiere para la minuta del día
// (Minuta, parte M2; diseño en notes/diseno-minuta-buenos-dias.md).
//
// Con lo que ya está en la base, Gypi arma sugerencias por sección. No se
// cargan solas: en la minuta aparecen como "Gypi sugiere" y se agregan con un
// toque (o todas juntas), porque en la reunión se decide qué entra.
//   1a Producción terminada: OT al 100 % por escaneo cuyo último escaneo fue
//      desde el día hábil anterior hasta ayer (el lunes cuenta el viernes,
//      sábado y domingo).
//   1b En curso: OT abiertas con avance por escaneo entre 0 y 100 %, en verde
//      y con su fecha de entrega.
//   1c A iniciar: OT que el plan confirmado pone hoy o el día hábil siguiente
//      y que todavía no tienen escaneos, con "¿Planilla y material?": si tiene
//      piezas pegadas y si el stock alcanza para lo que le falta retirar
//      según el MRP.
//   2a Instalación terminada: actas firmadas en ese mismo período.
//   2b En curso: OT cargadas sin acta firmada.
//   2c Pendientes: los pendientes de obra sin resolver (de Instalaciones y
//      del acta), con su fecha si la tienen. Responsable y fecha se completan
//      en la reunión (sin eso no se registran).
// No escribe nada: solo lee.
import { porcentajeOt } from "./piezas";
import { faltaPorOt } from "./materialDia";

const DIA = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const diaSemana = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();
const sumar = (fecha, dias) => iso(Date.parse(`${fecha}T12:00:00Z`) + dias * DIA);

/** Día hábil anterior (lunes a viernes): el lunes da el viernes. */
export function habilAnterior(fecha) {
  let d = sumar(fecha, -1);
  while ([0, 6].includes(diaSemana(d))) d = sumar(d, -1);
  return d;
}

/** Día hábil siguiente: el viernes da el lunes. */
export function habilSiguiente(fecha) {
  let d = sumar(fecha, 1);
  while ([0, 6].includes(diaSemana(d))) d = sumar(d, 1);
  return d;
}

/** Desde cuándo se cuenta "ayer" (inicio del día hábil anterior) y hasta cuándo (inicio de hoy), en hora argentina. */
export function ventanaAyer(fecha) {
  return {
    desde: new Date(`${habilAnterior(fecha)}T00:00:00-03:00`).toISOString(),
    hasta: new Date(`${fecha}T00:00:00-03:00`).toISOString(),
  };
}

const abierta = (p) => p && p.estado !== "cerrado" && !p.terminado_planilla;
const porOt = (lista) => lista.slice().sort((a, b) => String(a.ot).localeCompare(String(b.ot), "es", { numeric: true }));

/**
 * ¿Planilla y material? de una OT a iniciar.
 * @returns {"listo"|"falta_planilla"|"falta_material"|"falta_todo"}
 */
export function listoParaIniciar({ conPiezas, faltaOt, stock }) {
  const faltaMaterial = [...(faltaOt || new Map())].some(([sku, n]) => (Number(stock.get(sku)) || 0) < n);
  if (!conPiezas && faltaMaterial) return "falta_todo";
  if (!conPiezas) return "falta_planilla";
  if (faltaMaterial) return "falta_material";
  return "listo";
}

/**
 * Sugerencias para la minuta de `fecha`.
 * @param {{
 *   fecha: string,
 *   proyectos: object[],    // ot, estado, terminado_planilla, fecha_entrega
 *   avancePiezas?: object[], // v_avance_piezas: ot, etapa, total, pasaron
 *   pasos?: object[],       // pasos_pieza desde el día hábil anterior: ot, created_at
 *   planItems?: object[],   // renglones de los planes confirmados vigentes: ot, fecha
 *   actas?: object[],       // actas_ot: ot, firmada_at
 *   cargas?: object[],      // cargas_ot: ot, firma_carga_at
 *   pendientes?: object[],  // pendientes_obra sin resolver: id, ot, descripcion, fecha
 *   necesidades?: object[], // necesidades_stock de las OT a iniciar: ot, sku, cantidad
 *   movimientos?: object[], // movimientos_stock de esas OT: ot, sku, cantidad, tipo, anulado
 *   articulos?: object[],   // articulos_stock: sku, stock
 * }} datos
 * @returns {Record<string, object[]>} por sección: [{ clave, ot, texto, semaforo, fecha_objetivo, datos }]
 */
export function armarPrecarga({ fecha, proyectos = [], avancePiezas = [], pasos = [], planItems = [], actas = [], cargas = [], pendientes = [], necesidades = [], movimientos = [], articulos = [] }) {
  const { desde, hasta } = ventanaAyer(fecha);
  const proy = new Map(proyectos.map((p) => [String(p.ot), p]));

  // Avance por escaneo de cada OT y si tiene piezas pegadas
  const filas = new Map();
  for (const f of avancePiezas) {
    const ot = String(f.ot);
    if (!filas.has(ot)) filas.set(ot, []);
    filas.get(ot).push(f);
  }
  const avance = new Map([...filas].map(([ot, fs]) => [ot, porcentajeOt(fs)]));
  const conPiezas = new Set([...filas].filter(([, fs]) => fs.some((f) => Number(f.total) > 0)).map(([ot]) => ot));

  // 1a: al 100 % y con el último escaneo en la ventana (ninguno hoy)
  const ultimo = new Map();
  for (const s of pasos) {
    const ot = String(s.ot);
    if (!ultimo.has(ot) || s.created_at > ultimo.get(ot)) ultimo.set(ot, s.created_at);
  }
  const enVentana = (ts) => ts && Date.parse(ts) >= Date.parse(desde) && Date.parse(ts) < Date.parse(hasta);
  const prodTerminada = porOt([...ultimo].filter(([ot, ts]) => avance.get(ot) === 100 && enVentana(ts) && proy.has(ot)).map(([ot]) => ({ ot })));

  // 1b: abiertas con avance entre 0 y 100 %, la más avanzada primero
  const prodEnCurso = proyectos
    .filter((p) => abierta(p) && avance.get(String(p.ot)) > 0 && avance.get(String(p.ot)) < 100)
    .map((p) => ({ ot: String(p.ot), semaforo: "verde", fecha_objetivo: p.fecha_entrega || null, datos: { avance: avance.get(String(p.ot)) } }))
    .sort((a, b) => b.datos.avance - a.datos.avance || a.ot.localeCompare(b.ot, "es", { numeric: true }));

  // 1c: el plan las pone hoy o el día hábil siguiente y no tienen escaneos
  const manana = habilSiguiente(fecha);
  const arranca = new Map();
  for (const i of planItems) {
    const ot = String(i.ot);
    if (i.fecha < fecha || i.fecha > manana) continue;
    if (!arranca.has(ot) || i.fecha < arranca.get(ot)) arranca.set(ot, i.fecha);
  }
  const falta = faltaPorOt(necesidades, movimientos);
  const stock = new Map(articulos.map((a) => [a.sku, a.stock]));
  const prodAIniciar = [...arranca]
    .filter(([ot]) => abierta(proy.get(ot)) && !(avance.get(ot) > 0))
    .map(([ot, dia]) => ({
      ot,
      fecha_objetivo: proy.get(ot).fecha_entrega || null,
      datos: { arranca: dia, listo: listoParaIniciar({ conPiezas: conPiezas.has(ot), faltaOt: falta.get(ot), stock }) },
    }))
    .sort((a, b) => a.datos.arranca.localeCompare(b.datos.arranca) || a.ot.localeCompare(b.ot, "es", { numeric: true }));

  // 2a y 2b: actas firmadas en la ventana; cargadas sin acta firmada
  const firmadas = new Set(actas.filter((a) => a.firmada_at).map((a) => String(a.ot)));
  const instTerminada = porOt(actas.filter((a) => enVentana(a.firmada_at) && proy.has(String(a.ot))).map((a) => ({ ot: String(a.ot) })));
  const instEnCurso = porOt(cargas
    .filter((c) => c.firma_carga_at && !firmadas.has(String(c.ot)) && abierta(proy.get(String(c.ot))))
    .map((c) => ({ ot: String(c.ot), semaforo: "verde" })));

  // 2c: pendientes sin resolver, los más viejos primero
  const instPendiente = pendientes
    .filter((p) => !p.resuelto && proy.has(String(p.ot)))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    .map((p) => ({ ot: String(p.ot), texto: p.descripcion || "", semaforo: "amarillo", fecha_objetivo: p.fecha || null, datos: { pendiente_id: p.id } }));

  const conClave = (seccion, lista) => lista.map((s) => ({ ...s, clave: claveSugerencia(seccion, s) }));
  return {
    prod_terminada: conClave("prod_terminada", prodTerminada),
    prod_en_curso: conClave("prod_en_curso", prodEnCurso),
    prod_a_iniciar: conClave("prod_a_iniciar", prodAIniciar),
    inst_terminada: conClave("inst_terminada", instTerminada),
    inst_en_curso: conClave("inst_en_curso", instEnCurso),
    inst_pendiente: conClave("inst_pendiente", instPendiente),
  };
}

/** Qué identifica a una sugerencia: la OT en su sección, o el pendiente de obra. */
export function claveSugerencia(seccion, s) {
  return s?.datos?.pendiente_id != null ? `${seccion}|p${s.datos.pendiente_id}` : `${seccion}|${s?.ot || ""}`;
}

/** Las sugerencias que todavía no están en la minuta. */
export function sugerenciasPendientes(sugeridos, items, seccion) {
  const ya = new Set(items.filter((it) => it.seccion === seccion).map((it) => claveSugerencia(seccion, it)));
  return (sugeridos?.[seccion] || []).filter((s) => !ya.has(s.clave));
}
