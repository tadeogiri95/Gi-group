// /api/finanzas/mayor — Finanzas → 📚 Mayor de cuentas (13/11, pedido de
// Tadeo; reglas en app/lib/finanzasMayor.js). Sin migración: sale de
// fin_operaciones.
//
//   GET [?hasta=AAAA-MM-DD] → sumas y saldos de todas las cuentas a esa fecha
//       (por defecto, hoy) y las listas para cargar un asiento.
//   GET ?cuenta=X&desde=&hasta= → además, el mayor de esa cuenta (con las de
//       abajo) en el período: saldo de apertura y cada movimiento con su saldo.
//
// Los asientos se guardan con /api/finanzas/operaciones (accion "crear"), con
// los mismos controles que cualquier operación. Solo el rol Dueño, con el pase
// del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGetAll } from "../../../lib/sbHelpers";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA, hoyAr, inicioMes } from "../../../lib/finanzasOperaciones";
import { listasFinanzas } from "../../../lib/finanzasListas";
import { movimientosDeCuenta, sumasYSaldos } from "../../../lib/finanzasMayor";

export const maxDuration = 60;

const MINIMAS = "id,fecha,tipo,neto,iva,otros_impuestos,total,total_ars,moneda,tipo_cambio,cuenta_debe,cuenta_haber,anulada_at";
const COMPLETAS = "id,fecha,tipo,proveedor_id,cliente_id,entidad,proyecto_id,centro_costo,neto,iva,otros_impuestos,total,moneda,tipo_cambio,total_ars,cuenta_debe,cuenta_haber,descripcion,referencia,origen,origen_id,estado,cargada_por_nombre,anulada_at,anulada_por_nombre,created_at";
/** Cuántos movimientos se muestran como mucho en el mayor de una cuenta (los más nuevos). */
const MAX_RENGLONES = 1500;

async function completas(sesion, ids) {
  const e = sesion.empresa_id;
  const out = [];
  for (let i = 0; i < ids.length; i += 150) {
    const path = (cols) => `fin_operaciones?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + 150).join(",")})&select=${cols}`;
    // Con los comprobantes (176 y 187); sin las migraciones, sin ellos
    const r = await sbGetAll(path(`${COMPLETAS},comprobante_url,comprobantes`), { sesion, maxFilas: 1000 })
      .catch((err) => {
        if (!/comprobante/.test(String(err?.message))) throw err;
        return sbGetAll(path(COMPLETAS), { sesion, maxFilas: 1000 });
      });
    out.push(...(r.data || []));
  }
  return new Map(out.map((o) => [Number(o.id), o]));
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const q = new URL(request.url).searchParams;
  const hoy = hoyAr();
  const hasta = FECHA.test(q.get("hasta") || "") ? q.get("hasta") : hoy;
  const cuenta = String(q.get("cuenta") || "").trim().slice(0, 40);
  const desde = FECHA.test(q.get("desde") || "") ? q.get("desde") : inicioMes(hasta);
  if (cuenta && desde > hasta) return NextResponse.json({ error: "La fecha desde es posterior a la fecha hasta" }, { status: 400 });
  try {
    const [ops, listas] = await Promise.all([
      sbGetAll(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=lte.${hasta}&select=${MINIMAS}&order=fecha.asc,id.asc`, { sesion, maxFilas: 200000 }),
      listasFinanzas(sesion),
    ]);
    const ctx = { cuentas: listas.cuentas || [], tipos: listas.tipos || [] };
    const saldos = sumasYSaldos(ops.data || [], { ...ctx, hasta });
    const base = { hasta, saldos, truncado: !!ops.truncado, ...listas };
    if (!cuenta) return NextResponse.json(base);
    const mayor = movimientosDeCuenta(ops.data || [], cuenta, { ...ctx, desde, hasta });
    const recortado = mayor.renglones.length > MAX_RENGLONES;
    const renglones = recortado ? mayor.renglones.slice(-MAX_RENGLONES) : mayor.renglones;
    const filas = await completas(sesion, renglones.map((r) => Number(r.op.id)));
    return NextResponse.json({
      ...base,
      mayor: {
        ...mayor,
        cuenta,
        desde,
        recortado,
        renglones: renglones.map((r) => ({ ...r, op: filas.get(Number(r.op.id)) || r.op })),
      },
    });
  } catch (err) {
    return errorFinanzas(err, "mayor GET");
  }
}
