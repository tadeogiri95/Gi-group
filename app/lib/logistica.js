// app/lib/logistica.js — Reglas del módulo de Logística (pedido de Tadeo, 23/11).
//
// Parte 1 (203): la libreta de Lugares (planta, depósitos, proveedores,
// clientes y otros, cada uno con su dirección y su pin) y la dirección de la
// obra de cada OT. Las obras no se cargan como lugar: salen de las OT activas,
// agrupadas por el nombre de la obra, y la dirección se guarda en cada OT.
// Las partes siguientes (viajes, Mis viajes, remito) usan estos puntos.
import { coordsValidas } from "./ubicacion";
import { haversine } from "./calc";

export const TIPOS_LUGAR = [
  { id: "planta",    label: "Planta",    emoji: "🏭" },
  { id: "deposito",  label: "Depósito",  emoji: "🏬" },
  { id: "proveedor", label: "Proveedor", emoji: "🛒" },
  { id: "cliente",   label: "Cliente",   emoji: "🏠" },
  { id: "otro",      label: "Otro",      emoji: "📍" },
];
export const tipoLugar = (id) => TIPOS_LUGAR.find((t) => t.id === id) || TIPOS_LUGAR[TIPOS_LUGAR.length - 1];

/** Lugares y direcciones los cargan el Dueño, los supervisores y la oficina. */
export const puedeGestionarLogistica = (rol) => rol === "gerencial" || rol === "administrativo";

export const AVISO_MIGRACION_LOGISTICA = "Para usar Logística falta correr la migración 203 en Supabase.";
export const AVISO_MIGRACION_VIAJES = "Para armar viajes falta correr la migración 204 en Supabase.";

const limpio = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

/** Clave de la obra de una OT: el nombre de la obra; sin obra, el cliente; sin nada, la OT. */
export function claveObra(p) {
  const obra = limpio(p?.obra), cliente = limpio(p?.cliente);
  if (obra) return `obra:${obra.toLowerCase()}`;
  if (cliente) return `cliente:${cliente.toLowerCase()}`;
  return `ot:${limpio(p?.ot)}`;
}

/**
 * Obras de las OT activas, con su dirección. Una obra con varias OT se
 * muestra una vez; si las OT tienen direcciones distintas, manda la primera
 * con pin y `distintas` avisa.
 * @returns {{ clave, nombre, cliente, ots: string[], ids: number[], direccion, lat, lng, conPin: boolean, sinDireccion: number, distintas: boolean }[]}
 *   sin dirección primero, después por nombre
 */
