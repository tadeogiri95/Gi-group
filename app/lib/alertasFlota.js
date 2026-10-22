// app/lib/alertasFlota.js — Alertas de mantenimiento de la flota
// (Mantenimiento, parte 30; ítem 43; migración 128; diseño en
// notes/diseno-mantenimiento-vehicular.md).
//
// Cada aspecto se revisa cada tantos días o tantos kilómetros, lo que pase
// primero. La última revisión de un aspecto es el último checklist que revisó
// su sección (el service, el último service cargado). Junto con los papeles y
// la licencia (app/lib/flota.js) arman el semáforo de cada vehículo, la
// pestaña Alertas, la tarjeta del Panel de control y el aviso diario. Solo
// avisan: no bloquean nada (Tadeo, 22/10).
import { avisosVehiculo, estadoVencimiento } from "./flota";
import { alertasArreglos } from "./arreglosFlota";

// Por aspecto: cada cuánto (dias, km) y con cuánta anticipación se avisa
// (aviso en días, avisoKm en km). Tabla de la parte 30, aprobada el 22/10.
export const FRECUENCIAS = [
  { id: "limpieza", nombre: "Limpieza", dias: 7, km: null, aviso: 0, avisoKm: null },
  { id: "fluidos", nombre: "Fluidos", dias: 15, km: 2000, aviso: 2, avisoKm: 200 },
  { id: "neumaticos", nombre: "Neumáticos", dias: 30, km: 5000, aviso: 5, avisoKm: 500 },
  { id: "luces", nombre: "Luces", dias: 30, km: null, aviso: 5, avisoKm: null },
  { id: "itv", nombre: "ITV (requisitos)", dias: 30, km: null, aviso: 5, avisoKm: null },
  { id: "documentacion", nombre: "Documentación", dias: 30, km: null, aviso: 5, avisoKm: null },
  { id: "service", nombre: "Service", dias: 365, km: 10000, aviso: 15, avisoKm: 1000 },
];

/** Las frecuencias de un vehículo: las de fábrica con lo que la empresa cambió para él. */
export function frecuenciasDe(vehiculo) {
  const propias = vehiculo?.frecuencias && typeof vehiculo.frecuencias === "object" ? vehiculo.frecuencias : {};
  return FRECUENCIAS.map((f) => {
    const p = propias[f.id] || {};
    const dias = p.dias === undefined ? f.dias : p.dias;
    const km = p.km === undefined ? f.km : p.km;
    return { ...f, dias, km };
  });
}

