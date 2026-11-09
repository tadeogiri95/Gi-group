// /api/finanzas/operaciones — Finanzas, parte F1b: Movimientos
// (fin_operaciones, migración 171; reglas en app/lib/finanzasOperaciones.js).
//
//   GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → operaciones del período (por
//       defecto el mes en curso) y las listas para cargar una nueva: tipos,
//       cuentas, cajas y bancos, centros de costo, proveedores y OT.
//   POST { accion: "crear", operacion } → valida (cuentas, caja, dólares, lo
//       que pide el tipo) y la guarda.
//   POST { accion: "anular", id } → la marca anulada con quién y cuándo. No se borra.
//       Solo las cargadas a mano: las de una factura se anulan con la factura.
//   POST { accion: "cambiar_tipo", id, tipo, recordar } → cambia el tipo (y las
//       cuentas) de una compra que salió de una factura; con recordar, queda
//       como tipo del proveedor para las próximas (F2a, migración 172).
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA, MAX_OPERACIONES, hoyAr, inicioMes, validarOperacion } from "../../../lib/finanzasOperaciones";

const COLUMNAS = "id,fecha,tipo,proveedor_id,entidad,proyecto_id,centro_costo,neto,iva,otros_impuestos,total,moneda,tipo_cambio,total_ars,cuenta_debe,cuenta_haber,descripcion,referencia,origen,estado,cargada_por_nombre,anulada_at,anulada_por_nombre,created_at";

async function listas(sesion) {
  const e = sesion.empresa_id;
  const leer = (path) => sbGetAll(path, { sesion, maxFilas: 5000 }).then((r) => r.data);
  const [tipos, cuentas, tesoreria, centros, proveedores, proyectos] = await Promise.all([
    leer(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,pide_entidad,pide_ot,pide_cc,descripcion,activo&order=codigo.asc`),
    leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,activa&order=codigo.asc`),
    leer(`fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=cuenta.asc`),
    leer(`fin_centros_costo?empresa_id=eq.${e}&select=codigo,nombre,division,activo&order=codigo.asc`),
    leer(`proveedores?empresa_id=eq.${e}&select=id,nombre,activo&order=nombre.asc,id.asc`),
    leer(`proyectos?empresa_id=eq.${e}&select=id,ot,cliente,obra,descripcion,estado&order=id.desc`),
  ]);
  return { tipos, cuentas, tesoreria, centros, proveedores, proyectos };
}

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const url = new URL(request.url);
  const hoy = hoyAr();
  const desde = FECHA.test(url.searchParams.get("desde") || "") ? url.searchParams.get("desde") : inicioMes(hoy);
  const hasta = FECHA.test(url.searchParams.get("hasta") || "") ? url.searchParams.get("hasta") : hoy;
  if (desde > hasta) return NextResponse.json({ error: "La fecha desde es posterior a la fecha hasta" }, { status: 400 });
  try {
    const e = sesion.empresa_id;
    const [ops, datos] = await Promise.all([
      sbGetAll(`fin_operaciones?empresa_id=eq.${e}&fecha=gte.${desde}&fecha=lte.${hasta}&select=${COLUMNAS}&order=fecha.desc,id.desc`, { sesion, maxFilas: MAX_OPERACIONES }),
      listas(sesion),
    ]);
    return NextResponse.json({ desde, hasta, operaciones: ops.data, truncado: ops.truncado, ...datos });
  } catch (err) {
    return errorFinanzas(err, "operaciones GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!d || typeof d !== "object") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  const e = sesion.empresa_id;
  try {
    if (d.accion === "crear") {
      const { op, errores } = validarOperacion(d.operacion, await listas(sesion));
      if (errores.length) return NextResponse.json({ error: errores.join(" "), errores }, { status: 400 });
      const ahora = new Date().toISOString();
      const [fila] = await sbPost("fin_operaciones", {
        ...op, empresa_id: e, cargada_por_nombre: await nombreEmpleado(sesion), created_at: ahora, updated_at: ahora,
      }, { sesion });
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true, operacion: fila });
    }
    if (d.accion === "anular") {
      const id = Number(d.id);
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta la operación" }, { status: 400 });
      const ahora = new Date().toISOString();
      // Las que salieron de una factura se anulan solas al anular la factura
      const filas = await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null&origen=eq.manual`, {
        anulada_at: ahora, anulada_por_nombre: await nombreEmpleado(sesion), updated_at: ahora,
      }, { sesion });
      if (!filas?.length) return NextResponse.json({ error: "No encontré esa operación, ya estaba anulada o salió de una factura (se anula anulando la factura)" }, { status: 404 });
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true, operacion: filas[0] });
    }
    if (d.accion === "cambiar_tipo") {
      // Compra que salió sola de una factura (F2a): el dueño elige el tipo y Gypi lo recuerda para el proveedor
      const id = Number(d.id);
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta la operación" }, { status: 400 });
      const [op] = (await sbGet(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null&select=id,origen,proveedor_id&limit=1`, { sesion })) || [];
      if (!op) return NextResponse.json({ error: "No encontré esa operación o está anulada" }, { status: 404 });
      const [tipo] = (await sbGet(`fin_tipos_operacion?empresa_id=eq.${e}&codigo=eq.${encodeURIComponent(String(d.tipo || ""))}&select=codigo,cuenta_debe,cuenta_haber,activo&limit=1`, { sesion })) || [];
      if (!tipo || tipo.activo === false) return NextResponse.json({ error: "Ese tipo de operación no existe o está desactivado" }, { status: 400 });
      if (!tipo.cuenta_debe || !tipo.cuenta_haber) return NextResponse.json({ error: `${tipo.codigo} no tiene cuentas por defecto: completalas en Configuración` }, { status: 400 });
      const [fila] = (await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}`, {
        tipo: tipo.codigo, cuenta_debe: tipo.cuenta_debe, cuenta_haber: tipo.cuenta_haber, estado: "confirmada", updated_at: new Date().toISOString(),
      }, { sesion })) || [];
      if (d.recordar && op.proveedor_id) {
        await sbPatch(`proveedores?id=eq.${op.proveedor_id}&empresa_id=eq.${e}`, { fin_tipo: tipo.codigo }, { sesion });
      }
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true, operacion: fila });
    }
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return errorFinanzas(err, `operaciones ${d.accion}`);
  }
}
