// app/lib/unirServidor.js — 19/11 (Tadeo: "Felipe Omar Guzmán" repetido no se
// podía unir desde la Agenda). Unir dos clientes o dos proveedores repetidos
// sin perder nada, desde 👥 Clientes, Compras → Proveedores o la Agenda.
import { sbGet, sbPatch, sbRpc } from "./sbHelpers";
import { unirClientes } from "./finanzasClientes";
import { moverCuentaProveedor, moverParProveedor } from "./proveedoresUnicos";
import { CLAVE_CUENTAS_PROV } from "./finanzasProveedores";
import { CLAVE_UNIFICADOS, leerPares } from "./finanzasUnificados";

export const FALTA_183 = "Para unir proveedores repetidos falta correr la migración 183 en Supabase.";

async function leerConfig(e, clave) {
  const [r] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${clave}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  return r?.valor ?? null;
}

/**
 * El proveedor repetido (sale) pasa al que queda con todo lo suyo (183: una
 * transacción de la base), y después su cuenta y el par cliente-proveedor.
 * @returns {Promise<{ ok: true, movidos: number } | { ok: false, error: string, status: number }>}
 */
export async function unirProveedoresEnBase(e, queda, sale) {
  let r;
  try {
    r = await sbRpc("compras_unir_proveedores", { p_empresa: e, p_queda: queda, p_sale: sale });
  } catch (err) {
    if (/compras_unir_proveedores/.test(String(err?.message)) && /PGRST202|42883|Could not find the function/.test(String(err?.message))) {
      return { ok: false, error: FALTA_183, status: 409 };
    }
    throw err;
  }
  if (!r?.ok) {
    const textos = { mismo: "Elegí dos proveedores distintos", no_existe: "No encontré uno de los dos proveedores", ya_unido: "Ese proveedor ya está unido a otro" };
    return { ok: false, error: textos[r?.tipo] || "No se pudo unir", status: r?.tipo === "no_existe" ? 404 : 409 };
  }
  const cuentas = await leerConfig(e, CLAVE_CUENTAS_PROV);
  if (cuentas?.cuentas && `p${sale}` in cuentas.cuentas) {
    const valor = { ...cuentas, cuentas: moverCuentaProveedor(cuentas.cuentas, queda, sale), actualizado_at: new Date().toISOString() };
    await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CUENTAS_PROV}`, { valor }, { silent: true });
  }
  const unificados = await leerConfig(e, CLAVE_UNIFICADOS);
  const pares = leerPares(unificados);
  if (pares.some((p) => p.proveedor_id === sale)) {
    const valor = { ...unificados, pares: moverParProveedor(pares, queda, sale) };
    await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_UNIFICADOS}`, { valor }, { silent: true });
  }
  return { ok: true, movidos: r.movidos || 0 };
}

/**
 * El cliente b pasa a ser otro nombre de a. Todo lo de b pasa a a: las
 * operaciones, los cheques, las OT y su renglón de la Agenda (19/11: antes
 * los cheques y las OT quedaban en el que salía).
 * @param {object} a el que queda (fila de fin_clientes)
 * @param {object} b el que sale
 */
export async function unirClientesEnBase(sesion, a, b) {
  const e = sesion.empresa_id;
  const { a: ca, b: cb } = unirClientes(a, b);
  const ahora = new Date().toISOString();
  await sbPatch(`fin_clientes?id=eq.${a.id}&empresa_id=eq.${e}`, { ...ca, updated_at: ahora }, { sesion });
  await sbPatch(`fin_clientes?id=eq.${b.id}&empresa_id=eq.${e}`, { ...cb, updated_at: ahora }, { sesion });
  await sbPatch(`fin_operaciones?empresa_id=eq.${e}&cliente_id=eq.${b.id}`, { cliente_id: a.id, updated_at: ahora }, { sesion });
  // Sin la 192 los cheques no tienen cliente: no pasa nada
  await sbPatch(`fin_cheques?empresa_id=eq.${e}&cliente_id=eq.${b.id}`, { cliente_id: a.id, updated_at: ahora }, { sesion, silent: true }).catch(() => null);
  await sbPatch(`proyectos?empresa_id=eq.${e}&cliente_id=eq.${b.id}`, { cliente_id: a.id }, { silent: true }).catch(() => null);
  // La Agenda deja una sola persona por cliente: si a ya tiene su renglón, el de b lo suelta
  const [conA] = (await sbGet(`fin_personas?empresa_id=eq.${e}&cliente_id=eq.${a.id}&select=id&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  await sbPatch(`fin_personas?empresa_id=eq.${e}&cliente_id=eq.${b.id}`, { cliente_id: conA ? null : a.id, updated_at: ahora }, { sesion, silent: true }).catch(() => null);
}
