// app/lib/destinosPiezas.js — Qué se arma y qué va suelto en cada OT (Tadeo,
// 07/11; migración 163, tabla destinos_ot).
//
// El código de cada pieza es (OT)-(Módulo)-(Pieza). Las piezas con el mismo
// módulo forman ese módulo: se arma en planta y viaja como un bulto. Además:
//   - un módulo se puede marcar "Van sueltas" (AJ, ajustes; CEN, cenefas):
//     sus piezas viajan sueltas;
//   - una pieza sin módulo, (OT)-(Pieza), se asigna a un módulo (va armada
//     dentro de él y en Gypi pasa a ser de ese módulo) o va suelta; mientras
//     nadie elige, queda sin definir;
//   - una pieza con módulo no se mueve a otro: su código impreso ya dice el
//     módulo. Si está mal, se corrige en la planilla.
//   - la columna SUELTO de la planilla (DATOS por pieza, NECESIDADES por
//     herraje) pone suelto lo marcado; lo que se elige en Gypi le gana.
//   - los herrajes y perfiles van dentro del mueble salvo que digan suelto.
// Lo suelto pasa a 📦 Sueltos de la OT para tildarlo en el acopio y la carga.
// Sin red ni base: lo usan la pantalla y el servidor.
import { moduloDe } from "./piezas";

/** Destinos de un módulo. */
export const ARMADO = "armado";
export const SUELTAS = "sueltas";
export const MAX_SUELTOS_OT = 400;

const indice = (destinos, tipo) => new Map((destinos || []).filter((d) => d.tipo === tipo).map((d) => [d.clave, d]));
const medidaDe = (p) => (p.l1 && p.l2 ? `${Number(p.l1)} × ${Number(p.l2)}` : null);

/**
 * Lo que dice cada fila de destinos_ot, junto a las piezas de la OT.
 * @param {{ nombre: string, modulo?: string|null, material?: string|null, l1?: number, l2?: number }[]} piezas una fila por pieza física (piezas_ot)
 * @param {object[]} destinos filas de destinos_ot de la OT
 */
export function armarDestinos(piezas = [], destinos = []) {
  const deModulo = indice(destinos, "modulo");
  const dePieza = indice(destinos, "pieza");
  const deHerraje = indice(destinos, "herraje");

  // Un renglón por nombre de pieza (cada pieza física es una fila)
  const renglones = new Map();
  for (const p of piezas || []) {
    const r = renglones.get(p.nombre);
    if (r) r.unidades += 1;
    else renglones.set(p.nombre, { nombre: p.nombre, propio: moduloDe(p.nombre), material: p.material || null, medida: medidaDe(p), unidades: 1 });
  }

  const modulos = new Map();
  for (const r of renglones.values()) {
    if (!r.propio) continue;
    if (!modulos.has(r.propio)) {
      const d = deModulo.get(r.propio);
      modulos.set(r.propio, { modulo: r.propio, destino: d?.suelto ? SUELTAS : ARMADO, manual: d?.suelto != null, piezas: 0, unidades: 0, agregadas: 0, sueltasPlanilla: 0 });
    }
  }

  const sinModulo = [];
  const sueltas = [];
  for (const r of renglones.values()) {
    const d = dePieza.get(r.nombre);
    const marcadaPlanilla = !!d?.planilla_suelto;
    if (r.propio) {
      const m = modulos.get(r.propio);
      m.piezas += 1;
      m.unidades += r.unidades;
      const suelta = d?.suelto ?? (m.destino === SUELTAS || marcadaPlanilla);
      if (suelta) {
        sueltas.push({ ...r, vaCon: r.propio });
        if (m.destino === ARMADO) m.sueltasPlanilla += 1;
      }
      continue;
    }
    // Sin módulo: elegida a mano, si no lo que dice la planilla, si no sin definir
    const asignado = d?.modulo && modulos.has(d.modulo) ? d.modulo : null;
    let destino = null;
    if (d?.suelto === true) destino = "suelta";
    else if (asignado) destino = "modulo";
    else if (d?.suelto == null && marcadaPlanilla) destino = "suelta";
    const fila = { ...r, destino, modulo: destino === "modulo" ? asignado : null, manual: d?.suelto === true || !!asignado, planilla: marcadaPlanilla };
    sinModulo.push(fila);
    if (destino === "suelta") sueltas.push({ ...r, vaCon: null });
    if (destino === "modulo") {
      const m = modulos.get(asignado);
      m.agregadas += 1;
      if (m.destino === SUELTAS) sueltas.push({ ...r, vaCon: asignado });
    }
  }

  const herrajes = [...deHerraje.values()]
    .filter((d) => d.en_planilla || d.suelto != null)
    .map((d) => ({
      clave: d.clave,
      ...(d.datos || {}),
      en_planilla: !!d.en_planilla,
      planilla_suelto: !!d.planilla_suelto,
      suelto: d.suelto ?? !!d.planilla_suelto,
      manual: d.suelto != null,
    }))
    .filter((h) => h.descripcion || h.codigo)
    .sort((a, b) => String(a.tipo || "").localeCompare(String(b.tipo || "")) || String(a.descripcion || "").localeCompare(String(b.descripcion || "")));

  const listaModulos = [...modulos.values()].sort((a, b) => a.modulo.localeCompare(b.modulo, "es", { numeric: true }));
  return {
    modulos: listaModulos,
    sinModulo: sinModulo.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })),
    herrajes,
    sinDefinir: sinModulo.filter((p) => !p.destino).length,
    sueltas,
  };
}

