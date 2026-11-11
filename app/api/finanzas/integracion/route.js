// /api/finanzas/integracion — Finanzas, parte 9 del plan del 11/11: Finanzas
// unida con Flota, Maquinaria y Stock (reglas en app/lib/finanzasIntegracion.js).
// Sin migración.
//
//   GET → los costos de mantenimiento de vehículos y máquinas de los últimos
//       12 meses que todavía no están en Finanzas (cada uno con el formulario
//       de gasto ya lleno) y el stock valorizado contra el saldo contable de
//       los bienes de cambio. Si la empresa no tiene Flota, Maquinaria o Stock,
//       esa parte viene vacía.
//   El gasto se carga con /api/finanzas/operaciones (accion "gasto" con
//   gasto.vinculo), que lo une al arreglo para que no se cargue dos veces.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGetAll } from "../../../lib/sbHelpers";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { ORIGEN_GASTO } from "../../../lib/finanzasGastos";
import { MESES_ATRAS, costosMantenimiento, gastoDeCosto, stockValorizado } from "../../../lib/finanzasIntegracion";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
// Sin el módulo (o sin su migración) la tabla no está: esa parte queda vacía
const leerSiHay = (sesion, path, maxFilas) => leer(sesion, path, maxFilas).catch(() => []);

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const hoy = hoyAr();
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - MESES_ATRAS);
  const desde = d.toISOString().slice(0, 10);
  try {
    const [mantenimientos, fallas, vehiculos, maquinas, gastos, tipos, proveedores, cuentas, articulos, opsStock] = await Promise.all([
      leerSiHay(sesion, `vehiculo_mantenimientos?empresa_id=eq.${e}&fecha=gte.${desde}&costo=gt.0&select=id,vehiculo_id,tipo,fecha,donde,taller,detalle,costo,factura_url&order=fecha.desc`),
      leerSiHay(sesion, `maquina_fallas?empresa_id=eq.${e}&estado=eq.resuelta&cerrado_at=gte.${desde}&costo=gt.0&select=id,maquina_id,descripcion,detalle,estado,costo,factura_url,cerrado_at,created_at&order=cerrado_at.desc`),
      leerSiHay(sesion, `vehiculos?empresa_id=eq.${e}&select=id,patente,marca,modelo`),
      leerSiHay(sesion, `maquinas?empresa_id=eq.${e}&select=id,codigo,nombre`),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_GASTO}&anulada_at=is.null&or=(origen_id.like.ga*,origen_id.like.gb*)&select=origen_id,total,total_ars,anulada_at`, 20000),
      leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,cuenta_debe,cuenta_haber,activo`),
      leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,activo`),
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
      leerSiHay(sesion, `articulos_stock?empresa_id=eq.${e}&activo=eq.true&stock=gt.0&select=sku,familia,division,stock,ultimo_precio,activo`, 20000),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.like.01.01.04*,cuenta_haber.like.01.01.04*)&select=cuenta_debe,cuenta_haber,total,total_ars,estado,anulada_at`, 200000),
    ]);
    const costos = costosMantenimiento({ mantenimientos, fallas, vehiculos, maquinas, ops: gastos });
    return NextResponse.json({
      hoy,
      mantenimiento: {
        ...costos,
        pendientes: costos.pendientes.map((p) => ({ ...p, inicial: gastoDeCosto(p, { tipos, proveedores }) })),
      },
      stock: articulos.length ? stockValorizado({ articulos, cuentas, ops: opsStock }) : null,
    });
  } catch (err) {
    return errorFinanzas(err, "integracion GET");
  }
}
