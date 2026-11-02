// app/lib/minutasReporte.js — Reportes consolidados de las minutas y tarjeta
// del Panel (Minuta, parte M5; diseño en notes/diseno-minuta-buenos-dias.md).
//
// Con las minutas de un período (semana o mes) arma:
//   - Reunión: cuántas, duración promedio, cuántas empezaron a horario (8:45,
//     con 5 minutos de tolerancia) y la asistencia de cada uno.
//   - OT con contingencias: los días que estuvieron en amarillo o rojo (en
//     curso de producción e instalación) y las OT que se repiten en el foco.
//   - Pendientes por responsable: abiertos, resueltos y días promedio hasta
//     resolverlos (desde el día en que aparecieron por primera vez).
//   - Feedback por área y por tipo.
//   - Compras disparadas desde la minuta: cuántas, urgentes y con pedido.
// No escribe nada: solo cuenta.
import { SECCIONES_SEGUIMIENTO, listaInstaladores } from "./minutas";
import { resumenRevision } from "./minutasRevision";

export const HORA_REUNION = "08:45";
const TOLERANCIA_MIN = 5;
const DIA = 86400000;

const minutos = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const dias = (desde, hasta) => Math.max(0, Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / DIA));
const fechaDeTs = (ts) => (ts ? new Date(Date.parse(ts) - 3 * 3600000).toISOString().slice(0, 10) : null);
const contar = (lista, clave) => {
  const m = new Map();
  for (const x of lista) { const k = clave(x); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return m;
};
const ordenar = (m) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "es", { numeric: true }));
const redondear = (n) => Math.round(n * 10) / 10;

// Los pendientes con responsable (el en curso se sigue en "OT con contingencias")
const PENDIENTES = SECCIONES_SEGUIMIENTO.filter((s) => s !== "prod_en_curso" && s !== "inst_en_curso");

/**
 * @param {{ minutas: object[], items: object[], hoy: string }} datos
 *   minutas: id, fecha, inicio, cierre, asistentes, estado
 *   items: minuta_items de esas minutas (con seccion, ot, semaforo, responsable, tipo, area, datos, viene_de, resuelto_at)
 */
