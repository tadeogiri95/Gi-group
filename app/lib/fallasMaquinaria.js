// app/lib/fallasMaquinaria.js — Fallas, arreglos e indicadores de la
// maquinaria (Mantenimiento, parte 35; ítem 43; migración 134; diseño en
// notes/diseno-menu-y-mantenimiento.md).
//
// Una falla la avisa cualquier operario (desde su Inicio o con el QR de la
// máquina) o sale de un ❌ Mal de una tarea del plan. Si dejó la máquina
// parada, cuenta horas paradas desde que se avisó hasta que se arregla. Con
// las fallas y las tareas hechas salen los indicadores del mes: cumplimiento
// del preventivo, horas paradas, tiempo medio entre fallas (cuánto anda sin
// romperse), tiempo medio de arreglo y costo. Solo avisan: no bloquean nada.

/** Las que siguen abiertas, las que dejaron la máquina parada primero. */
export function fallasPendientes(fallas = [], maquinaId = null) {
  return fallas
    .filter((f) => f.estado === "pendiente" && (maquinaId == null || f.maquina_id === maquinaId))
    .sort((a, b) => Number(!!b.parada) - Number(!!a.parada) || String(a.created_at).localeCompare(String(b.created_at)));
}

/** ¿Queda alguna falla abierta que tenga la máquina parada (sin contar la que se cierra)? */
export function sigueParada(fallas = [], maquinaId, salvoId = null) {
  return fallas.some((f) => f.maquina_id === maquinaId && f.estado === "pendiente" && f.parada && f.id !== salvoId);
}

/** Lo que quedó ❌ Mal en una tarea hecha pasa a fallas pendientes, con su nota y su foto. */
export function fallasDeRegistro(items = []) {
  return items
    .filter((i) => i.estado === "mal")
    .map((i) => ({
      origen: "tarea",
      punto_nombre: String(i.nombre || "").slice(0, 120) || null,
      descripcion: `${i.nombre}${i.nota ? `: ${i.nota}` : ""}`.slice(0, 300),
      foto: i.foto || null,
    }));
}

// ─── QR de la máquina ───────────────────────────────────────────────────────

export const CODIGO_VALIDO = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;

/** Link que va en el QR pegado en la máquina: abre "Avisar una falla" con la máquina elegida. */
export function linkMaquina(origen, slug, codigo) {
  return `${String(origen).replace(/\/$/, "")}/${encodeURIComponent(slug)}?maquina=${encodeURIComponent(String(codigo))}`;
}

/** Código de máquina de un QR escaneado (el link de la etiqueta, o el código solo). Si no, null. */
export function leerQrMaquina(texto) {
  const s = String(texto ?? "").trim();
  if (!s || s.length > 500) return null;
  if (/^https?:\/\//i.test(s)) {
    let url;
    try { url = new URL(s); } catch { return null; }
    const c = String(url.searchParams.get("maquina") || "").toUpperCase();
    return CODIGO_VALIDO.test(c) ? c : null;
  }
  const c = s.toUpperCase();
  return CODIGO_VALIDO.test(c) ? c : null;
}

// ─── Tiempos ────────────────────────────────────────────────────────────────

const HORA = 3600000;

/** Principio y fin de un mes ("2026-10") en hora de Argentina (UTC-3), en ms. */
function limitesMes(ym) {
  const [y, m] = ym.split("-").map(Number);
  return [Date.UTC(y, m - 1, 1, 3), Date.UTC(y, m, 1, 3)];
}

/** Tramos en que la máquina estuvo parada por sus fallas, sin contar dos veces lo que se superpone. */
export function tramosParada(fallas = [], maquinaId, ahora = Date.now()) {
  const tramos = fallas
    .filter((f) => f.maquina_id === maquinaId && f.parada && f.parada_desde)
    .map((f) => [Date.parse(f.parada_desde), f.cerrado_at ? Date.parse(f.cerrado_at) : ahora])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  const unidos = [];
  for (const t of tramos) {
    const ult = unidos[unidos.length - 1];
    if (ult && t[0] <= ult[1]) ult[1] = Math.max(ult[1], t[1]);
    else unidos.push([...t]);
  }
  return unidos;
}

/** Horas que estuvo parada en un mes. */
export function horasParadaMes(fallas, maquinaId, ym, ahora = Date.now()) {
  const [desde, hasta] = limitesMes(ym);
  const fin = Math.min(hasta, ahora);
  let ms = 0;
  for (const [a, b] of tramosParada(fallas, maquinaId, ahora)) ms += Math.max(0, Math.min(b, fin) - Math.max(a, desde));
  return ms / HORA;
}

/** "45 min", "3 h", "2 días y 4 h". */
export function textoHoras(h) {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h <= 0) return "0 h";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `${Math.round(h)} h`;
  const dias = Math.floor(h / 24);
  const resto = Math.round(h - dias * 24);
  return `${dias} día${dias === 1 ? "" : "s"}${resto ? ` y ${resto} h` : ""}`;
}

// ─── Cumplimiento del preventivo ────────────────────────────────────────────

