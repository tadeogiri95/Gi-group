// app/lib/finanzasListas.js — Las listas que usan las pantallas de Finanzas
// para cargar y validar una operación (tipos, plan de cuentas, cajas y
// bancos, centros de costo, proveedores y OT). Las comparten
// /api/finanzas/operaciones y /api/finanzas/mayor. Desde el 19/11 (punto 13,
// imputar después) también los clientes, los vehículos y las máquinas; si
// Flota o Maquinaria no están, van vacías.
import { sbGetAll } from "./sbHelpers";

/** @param {{ paraImputar?: boolean }} [opts] paraImputar = también clientes, vehículos y máquinas */
export async function listasFinanzas(sesion, { paraImputar = false } = {}) {
  const e = sesion.empresa_id;
  const leer = (path) => sbGetAll(path, { sesion, maxFilas: 5000 }).then((r) => r.data);
  const opcional = (path) => (paraImputar ? leer(path).catch(() => []) : Promise.resolve(null));
  const [tipos, cuentas, tesoreria, centros, proveedores, proyectos, clientes, vehiculos, maquinas] = await Promise.all([
    leer(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,pide_entidad,pide_ot,pide_cc,descripcion,activo&order=codigo.asc`),
    leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,activa&order=codigo.asc`),
    leer(`fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=cuenta.asc`),
    leer(`fin_centros_costo?empresa_id=eq.${e}&select=codigo,nombre,division,activo&order=codigo.asc`),
    leer(`proveedores?empresa_id=eq.${e}&select=id,nombre,cuit,fin_tipo,activo&order=nombre.asc,id.asc`),
    leer(`proyectos?empresa_id=eq.${e}&select=id,ot,cliente,obra,descripcion,estado&order=id.desc`),
    opcional(`fin_clientes?empresa_id=eq.${e}&select=id,nombre,activo,unido_a&order=nombre.asc,id.asc`),
    opcional(`vehiculos?empresa_id=eq.${e}&select=id,patente,marca,modelo,activo&order=patente.asc`),
    opcional(`maquinas?empresa_id=eq.${e}&select=id,codigo,nombre,activo&order=codigo.asc`),
  ]);
  const base = { tipos, cuentas, tesoreria, centros, proveedores, proyectos };
  return paraImputar ? { ...base, clientes: clientes || [], vehiculos: vehiculos || [], maquinas: maquinas || [] } : base;
}