export function resumenMinutas({ minutas = [], items = [], hoy }) {
  const fechaDe = new Map(minutas.map((m) => [m.id, m.fecha]));
  const conFecha = items.map((it) => ({ ...it, fecha: it.fecha || fechaDe.get(it.minuta_id) || null }));

  // Reunión
  const duraciones = minutas.map((m) => {
    const a = minutos(m.inicio), b = minutos(m.cierre);
    return a != null && b != null && b >= a ? b - a : null;
  }).filter((x) => x != null);
  const conInicio = minutas.filter((m) => minutos(m.inicio) != null);
  const aHorario = conInicio.filter((m) => minutos(m.inicio) <= minutos(HORA_REUNION) + TOLERANCIA_MIN).length;
  const asistencia = ordenar(contar(minutas.flatMap((m) => (Array.isArray(m.asistentes) ? m.asistentes : [])), (n) => n))
    .map(([nombre, veces]) => ({ nombre, veces, pct: minutas.length ? Math.round((veces / minutas.length) * 100) : 0 }));
  const reunion = {
    cantidad: minutas.length,
    duracionPromedio: duraciones.length ? Math.round(duraciones.reduce((s, x) => s + x, 0) / duraciones.length) : null,
    aHorario, conInicio: conInicio.length, asistencia,
  };

  // OT con contingencias: días distintos en amarillo o rojo
  const contingencias = new Map();
  for (const it of conFecha) {
    if (!it.ot || !["prod_en_curso", "inst_en_curso"].includes(it.seccion) || !["amarillo", "rojo"].includes(it.semaforo)) continue;
    if (!contingencias.has(it.ot)) contingencias.set(it.ot, { ot: it.ot, proyecto: it.proyecto || null, cliente: it.cliente || null, dias: new Set(), rojo: new Set() });
    const c = contingencias.get(it.ot);
    c.dias.add(it.fecha);
    if (it.semaforo === "rojo") c.rojo.add(it.fecha);
  }
  const otContingencias = [...contingencias.values()]
    .map((c) => ({ ot: c.ot, proyecto: c.proyecto, cliente: c.cliente, dias: c.dias.size, diasRojo: c.rojo.size }))
    .sort((a, b) => b.dias - a.dias || b.diasRojo - a.diasRojo || a.ot.localeCompare(b.ot, "es", { numeric: true }));
  const focoPorOt = new Map();
  for (const it of conFecha) {
    if (it.seccion !== "foco" || !it.ot) continue;
    if (!focoPorOt.has(it.ot)) focoPorOt.set(it.ot, { ot: it.ot, proyecto: it.proyecto || null, dias: new Set() });
    focoPorOt.get(it.ot).dias.add(it.fecha);
  }
  const otFoco = [...focoPorOt.values()].map((f) => ({ ot: f.ot, proyecto: f.proyecto, veces: f.dias.size }))
    .filter((f) => f.veces > 1).sort((a, b) => b.veces - a.veces || a.ot.localeCompare(b.ot, "es", { numeric: true }));

  // Pendientes por responsable: el último renglón de cada cadena dice cómo está
  const pend = conFecha.filter((it) => PENDIENTES.includes(it.seccion));
  const siguieron = new Set(pend.map((it) => it.viene_de).filter(Boolean));
  const porResp = new Map();
  for (const it of pend.filter((x) => !siguieron.has(x.id))) {
    const r = String(it.responsable || "").trim() || "Sin responsable";
    if (!porResp.has(r)) porResp.set(r, { responsable: r, abiertos: 0, resueltos: 0, vencidos: 0, diasResolver: [] });
    const x = porResp.get(r);
    const inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(it.datos?.desde || "")) ? it.datos.desde : it.fecha;
    if (it.resuelto_at) {
      x.resueltos += 1;
      if (inicio) x.diasResolver.push(dias(inicio, fechaDeTs(it.resuelto_at)));
    } else {
      x.abiertos += 1;
      if (it.fecha_objetivo && hoy && it.fecha_objetivo < hoy) x.vencidos += 1;
    }
  }
  const pendientes = [...porResp.values()]
    .map(({ diasResolver, ...x }) => ({ ...x, diasPromedio: diasResolver.length ? redondear(diasResolver.reduce((s, d) => s + d, 0) / diasResolver.length) : null }))
    .sort((a, b) => b.abiertos - a.abiertos || b.vencidos - a.vencidos || a.responsable.localeCompare(b.responsable, "es"));

  // Feedback por área y por tipo
  const fb = conFecha.filter((it) => it.seccion === "feedback");
  const areas = new Map();
  for (const it of fb) {
    const a = it.area || "Sin área";
    if (!areas.has(a)) areas.set(a, { area: a, total: 0, tipos: {} });
    const x = areas.get(a);
    x.total += 1;
    const t = it.tipo || "Sin tipo";
    x.tipos[t] = (x.tipos[t] || 0) + 1;
  }
  const feedback = {
    total: fb.length,
    porArea: [...areas.values()].sort((a, b) => b.total - a.total || a.area.localeCompare(b.area, "es")),
    porTipo: ordenar(contar(fb, (it) => it.tipo || "Sin tipo")).map(([tipo, n]) => ({ tipo, n })),
  };

  // Compras
  const comp = conFecha.filter((it) => it.seccion === "compra");
  const compras = {
    total: comp.length,
    urgentes: comp.filter((it) => it.tipo === "urgente").length,
    conPedido: comp.filter((it) => it.datos?.pedido_id).length,
  };

  return { reunion, otContingencias, otFoco, pendientes, feedback, compras };
}

/**
 * Tarjeta "📝 Minuta de hoy" del Panel: si ya se empezó o se cerró, y los
 * pendientes abiertos que vencen hoy o ya vencieron.
 * @param {{ minuta: object|null, items?: object[], abiertos: object[], hoy: string }} datos
 *   items = renglones de la minuta de hoy; abiertos = GET ?seguimiento (lo abierto de días anteriores)
 */
export function tarjetaMinuta({ minuta, items = [], abiertos = [], hoy }) {
  // Lo de días anteriores que ya pasó a la de hoy cuenta con el renglón de hoy
  const pasaron = new Set(items.map((it) => it.viene_de).filter(Boolean));
  const pend = [...abiertos.filter((it) => !pasaron.has(it.id)), ...items.filter((it) => !it.resuelto_at)]
    .filter((it) => PENDIENTES.includes(it.seccion));
  return {
    estado: !minuta ? "sin_empezar" : minuta.estado === "cerrada" ? "cerrada" : "abierta",
    venceHoy: pend.filter((it) => it.fecha_objetivo === hoy).length,
    vencidos: pend.filter((it) => it.fecha_objetivo && it.fecha_objetivo < hoy).length,
    abiertos: pend.length,
    gerencia: pend.filter((it) => it.datos?.gerencia).length,
  };
}

