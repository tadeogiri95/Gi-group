// app/lib/flota.js — Flota de vehículos y sus papeles (Mantenimiento, parte
// 28; ítem 43; migración 126; diseño en notes/diseno-mantenimiento-vehicular.md).
//
// Cada vehículo tiene sus papeles con vencimiento. Renovar un papel agrega un
// renglón nuevo: el vigente es el último cargado de cada tipo (y, en "otro",
// de cada nombre). El semáforo de un vehículo es el peor de sus papeles
// vigentes y de la licencia de su responsable: 🔴 vencido, 🟡 vence pronto,
// ✅ al día. Solo avisa: no bloquea nada (Tadeo, 22/10).

export const TIPOS_VEHICULO = [
  { id: "auto", nombre: "Auto" },
  { id: "utilitario", nombre: "Utilitario" },
  { id: "camioneta", nombre: "Camioneta" },
  { id: "camion", nombre: "Camión" },
  { id: "acoplado", nombre: "Acoplado" },
  { id: "autoelevador", nombre: "Autoelevador" },
  { id: "otro", nombre: "Otro" },
];

export const COMBUSTIBLES = [
  { id: "nafta", nombre: "Nafta" },
  { id: "gasoil", nombre: "Gasoil" },
  { id: "gnc", nombre: "GNC" },
  { id: "electrico", nombre: "Eléctrico" },
  { id: "otro", nombre: "Otro" },
];

// aviso: cuántos días antes del vencimiento se pone en amarillo (tabla de la parte 30)
export const TIPOS_PAPEL = [
  { id: "seguro", nombre: "Seguro", emoji: "🛡️", aviso: 15 },
  { id: "itv", nombre: "ITV", emoji: "✅", aviso: 30 },
  { id: "cedula", nombre: "Cédula", emoji: "🪪", aviso: 15 },
  { id: "titulo", nombre: "Título", emoji: "📜", aviso: 15 },
  { id: "patente", nombre: "Patente (impuesto)", emoji: "🧾", aviso: 15 },
  { id: "matafuego", nombre: "Matafuego", emoji: "🧯", aviso: 15 },
  { id: "otro", nombre: "Otro papel", emoji: "📄", aviso: 15 },
];
export const AVISO_LICENCIA = 30;

// ITV condicional: 60 días para arreglar lo leve; rechazada: 30 días
export const DIAS_ITV = { condicional: 60, rechazado: 30 };

export const RESULTADOS_ITV = [
  { id: "apto", nombre: "Apto" },
  { id: "condicional", nombre: "Condicional" },
  { id: "rechazado", nombre: "Rechazado" },
];

const NIVELES = ["ok", "sin_fecha", "pronto", "vencido"];

export function tipoPapel(id) {
  return TIPOS_PAPEL.find((t) => t.id === id) || TIPOS_PAPEL[TIPOS_PAPEL.length - 1];
}

export function nombreTipoVehiculo(id) {
  return TIPOS_VEHICULO.find((t) => t.id === id)?.nombre || "Vehículo";
}

