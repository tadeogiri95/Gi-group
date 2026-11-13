// app/lib/finanzasRepetidosServidor.js — buscar en la base los movimientos
// repetidos de cajas y bancos antes de guardar (reglas en finanzasRepetidos.js).
import { NextResponse } from "next/server";
import { sbGetAll } from "./sbHelpers";
import { buscarRepetidos, cajasDeOperacion, rangoRevision, respuestaRepetidos } from "./finanzasRepetidos";

const COLUMNAS = "id,fecha,tipo,entidad,descripcion,origen,origen_id,total,total_ars,cuenta_debe,cuenta_haber,anulada_at";
const lista = (cuentas) => encodeURIComponent(cuentas.map((c) => `"${String(c).replace(/"/g, "")}"`).join(","));

/**
 * Las operaciones nuevas que ya tienen otra igual en la misma caja o banco.
 * @param {object} sesion la del Dueño
 * @param {object[]} nuevas las que se van a guardar
 * @param {{ tesoreria?: object[], excluir?: number[] }} [opts]
 * @returns {Promise<{ repetidos: object[], nombres: Record<string,string> }>}
 */
export async function repetidosEnBase(sesion, nuevas = [], { tesoreria = null, excluir = [] } = {}) {
  const e = sesion.empresa_id;
  const cajas = tesoreria || (await sbGetAll(`fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre`, { sesion, maxFilas: 1000 })).data || [];
  const enCaja = new Set(cajas.map((t) => t.cuenta));
  const nombres = Object.fromEntries(cajas.map((t) => [t.cuenta, t.nombre]));
  const cuentas = [...new Set(nuevas.flatMap((n) => cajasDeOperacion(n, enCaja)))];
  const rango = rangoRevision(nuevas);
  if (!cuentas.length || !rango) return { repetidos: [], nombres };
  const existentes = [];
  for (let i = 0; i < cuentas.length; i += 50) {
    const l = lista(cuentas.slice(i, i + 50));
    const r = await sbGetAll(
      `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=gte.${rango.desde}&fecha=lte.${rango.hasta}&or=(cuenta_debe.in.(${l}),cuenta_haber.in.(${l}))&select=${COLUMNAS}&order=fecha.asc,id.asc`,
      { sesion, maxFilas: 20000 },
    );
    existentes.push(...(r.data || []));
  }
  const unicas = [...new Map(existentes.map((o) => [o.id, o])).values()];
  return { repetidos: buscarRepetidos(nuevas, unicas, enCaja, { excluir }), nombres };
}

/** La respuesta 409 con los repetidos, o null si no hay. */
export function frenoRepetidos({ repetidos, nombres }) {
  if (!repetidos.length) return null;
  return NextResponse.json(respuestaRepetidos(repetidos, nombres), { status: 409 });
}
