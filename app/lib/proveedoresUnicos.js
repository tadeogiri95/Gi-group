// app/lib/proveedoresUnicos.js — Una sola lista de proveedores (auditoría del
// 12/11, parte 5; migración 183).
//
//   - Al dar de alta o corregir un proveedor en Compras se busca si ya está:
//     el mismo CUIT o el mismo nombre escrito distinto ("MADERAS CORDOBA SA" =
//     "Maderas Córdoba S.A.") no deja crear otro; un nombre parecido
//     ("BUGLIOTTI" y "BUGLIOTTI JUAN") pregunta antes ("Es otro proveedor").
//   - Los que ya quedaron repetidos se unen: todo lo del repetido pasa al que
//     queda (compras, facturas, Finanzas, cheques, agenda, services y fallas)
//     con la función compras_unir_proveedores de la base. Acá se arma la
//     sugerencia de cuáles unir y lo que vive en config_sistema (la cuenta de
//     cada proveedor y los pares cliente-proveedor).
//   - El taller de un service, arreglo o falla se elige de la lista: se guarda
//     el proveedor y su nombre.
import { buscarEnAgenda } from "./altaPersona";
import { clavePersona, cuitLimpio } from "./finanzasPersonas";

const comoAgenda = (p) => ({ ...p, clave: `p${p.id}` });

/**
 * ¿Ya hay un proveedor así? Busca entre los otros (no el que se corrige ni los
 * ya unidos a otro).
 * @returns {{ igual: object|null, parecidos: object[] }}
 */
export function proveedorRepetido(fila, proveedores = [], idPropio = null) {
  const otros = proveedores.filter((p) => Number(p.id) !== Number(idPropio) && !p.unido_a).map(comoAgenda);
  const r = buscarEnAgenda({ nombre: fila.nombre, cuit: fila.cuit }, otros);
  return { igual: r.igual, parecidos: r.parecidos };
}

/** Lo que vuelve a la pantalla de un proveedor parecido. */
export const proveedorCorto = (p) => ({ id: Number(p.id), nombre: p.nombre, cuit: p.cuit || null, activo: p.activo !== false });

/** Cuántos datos tiene cargados (para elegir cuál queda). */
function datosCargados(p) {
  return ["cuit", "contacto", "whatsapp", "email", "plazo_dias", "condicion_pago"].filter((c) => p[c] != null && p[c] !== "").length;
}

/** Cuál queda de dos: el activo, el que tiene más datos, el más viejo. */
export function cualQueda(a, b) {
  const act = (p) => (p.activo === false ? 0 : 1);
  if (act(a) !== act(b)) return act(a) > act(b) ? [a, b] : [b, a];
  const da = datosCargados(a);
  const db = datosCargados(b);
  if (da !== db) return da > db ? [a, b] : [b, a];
  return Number(a.id) <= Number(b.id) ? [a, b] : [b, a];
}

/**
 * Proveedores que parecen el mismo: mismo CUIT o mismo nombre escrito
 * distinto. Cada uno aparece una sola vez (el primer par que lo toca).
 * @returns {{ queda: object, sale: object, por: "cuit"|"nombre" }[]}
 */
export function sugerirUniones(proveedores = []) {
  const vivos = proveedores.filter((p) => !p.unido_a);
  const usados = new Set();
  const out = [];
  const agregar = (a, b, por) => {
    if (usados.has(a.id) || usados.has(b.id) || a.id === b.id) return;
    usados.add(a.id);
    usados.add(b.id);
    const [queda, sale] = cualQueda(a, b);
    out.push({ queda: proveedorCorto(queda), sale: proveedorCorto(sale), por });
  };
  const porCuit = new Map();
  for (const p of vivos) {
    const c = cuitLimpio(p.cuit);
    if (!c) continue;
    if (porCuit.has(c)) agregar(porCuit.get(c), p, "cuit");
    else porCuit.set(c, p);
  }
  const porClave = new Map();
  for (const p of vivos) {
    const k = clavePersona(p.nombre);
    if (!k) continue;
    const otro = porClave.get(k);
    // Dos CUIT distintos cargados: son dos proveedores aunque se llamen igual
    if (otro && !(cuitLimpio(otro.cuit) && cuitLimpio(p.cuit) && cuitLimpio(otro.cuit) !== cuitLimpio(p.cuit))) agregar(otro, p, "nombre");
    else if (!otro) porClave.set(k, p);
  }
  return out;
}

/**
 * La cuenta del proveedor (finanzas_cuentas_proveedores): si el repetido tenía
 * una y el que queda no, pasa al que queda. La del repetido se borra.
 */
export function moverCuentaProveedor(cuentas = {}, queda, sale) {
  const out = { ...cuentas };
  const kq = `p${queda}`;
  const ks = `p${sale}`;
  if (out[ks] && !out[kq]) out[kq] = out[ks];
  delete out[ks];
  return out;
}

/**
 * Los pares cliente-proveedor (finanzas_cliente_proveedor): el par del
 * repetido pasa al que queda, salvo que el que queda ya tenga el suyo.
 */
export function moverParProveedor(pares = [], queda, sale) {
  const yaTiene = pares.some((p) => Number(p.proveedor_id) === Number(queda));
  return pares
    .filter((p) => !(yaTiene && Number(p.proveedor_id) === Number(sale)))
    .map((p) => (Number(p.proveedor_id) === Number(sale) ? { ...p, proveedor_id: Number(queda) } : p));
}

/** Lo que se copia a la agenda (fin_personas) al corregir un proveedor. */
export function datosAgendaDeProveedor(p) {
  const out = {};
  if (p.cuit) out.cuit = p.cuit;
  if (p.email) out.email = String(p.email).slice(0, 160);
  if (p.whatsapp) out.telefono = String(p.whatsapp).slice(0, 40);
  if (p.contacto) out.contacto = String(p.contacto).slice(0, 120);
  return out;
}

/** Lo que se copia a la agenda al corregir un cliente. */
export function datosAgendaDeCliente(c) {
  const out = {};
  if (c.cuit) out.cuit = c.cuit;
  if (c.email) out.email = String(c.email).slice(0, 160);
  if (c.telefono) out.telefono = String(c.telefono).slice(0, 40);
  return out;
}

/** El taller elegido: el proveedor de la lista (id y nombre) o el texto escrito. */
export function tallerElegido(d, proveedores = []) {
  const id = Number(d?.proveedor_id) || null;
  if (id) {
    const p = proveedores.find((x) => Number(x.id) === id);
    if (!p) return { error: "Ese taller no está en la lista de proveedores" };
    return { proveedor_id: id, taller: String(p.nombre).slice(0, 120) };
  }
  const t = String(d?.taller ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { proveedor_id: null, taller: t || null };
}
