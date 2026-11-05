// app/lib/ajustesTiempo.js — Cambios de tiempo de los procesos de una OT
// (Tadeo, 29/10; migración 145).
//
// Dos clases de registro en ajustes_tiempo_ot, siempre con un motivo:
//   faltan       "⏱ Faltan X h": gerencia, supervisores o administración dicen
//                cuánto le falta a un proceso. Manda sobre el cálculo del plan
//                vivo hasta que el proceso termine; si después se escanean
//                piezas, baja en la misma proporción.
//   corrimiento  el plan vivo corrió un proceso solo (no se hizo lo
//                planificado) y se anota por qué. Hasta que se anota, el
//                proceso sale en "Atrasos sin motivo".
// Cada registro guarda cuántos días estaba corrido el proceso del plan
// confirmado (dias): si después se corre más, vuelve a pedir el motivo.
// Queda en la OT para analizar después (Detalle OT → ⏱ Cambios de tiempo).
//
// 05/11 (Tadeo, migración 162): también "⏱ Necesita más tiempo" en Diseño
// (días hábiles), Técnica (horas) e Instalación (días de obra), cada uno con
// sus motivos. En esos solo hay 'faltan'. El valor va en `horas` aunque sea
// en días (unidadDe dice cuál).

export const MOTIVOS_TIEMPO = [
  { id: "falta_material", label: "Falta de material" },
  { id: "falla_maquina", label: "Falla de máquina" },
  { id: "corte_electricidad", label: "Corte de electricidad" },
  { id: "planificacion_subestimada", label: "Tiempo de planificación subestimado" },
  { id: "interrupcion", label: "Interrupción del trabajo" },
  { id: "otros", label: "Otros" },
];
const M = (id, label) => ({ id, label });
const SUBESTIMADO = M("planificacion_subestimada", "Tiempo de planificación subestimado");
const OTROS = M("otros", "Otros");
/** Motivos de Diseño y Técnica (162). */
export const MOTIVOS_DISENO = [
  M("cambios_cliente", "Cambios del cliente"), M("espera_cliente", "Espera de aprobación o respuesta del cliente"),
  M("falta_informacion", "Falta información o medidas"), SUBESTIMADO, M("interrupcion", "Interrupción del trabajo"), OTROS,
];
/** Motivos de Instalación (162). */
export const MOTIVOS_INSTALACION = [
  M("obra_no_lista", "La obra no estaba lista"), M("falta_material", "Falta de material"), M("cambios_cliente", "Cambios del cliente"),
  M("clima", "Clima"), SUBESTIMADO, M("interrupcion", "Interrupción del trabajo"), OTROS,
];
const PRODUCCION = new Set(["corte", "canteado", "mecanizado", "armado"]);
const ETAPAS = new Set([...PRODUCCION, "diseno", "tecnica", "instalacion"]);
/** Los motivos que se pueden elegir en un proceso o área. */
export const motivosDe = (etapa) => (etapa === "diseno" || etapa === "tecnica" ? MOTIVOS_DISENO : etapa === "instalacion" ? MOTIVOS_INSTALACION : MOTIVOS_TIEMPO);
/** "h" (horas) o "dias" (días hábiles): Diseño e Instalación van en días. */
export const unidadDe = (etapa) => (etapa === "diseno" || etapa === "instalacion" ? "dias" : "h");
/** Nombre del proceso o área. */
export const NOMBRE_ETAPA = { corte: "Corte", canteado: "Canteado", mecanizado: "Mecanizado", armado: "Armado", diseno: "Diseño", tecnica: "Técnica", instalacion: "Instalación" };
/** "12 h", "medio día", "3 días". */
export function textoValor(n, etapa) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  if (unidadDe(etapa) === "h") return `${String(v).replace(".", ",")} h`;
  if (v === 0.5) return "medio día";
  return `${String(v).replace(".", ",")} ${v === 1 ? "día" : "días"}`;
}
export const AVISO_MIGRACION_162 = "Para anotar más tiempo en Diseño, Técnica o Instalación falta correr la migración 162 en Supabase.";
export const AVISO_MIGRACION_145 = "Para guardar el motivo falta correr la migración 145 en Supabase.";

/** "Falta de material", o "Otros: …" con lo que se escribió. */
export function textoMotivo(a) {
  const m = [...MOTIVOS_TIEMPO, ...MOTIVOS_DISENO, ...MOTIVOS_INSTALACION].find((x) => x.id === a?.motivo);
  if (!m) return "—";
  return m.id === "otros" && a.detalle ? `Otros: ${a.detalle}` : m.label;
}

