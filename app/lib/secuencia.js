// app/lib/secuencia.js — Un solo cálculo para la planificación y el Gantt de
// OT (Tadeo, 29/10: "usa un solo cálculo"). Lo usan el plan de 📊 Carga
// (planHorizonte) y el Gantt de Proyectos (procesosPlan), así las fechas que
// se ven al planificar son las mismas que ve la planta.
//
// Reglas (Tadeo, 27/10):
//  - en cada OT un proceso arranca cuando termina el anterior
//    (Corte → Canteado → Mecanizado → Armado);
//  - por cada máquina pasa una sola OT a la vez, en el orden de prioridad;
//  - Armado se reparte entre los armadores (crearArmado);
//  - cada día tiene las horas de la grilla de horarios del personal operativo
//    (del primero que entra al último que sale); los días de horas extra
//    rinden como el día más largo de la semana.
// Las horas son de reloj: el plan guarda horas de gente y cada máquina las
// divide entre sus personas o máquinas (duracion).

/** Sin grilla de horarios cargada: 8 horas de lunes a viernes. Índice = día de la semana (0 = domingo). */
export const HORAS_SEMANA_POR_DEFECTO = [0, 8, 8, 8, 8, 8, 0];
const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diaSemana = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export const MAQUINAS_PLAN = ["corte", "canteado", "mecanizado"];
export const ETAPAS_SECUENCIA = [...MAQUINAS_PLAN, "armado"];

/**
 * Calendario de trabajo desde `base` con las horas de cada día de la semana.
 * t = horas de trabajo desde el comienzo de `base`. `extras` = días de horas
 * extra (un sábado o domingo sin nadie puesto), con las horas del día más largo.
 */
export function calendario(base, horasSemana, extras = null) {
  const hs = (horasSemana || []).some((h) => h > 0) ? horasSemana : HORAS_SEMANA_POR_DEFECTO;
  const largo = Math.max(...hs);
  const horasDe = (f) => (hs[diaSemana(f)] > 0 ? hs[diaSemana(f)] : extras?.has(f) ? largo : 0);
  const dias = []; // { fecha, horas, desde (t al empezar el día) }
  const siguiente = (desde) => {
    let f = desde;
    while (!(horasDe(f) > 0)) f = sumarDias(f, 1);
    return f;
  };
  const f0 = siguiente(base);
  dias.push({ fecha: f0, horas: horasDe(f0), desde: 0 });
  const dia = (i) => {
    while (dias.length <= i) {
      const u = dias[dias.length - 1];
      const f = siguiente(sumarDias(u.fecha, 1));
      dias.push({ fecha: f, horas: horasDe(f), desde: u.desde + u.horas });
    }
    return dias[i];
  };
  /** t al empezar el primer día de trabajo en o después de la fecha. */
  const inicio = (fecha) => {
    let i = 0;
    while (dia(i).fecha < fecha) i++;
    return dia(i).desde;
  };
  /** { fecha, frac } del momento t; si termina justo al final de un día, queda en ese día. */
  const punto = (t, esFin) => {
    let i = 0;
    while (t > dia(i).desde + dia(i).horas - 1e-9 && !(esFin && t <= dia(i).desde + dia(i).horas + 1e-9)) i++;
    const d = dia(i);
    return { fecha: d.fecha, frac: Math.min(1, Math.max(0, (t - d.desde) / d.horas)) };
  };
  /** Cuántas horas del tramo [t0, t1) caen en cada día: [{ fecha, horas }]. */
  const reparto = (t0, t1) => {
    const out = [];
    for (let i = 0; dia(i).desde < t1 - 1e-9; i++) {
      const d = dia(i);
      const h = Math.min(t1, d.desde + d.horas) - Math.max(t0, d.desde);
      if (h > 1e-9) out.push({ fecha: d.fecha, horas: h });
    }
    return out;
  };
  return { inicio, punto, reparto };
}

/** Horas de reloj que el proceso ocupa su línea (el plan guarda horas de gente). */
export function duracion(etapa, horas, params) {
  if (etapa === "canteado") return horas / (params?.personas_canteadora === 2 ? 2 : 1);
  if (etapa === "mecanizado") return horas / (params?.maquinas_cnc || 1);
  if (etapa === "corte") return horas / (params?.maquinas_corte || 1);
  return horas;
}

/**
 * Armado con varios armadores a la vez (Tadeo, 27/10). Cada OT, en el orden
 * del plan, arranca apenas está lista (terminó su Mecanizado y llegó su día
 * del plan) y hay armadores libres: toma hasta maxPorOt; los que sobran
 * arman la OT siguiente en paralelo. Con k armadores, G horas de gente
 * tardan G / k. Los operarios de una máquina que ya no tiene más trabajo
 * pasan a Armado (ayudantes[máquina], desde que se libera).
 */
