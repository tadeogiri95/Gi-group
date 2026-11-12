// app/lib/tallerServidor.js — El taller de un service, arreglo o falla sale de
// la lista de proveedores (auditoría del 12/11, parte 5; migración 183).
import { sbGet } from "./sbHelpers";
import { tallerElegido } from "./proveedoresUnicos";

/** { proveedor_id, taller } del proveedor elegido (de esta empresa), o el texto escrito; { error } si no está. */
export async function tallerDe(sesion, d) {
  if (!d?.proveedor_id) return tallerElegido(d);
  const lista = (await sbGet(`proveedores?id=eq.${Number(d.proveedor_id)}&empresa_id=eq.${sesion.empresa_id}&select=id,nombre&limit=1`, { sesion })) || [];
  return tallerElegido(d, lista);
}
