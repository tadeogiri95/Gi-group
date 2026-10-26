// app/lib/cargaPlanta.js — Carga de la planta contra su capacidad
// (planificación de la producción, parte 39; diseño en
// notes/diseno-planificacion-produccion.md). Todo se calcula en el momento:
// todavía no se guarda ningún plan (eso es la parte 41).
//
// Horas de una OT por etapa (solo lo que falta):
//   Corte      = (placas + fondos) × min por placa
//   Canteado   = metros de canto × min por metro (con 2 personas la máquina
//                tarda menos, pero ocupa a las 2: mismas horas de gente)
//   Mecanizado = placas mecanizadas × min por placa (MECANIZADOS de la
//                planilla, o el % configurado de placas + fondos)
//   Armado     = gabinetes × min por gabinete (módulos de la OT, o las
//                etiquetas de módulo, o placas × gabinetes por placa)
// Capacidad = horario semanal de los operarios de la división que no son
// instaladores (sin descontar francos ni licencias). La eficiencia se aplica
// a las horas de trabajo: con 85 %, una hora de reloj rinde 51 minutos.
import { buscarDivision } from "./rutas";
import { ETAPAS_PLAN } from "./planificacion";

const DIAS_KEY = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const DIA = 86400000;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const ms = (fecha) => Date.parse(`${fecha}T00:00:00Z`);

/** Días ("AAAA-MM-DD") entre dos fechas, las dos incluidas. */
export function diasDelPeriodo(desde, hasta) {
  const out = [];
  for (let t = ms(desde); t <= ms(hasta) && out.length < 62; t += DIA) out.push(iso(t));
  return out;
}

/** Semana (desde el primer día que cuenta la empresa) o mes que contiene la fecha, corrido `paso` lugares. */
export function periodo(tipo, fecha, paso = 0, modo = "semana_domingo") {
  if (tipo === "mes") {
    const [a, m] = fecha.split("-").map(Number);
    const ini = new Date(Date.UTC(a, m - 1 + paso, 1));
    const fin = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
    return { tipo, desde: iso(ini.getTime()), hasta: iso(fin.getTime()) };
  }
  const t = ms(fecha);
  const dia = new Date(t).getUTCDay();
  const ini = t - (modo === "semana_domingo" ? dia : (dia + 6) % 7) * DIA + paso * 7 * DIA;
  return { tipo: "semana", desde: iso(ini), hasta: iso(ini + 6 * DIA) };
}

const minutos = (h) => {
  const [hh, mm] = String(h || "").split(":").map(Number);
  return Number.isFinite(hh) ? hh * 60 + (Number.isFinite(mm) ? mm : 0) : null;
};

/** Turno de ese día en minutos desde las 0: { in, out } (out > 24 h si cruza la medianoche), o null. */
function turno(empleado, fecha) {
  const t = empleado?.diagrama?.[DIAS_KEY[new Date(ms(fecha)).getUTCDay()]];
  if (!t) return null;
  const a = minutos(t.in), b = minutos(t.out);
  if (a == null || b == null || a === b) return null;
  return { in: a, out: b > a ? b : b + 24 * 60 };
}

/** Operarios que suman capacidad: activos, rol operativo, no instaladores, de la división. */
export function operariosDePlanta(empleados, divisiones, division) {
  return (empleados || []).filter((e) =>
    e?.rol === "operativo" && e?.activo !== false && !e?.es_instalador
    && (!division || buscarDivision(divisiones, e.division)?.id === division.id));
}

/**
 * Capacidad del período en horas de reloj.
 * gente: suma de los turnos de cada operario.
 * maquina: horas en que la planta está abierta (del primero que entra al
 * último que sale, cada día); una máquina trabaja como mucho eso.
 */
export function capacidadPlanta(operarios, dias) {
  let gente = 0, maquina = 0;
  const porDia = [];
  for (const fecha of dias) {
    let g = 0, ini = null, fin = null;
    for (const e of operarios) {
      const t = turno(e, fecha);
      if (!t) continue;
      g += t.out - t.in;
      ini = ini == null ? t.in : Math.min(ini, t.in);
      fin = fin == null ? t.out : Math.max(fin, t.out);
    }
    const m = ini == null ? 0 : fin - ini;
    gente += g; maquina += m;
    porDia.push({ fecha, gente: g / 60, maquina: m / 60 });
  }
  return { gente: gente / 60, maquina: maquina / 60, porDia, personas: operarios.length };
}

/** Qué parte de la etapa falta: 0 si está terminada, lo que falta escanear si se escanea por pieza, si no 1. */
export function pendienteEtapa({ ot, codigo, avance = [], piezas = [] }) {
  if (codigo == null) return 1;
  const fila = avance.find((a) => String(a.ot) === String(ot) && Number(a.etapa) === Number(codigo));
  if (fila && ["terminada", "aprobada", "no_aplica"].includes(fila.estado)) return 0;
  const p = piezas.find((x) => String(x.ot) === String(ot) && Number(x.etapa) === Number(codigo));
  if (p && Number(p.total) > 0) return Math.max(0, 1 - Math.min(Number(p.pasaron) || 0, Number(p.total)) / Number(p.total));
  return 1;
}

/**
 * Horas de una OT por etapa (horas de trabajo efectivas, antes de la eficiencia).
 * @returns {{ ot, sinDatos: boolean, placas, metros, mecanizadas, gabinetes, origenGabinetes, etapas: Record<string,{gente:number, maquina:number, pendiente:number}>, total: number }}
 */