const diaAr = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function finDeMes(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * De lo que tocaba en el mes, cuánto se hizo: { tocaban, hechas, pct }.
 * Las tareas por días cuentan cuántas veces tocaban en el mes (hasta hoy, si
 * es el mes en curso); las que van cada más de un mes, si les tocaba en ese
 * mes. Una tarea hecha de más no compensa otra que no se hizo.
 * Lo bueno es más de 80 %.
 */
export function cumplimientoPreventivo(tareas = [], registros = [], ym, hoy) {
  const inicio = `${ym}-01`;
  const fin = finDeMes(ym) < hoy ? finDeMes(ym) : hoy;
  let tocaban = 0;
  let hechas = 0;
  if (inicio > hoy) return { tocaban, hechas, pct: null };
  for (const t of tareas) {
    if (t.activa === false || !t.cada_dias) continue;
    const alta = t.created_at ? diaAr(t.created_at) : inicio;
    if (alta > fin) continue;
    const desde = alta > inicio ? alta : inicio;
    const dias = diasEntre(desde, fin) + 1;
    const propios = registros.filter((r) => r.tarea_id === t.id);
    let esperadas;
    if (t.cada_dias <= dias) {
      esperadas = Math.floor(dias / t.cada_dias);
    } else {
      const antes = propios.filter((r) => r.fecha < desde).map((r) => r.fecha).sort();
      const vence = sumarDias(antes.length ? antes[antes.length - 1] : alta, t.cada_dias);
      esperadas = vence >= desde && vence <= fin ? 1 : 0;
    }
    if (!esperadas) continue;
    tocaban += esperadas;
    hechas += Math.min(esperadas, propios.filter((r) => r.fecha >= inicio && r.fecha <= fin).length);
  }
  return { tocaban, hechas, pct: tocaban ? Math.round((hechas / tocaban) * 100) : null };
}

// ─── Indicadores ────────────────────────────────────────────────────────────

/**
 * Indicadores por máquina en los meses elegidos (del más viejo al de hoy):
 * por fila { maquina, cumplimiento, horasParada, fallas, entreFallasDias,
 * arregloHoras, costoPorMes, costo }, y los totales de la empresa.
 * - Tiempo medio entre fallas = horas que anduvo (las del período menos las
 *   paradas) / fallas del período, en días.
 * - Tiempo medio de arreglo = de que se avisó a que se arregló, en horas.
 */
export function indicadoresMaquinaria({ maquinas = [], tareas = [], registros = [], fallas = [], meses, hoy, ahora = Date.now() }) {
  const [desde] = limitesMes(meses[0]);
  const hasta = Math.min(limitesMes(meses[meses.length - 1])[1], ahora);
  const horasPeriodo = Math.max(0, (hasta - desde) / HORA);
  const enPeriodo = (iso) => { const t = Date.parse(iso); return t >= desde && t < hasta; };
  const mesDe = (iso) => diaAr(iso).slice(0, 7);
  const filas = maquinas.filter((m) => m.activo !== false).map((m) => {
    const propias = fallas.filter((f) => f.maquina_id === m.id && f.estado !== "descartada");
    const susTareas = tareas.filter((t) => t.maquina_id === m.id);
    const susRegistros = registros.filter((r) => r.maquina_id === m.id);
    let tocaban = 0;
    let hechas = 0;
    for (const ym of meses) {
      const c = cumplimientoPreventivo(susTareas, susRegistros, ym, hoy);
      tocaban += c.tocaban;
      hechas += c.hechas;
    }
    const horasParada = meses.reduce((a, ym) => a + horasParadaMes(fallas, m.id, ym, ahora), 0);
    const delPeriodo = propias.filter((f) => enPeriodo(f.created_at));
    const arregladas = propias.filter((f) => f.estado === "resuelta" && f.cerrado_at && enPeriodo(f.cerrado_at));
    const arregloHoras = arregladas.length
      ? arregladas.reduce((a, f) => a + Math.max(0, Date.parse(f.cerrado_at) - Date.parse(f.created_at)) / HORA, 0) / arregladas.length
      : null;
    const costoPorMes = Object.fromEntries(meses.map((ym) => [ym, 0]));
    for (const f of arregladas) {
      const ym = mesDe(f.cerrado_at);
      if (ym in costoPorMes) costoPorMes[ym] += Number(f.costo) || 0;
    }
    return {
      maquina: m,
      cumplimiento: { tocaban, hechas, pct: tocaban ? Math.round((hechas / tocaban) * 100) : null },
      horasParada,
      fallas: delPeriodo.length,
      entreFallasDias: delPeriodo.length ? Math.max(0, horasPeriodo - horasParada) / delPeriodo.length / 24 : null,
      arregloHoras,
      arreglos: arregladas.length,
      costoPorMes,
      costo: Object.values(costoPorMes).reduce((a, b) => a + b, 0),
    };
  });
  const tocaban = filas.reduce((a, f) => a + f.cumplimiento.tocaban, 0);
  const hechas = filas.reduce((a, f) => a + f.cumplimiento.hechas, 0);
  const costoMes = Object.fromEntries(meses.map((ym) => [ym, filas.reduce((a, f) => a + f.costoPorMes[ym], 0)]));
  const arreglos = filas.reduce((a, f) => a + f.arreglos, 0);
  return {
    filas: filas.sort((a, b) => b.horasParada - a.horasParada || b.fallas - a.fallas || a.maquina.codigo.localeCompare(b.maquina.codigo)),
    total: {
      cumplimiento: { tocaban, hechas, pct: tocaban ? Math.round((hechas / tocaban) * 100) : null },
      horasParada: filas.reduce((a, f) => a + f.horasParada, 0),
      fallas: filas.reduce((a, f) => a + f.fallas, 0),
      arregloHoras: arreglos ? filas.reduce((a, f) => a + (f.arregloHoras ?? 0) * f.arreglos, 0) / arreglos : null,
      costoMes,
      costo: Object.values(costoMes).reduce((a, b) => a + b, 0),
    },
  };
}

/** Color del cumplimiento: ✅ más de 80 %, 🟡 de 50 a 80, 🔴 menos. */
export function nivelCumplimiento(pct) {
  if (pct == null) return "ok";
  return pct >= 80 ? "ok" : pct >= 50 ? "pronto" : "vencido";
}