/** "ab 123 cd" → "AB123CD": la patente se guarda sin espacios ni guiones, en mayúsculas. */
export function normalizarPatente(s) {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Nombre del papel para mostrar: el de su tipo, o el que se le puso si es "otro". */
export function nombrePapel(p) {
  if (p?.tipo === "otro" && p?.nombre) return p.nombre;
  return tipoPapel(p?.tipo).nombre;
}

function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(desdeISO, hastaISO) {
  return Math.round((Date.parse(`${hastaISO}T12:00:00Z`) - Date.parse(`${desdeISO}T12:00:00Z`)) / 86400000);
}

/**
 * Hasta cuándo vale un papel. La ITV condicional o rechazada vence antes:
 * 60 o 30 días desde la revisión, aunque la oblea diga otra cosa.
 */
export function vencimientoPapel(p) {
  const v = p?.vencimiento || null;
  const plazo = p?.tipo === "itv" ? DIAS_ITV[p?.resultado] : null;
  if (!plazo || !p?.fecha) return v;
  const limite = sumarDias(p.fecha, plazo);
  return v && v < limite ? v : limite;
}

/** { nivel: vencido | pronto | ok | sin_fecha, dias } para una fecha de vencimiento. */
export function estadoVencimiento(vencimiento, avisoDias, hoy) {
  if (!vencimiento) return { nivel: "sin_fecha", dias: null };
  const dias = diasEntre(hoy, vencimiento);
  if (dias < 0) return { nivel: "vencido", dias };
  if (dias <= avisoDias) return { nivel: "pronto", dias };
  return { nivel: "ok", dias };
}

/** "Venció hace 3 días", "Vence hoy", "Vence en 5 días", "Vence el 30/11/2026". */
export function textoVencimiento({ nivel, dias }, vencimiento) {
  if (nivel === "sin_fecha") return "Sin vencimiento";
  if (dias < 0) return `Venció hace ${-dias} día${dias === -1 ? "" : "s"}`;
  if (dias === 0) return "Vence hoy";
  if (nivel === "pronto") return `Vence en ${dias} día${dias === 1 ? "" : "s"}`;
  const [y, m, d] = String(vencimiento).split("-");
  return `Vence el ${d}/${m}/${y}`;
}

function clavePapel(p) {
  return p.tipo === "otro" ? `otro:${String(p.nombre ?? "").trim().toLowerCase()}` : p.tipo;
}

/** El último papel cargado de cada tipo (los anteriores son historial). */
export function papelesVigentes(papeles = []) {
  const ultimos = new Map();
  for (const p of papeles) {
    const k = clavePapel(p);
    const otro = ultimos.get(k);
    if (!otro || String(p.created_at ?? "") > String(otro.created_at ?? "") || (p.created_at === otro.created_at && p.id > otro.id)) ultimos.set(k, p);
  }
  const orden = (p) => TIPOS_PAPEL.findIndex((t) => t.id === p.tipo);
  return [...ultimos.values()].sort((a, b) => orden(a) - orden(b) || nombrePapel(a).localeCompare(nombrePapel(b)));
}

/**
 * Avisos de un vehículo: sus papeles vigentes, los que faltan (seguro e ITV)
 * y la licencia de su responsable. Cada aviso: { clave, texto, nivel, dias }.
 * El título y la cédula no vencen: sin fecha no avisan.
 */
export function avisosVehiculo(vehiculo, papeles = [], responsable = null, hoy) {
  const vigentes = papelesVigentes(papeles.filter((p) => p.vehiculo_id === vehiculo.id));
  const avisos = [];
  for (const p of vigentes) {
    const venc = vencimientoPapel(p);
    const estado = estadoVencimiento(venc, tipoPapel(p.tipo).aviso, hoy);
    if (p.tipo === "itv" && p.resultado === "rechazado" && estado.nivel !== "vencido") estado.nivel = "pronto";
    avisos.push({ clave: `papel-${p.id}`, papel: p, texto: nombrePapel(p), vencimiento: venc, ...estado });
  }
  for (const tipo of ["seguro", "itv"]) {
    if (!vigentes.some((p) => p.tipo === tipo)) avisos.push({ clave: `falta-${tipo}`, texto: tipo === "itv" ? "Falta cargar la ITV" : "Falta cargar el seguro", nivel: "pronto", dias: null, falta: tipo });
  }
  if (responsable) {
    const estado = estadoVencimiento(responsable.licencia_vencimiento, AVISO_LICENCIA, hoy);
    if (estado.nivel !== "sin_fecha") avisos.push({ clave: "licencia", texto: `Licencia de ${responsable.nombre}`, vencimiento: responsable.licencia_vencimiento, ...estado });
  }
  return avisos;
}

/** El peor nivel de una lista de avisos (vencido > pronto > sin_fecha > ok). */
export function peorNivel(avisos = []) {
  let peor = "ok";
  for (const a of avisos) if (NIVELES.indexOf(a.nivel) > NIVELES.indexOf(peor)) peor = a.nivel;
  return peor === "sin_fecha" ? "ok" : peor;
}

export const SEMAFORO = {
  vencido: { emoji: "🔴", texto: "Vencido" },
  pronto: { emoji: "🟡", texto: "Vence pronto" },
  ok: { emoji: "✅", texto: "Al día" },
  sin_fecha: { emoji: "⚪", texto: "Sin vencimiento" },
};

/** Quién puede cargar y editar la flota: gerencia y Administración. */
export function puedeEditarFlota(rol) {
  return rol === "gerencial" || rol === "administrativo";
}