export function horasOt(proyecto, params, { modulosEtiquetas = null, avance = [], piezas = [] } = {}) {
  const placas = (num(proyecto.placas) || 0) + (num(proyecto.fondos) || 0);
  const metros = num(proyecto.metros_canto) || 0;
  const mecanizadas = num(proyecto.placas_mecanizadas) ?? placas * ((params.pct_mecanizado || 0) / 100);
  let gabinetes, origenGabinetes;
  if (num(proyecto.total_modulos)) { gabinetes = num(proyecto.total_modulos); origenGabinetes = "modulos"; }
  else if (modulosEtiquetas) { gabinetes = modulosEtiquetas; origenGabinetes = "etiquetas"; }
  else { gabinetes = placas * (params.gabinetes_por_placa || 0); origenGabinetes = "placas"; }
  const sinDatos = num(proyecto.placas) == null && num(proyecto.fondos) == null && num(proyecto.metros_canto) == null;

  const pend = (id) => pendienteEtapa({ ot: proyecto.ot, codigo: params.etapas?.[id], avance, piezas });
  const doble = params.personas_canteadora === 2;
  const factorCanteadora = doble ? (params.pct_tiempo_canteadora_2 || 100) / 100 : 1;
  const personasCanteadora = doble ? 2 : 1;

  const base = {
    corte: placas * (params.min_placa || 0),
    canteado: metros * (params.min_metro_canto || 0),
    mecanizado: mecanizadas * (params.min_mecanizado_placa || 0),
    armado: gabinetes * (params.min_armado_gabinete || 0),
  };
  const etapas = {};
  for (const { id } of ETAPAS_PLAN) {
    const pendiente = pend(id);
    // Minutos de máquina (o de puesto, en Armado) y de gente
    const maquina = id === "canteado" ? base[id] * factorCanteadora * pendiente : base[id] * pendiente;
    const gente = id === "canteado" ? maquina * personasCanteadora : maquina;
    etapas[id] = { gente: gente / 60, maquina: maquina / 60, pendiente };
  }
  const total = Object.values(etapas).reduce((s, e) => s + e.gente, 0);
  return { ot: proyecto.ot, sinDatos, placas, metros, mecanizadas, gabinetes, origenGabinetes, etapas, total };
}

const MAQUINAS = [
  { id: "corte", nombre: "Seccionadora", cantidad: (p) => p.maquinas_corte || 1 },
  { id: "canteado", nombre: "Canteadora", cantidad: () => 1 },
  { id: "mecanizado", nombre: "CNC", cantidad: (p) => p.maquinas_cnc || 1 },
];

/**
 * Carga del período contra la capacidad, todo en horas de reloj.
 * @returns {{ necesarias, disponibles, extra, viable, porEtapa, maquinas, cuello, ots }}
 */
export function cargaPeriodo({ ots, params, capacidad }) {
  const ef = (params.eficiencia || 100) / 100;
  const reloj = (h) => h / ef;
  const porEtapa = Object.fromEntries(ETAPAS_PLAN.map(({ id, nombre }) => [id, {
    id, nombre,
    gente: reloj(ots.reduce((s, o) => s + o.etapas[id].gente, 0)),
    maquina: reloj(ots.reduce((s, o) => s + o.etapas[id].maquina, 0)),
  }]));
  const necesarias = Object.values(porEtapa).reduce((s, e) => s + e.gente, 0);
  const disponibles = capacidad.gente;
  const extra = Math.max(0, necesarias - disponibles);

  const maquinas = MAQUINAS.map((m) => {
    const disp = capacidad.maquina * m.cantidad(params);
    const nec = porEtapa[m.id].maquina;
    return { id: m.id, nombre: m.nombre, cantidad: m.cantidad(params), necesarias: nec, disponibles: disp, extra: Math.max(0, nec - disp), uso: disp > 0 ? nec / disp : (nec > 0 ? Infinity : 0) };
  });

  // Cuello de botella: lo más cargado entre la gente y cada máquina
  const candidatos = [
    { id: "gente", nombre: "Gente", uso: disponibles > 0 ? necesarias / disponibles : (necesarias > 0 ? Infinity : 0), extra },
    ...maquinas.map((m) => ({ id: m.id, nombre: m.nombre, uso: m.uso, extra: m.extra })),
  ];
  const cuello = candidatos.reduce((a, b) => (b.uso > a.uso ? b : a));
  const viable = candidatos.every((c) => c.extra <= 0.0001);
  return { necesarias, disponibles, extra, viable, porEtapa, maquinas, cuello: cuello.uso > 0 ? cuello : null, ots };
}

/** OT que vienen tildadas: las que tienen fecha objetivo hasta el fin del período (incluye las atrasadas). */
export function preseleccion(ots, hasta) {
  return new Set(ots.filter((p) => p.fecha_objetivo && p.fecha_objetivo <= hasta).map((p) => p.id));
}

/** Gabinetes por OT según las etiquetas de módulo (módulos distintos de sus piezas). */
export function modulosPorOt(piezas) {
  const porOt = new Map();
  for (const p of piezas || []) {
    const m = String(p.modulo || "").trim();
    if (!m) continue;
    const k = String(p.ot);
    if (!porOt.has(k)) porOt.set(k, new Set());
    porOt.get(k).add(m.toLowerCase());
  }
  return new Map([...porOt].map(([k, s]) => [k, s.size]));
}

/** 12,5 → "12,5 h"; 0,04 → "0 h". */
export function fmtH(h) {
  if (!Number.isFinite(h)) return "—";
  return `${(Math.round(h * 10) / 10).toLocaleString("es-AR")} h`;
}