function fechaAr(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** La última revisión de cada sección según los checklists del vehículo: { seccion: { fecha, km } }. */
export function ultimasRevisiones(checklists = []) {
  const ult = {};
  for (const c of checklists) {
    const fecha = fechaAr(c.created_at);
    for (const s of Array.isArray(c.secciones) ? c.secciones : []) {
      if (!ult[s] || fecha > ult[s].fecha || (fecha === ult[s].fecha && (c.km ?? 0) > (ult[s].km ?? 0))) ult[s] = { fecha, km: c.km ?? null };
    }
  }
  return ult;
}

/**
 * Cómo está un aspecto: { nivel, dias, km, texto }.
 * dias = días que faltan (negativo: atrasado); km = km que faltan.
 */
export function estadoRevision(f, ultima, kmActual, hoy) {
  if (!f.dias && !f.km) return null;
  if (!ultima?.fecha) return { nivel: "pronto", dias: null, km: null, texto: f.id === "service" ? "Falta cargar el último service" : "Nunca se revisó" };
  const porDias = f.dias ? estadoVencimiento(sumarDias(ultima.fecha, f.dias), f.aviso, hoy) : null;
  let porKm = null;
  if (f.km && ultima.km != null && kmActual != null) {
    const faltan = ultima.km + f.km - kmActual;
    porKm = { nivel: faltan < 0 ? "vencido" : faltan <= (f.avisoKm ?? 0) ? "pronto" : "ok", km: faltan };
  }
  const orden = { vencido: 0, pronto: 1, ok: 2 };
  const peor = [porDias, porKm].filter(Boolean).sort((a, b) => orden[a.nivel] - orden[b.nivel])[0];
  const nivel = peor?.nivel || "ok";
  const usarKm = porKm && (!porDias || (peor === porKm && nivel !== "ok"));
  let texto;
  if (usarKm) texto = porKm.km < 0 ? `Se pasó por ${(-porKm.km).toLocaleString("es-AR")} km` : `Faltan ${porKm.km.toLocaleString("es-AR")} km`;
  else if (!porDias) texto = "Falta cargar los kilómetros";
  else if (porDias.dias < 0) texto = `Atrasado ${-porDias.dias} día${porDias.dias === -1 ? "" : "s"}`;
  else if (porDias.dias === 0) texto = "Toca hoy";
  else texto = `Toca en ${porDias.dias} día${porDias.dias === 1 ? "" : "s"}`;
  return { nivel, dias: porDias?.dias ?? null, km: porKm?.km ?? null, texto };
}

/**
 * Todas las alertas de un vehículo: arreglos pendientes (parte 31), papeles,
 * licencia, revisiones por sección y service. Cada una { clave, texto,
 * detalle, nivel, dias }.
 */
export function alertasVehiculo(vehiculo, { papeles = [], checklists = [], arreglos = [], responsable = null, hoy }) {
  const alertas = [
    ...alertasArreglos(vehiculo.id, arreglos),
    ...avisosVehiculo(vehiculo, papeles, responsable, hoy).map((a) => ({ ...a, tipo: "papel" })),
  ];
  const propios = checklists.filter((c) => c.vehiculo_id === vehiculo.id);
  const ult = ultimasRevisiones(propios);
  if (!propios.length) {
    alertas.push({ clave: "sin-checklist", tipo: "revision", texto: "Falta el primer checklist", nivel: "pronto", dias: null });
  }
  for (const f of frecuenciasDe(vehiculo)) {
    if (f.id !== "service" && !propios.length) continue;
    const ultima = f.id === "service" ? (vehiculo.service_fecha ? { fecha: vehiculo.service_fecha, km: vehiculo.service_km ?? null } : null) : ult[f.id];
    const e = estadoRevision(f, ultima, vehiculo.km ?? null, hoy);
    if (!e) continue;
    alertas.push({ clave: `rev-${f.id}`, tipo: "revision", aspecto: f.id, texto: f.nombre, detalle: e.texto, nivel: e.nivel, dias: e.dias, km: e.km, ultima });
  }
  return alertas;
}

/** Las que piden atención (vencido o pronto), lo más urgente primero. */
export function urgentes(alertas = []) {
  const orden = { vencido: 0, pronto: 1 };
  return alertas
    .filter((a) => a.nivel === "vencido" || a.nivel === "pronto")
    .sort((a, b) => orden[a.nivel] - orden[b.nivel] || (a.dias ?? 9999) - (b.dias ?? 9999));
}

/** Texto de una alerta en una línea: "Seguro: venció hace 3 días", "Fluidos: atrasado 2 días". */
export function textoAlerta(a, textoVencimientoFn) {
  if (a.falta || a.clave === "sin-checklist") return a.texto;
  if (a.tipo === "arreglo") return `🔧 ${a.texto}${a.nivel === "vencido" ? " (no puede circular)" : ""}`;
  if (a.tipo === "revision") return `${a.texto}: ${String(a.detalle).toLowerCase()}`;
  return `${a.texto}: ${textoVencimientoFn(a, a.vencimiento).toLowerCase()}`;
}

/** Firma de lo que hay para avisar: si no cambió desde el último aviso, no se repite. */
export function firmaAvisos(alertas = []) {
  return urgentes(alertas).map((a) => `${a.clave}:${a.nivel}`).sort().join("|");
}

/**
 * Qué hay que avisar hoy de un vehículo (aviso diario, /api/cron/flota-alertas).
 * nuevas = las urgentes que no estaban en el último aviso (o cambiaron de
 * 🟡 a 🔴); cambio = hay que guardar la firma nueva aunque no se avise nada
 * (por ejemplo, porque algo se puso al día).
 */
export function avisoDelDia(vehiculo, alertas) {
  const firma = firmaAvisos(alertas);
  const antes = new Set(String(vehiculo.aviso_firma || "").split("|").filter(Boolean));
  const nuevas = urgentes(alertas).filter((a) => !antes.has(`${a.clave}:${a.nivel}`));
  return { firma, nuevas, cambio: firma !== (vehiculo.aviso_firma || "") };
}

/** Texto del aviso al celular: "Seguro: venció hace 3 días · Fluidos: atrasado 2 días · y 1 más". */
export function textoAvisos(alertas, textoVencimientoFn, max = 3) {
  const partes = alertas.slice(0, max).map((a) => textoAlerta(a, textoVencimientoFn));
  if (alertas.length > max) partes.push(`y ${alertas.length - max} más`);
  return partes.join(" · ");
}