// ─── Informe consolidado (Tadeo, 02/11) ─────────────────────────────────────
// Del día, de la semana o del mes, para leerlo de un vistazo: reunión, foco,
// OT terminadas con su valor, OT en curso con su estado y contingencias,
// pendientes con los días que llevan abiertos y feedback por tipo. La semana
// y el mes son la suma de los informes de cada día (la serie).

const TERMINADAS = ["prod_terminada", "inst_terminada"];
const EN_CURSO = ["prod_en_curso", "inst_en_curso"];
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const diaSemana = (f) => DIAS_SEMANA[new Date(`${f}T12:00:00Z`).getUTCDay()];
const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
/** Lunes de la semana de esa fecha (AAAA-MM-DD). */
export function lunesDe(f) {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const masDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Desde y hasta del período: "dia", "semana" (lunes a domingo) o "mes". */
export function rangoInforme(modo, fecha) {
  if (modo === "semana") { const l = lunesDe(fecha); return { desde: l, hasta: masDias(l, 6) }; }
  if (modo === "mes") {
    const desde = `${fecha.slice(0, 7)}-01`;
    const d = new Date(`${desde}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
    return { desde, hasta: d.toISOString().slice(0, 10) };
  }
  return { desde: fecha, hasta: fecha };
}

/** El mismo período corrido para atrás (-1) o para adelante (+1). */
export function moverInforme(modo, fecha, paso) {
  if (modo === "semana") return masDias(lunesDe(fecha), 7 * paso);
  if (modo === "mes") { const d = new Date(`${fecha.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + paso); return d.toISOString().slice(0, 10); }
  return masDias(fecha, paso);
}

const MESES_INF = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "Jueves 30/10", "Semana del 26/10 al 01/11" o "Octubre 2026". */
export function nombreInforme(modo, fecha) {
  const { desde, hasta } = rangoInforme(modo, fecha);
  if (modo === "semana") return `Semana del ${ddmm(desde)} al ${ddmm(hasta)}`;
  if (modo === "mes") { const m = MESES_INF[Number(desde.slice(5, 7)) - 1]; return `${m[0].toUpperCase()}${m.slice(1)} ${desde.slice(0, 4)}`; }
  const largo = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][new Date(`${desde}T12:00:00Z`).getUTCDay()];
  return `${largo} ${ddmm(desde)}`;
}

/**
 * @param {{ minutas: object[], items: object[], precios?: Record<string, number>, hoy: string, modo?: "dia"|"semana"|"mes", hasta?: string }} datos
 *   precios: OT → precio (migración 142); sin precio la OT va sin valor.
 *   hasta: último día del período (los pendientes abiertos cuentan hasta ahí o hasta hoy).
 *   anterior: el feedback del período anterior ({ reuniones, items: [{ tipo, area }] }) para comparar.
 */
export function informeMinutas({ minutas = [], items = [], precios = {}, hoy, modo = "semana", hasta = null, anterior = null }) {
  const base = resumenMinutas({ minutas, items, hoy });
  const fechaDe = new Map(minutas.map((m) => [m.id, m.fecha]));
  const its = items.map((it) => ({ ...it, fecha: it.fecha || fechaDe.get(it.minuta_id) || null }))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || (a.orden || 0) - (b.orden || 0));
  const corte = hasta && hoy && hasta < hoy ? hasta : hoy;
  const precio = (ot) => (ot != null && precios[ot] != null && Number.isFinite(Number(precios[ot])) ? Number(precios[ot]) : null);

  // Reunión: cada día y el total
  const diasReunion = minutas.map((m) => ({
    fecha: m.fecha, inicio: m.inicio ? String(m.inicio).slice(0, 5) : null, cierre: m.cierre ? String(m.cierre).slice(0, 5) : null,
    duracion: (() => { const a = minutos(m.inicio), b = minutos(m.cierre); return a != null && b != null && b >= a ? b - a : null; })(),
    aHorario: minutos(m.inicio) == null ? null : minutos(m.inicio) <= minutos(HORA_REUNION) + TOLERANCIA_MIN,
    modera: m.modera || null, registra: m.registra || null,
    asistentes: Array.isArray(m.asistentes) ? m.asistentes : [],
    cerrada: m.estado === "cerrada",
  }));
  const presentesPromedio = diasReunion.length ? redondear(diasReunion.reduce((s, d) => s + d.asistentes.length, 0) / diasReunion.length) : 0;
  const reunion = { ...base.reunion, dias: diasReunion, presentesPromedio };

  // Foco: el del día en orden; en el período, cuántos días estuvo cada OT
  const focoItems = its.filter((it) => it.seccion === "foco");
  const focoMap = new Map();
  for (const it of focoItems) {
    const k = it.ot || it.texto || "";
    if (!k) continue;
    if (!focoMap.has(k)) focoMap.set(k, { ot: it.ot || null, proyecto: it.proyecto || null, cliente: it.cliente || null, texto: it.texto || "", dias: new Set() });
    const f = focoMap.get(k);
    f.dias.add(it.fecha);
    if (it.texto) f.texto = it.texto;
  }
  const foco = {
    items: focoItems.map((it) => ({ fecha: it.fecha, ot: it.ot || null, proyecto: it.proyecto || null, cliente: it.cliente || null, texto: it.texto || "" })),
    porOt: [...focoMap.values()].map((f) => ({ ...f, dias: f.dias.size }))
      .sort((a, b) => b.dias - a.dias || String(a.ot).localeCompare(String(b.ot), "es", { numeric: true })),
  };

  // Terminadas con su valor (una OT cuenta una vez por sección)
  const vistos = new Set();
  const terminadas = [];
  for (const it of its.filter((x) => TERMINADAS.includes(x.seccion))) {
    const k = `${it.seccion}|${it.ot || it.id}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    terminadas.push({ seccion: it.seccion, fecha: it.fecha, ot: it.ot || null, proyecto: it.proyecto || null, cliente: it.cliente || null, texto: it.texto || "", valor: precio(it.ot) });
  }
  const totalDe = (sec) => {
    const l = terminadas.filter((t) => t.seccion === sec);
    return { cantidad: l.length, valor: l.reduce((s, t) => s + (t.valor || 0), 0), sinPrecio: l.filter((t) => t.valor == null).length };
  };
  const terminado = { items: terminadas, produccion: totalDe("prod_terminada"), instalacion: totalDe("inst_terminada") };

  // En curso: el último estado de cada OT en el período, con sus días en amarillo o rojo
  const ultimo = new Map();
  for (const it of its.filter((x) => EN_CURSO.includes(x.seccion))) {
    const k = `${it.seccion}|${it.ot || it.id}`;
    ultimo.set(k, it);
  }
  const contDe = new Map(base.otContingencias.map((c) => [c.ot, c]));
  const enCursoItems = [...ultimo.values()].map((it) => ({
    seccion: it.seccion, fecha: it.fecha, ot: it.ot || null, proyecto: it.proyecto || null, cliente: it.cliente || null,
    semaforo: it.semaforo || "verde", texto: it.texto || "", responsable: it.responsable || null, fecha_objetivo: it.fecha_objetivo || null,
    instaladores: listaInstaladores(it.datos?.instaladores),
    diasProblema: contDe.get(it.ot)?.dias || 0, diasRojo: contDe.get(it.ot)?.diasRojo || 0,
  }));
  const orden = { rojo: 0, amarillo: 1, verde: 2 };
  enCursoItems.sort((a, b) => (orden[a.semaforo] ?? 3) - (orden[b.semaforo] ?? 3) || b.diasProblema - a.diasProblema || String(a.ot).localeCompare(String(b.ot), "es", { numeric: true }));
  const cuentaSem = (l) => ({ verde: l.filter((x) => (x.semaforo || "verde") === "verde").length, amarillo: l.filter((x) => x.semaforo === "amarillo").length, rojo: l.filter((x) => x.semaforo === "rojo").length });
  const enCurso = { items: enCursoItems, ...cuentaSem(enCursoItems) };

  // Pendientes: el último renglón de cada cadena, con los días desde que surgió
  const porId = new Map(its.map((it) => [it.id, it]));
  const pend = its.filter((it) => PENDIENTES.includes(it.seccion));
  const siguieron = new Set(pend.map((it) => it.viene_de).filter(Boolean));
  const origen = (it) => {
    if (FECHA_OK.test(String(it.datos?.desde || ""))) return it.datos.desde;
    let x = it, f = it.fecha, n = 0;
    while (x?.viene_de && porId.has(x.viene_de) && n++ < 400) { x = porId.get(x.viene_de); if (x.fecha && x.fecha < f) f = x.fecha; }
    return f;
  };
  const pendientesItems = pend.filter((it) => !siguieron.has(it.id)).map((it) => {
    const desde = origen(it);
    const resuelto = it.resuelto_at ? fechaDeTs(it.resuelto_at) : null;
    return {
      seccion: it.seccion, fecha: it.fecha, ot: it.ot || null, proyecto: it.proyecto || null, texto: it.texto || "",
      responsable: String(it.responsable || "").trim() || "Sin responsable", fecha_objetivo: it.fecha_objetivo || null,
      desde, dias: desde ? dias(desde, resuelto || corte) : null, resuelto: !!resuelto,
      vencido: !resuelto && !!it.fecha_objetivo && !!corte && it.fecha_objetivo < corte, gerencia: !!it.datos?.gerencia,
    };
  }).sort((a, b) => Number(a.resuelto) - Number(b.resuelto) || (b.dias || 0) - (a.dias || 0));
  const abiertos = pendientesItems.filter((p) => !p.resuelto);
  const resueltos = pendientesItems.filter((p) => p.resuelto);
  const pendientes = {
    items: pendientesItems,
    abiertos: abiertos.length, vencidos: abiertos.filter((p) => p.vencido).length, gerencia: abiertos.filter((p) => p.gerencia).length,
    resueltos: resueltos.length,
    diasPromedioAbiertos: abiertos.length ? redondear(abiertos.reduce((s, p) => s + (p.dias || 0), 0) / abiertos.length) : null,
    diasPromedioResolver: resueltos.length ? redondear(resueltos.reduce((s, p) => s + (p.dias || 0), 0) / resueltos.length) : null,
    porResponsable: base.pendientes,
  };

  // Feedback: cuántos de cada tipo (los conocidos primero)
  const tiposOrden = ["Error", "Falta de dato", "Mejora", "Reconocimiento"];
  const feedback = {
    ...base.feedback,
    porTipo: [...base.feedback.porTipo].sort((a, b) => {
      const ia = tiposOrden.indexOf(a.tipo), ib = tiposOrden.indexOf(b.tipo);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.n - a.n;
    }),
  };

  // Feedback detallado: cada uno, del más nuevo al más viejo, y un análisis corto
  feedback.items = its.filter((it) => it.seccion === "feedback").map((it) => ({
    fecha: it.fecha, ot: it.ot || null, proyecto: it.proyecto || null, cliente: it.cliente || null,
    tipo: it.tipo || "Sin tipo", area: it.area || "Sin área", texto: it.texto || "", trae: it.responsable || null, revisado: !!it.resuelto_at,
  })).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  feedback.analisis = analisisFeedback(feedback.items, anterior);

  // Serie: un punto por día (semana) o por semana (mes) — la suma de los informes diarios
  const clave = (f) => (modo === "mes" ? lunesDe(f) : f);
  const serieMap = new Map();
  const punto = (f) => {
    const k = clave(f);
    if (!serieMap.has(k)) serieMap.set(k, {
      clave: k, etiqueta: modo === "mes" ? `Sem ${ddmm(k)}` : `${diaSemana(k)} ${ddmm(k)}`,
      reuniones: 0, verde: 0, amarillo: 0, rojo: 0, terminadas: 0, valor: 0, pendientesNuevos: 0, resueltos: 0, feedback: 0,
    });
    return serieMap.get(k);
  };
  for (const m of minutas) if (m.fecha) punto(m.fecha).reuniones += 1;
  for (const it of its) {
    if (!it.fecha) continue;
    const p = punto(it.fecha);
    if (EN_CURSO.includes(it.seccion)) p[["amarillo", "rojo"].includes(it.semaforo) ? it.semaforo : "verde"] += 1;
    else if (it.seccion === "feedback") p.feedback += 1;
    else if (PENDIENTES.includes(it.seccion)) {
      if (!it.viene_de) p.pendientesNuevos += 1;
      if (it.resuelto_at) p.resueltos += 1;
    }
  }
  for (const t of terminadas) { if (!t.fecha) continue; const p = punto(t.fecha); p.terminadas += 1; p.valor += t.valor || 0; }
  const serie = [...serieMap.values()].sort((a, b) => a.clave.localeCompare(b.clave));

  // Revisión de la minuta anterior (155): % de alertas mitigadas, fechas cumplidas y compras hechas
  const revision = resumenRevision(its);

  return { modo, reunion, foco, terminado, enCurso, pendientes, feedback, compras: base.compras, otFoco: base.otFoco, serie, revision };
}

// ─── Análisis del feedback ──────────────────────────────────────────────────
// Frases cortas armadas con reglas (no inventa nada): de qué tipo fue, qué
// área recibió más errores, qué OT se repiten, quién trae más, cuántos se
// revisaron el jueves y cómo viene contra el período anterior.

const NEGATIVOS = ["Error", "Falta de dato"];
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const NOMBRE_TIPO = { Error: ["error", "errores"], "Falta de dato": ["falta de dato", "faltas de dato"], Mejora: ["mejora", "mejoras"], Reconocimiento: ["reconocimiento", "reconocimientos"] };
const nombreTipo = (t, n) => (NOMBRE_TIPO[t] ? plural(n, ...NOMBRE_TIPO[t]) : `${n} de tipo ${t}`);

/**
 * @param {{ tipo, area, ot, trae, revisado }[]} items  el feedback del período
 * @param {{ reuniones?: number, items: { tipo, area }[] } | null} anterior
 * @returns {{ tono: "bien"|"atencion"|"mal"|"normal", texto: string }[]}
 */
export function analisisFeedback(items = [], anterior = null) {
  const frases = [];
  if (!items.length) return frases;
  const porTipo = ordenar(contar(items, (it) => it.tipo || "Sin tipo"));
  const neg = items.filter((it) => NEGATIVOS.includes(it.tipo));
  const pctNeg = Math.round((neg.length / items.length) * 100);
  frases.push({
    tono: pctNeg >= 50 ? "atencion" : "normal",
    texto: `Hubo ${plural(items.length, "feedback", "feedback")}: ${porTipo.map(([t, n]) => nombreTipo(t, n)).join(", ")}.${neg.length ? ` El ${pctNeg} % marca un problema (error o falta de dato).` : " Ninguno marca un problema."}`,
  });
  if (neg.length) {
    const [area, n] = ordenar(contar(neg, (it) => it.area || "Sin área"))[0];
    if (n > 1 || neg.length === 1) frases.push({ tono: n >= 3 ? "mal" : "atencion", texto: `${area} recibió ${n === neg.length ? (n === 1 ? "el único problema" : "todos los problemas") : `${n} de los ${neg.length} problemas`}: conviene revisar con esa área de dónde vienen.` });
  }
  const otRep = ordenar(contar(items.filter((it) => it.ot), (it) => it.ot)).filter(([, n]) => n > 1);
  if (otRep.length) frases.push({ tono: "atencion", texto: `Se repiten OT: ${otRep.slice(0, 4).map(([ot, n]) => `OT ${ot} (${n} veces)`).join(", ")}.` });
  const rec = items.filter((it) => it.tipo === "Reconocimiento");
  if (rec.length) {
    const areas = [...new Set(rec.map((it) => it.area).filter(Boolean))];
    frases.push({ tono: "bien", texto: `${plural(rec.length, "reconocimiento", "reconocimientos")}${areas.length ? ` para ${areas.join(", ")}` : ""}.` });
  }
  const trae = ordenar(contar(items.filter((it) => it.trae), (it) => it.trae));
  if (trae.length && items.length >= 3) frases.push({ tono: "normal", texto: `Lo trajeron: ${trae.slice(0, 4).map(([q, n]) => `${q} ${n}`).join(", ")}${trae.length > 4 ? " y otros" : ""}.` });
  const rev = items.filter((it) => it.revisado).length;
  frases.push({ tono: rev === items.length ? "bien" : "normal", texto: rev === items.length ? "Todos ya se revisaron." : `Falta revisar ${items.length - rev} de ${items.length} en la revisión del jueves.` });
  if (anterior && anterior.reuniones) {
    const antNeg = (anterior.items || []).filter((it) => NEGATIVOS.includes(it.tipo)).length;
    const total = (anterior.items || []).length;
    const flecha = (a, b) => (b < a ? "bajaron" : b > a ? "subieron" : "siguen igual");
    frases.push({
      tono: neg.length < antNeg ? "bien" : neg.length > antNeg ? "mal" : "normal",
      texto: `Contra el período anterior: los problemas ${flecha(antNeg, neg.length)} (de ${antNeg} a ${neg.length}) y el total pasó de ${total} a ${items.length}.`,
    });
  }
  return frases;
}
