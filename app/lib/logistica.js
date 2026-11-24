// app/lib/logistica.js — Reglas del módulo de Logística (pedido de Tadeo, 23/11).
//
// Parte 1 (203): la libreta de Lugares (planta, depósitos, proveedores,
// clientes y otros, cada uno con su dirección y su pin) y la dirección de la
// obra de cada OT. Las obras no se cargan como lugar: salen de las OT activas,
// agrupadas por el nombre de la obra, y la dirección se guarda en cada OT.
// Las partes siguientes (viajes, Mis viajes, remito) usan estos puntos.
import { coordsValidas } from "./ubicacion";

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
