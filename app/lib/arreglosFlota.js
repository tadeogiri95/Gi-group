// app/lib/arreglosFlota.js — Arreglos, services e historial de la flota
// (Mantenimiento, parte 31; ítem 43; migración 129; diseño en
// notes/diseno-mantenimiento-vehicular.md).
//
// Un punto ❌ Mal del checklist crea un arreglo pendiente; la oficina anota
// otros a mano o desde un ⚠️ Revisar. Un arreglo 🔴 "no puede circular" pone
// el vehículo en rojo en toda la app hasta que se resuelve (solo avisa: no
// bloquea nada; Tadeo, 22/10). Resolverlo carga un mantenimiento (qué se hizo,
// dónde, costo, factura); los services y reparaciones se cargan igual sin
// checklist. Con todo eso se arman el historial y el costo por mes.

export const PRIORIDADES = [
  { id: "no_circula", nombre: "No puede circular", emoji: "🔴" },
  { id: "pronto", nombre: "Arreglar pronto", emoji: "🟡" },
];
export const TIPOS_MANTENIMIENTO = [
  { id: "service", nombre: "Service", emoji: "🛢" },
  { id: "reparacion", nombre: "Reparación", emoji: "🔧" },
  { id: "arreglo", nombre: "Arreglo", emoji: "🔧" },
];
export const DONDE = [
  { id: "taller", nombre: "Taller" },
  { id: "interno", nombre: "Interno" },
];

export const nombrePrioridad = (id) => PRIORIDADES.find((p) => p.id === id) || PRIORIDADES[1];
export const tipoMantenimiento = (id) => TIPOS_MANTENIMIENTO.find((t) => t.id === id) || TIPOS_MANTENIMIENTO[1];

/** Los arreglos que crea un checklist: uno por punto en Mal, con su nota y foto. */
export function arreglosDeChecklist(items = []) {
  return items
    .filter((i) => i.estado === "mal")
    .map((i) => ({
      seccion_nombre: i.seccion_nombre,
      punto_nombre: i.nombre,
      descripcion: `${i.nombre}${i.nota ? `: ${i.nota}` : ""}`.slice(0, 300),
      foto: i.foto || null,
      prioridad: i.no_circula ? "no_circula" : "pronto",
    }));
}

export const pendientes = (arreglos = []) => arreglos.filter((a) => a.estado === "pendiente");
export const noCircula = (arreglos = []) => pendientes(arreglos).filter((a) => a.prioridad === "no_circula");

/** Alertas de los arreglos pendientes de un vehículo (se suman a las de alertasFlota). */
export function alertasArreglos(vehiculoId, arreglos = []) {
  return pendientes(arreglos)
    .filter((a) => a.vehiculo_id === vehiculoId)
    .map((a) => ({
      clave: `arr-${a.id}`, tipo: "arreglo", texto: a.descripcion, arreglo: a,
      detalle: nombrePrioridad(a.prioridad).nombre,
      nivel: a.prioridad === "no_circula" ? "vencido" : "pronto", dias: null,
    }));
}

/** El último service de los mantenimientos: { fecha, km } o null. */
export function ultimoService(mantenimientos = []) {
  const s = mantenimientos.filter((m) => m.tipo === "service")
    .sort((a, b) => (b.fecha > a.fecha ? 1 : b.fecha < a.fecha ? -1 : (b.km ?? 0) - (a.km ?? 0)))[0];
  return s ? { fecha: s.fecha, km: s.km ?? null } : null;
}

