// app/lib/altaPersona.js — "➕ Nuevo" cliente o proveedor sin cambiar de
// pantalla (11/11, pedido de Tadeo; parte 4 del plan Finanzas e Inventario).
//
// Donde se elige un proveedor o un cliente (Nueva operación, pagos, cheques,
// cargar gasto, Mi caja, Compras, ingresos de Stock) hay un botón para darlo
// de alta ahí mismo. Antes de crear nada se busca en la agenda única
// (proveedores + clientes + hoja PERSONAS, ver finanzasPersonas.js):
//   - mismo CUIT, o el mismo nombre escrito distinto ("GIRI EZEQUIEL" =
//     "EZEQUIEL GIRI", "STOM" = "STOM SAS") → es esa persona: no se crea otra.
//     Si estaba en la agenda pero no era proveedor (o cliente), pasa a serlo.
//   - un nombre parecido ("BUGLIOTTI" y "BUGLIOTTI JUAN") → se pregunta si es
//     alguno de esos antes de crear uno nuevo.
import { clavePersona, cuitLimpio } from "./finanzasPersonas";

export const ROLES_ALTA = { proveedor: "Proveedor", cliente: "Cliente" };
export const MAX_PARECIDOS = 5;

const txt = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Lo que escribió la persona, limpio, con los errores en palabras. */
export function validarAlta(d = {}) {
  const errores = [];
  const nombre = txt(d.nombre, 120);
  if (!nombre) errores.push("Falta el nombre.");
  const digitos = String(d.cuit ?? "").replace(/\D/g, "");
  if (digitos && digitos.length !== 11) errores.push("El CUIT tiene que tener 11 números (o dejalo vacío).");
  const rol = ROLES_ALTA[d.rol] ? d.rol : null;
  if (!rol) errores.push("Elegí si es proveedor o cliente.");
  return { errores, alta: { nombre, cuit: cuitLimpio(digitos) || null, rol } };
}

/** "30711222339" → "30-71122233-9" (como se guarda en proveedores). */
export function cuitConGuiones(c) {
  const d = cuitLimpio(c);
  return d ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : null;
}

/**
 * ¿Ya está en la agenda?
 * @param {{ nombre: string, cuit?: string|null }} alta
 * @param {{ clave: string, nombre: string, cuit?: string|null }[]} agenda
 * @returns {{ igual: object|null, parecidos: object[] }}
 */
export function buscarEnAgenda(alta, agenda = []) {
  const cuit = cuitLimpio(alta.cuit);
  if (cuit) {
    const porCuit = agenda.find((e) => cuitLimpio(e.cuit) === cuit);
    if (porCuit) return { igual: porCuit, parecidos: [] };
  }
  const clave = clavePersona(alta.nombre);
  if (!clave) return { igual: null, parecidos: [] };
  const igual = agenda.find((e) => clavePersona(e.nombre) === clave || (e.alias || []).some((a) => clavePersona(a) === clave));
  if (igual) return { igual, parecidos: [] };
  // Parecidos: todas las palabras (de 4 letras o más) de uno están en el otro
  const mias = new Set(clave.split(" ").filter((p) => p.length >= 4));
  if (!mias.size) return { igual: null, parecidos: [] };
  const parecidos = agenda.filter((e) => {
    const suyas = new Set(clavePersona(e.nombre).split(" ").filter((p) => p.length >= 4));
    if (!suyas.size) return false;
    const [chica, grande] = mias.size <= suyas.size ? [mias, suyas] : [suyas, mias];
    return [...chica].every((p) => grande.has(p));
  });
  return { igual: null, parecidos: parecidos.slice(0, MAX_PARECIDOS) };
}

/** ¿Esa persona de la agenda ya cumple el rol pedido? */
export const tieneRol = (e, rol) => (rol === "cliente" ? !!e?.cliente_id : !!e?.proveedor_id);

/** Lo que vuelve a la pantalla: solo lo que hace falta para elegirla. */
export function personaElegible(e) {
  return { clave: e.clave, nombre: e.nombre, cuit: e.cuit || null, proveedor_id: e.proveedor_id || null, cliente_id: e.cliente_id || null };
}

/** El texto de un parecido para el botón "Sí, es …". */
export function textoParecido(e) {
  const rol = e.proveedor_id && e.cliente_id ? "proveedor y cliente" : e.proveedor_id ? "proveedor" : e.cliente_id ? "cliente" : "en la agenda";
  return `${e.nombre} (${rol}${e.cuit ? ` · CUIT ${cuitConGuiones(e.cuit) || e.cuit}` : ""})`;
}