const clave = (ot, etapa) => `${ot}|${etapa}`;

/**
 * Revisa un registro antes de guardarlo (en la pantalla y en /api/data).
 * @returns {string|null} el error, o null si está bien
 */
export function validarAjuste(a) {
  if (!a || typeof a !== "object") return "Faltan los datos";
  if (typeof a.ot !== "string" || !a.ot.trim() || a.ot.length > 40) return "Falta la OT";
  if (!ETAPAS.has(a.etapa)) return "Proceso inválido";
  if (a.tipo !== "faltan" && a.tipo !== "corrimiento") return "Tipo inválido";
  if (!PRODUCCION.has(a.etapa) && a.tipo !== "faltan") return "Tipo inválido";
  if (!motivosDe(a.etapa).some((m) => m.id === a.motivo)) return "Elegí el motivo";
  const detalle = typeof a.detalle === "string" ? a.detalle.trim() : "";
  if (a.motivo === "otros" && !detalle) return "Escribí cuál es el motivo";
  if (detalle.length > 300) return "El motivo es muy largo (hasta 300 letras)";
  if (a.tipo === "faltan") {
    const h = a.horas;
    if (typeof h !== "number" || !Number.isFinite(h) || h < 0 || h > 9999) return unidadDe(a.etapa) === "h" ? "Escribí cuántas horas faltan" : "Escribí cuántos días faltan";
    if (!PRODUCCION.has(a.etapa) && h < 0.5) return unidadDe(a.etapa) === "h" ? "Tiene que ser media hora o más" : "Tiene que ser medio día o más";
  }
  if (a.pendiente != null && (typeof a.pendiente !== "number" || a.pendiente < 0 || a.pendiente > 1)) return "Avance inválido";
  if (a.dias != null && (!Number.isInteger(a.dias) || a.dias < 0 || a.dias > 3650)) return "Días inválidos";
  return null;
}

/**
 * El último "Faltan X h" de cada proceso, para el plan vivo:
 * Map "OT|etapa" → { horas, pendiente } (pendiente = lo que faltaba, de 0 a 1,
 * cuando se cargó; null si no se sabía).
 */
export function faltanManual(ajustes = []) {
  const m = new Map();
  const ordenados = [...(ajustes || [])].filter((a) => a.tipo === "faltan" && a.horas != null)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  for (const a of ordenados) m.set(clave(String(a.ot), a.etapa), { horas: Number(a.horas), pendiente: a.pendiente == null ? null : Number(a.pendiente) });
  return m;
}

/**
 * Horas que manda el "Faltan X h" ahora: lo cargado, achicado en la misma
 * proporción en que bajó lo que falta por escaneo o checkeo desde entonces.
 */
export function horasManuales(m, pendienteAhora) {
  if (!m) return null;
  if (m.pendiente > 0 && pendienteAhora >= 0 && pendienteAhora < m.pendiente) return m.horas * (pendienteAhora / m.pendiente);
  return m.horas;
}

/**
 * Procesos que el plan vivo corrió y nadie anotó por qué: los corridos del
 * plan confirmado sin un registro desde la confirmación que cubra esos días.
 * @param {Map} vivo resultado de planVivo
 * @param {object[]} ajustes filas de ajustes_tiempo_ot
 * @param {string|null} desde cuándo se confirmó el plan (ISO); lo anterior no cuenta
 * @returns {{ ot: string, etapa: string, nombre: string, dias: number, fila: object }[]}
 */
export function atrasosSinMotivo(vivo, ajustes = [], desde = null) {
  const cubre = new Map();
  for (const a of ajustes || []) {
    if (desde && String(a.created_at || "") < desde) continue;
    const k = clave(String(a.ot), a.etapa);
    cubre.set(k, Math.max(cubre.get(k) ?? -1, Number(a.dias) || 0));
  }
  const out = [];
  for (const fila of vivo?.values?.() || []) {
    for (const q of fila.procesos || []) {
      if (!(q.diasCorrido > 0)) continue;
      if ((cubre.get(clave(fila.ot, q.etapa)) ?? -1) >= q.diasCorrido) continue;
      out.push({ ot: fila.ot, etapa: q.etapa, nombre: q.nombre, dias: q.diasCorrido, fila });
    }
  }
  return out.sort((a, b) => b.dias - a.dias || a.ot.localeCompare(b.ot, "es", { numeric: true }));
}

/** Registros de una OT, el más nuevo primero. */
export function ajustesDeOt(ajustes = [], ot) {
  return (ajustes || []).filter((a) => String(a.ot) === String(ot))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}