export function obrasDeOts(proyectos = []) {
  const grupos = new Map();
  for (const p of proyectos) {
    if (!p || p.estado === "cerrado") continue;
    const k = claveObra(p);
    if (!grupos.has(k)) grupos.set(k, { clave: k, nombre: limpio(p.obra) || limpio(p.cliente) || `OT ${limpio(p.ot)}`, cliente: limpio(p.cliente), filas: [] });
    grupos.get(k).filas.push(p);
  }
  const obras = [...grupos.values()].map((g) => {
    const conPin = g.filas.find((p) => coordsValidas(p.lat, p.lng));
    const conTexto = g.filas.find((p) => limpio(p.direccion));
    const ref = conPin || conTexto || null;
    const firmas = new Set(g.filas.map((p) => (coordsValidas(p.lat, p.lng) ? `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}` : limpio(p.direccion).toLowerCase())).filter(Boolean));
    return {
      clave: g.clave,
      nombre: g.nombre,
      cliente: g.cliente && g.cliente.toLowerCase() !== g.nombre.toLowerCase() ? g.cliente : "",
      ots: g.filas.map((p) => String(p.ot)).sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
      ids: g.filas.map((p) => p.id),
      direccion: ref ? limpio(ref.direccion) || null : null,
      lat: conPin ? Number(conPin.lat) : null,
      lng: conPin ? Number(conPin.lng) : null,
      conPin: !!conPin,
      sinDireccion: g.filas.filter((p) => !coordsValidas(p.lat, p.lng) && !limpio(p.direccion)).length,
      distintas: firmas.size > 1,
    };
  });
  return obras.sort((a, b) => Number(a.sinDireccion === 0) - Number(b.sinDireccion === 0) || a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
}

/** Texto corto de dónde queda: la dirección, o "Solo pin en el mapa", o "Sin dirección". */
export function textoUbicacion({ direccion, lat, lng } = {}) {
  const d = limpio(direccion);
  if (d) return d;
  return coordsValidas(lat, lng) ? "Solo pin en el mapa" : "Sin dirección";
}

// ─── Parte 2 (204): viajes y paradas ────────────────────────────────────────

export const TIPOS_VIAJE = [
  { id: "distribucion",   label: "Entrega",         emoji: "🚚", ayuda: "Llevar muebles o materiales a obras y clientes" },
  { id: "abastecimiento", label: "Abastecimiento",  emoji: "🛒", ayuda: "Retirar material de proveedores" },
  { id: "interno",        label: "Interno",         emoji: "🔁", ayuda: "Entre la planta, depósitos y otros lugares propios" },
  { id: "devolucion",     label: "Devolución",      emoji: "↩️", ayuda: "Traer de vuelta sobrantes, rechazos o material a devolver" },
];
export const tipoViaje = (id) => TIPOS_VIAJE.find((t) => t.id === id) || TIPOS_VIAJE[0];

export const ESTADOS_VIAJE = {
  planificado: { label: "Planificado", emoji: "🗓️" },
  en_camino:   { label: "En camino",   emoji: "🚚" },
  terminado:   { label: "Terminado",   emoji: "✅" },
  cancelado:   { label: "Cancelado",   emoji: "✖️" },
};

export const ACCIONES_PARADA = [
  { id: "entregar",         label: "Entregar" },
  { id: "retirar",          label: "Retirar" },
  { id: "entregar_retirar", label: "Entregar y retirar" },
];
export const accionParada = (id) => ACCIONES_PARADA.find((a) => a.id === id) || ACCIONES_PARADA[0];
/** La acción que va por defecto según el tipo de viaje. */
export const accionPorTipo = (tipo) => (tipo === "abastecimiento" || tipo === "devolucion" ? "retirar" : "entregar");

/** Con 2 a 4 viajes por día y 10 paradas en total, 15 por viaje sobra. */
export const MAX_PARADAS = 15;

const conPin = (p) => coordsValidas(p?.lat, p?.lng);

/**
 * Ordena las paradas por cercanía: desde la salida, siempre a la más cerca
 * que falta (vecino más cercano, en línea recta). Las que no tienen pin van
 * al final en el orden que tenían. Sin salida con pin arranca por la primera
 * que tenga pin.
 * @returns {{ paradas: object[], sinPin: number }}
 */
export function ordenarPorCercania(origen, paradas = []) {
  const conP = paradas.filter(conPin);
  const sinP = paradas.filter((p) => !conPin(p));
  const orden = [];
  let actual = conPin(origen) ? origen : null;
  const faltan = [...conP];
  while (faltan.length) {
    let mejor = 0;
    if (actual) {
      let dist = Infinity;
      faltan.forEach((p, i) => {
        const d = haversine(Number(actual.lat), Number(actual.lng), Number(p.lat), Number(p.lng));
        if (d < dist) { dist = d; mejor = i; }
      });
    }
    actual = faltan.splice(mejor, 1)[0];
    orden.push(actual);
  }
  return { paradas: [...orden, ...sinP], sinPin: sinP.length };
}

/** Mueve una parada un lugar para arriba (-1) o para abajo (+1). */
export function moverParada(paradas, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= paradas.length) return paradas;
  const nuevas = [...paradas];
  [nuevas[i], nuevas[j]] = [nuevas[j], nuevas[i]];
  return nuevas;
}

/** Kilómetros en línea recta del recorrido (solo entre puntos con pin). Es una referencia, no la distancia por calle. */
export function kmEnLineaRecta(origen, paradas = [], vuelve = false) {
  const puntos = [origen, ...paradas, ...(vuelve ? [origen] : [])].filter(conPin);
  let m = 0;
  for (let i = 1; i < puntos.length; i++) m += haversine(Number(puntos[i - 1].lat), Number(puntos[i - 1].lng), Number(puntos[i].lat), Number(puntos[i].lng));
  return Math.round(m / 100) / 10;
}