/**
 * Módulo que debe tener cada pieza en piezas_ot: el de su código, o el que se
 * le asignó si no tiene. Solo los nombres que cambian: { nombre: modulo|null }.
 */
export function modulosACorregir(piezas = [], destinos = []) {
  const { sinModulo } = armarDestinos(piezas, destinos);
  const quiere = new Map(sinModulo.map((p) => [p.nombre, p.destino === "modulo" ? p.modulo : null]));
  const out = {};
  for (const p of piezas || []) {
    const propio = moduloDe(p.nombre);
    const debe = propio || quiere.get(p.nombre) || null;
    if ((p.modulo || null) !== debe) out[p.nombre] = debe;
  }
  return out;
}

/**
 * Ítems de 📦 Sueltos que pone Gypi: las piezas sueltas (código = nombre de
 * la pieza, así el escaneo de Carga las tilda) y los herrajes sueltos.
 */
export function sueltosDeDestinos(piezas = [], destinos = []) {
  const { sueltas, herrajes } = armarDestinos(piezas, destinos);
  const items = sueltas.map((r) => ({
    tipo: "Madera",
    codigo: String(r.nombre).slice(0, 40),
    descripcion: String(r.material || r.nombre).slice(0, 200),
    medida: r.medida,
    cantidad: r.unidades,
    va_con: r.vaCon ? `Módulo ${r.vaCon}`.slice(0, 80) : null,
  }));
  for (const h of herrajes) {
    if (!h.suelto || !h.en_planilla) continue;
    items.push({
      tipo: h.tipo || "Herraje",
      codigo: h.codigo || null,
      descripcion: String(h.descripcion || h.codigo).slice(0, 200),
      medida: h.medida || null,
      cantidad: Number(h.cantidad) > 0 ? Number(h.cantidad) : 1,
      va_con: null,
    });
  }
  return items.slice(0, MAX_SUELTOS_OT);
}

/** "8 módulos · 5 sueltas · 3 sin definir" */
export function textoDestinos(d) {
  const armados = d.modulos.filter((m) => m.destino === ARMADO).length;
  const partes = [armados === 1 ? "1 módulo armado" : `${armados} módulos armados`];
  if (d.sueltas.length) partes.push(d.sueltas.length === 1 ? "1 pieza suelta" : `${d.sueltas.length} piezas sueltas`);
  const herrajesSueltos = d.herrajes.filter((h) => h.suelto && h.en_planilla).length;
  if (herrajesSueltos) partes.push(herrajesSueltos === 1 ? "1 herraje suelto" : `${herrajesSueltos} herrajes sueltos`);
  if (d.sinDefinir) partes.push(`${d.sinDefinir} sin definir`);
  return partes.join(" · ");
}

/** Contenido del bulto de un módulo armado en 🚚 Carga: "Módulo M1". */
export const contenidoBultoModulo = (modulo) => `Módulo ${modulo}`;
const MODULO_DE_BULTO = /^Módulo (.+)$/;
/** "Módulo M1" → "M1"; null si el bulto no es de un módulo. */
export const moduloDeBulto = (contenido) => String(contenido ?? "").match(MODULO_DE_BULTO)?.[1] || null;

/**
 * Bultos de la OT = sus módulos armados (Tadeo, 07/11: el módulo es el bulto).
 * Qué hacer con bultos_ot para que haya uno por módulo armado, en orden:
 *   - se agregan los que faltan al final;
 *   - se borran los de módulos que ya no se arman, salvo si ya están cargados;
 *   - los números se corren para quedar "1 de N" sin huecos.
 * Null si la OT tiene bultos armados a mano (otro contenido): no se tocan.
 * @param {{ id: number, numero: number, contenido: string|null, cargado?: boolean }[]} bultos
 * @param {string[]} modulos los módulos armados
 */
export function planBultos(bultos = [], modulos = []) {
  if ((bultos || []).some((b) => !moduloDeBulto(b.contenido))) return null;
  const quiero = new Set(modulos);
  const ordenados = [...(bultos || [])].sort((a, b) => a.numero - b.numero);
  const borrar = ordenados.filter((b) => !quiero.has(moduloDeBulto(b.contenido)) && !b.cargado).map((b) => b.id);
  const quedan = ordenados.filter((b) => !borrar.includes(b.id));
  const renumerar = quedan.flatMap((b, i) => (b.numero === i + 1 ? [] : [{ id: b.id, numero: i + 1 }]));
  const tienen = new Set(quedan.map((b) => moduloDeBulto(b.contenido)));
  const crear = modulos.filter((m) => !tienen.has(m)).map((m, i) => ({ numero: quedan.length + i + 1, contenido: contenidoBultoModulo(m) }));
  return { crear, borrar, renumerar };
}
