// /api/finanzas/reporte — Finanzas → 📑 Reporte financiero (mejoras del 09/11,
// parte E; reglas en app/lib/finanzasReporte.js). Sin migración.
//
//   GET ?tipo=semana|mes&fecha=AAAA-MM-DD → el reporte de la semana (lunes a
//       domingo) o del mes de esa fecha; ?tipo=rango&fecha=desde&hasta=AAAA-MM-DD
//       entre dos fechas (hasta 12 meses; 11/11): resultados, flujo de caja, posición
//       de fondos, valores a cobrar y a pagar, cuentas a cobrar y a pagar.
//       Se arma en el momento; no guarda nada.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll } from "../../../lib/sbHelpers";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { CLAVE_RESULTADOS, configResultados } from "../../../lib/finanzasResultados";
import { CLAVE_FLUJO, validarLineasFlujo } from "../../../lib/finanzasFlujo";
import { errorPeriodo, periodoReporte, reporteFinanciero } from "../../../lib/finanzasReporte";

const COLUMNAS = "id,fecha,tipo,proveedor_id,cliente_id,entidad,proyecto_id,centro_costo,neto,total,total_ars,moneda,cuenta_debe,cuenta_haber,estado,origen,origen_id,anulada_at";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const config = async (e, clave) => (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${clave}&select=valor&limit=1`, { silent: true, fallback: [] }))?.[0]?.valor || null;

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const q = new URL(request.url).searchParams;
  const hoy = hoyAr();
  const tipo = q.get("tipo") || "mes";
  const fecha = q.get("fecha") || hoy;
  const hasta = q.get("hasta") || "";
  const periodo = periodoReporte(tipo, fecha, hasta);
  if (!periodo) return NextResponse.json({ error: tipo === "rango" ? errorPeriodo(fecha, hasta) || "Elegí las dos fechas" : "Elegí semana, mes o entre fechas y una fecha" }, { status: 400 });
  try {
    const [ops, cuentas, tesoreria, proyectos, centros, cfgRes, cfgFlujo, cheques, clientes, proveedores, empresas] = await Promise.all([
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=lte.${periodo.hasta}&select=${COLUMNAS}&order=fecha.asc,id.asc`, 300000),
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,linea_eerr,activa&order=codigo.asc`),
      leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
      leer(sesion, `proyectos?empresa_id=eq.${e}&select=id,division`, 20000),
      leer(sesion, `fin_centros_costo?empresa_id=eq.${e}&select=codigo,division`).catch(() => []),
      config(e, CLAVE_RESULTADOS),
      config(e, CLAVE_FLUJO),
      leer(sesion, `fin_cheques?empresa_id=eq.${e}&estado=in.(pendiente,en_cartera)&select=clase,tipo,estado,fecha_pago,importe,banco,numero,librador,beneficiario`, 20000).catch(() => []),
      leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=id.asc`, 10000).catch(() => []),
      leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre&order=id.asc`, 10000),
      sbGet(`empresa?id=eq.${e}&select=nombre&limit=1`, { silent: true, fallback: [] }),
    ]);
    const reporte = reporteFinanciero({
      tipo, fecha, hasta, ops, cuentas, tesoreria, proyectos, centros, lineas: validarLineasFlujo(cfgFlujo || {}),
      materialesPct: configResultados(cfgRes).materiales_pct, cheques, clientes, proveedores, hoy,
    });
    return NextResponse.json({ ...reporte, empresa: empresas?.[0]?.nombre || "" });
  } catch (err) {
    return errorFinanzas(err, "reporte GET");
  }
}