// Google Maps acepta hasta 9 paradas intermedias en un link: con más, el
// recorrido se parte en tramos (cada uno arranca donde terminó el anterior).
export const MAX_INTERMEDIAS = 9;

const puntoMaps = (p) => (conPin(p) ? `${Number(p.lat)},${Number(p.lng)}` : String(p?.direccion ?? "").trim());

/**
 * Links de Google Maps con el recorrido en auto (gratis, sin clave): sale de
 * `origen`, pasa por las paradas en orden y, si `vuelve`, termina en el origen.
 * Una parada sin pin ni dirección no se puede poner y se cuenta en `sinUbicar`.
 * @returns {{ tramos: { url: string, desde: number, hasta: number }[], sinUbicar: number }}
 *   desde/hasta: números de parada (1 = la primera) que cubre cada tramo
 */
export function linksRecorrido({ origen = null, paradas = [], vuelve = false } = {}) {
  const ubicables = paradas.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => puntoMaps(p));
  const sinUbicar = paradas.length - ubicables.length;
  const puntos = [];
  if (origen && puntoMaps(origen)) puntos.push({ texto: puntoMaps(origen), n: 0 });
  for (const { p, n } of ubicables) puntos.push({ texto: puntoMaps(p), n });
  if (vuelve && origen && puntoMaps(origen) && ubicables.length) puntos.push({ texto: puntoMaps(origen), n: 0 });
  if (puntos.length < 2) return { tramos: [], sinUbicar };
  const tramos = [];
  const porTramo = MAX_INTERMEDIAS + 2; // salida + intermedias + llegada
  for (let i = 0; i < puntos.length - 1; i += porTramo - 1) {
    const trozo = puntos.slice(i, i + porTramo);
    if (trozo.length < 2) break;
    const [desde, ...resto] = trozo;
    const hasta = resto[resto.length - 1];
    const medio = resto.slice(0, -1);
    const q = new URLSearchParams({ api: "1", origin: desde.texto, destination: hasta.texto, travelmode: "driving" });
    if (medio.length) q.set("waypoints", medio.map((x) => x.texto).join("|"));
    const ns = trozo.map((x) => x.n).filter((n) => n > 0);
    tramos.push({ url: `https://www.google.com/maps/dir/?${q.toString()}`, desde: ns.length ? Math.min(...ns) : 0, hasta: ns.length ? Math.max(...ns) : 0 });
  }
  return { tramos, sinUbicar };
}

/** Número que le toca al próximo viaje de la empresa. */
export const siguienteNumero = (viajes = []) => viajes.reduce((m, v) => Math.max(m, Number(v?.numero) || 0), 0) + 1;

/** Un viaje se puede cambiar mientras no salió. */
export const viajeEditable = (v) => !v || v.estado === "planificado";

/** Otros viajes del mismo día que usan el mismo vehículo o el mismo chofer (solo avisa). */
export function choquesDelDia(viaje, otros = []) {
  const mismos = otros.filter((o) => o.id !== viaje.id && o.fecha === viaje.fecha && o.estado !== "cancelado");
  return {
    vehiculo: viaje.vehiculo_id ? mismos.filter((o) => o.vehiculo_id === viaje.vehiculo_id) : [],
    chofer: viaje.chofer_id ? mismos.filter((o) => o.chofer_id === viaje.chofer_id) : [],
  };
}

// ─── Parte 3 (205): Mis viajes del chofer ───────────────────────────────────

export const AVISO_MIGRACION_MIS_VIAJES = "Para cumplir los viajes falta correr la migración 205 en Supabase.";