function crearArmado({ armadores, maxPorOt, ayudantes }) {
  const tomados = []; // { t0, t1, k }
  const pool = (t) => armadores + ayudantes.reduce((s, a) => s + (a.desde <= t + 1e-9 ? a.n : 0), 0);
  const usados = (t) => tomados.reduce((s, x) => s + (x.t0 <= t + 1e-9 && t < x.t1 - 1e-9 ? x.k : 0), 0);
  const libres = (t0, t1) => {
    // Lo mínimo libre en el tramo: se mira al empezar y cada vez que arranca otra OT adentro
    const puntos = [t0, ...tomados.map((x) => x.t0).filter((t) => t > t0 && t < t1)];
    return Math.min(...puntos.map((t) => pool(t) - usados(t)));
  };
  return (listo, G) => {
    const candidatos = [...new Set([listo, ...tomados.map((x) => x.t1), ...ayudantes.map((a) => a.desde)].filter((t) => t >= listo))].sort((a, b) => a - b);
    for (const t0 of candidatos) {
      for (let k = Math.min(maxPorOt, pool(t0) - usados(t0)); k >= 1; k--) {
        const t1 = t0 + G / k;
        if (libres(t0, t1) >= k) { tomados.push({ t0, t1, k }); return { t0, t1, k }; }
      }
    }
    // No debería pasar: cuando todo lo anterior termina, queda alguien libre
    const t0 = Math.max(listo, ...tomados.map((x) => x.t1));
    const k = Math.max(1, Math.min(maxPorOt, pool(t0)));
    tomados.push({ t0, t1: t0 + G / k, k });
    return { t0, t1: t0 + G / k, k };
  };
}

/**
 * Tramos de cada OT, en el orden recibido: Map<clave, [{ etapa, t0, t1, horas, personas }]>.
 * @param {{ clave: string, horas: Record<string, number> }[]} ots  horas de gente (de reloj) por etapa
 * @param {{ params?: object, personal?: { armadores: number, maxPorOt: number, ayudantes?: Record<string, number> }|null, inicio?: (o: object, etapa: string) => number }} opciones
 *   inicio: lo más temprano que puede arrancar cada proceso (t); por defecto 0.
 *   Sin `personal`, Armado lo hace una persona por vez (como una máquina).
 *   ordenEtapa: orden propio de algún proceso ({ canteado: [clave, …] }), el
 *   que se arma en "OT por proceso" del Gantt (Tadeo, 29/10); en los demás,
 *   el orden recibido.
 */
export function secuenciar(ots, { params = null, personal = null, inicio = () => 0, ordenEtapa = null } = {}) {
  const lugar = new Map(ots.map((o, i) => [o.clave, i]));
  const enOrden = (etapa) => {
    const propio = ordenEtapa?.[etapa];
    if (!propio?.length) return ots;
    const pos = new Map(propio.map((c, i) => [c, i]));
    const en = (o) => (pos.has(o.clave) ? pos.get(o.clave) : propio.length + lugar.get(o.clave));
    return [...ots].sort((a, b) => en(a) - en(b));
  };
  // 1) Máquinas: una OT a la vez por máquina, en secuencia dentro de cada OT
  const libre = {}; // hasta cuándo está ocupada cada máquina
  const tramos = new Map(ots.map((o) => [o.clave, []]));
  const listoOt = new Map(); // cuándo terminó cada OT su último proceso
  for (const id of MAQUINAS_PLAN) {
    for (const o of enOrden(id)) {
      const h = duracion(id, o.horas[id] || 0, params);
      if (h <= 0) continue;
      // No antes de lo que diga `inicio`, ni de que termine el anterior de la OT, ni de que se libere la máquina
      const t0 = Math.max(listoOt.get(o.clave) || 0, libre[id] || 0, inicio(o, id));
      libre[id] = t0 + h;
      listoOt.set(o.clave, t0 + h);
      tramos.get(o.clave).push({ etapa: id, t0, t1: t0 + h, horas: h, personas: null });
    }
  }
  // 2) Armado: con los armadores, y los de cada máquina cuando se queda sin trabajo
  const ayudantes = Object.entries(personal?.ayudantes || {}).map(([id, n]) => ({ desde: libre[id] || 0, n: Number(n) || 0 })).filter((a) => a.n > 0);
  const armadores = personal ? Math.max(0, Number(personal.armadores) || 0) : 1;
  const armar = crearArmado({
    armadores: armadores || (ayudantes.length ? 0 : 1),
    maxPorOt: personal ? Math.max(1, Number(personal.maxPorOt) || 1) : 1,
    ayudantes,
  });
  for (const o of enOrden("armado")) {
    const G = o.horas.armado || 0;
    if (G <= 0) continue;
    const lista = tramos.get(o.clave);
    const listo = Math.max(lista.length ? lista[lista.length - 1].t1 : 0, inicio(o, "armado"));
    const { t0, t1, k } = armar(listo, G);
    lista.push({ etapa: "armado", t0, t1, horas: t1 - t0, personas: personal ? k : null });
  }
  return tramos;
}
