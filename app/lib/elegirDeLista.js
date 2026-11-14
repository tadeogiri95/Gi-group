// app/lib/elegirDeLista.js — Etapa 2 de Finanzas integrada (14/11, migración
// 192): el proveedor y el cliente se eligen de la lista, no se escriben.
//
// Cuando la pantalla manda un nombre (lo que se eligió de la lista, o lo que
// leyó la IA de un remito), se busca en la lista con la misma regla que la
// Agenda: mismas palabras en cualquier orden, sin S.A./S.R.L., puntos ni
// tildes ("STOM" = "STOM SAS"). Si no está, se avisa para que lo elija o lo dé
// de alta, en vez de guardar un nombre suelto.
import { clavePersona } from "./finanzasPersonas";

const vivo = (x) => x && x.activo !== false && !x.unido_a;

/** El proveedor de la lista para un id o un nombre (o null). */
export function proveedorDeLista({ id, nombre } = {}, proveedores = []) {
  const n = Number(id);
  if (n > 0) {
    const p = proveedores.find((x) => Number(x.id) === n);
    if (p) return p.unido_a ? proveedores.find((x) => Number(x.id) === Number(p.unido_a)) || p : p;
  }
  const k = clavePersona(nombre);
  if (!k) return null;
  const iguales = proveedores.filter((x) => vivo(x) && clavePersona(x.nombre) === k);
  return iguales.length === 1 ? iguales[0] : iguales.sort((a, b) => Number(a.id) - Number(b.id))[0] || null;
}

/** El cliente de la lista para un id o un nombre (también por sus otros nombres), o null. */
export function clienteDeLista({ id, nombre } = {}, clientes = []) {
  const n = Number(id);
  if (n > 0) {
    const c = clientes.find((x) => Number(x.id) === n);
    if (c) return c.unido_a ? clientes.find((x) => Number(x.id) === Number(c.unido_a)) || c : c;
  }
  const k = clavePersona(nombre);
  if (!k) return null;
  return clientes.find((x) => vivo(x) && [x.nombre, ...(x.alias || [])].some((a) => clavePersona(a) === k)) || null;
}

/** El aviso cuando el proveedor escrito no está en la lista. */
export const avisoFaltaProveedor = (nombre) => `"${String(nombre).slice(0, 120)}" no está en la lista de proveedores: elegilo de la lista o dalo de alta con ➕.`;

/** ¿El error de la base es porque falta la columna nueva (migración 192 sin correr)? */
export const faltaColumna192 = (err) => /proveedor_id|cliente_id/.test(String(err?.message)) && /42703|does not exist|PGRST204|schema cache/.test(String(err?.message));
