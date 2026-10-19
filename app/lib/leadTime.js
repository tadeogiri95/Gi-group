// app/lib/leadTime.js — Lead time de cada OT (seguimiento de OT por escaneo,
// parte 27). Cuánto tardó, en días corridos:
//   Producción: desde la liberación de la OT (o el primer escaneo, si nunca
//               se liberó) hasta el último escaneo que la dejó al 100%. Una
//               OT sin piezas cargadas termina cuando todas sus etapas
//               marcadas quedaron cerradas.
//   Instalación: desde la carga en el camión (firma de la carga, o el primer
//               bulto cargado) hasta el acta firmada.
//   Total:      desde el alta de la OT hasta el acta firmada.
// Una etapa que todavía no terminó no tiene lead time (null).
import { buscarDivision } from "./rutas";

const ms = (t) => (t ? Date.parse(t) : NaN);
const minimo = (...ts) => ts.filter((t) => Number.isFinite(ms(t))).sort((a, b) => ms(a) - ms(b))[0] ?? null;
const maximo = (...ts) => ts.filter((t) => Number.isFinite(ms(t))).sort((a, b) => ms(b) - ms(a))[0] ?? null;

/** Días entre dos momentos, con un decimal; null si falta alguno o no tiene sentido. */
export function dias(desde, hasta) {
  const d = ms(desde), h = ms(hasta);
  if (!Number.isFinite(d) || !Number.isFinite(h) || h < d) return null;
  return Math.round(((h - d) / 86400000) * 10) / 10;
}

const agrupar = (filas, clave) => {
  const m = new Map();
  for (const f of filas || []) {
    const k = String(f[clave]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return m;
};

/**
 * Lead time de cada OT.
 * @param {{ proyectos: object[], avancePiezas?: object[], avanceEtapas?: object[], cargas?: object[], bultos?: object[], actas?: object[] }} datos
 *   avancePiezas: filas de v_avance_piezas con primer_paso y ultimo_paso (118)
 * @returns {object[]} una fila por OT: fechas de cada hito y los días de cada tramo
 */
export function leadTimes({ proyectos = [], avancePiezas = [], avanceEtapas = [], cargas = [], bultos = [], actas = [] }) {
  const piezas = agrupar(avancePiezas, "ot");
  const etapas = agrupar(avanceEtapas, "ot");
  const bultosOt = agrupar(bultos, "ot");
  const carga = new Map(cargas.map((c) => [String(c.ot), c]));
  const acta = new Map(actas.map((a) => [String(a.ot), a]));

  return proyectos.map((p) => {
    const ot = String(p.ot);
    const filas = (piezas.get(ot) || []).filter((f) => Number(f.total) > 0);
    const primerEscaneo = minimo(...filas.map((f) => f.primer_paso));
    let finProduccion = null;
    if (filas.length) {
      const completa = filas.every((f) => Number(f.pasaron) >= Number(f.total));
      if (completa) finProduccion = maximo(...filas.map((f) => f.ultimo_paso));
    } else {
      const marcadas = etapas.get(ot) || [];
      const cerradas = marcadas.length > 0 && marcadas.every((a) => ["aprobada", "terminada", "no_aplica"].includes(a.estado));
      if (cerradas) finProduccion = maximo(...marcadas.map((a) => a.aprobada_at || a.terminada_at));
    }
    const inicioProduccion = p.liberada_at || primerEscaneo;
    const inicioInstalacion = carga.get(ot)?.firma_carga_at || minimo(...(bultosOt.get(ot) || []).map((b) => b.cargado_at));
    const finInstalacion = acta.get(ot)?.firmada_at || null;
    return {
      ot,
      cliente: p.cliente || p.proyecto || null,
      division: p.division || null,
      alta: p.created_at || null,
      inicioProduccion, finProduccion, inicioInstalacion, finInstalacion,
      produccion: dias(inicioProduccion, finProduccion),
      instalacion: dias(inicioInstalacion, finInstalacion),
      total: dias(p.created_at, finInstalacion),
    };
  });
}

const enPeriodo = (t, desde, hasta) => {
  if (!t) return false;
  const d = new Date(ms(t) - 3 * 3600000).toISOString().slice(0, 10); // día en Argentina
  return d >= desde && d <= hasta;
};
const promedio = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

export const TRAMOS = [
  { clave: "produccion", fin: "finProduccion", nombre: "Producción" },
  { clave: "instalacion", fin: "finInstalacion", nombre: "Instalación" },
  { clave: "total", fin: "finInstalacion", nombre: "Total (alta → acta)" },
];

/**
 * Lead times de las OT que terminaron cada tramo dentro del período, con el
 * promedio general y por división.
 * @returns {{ tramos: { clave, nombre, cantidad, promedio, porDivision: { nombre, cantidad, promedio }[] }[], ots: object[] }}
 */
export function resumenLeadTime(filas, { desde, hasta, divisiones = [] }) {
  const nombreDiv = (v) => buscarDivision(divisiones, v)?.label || (v ? String(v) : "Sin división");
  const tramos = TRAMOS.map((t) => {
    const ots = filas.filter((f) => f[t.clave] != null && enPeriodo(f[t.fin], desde, hasta));
    const porDiv = agrupar(ots.map((f) => ({ ...f, div: nombreDiv(f.division) })), "div");
    return {
      clave: t.clave,
      nombre: t.nombre,
      cantidad: ots.length,
      promedio: promedio(ots.map((f) => f[t.clave])),
      porDivision: [...porDiv].map(([nombre, fs]) => ({ nombre, cantidad: fs.length, promedio: promedio(fs.map((f) => f[t.clave])) }))
        .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es")),
    };
  });
  const ots = filas
    .filter((f) => TRAMOS.some((t) => f[t.clave] != null && enPeriodo(f[t.fin], desde, hasta)))
    .sort((a, b) => ms(maximo(b.finInstalacion, b.finProduccion)) - ms(maximo(a.finInstalacion, a.finProduccion)));
  return { tramos, ots };
}