export const ESTADOS_PARADA = {
  pendiente:   { label: "Pendiente",   emoji: "⏳" },
  entregado:   { label: "Entregado",   emoji: "✅" },
  parcial:     { label: "Parcial",     emoji: "🟠" },
  rechazado:   { label: "Rechazado",   emoji: "✖️" },
  no_visitado: { label: "No se fue",   emoji: "⏭️" },
};
/** El estado con el texto según la acción: en un retiro, "Entregado" se dice "Retirado". */
export function estadoParada(estado, accion) {
  const e = ESTADOS_PARADA[estado] || ESTADOS_PARADA.pendiente;
  if (estado === "entregado" && accion === "retirar") return { ...e, label: "Retirado" };
  if (estado === "entregado" && accion === "entregar_retirar") return { ...e, label: "Hecho" };
  return e;
}

export const MIN_FOTOS = 1;
export const MAX_FOTOS = 5;
export const MAX_RENGLONES = 200;

/** Quién puede cumplir un viaje: su chofer, o quien gestiona Logística. */
export const puedeHacerViaje = (rol, viaje, empleadoId) => !!viaje && (puedeGestionarLogistica(rol) || (!!empleadoId && viaje.chofer_id === empleadoId));

/** Un viaje se cumple mientras no terminó ni se canceló. */
export const viajeEnCurso = (v) => !!v && (v.estado === "planificado" || v.estado === "en_camino");

const cant = (n) => {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : 0;
};

/**
 * Los renglones que se proponen para una parada con OT: un renglón por bulto
 * ("Bulto 3 de 12") y uno por suelto, todos con la cantidad completa.
 * @returns {{ origen: "bulto"|"suelto"|"mano", ref: number|null, ot: string|null, texto: string, cantidad: number, hecha: number }[]}
 */
export function renglonesDeOts({ ots = [], bultos = [], sueltos = [] } = {}) {
  const r = [];
  for (const ot of ots) {
    const bs = bultos.filter((b) => String(b.ot) === String(ot)).sort((a, b) => a.numero - b.numero);
    for (const b of bs) {
      const texto = [`OT ${ot} · Bulto ${b.numero} de ${bs.length}`, limpio(b.contenido)].filter(Boolean).join(" · ");
      r.push({ origen: "bulto", ref: b.id, ot: String(ot), texto: texto.slice(0, 200), cantidad: 1, hecha: 1 });
    }
    const ss = sueltos.filter((s) => String(s.ot) === String(ot)).sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.id - b.id);
    for (const s of ss) {
      const texto = [`OT ${ot}`, [limpio(s.codigo), limpio(s.descripcion)].filter(Boolean).join(" · ") || "Suelto", limpio(s.medida)].filter(Boolean).join(" · ");
      const c = cant(s.cantidad) || 1;
      r.push({ origen: "suelto", ref: s.id, ot: String(ot), texto: texto.slice(0, 200), cantidad: c, hecha: c });
    }
  }
  return r.slice(0, MAX_RENGLONES);
}

/** Lo que surge de los renglones: todo completo, una parte o nada. Sin renglones, null. */
export function resultadoDeRenglones(renglones = []) {
  const con = renglones.filter((x) => cant(x.cantidad) > 0);
  if (!con.length) return null;
  const hechos = con.filter((x) => cant(x.hecha) > 0);
  if (!hechos.length) return "rechazado";
  return con.every((x) => cant(x.hecha) >= cant(x.cantidad)) ? "entregado" : "parcial";
}

/**
 * Lo que falta para cumplir una parada (la misma regla en la app y en el
 * servidor). Devuelve el texto del problema, o null si está todo.
 */
export function faltaParaCumplir({ estado, accion = "entregar", fotos = [], firma_url = null, sin_firma = false, motivo = "", renglones = [] } = {}) {
  if (!ESTADOS_PARADA[estado] || estado === "pendiente") return "Elegí cómo terminó la parada";
  if (estado !== "entregado" && !limpio(motivo)) return estado === "no_visitado" ? "Poné por qué no se fue" : "Poné el motivo";
  if (estado === "no_visitado") return null;
  if (fotos.length < MIN_FOTOS) return "Sacá al menos una foto";
  if (fotos.length > MAX_FOTOS) return `Hasta ${MAX_FOTOS} fotos por parada`;
  if (estado === "parcial" && renglones.length && resultadoDeRenglones(renglones) === "entregado") return "Si es parcial, bajá la cantidad de lo que no se entregó";
  // Lo entregado lo firma quien recibe; si no hay nadie, se anota "sin firma"
  if (estado !== "rechazado" && accion !== "retirar" && !firma_url && !sin_firma) return "Falta la firma de quien recibe (o tildá que no hay nadie para firmar)";
  return null;
}

