// app/lib/finanzasListas.js — Las listas que usan las pantallas de Finanzas
// para cargar y validar una operación (tipos, plan de cuentas, cajas y
// bancos, centros de costo, proveedores y OT). Las comparten
// /api/finanzas/operaciones y /api/finanzas/mayor.
import { sbGetAll } from "./sbHelpers";

export async function listasFinanzas(sesion) {
  const e = sesion.empresa_id;
  const leer = (path) => sbGetAll(path, { sesion, maxFilas: 5000 }).then((r) => r.data);
  const [tipos, cuentas, tesoreria, centros, proveedores, proyectos] = await Promise.all([
    leer(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,pide_entidad,pide_ot,pide_cc,descripcion,activo&order=codigo.asc`),
    leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,activa&order=codigo.asc`),
    leer(`fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=cuenta.asc`),
    leer(`fin_centros_costo?empresa_id=eq.${e}&select=codigo,nombre,division,activo&order=codigo.asc`),
    leer(`proveedores?empresa_id=eq.${e}&select=id,nombre,cuit,fin_tipo,activo&order=nombre.asc,id.asc`),
    leer(`proyectos?empresa_id=eq.${e}&select=id,ot,cliente,obra,descripcion,estado&order=id.desc`),
  ]);
  return { tipos, cuentas, tesoreria, centros, proveedores, proyectos };
}