function fechaAr(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

const pesos = (n) => Number(n).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const textoCosto = (n) => (n == null || n === "" ? "" : pesos(n));

/**
 * Historial de un vehículo, lo último primero: checklists, arreglos
 * (anotados y cerrados), services y reparaciones, y papeles cargados.
 * Cada evento { fecha (YYYY-MM-DD), orden (ISO para desempatar), emoji, texto, detalle }.
 */
export function historialVehiculo({ checklists = [], arreglos = [], mantenimientos = [], papeles = [], nombrePapel = (p) => p.tipo }) {
  const ev = [];
  for (const c of checklists) {
    const malas = [c.mal ? `❌ ${c.mal} mal` : null, c.revisar ? `⚠️ ${c.revisar} a revisar` : null].filter(Boolean).join(" · ");
    ev.push({ clave: `c${c.id}`, fecha: fechaAr(c.created_at), orden: c.created_at, emoji: "📋", texto: "Checklist", detalle: [malas || "✅ Todo bien", c.empleado_nombre, c.km != null ? `${Number(c.km).toLocaleString("es-AR")} km` : null].filter(Boolean).join(" · "), checklist: c });
  }
  for (const a of arreglos) {
    ev.push({ clave: `a${a.id}`, fecha: fechaAr(a.created_at), orden: a.created_at, emoji: nombrePrioridad(a.prioridad).emoji, texto: `Arreglo anotado: ${a.descripcion}`, detalle: nombrePrioridad(a.prioridad).nombre });
    if (a.estado === "descartado" && a.cerrado_at) {
      ev.push({ clave: `ad${a.id}`, fecha: fechaAr(a.cerrado_at), orden: a.cerrado_at, emoji: "✖", texto: `Arreglo descartado: ${a.descripcion}`, detalle: a.motivo || "" });
    }
  }
  for (const m of mantenimientos) {
    const t = tipoMantenimiento(m.tipo);
    ev.push({
      clave: `m${m.id}`, fecha: m.fecha, orden: m.created_at || `${m.fecha}T12:00:00Z`, emoji: t.emoji, texto: `${t.nombre}: ${m.detalle}`,
      detalle: [m.donde === "taller" ? (m.taller || "Taller") : m.donde === "interno" ? "Interno" : m.taller, m.km != null ? `${Number(m.km).toLocaleString("es-AR")} km` : null, textoCosto(m.costo)].filter(Boolean).join(" · "),
      mantenimiento: m,
    });
  }
  for (const p of papeles) {
    ev.push({ clave: `p${p.id}`, fecha: fechaAr(p.created_at), orden: p.created_at, emoji: "📄", texto: `Papel cargado: ${nombrePapel(p)}`, detalle: p.vencimiento ? `Vence el ${p.vencimiento.split("-").reverse().join("/")}` : "" });
  }
  return ev.sort((a, b) => (b.fecha > a.fecha ? 1 : b.fecha < a.fecha ? -1 : String(b.orden).localeCompare(String(a.orden))));
}

/** Los últimos `n` meses hasta `hoy`, del más viejo al más nuevo: ["2026-05", …, "2026-10"]. */
export function ultimosMeses(hoy, n = 6) {
  const [y, m] = hoy.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/**
 * Costo de mantenimiento y kilómetros por vehículo en esos meses.
 * Kilómetros recorridos = última lectura del período menos la última de antes
 * (o la primera del período, si no hay de antes), con las lecturas de los
 * checklists y los mantenimientos.
 * Devuelve [{ vehiculo, porMes: { "2026-10": costo }, total, km }] y totales por mes.
 */
export function costosFlota({ vehiculos = [], mantenimientos = [], checklists = [], meses }) {
  const desde = meses[0];
  const hasta = meses[meses.length - 1];
  const filas = vehiculos.map((v) => {
    const porMes = Object.fromEntries(meses.map((m) => [m, 0]));
    for (const m of mantenimientos) {
      const mes = m.fecha.slice(0, 7);
      if (m.vehiculo_id === v.id && mes in porMes) porMes[mes] += Number(m.costo) || 0;
    }
    const lecturas = [
      ...checklists.filter((c) => c.vehiculo_id === v.id && c.km != null).map((c) => ({ mes: fechaAr(c.created_at).slice(0, 7), km: c.km })),
      ...mantenimientos.filter((m) => m.vehiculo_id === v.id && m.km != null).map((m) => ({ mes: m.fecha.slice(0, 7), km: m.km })),
    ];
    const dentro = lecturas.filter((l) => l.mes >= desde && l.mes <= hasta).map((l) => l.km);
    const antes = lecturas.filter((l) => l.mes < desde).map((l) => l.km);
    const km = dentro.length ? Math.max(...dentro) - (antes.length ? Math.max(...antes) : Math.min(...dentro)) : null;
    return { vehiculo: v, porMes, total: Object.values(porMes).reduce((a, b) => a + b, 0), km: km != null && km >= 0 ? km : null };
  });
  const totalMes = Object.fromEntries(meses.map((m) => [m, filas.reduce((a, f) => a + f.porMes[m], 0)]));
  return { filas: filas.sort((a, b) => b.total - a.total || a.vehiculo.patente.localeCompare(b.vehiculo.patente)), totalMes, total: Object.values(totalMes).reduce((a, b) => a + b, 0) };
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-10" → "oct" */
export const nombreMes = (ym) => MESES[Number(ym.slice(5, 7)) - 1];