/** Cuántas paradas se cumplieron y cuántas faltan. */
export function avanceViaje(paradas = []) {
  const total = paradas.length;
  const hechas = paradas.filter((p) => p.estado && p.estado !== "pendiente").length;
  return { total, hechas, faltan: total - hechas };
}

/**
 * Los viajes del chofer para su Inicio: los que están en camino (de cualquier
 * día), los planificados de hoy en adelante (y los de días anteriores que no
 * salieron) y los que terminó hoy. Primero el que está en camino.
 */
export function misViajes(viajes = [], empleadoId, hoy) {
  const peso = { en_camino: 0, planificado: 1, terminado: 2 };
  return viajes
    .filter((v) => v && v.chofer_id === empleadoId)
    .filter((v) => v.estado === "en_camino" || v.estado === "planificado" || (v.estado === "terminado" && v.fecha === hoy))
    .sort((a, b) => peso[a.estado] - peso[b.estado] || String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora || "99").localeCompare(String(b.hora || "99")) || a.numero - b.numero);
}

/** Texto corto para el botón del Inicio. */
export function detalleMisViajes(viajes = [], hoy) {
  const enCamino = viajes.find((v) => v.estado === "en_camino");
  if (enCamino) return `Viaje ${enCamino.numero} en camino: seguí con las paradas`;
  const deHoy = viajes.filter((v) => v.estado === "planificado" && v.fecha <= hoy).length;
  if (deHoy) return `${deHoy === 1 ? "Tenés 1 viaje" : `Tenés ${deHoy} viajes`} para hoy`;
  const prox = viajes.filter((v) => v.estado === "planificado").length;
  if (prox) return `${prox === 1 ? "1 viaje armado" : `${prox} viajes armados`} para los próximos días`;
  return "Los viajes de hoy ya están terminados";
}

/** Link de Google Maps para ir manejando hasta una parada desde donde está el celular. */
export function linkComoLlegar(p) {
  const destino = puntoMaps(p);
  if (!destino) return null;
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: destino, travelmode: "driving" }).toString()}`;
}

// ─── Parte 4 (206): remito de cada parada ───────────────────────────────────

export const AVISO_MIGRACION_REMITO = "Para el remito falta correr la migración 206 en Supabase.";

/** Una parada tiene remito cuando se cumplió (entregada, parcial o rechazada). */
export const tieneRemito = (p) => !!p && ["entregado", "parcial", "rechazado"].includes(p.estado);

/** Número del remito con ceros adelante: 12 → "000012". */
export const numeroRemito = (n) => (Number(n) > 0 ? String(Math.trunc(Number(n))).padStart(6, "0") : "");

/** Quien recibió puede firmar desde el link si la parada no se rechazó y todavía no tiene firma. */
export const puedeFirmarPorLink = (p) => tieneRemito(p) && p.estado !== "rechazado" && !p.firma_url;

/** Link del remito para mandar (lo abre cualquiera que lo tenga, sin usuario de Gypi). */
export const linkRemito = (origen, token) => (token ? `${String(origen || "").replace(/\/+$/, "")}/remito/${token}` : null);

/** Mensaje para WhatsApp o mail con el link del remito. */
export function textoRemito({ empresa = "", numero, nombre = "", url, firmar = false } = {}) {
  const de = empresa ? ` de ${empresa}` : "";
  const que = `Remito N° ${numeroRemito(numero)}${de}${nombre ? ` (${nombre})` : ""}`;
  return firmar
    ? `Hola, te mandamos el ${que}. Por favor, firmalo desde este link: ${url}`
    : `Hola, te mandamos el ${que}. Lo podés ver y bajar en PDF desde este link: ${url}`;
}

export const linkWhatsapp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;
export const linkMail = ({ asunto, cuerpo }) => `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
