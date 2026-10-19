// app/lib/asistenciaDia.js — Asistencia de un día en el Panel de control
// (pedido de Tadeo 19/10): solo operarios con horario ese día (los dueños y
// administrativos no tienen jornada fija), por división y en total, y la
// llegada de cada uno.
import { buscarDivision } from "./rutas";

const DIAS_KEY = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

/** "2026-10-19" → "lun" (día de la semana de esa fecha). */
export function diaKeyDeFecha(fecha) {
  return DIAS_KEY[new Date(`${fecha}T12:00:00`).getDay()];
}

/** Hora de entrada del turno de ese día ("08:00"), o null si no trabaja. */
export function entradaDelDia(empleado, diaKey) {
  const turno = empleado?.diagrama?.[diaKey];
  if (!turno) return null;
  return turno.in ? String(turno.in).slice(0, 5) : "";
}

/** Operarios activos (los que se espera que cumplan un horario). */
export function esOperario(e) {
  return e?.rol === "operativo" && e?.activo !== false;
}

function nombreDivision(divisiones, valor) {
  return buscarDivision(divisiones, valor)?.label || (valor ? String(valor) : "Sin división");
}

/**
 * Llegada de cada operario ese día.
 * Estado: "a_tiempo" | "tarde" | "falta" | "por_entrar" (hoy, su hora todavía
 * no llegó) | "fuera_horario" (vino sin turno ese día).
 * @param {{ empleados: object[], fichadas: object[], diaKey: string, divisiones?: object[], horaActual?: string|null }} p
 *   horaActual: "HH:MM" solo si el día es hoy; en días pasados nadie queda "por entrar"
 */
export function llegadasDelDia({ empleados = [], fichadas = [], diaKey, divisiones = [], horaActual = null }) {
  const porLegajo = new Map();
  for (const f of fichadas) if (!porLegajo.has(f.legajo)) porLegajo.set(f.legajo, f);
  const filas = [];
  for (const e of empleados.filter(esOperario)) {
    const entra = entradaDelDia(e, diaKey);
    const f = porLegajo.get(e.legajo) || null;
    if (entra == null && !f) continue; // sin turno y no vino: franco
    let estado;
    if (f) estado = entra == null ? "fuera_horario" : f.llegada_tarde ? "tarde" : "a_tiempo";
    else estado = horaActual && entra && entra > horaActual ? "por_entrar" : "falta";
    filas.push({
      id: e.id ?? e.legajo,
      legajo: e.legajo,
      nombre: e.nombre,
      division: nombreDivision(divisiones, e.division),
      entra,
      ingreso: f?.ingreso ? String(f.ingreso).slice(0, 5) : null,
      egreso: f?.egreso ? String(f.egreso).slice(0, 5) : null,
      minutosTarde: f?.llegada_tarde ? Number(f.minutos_tarde) || 0 : 0,
      estado,
    });
  }
  const ORDEN = { falta: 0, tarde: 1, a_tiempo: 2, por_entrar: 3, fuera_horario: 4 };
  return filas.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]
    || (a.ingreso || a.entra || "").localeCompare(b.ingreso || b.entra || "")
    || String(a.nombre).localeCompare(String(b.nombre), "es"));
}

/**
 * Esperados, vinieron y tarde por división y en total, a partir de las
 * llegadas. Esperados = operarios con turno ese día cuya hora ya llegó;
 * tarde se cuenta sobre los que vinieron.
 * @returns {{ divisiones: { nombre, esperados, vinieron, tarde }[], total: { esperados, vinieron, tarde } }}
 */
export function asistenciaPorDivision(llegadas) {
  const mapa = new Map();
  const total = { esperados: 0, vinieron: 0, tarde: 0 };
  for (const l of llegadas) {
    if (l.estado === "por_entrar" || l.estado === "fuera_horario") continue;
    if (!mapa.has(l.division)) mapa.set(l.division, { nombre: l.division, esperados: 0, vinieron: 0, tarde: 0 });
    const d = mapa.get(l.division);
    for (const t of [d, total]) {
      t.esperados++;
      if (l.estado !== "falta") t.vinieron++;
      if (l.estado === "tarde") t.tarde++;
    }
  }
  return {
    divisiones: [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    total,
  };
}

/** Porcentaje redondeado, o null si no hay base. */
export function pct(parte, base) {
  return base > 0 ? Math.round((parte / base) * 100) : null;
}
