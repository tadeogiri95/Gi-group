// /api/finanzas/cierre — Finanzas, parte F6c: lo que tiene Gypi para
// compararlo con el libro (reglas en app/lib/finanzasCierre.js). Sin migración.
//
//   GET ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD → saldos de Gypi al día "hasta"
//       (cajas y bancos, proveedores, clientes) y las operaciones confirmadas
//       del período. Por defecto, el mes en curso hasta hoy. La comparación con
//       el libro la hace la pantalla, que lee el .xlsx en el navegador.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGetAll } from "../../../lib/sbHelpers";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { saldosTesoreria } from "../../../lib/finanzasTesoreria";
import { ORIGEN_SALDO_INICIAL, cuentasProveedores, saldosProveedores } from "../../../lib/finanzasProveedores";
import { cuentasDeudores, saldosClientes } from "../../../lib/finanzasClientes";

const COLUMNAS = "id,fecha,tipo,proveedor_id,cliente_id,entidad,total,moneda,total_ars,cuenta_debe,cuenta_haber,descripcion,origen,estado,anulada_at";
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const q = new URL(request.url).searchParams;
  const hoy = hoyAr();
  const hasta = FECHA.test(q.get("hasta") || "") ? q.get("hasta") : hoy;
  const desde = FECHA.test(q.get("desde") || "") && q.get("desde") <= hasta ? q.get("desde") : `${hasta.slice(0, 7)}-01`;
  try {
    const [ops, tesoreria, cuentas, proveedores, clientes, revisar] = await Promise.all([
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&estado=eq.confirmada&fecha=lte.${hasta}&select=${COLUMNAS}&order=fecha.asc,id.asc`, 300000),
      leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
      leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre&order=nombre.asc,id.asc`, 10000),
      leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=nombre.asc,id.asc`, 10000),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&estado=eq.para_revisar&fecha=gte.${desde}&fecha=lte.${hasta}&select=id`, 5000),
    ]);
    const prov = cuentasProveedores(cuentas);
    const deu = cuentasDeudores(cuentas);
    const corte = ops.filter((o) => o.origen === ORIGEN_SALDO_INICIAL).reduce((m, o) => (o.fecha > m ? o.fecha : m), "");
    return NextResponse.json({
      desde, hasta, hoy, corte: corte || null,
      cajas: saldosTesoreria(ops, tesoreria).map(({ cuenta, nombre, moneda, activa, saldo }) => ({ cuenta, nombre, moneda, activa, saldo })),
      proveedores: saldosProveedores(ops, prov, proveedores).map(({ clave, nombre, deuda }) => ({ clave, nombre, deuda })),
      clientes: saldosClientes(ops, deu, clientes).map(({ clave, nombre, saldo }) => ({ clave, nombre, saldo })),
      lista_proveedores: proveedores,
      lista_clientes: clientes,
      cuentas_proveedores: [...prov],
      cuentas_deudores: [...deu],
      nombres_cuentas: Object.fromEntries(cuentas.map((c) => [c.codigo, c.nombre])),
      operaciones: ops
        .filter((o) => o.origen !== ORIGEN_SALDO_INICIAL && o.fecha >= desde)
        .map(({ id, fecha, tipo, entidad, total, moneda, cuenta_debe, cuenta_haber, descripcion }) => ({ id, fecha, tipo, entidad, total, moneda, cuenta_debe, cuenta_haber, descripcion })),
      para_revisar: revisar.length,
    });
  } catch (err) {
    return errorFinanzas(err, "cierre GET");
  }
}
