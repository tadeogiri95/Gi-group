// app/lib/finanzasAjusteSaldoServidor.js — El ajuste de saldo de un cliente
// o un proveedor del lado del servidor (punto 15; reglas en
// finanzasAjusteSaldo.js). El saldo de hoy lo calcula el servidor (no se usa
// el que manda la pantalla) y, si falta la cuenta del ajuste, la crea.
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPost } from "./sbHelpers";
import { broadcastRefresh } from "./broadcast";
import { cuentasDeudores, saldosClientes } from "./finanzasClientes";
import { cuentasProveedores, saldosProveedores } from "./finanzasProveedores";
import { cuentaAjusteAnteriores, cuentaAjusteNueva, operacionAjusteSaldo } from "./finanzasAjusteSaldo";

const COLS = "id,fecha,proveedor_id,cliente_id,entidad,total,total_ars,cuenta_debe,cuenta_haber,anulada_at";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const lista = (codigos) => encodeURIComponent(codigos.map((c) => `"${String(c).replace(/"/g, "")}"`).join(","));

/** La cuenta del ajuste: la del plan o, si no está, una nueva en 03.03.01. */
async function cuentaDelAjuste(sesion, cuentas) {
  const ya = cuentaAjusteAnteriores(cuentas);
  if (ya) return { codigo: ya, creada: false };
  const nueva = cuentaAjusteNueva(cuentas);
  const ahora = new Date().toISOString();
  await sbPost("fin_cuentas", { ...nueva, empresa_id: sesion.empresa_id, created_at: ahora, updated_at: ahora }, { sesion });
  broadcastRefresh(sesion.empresa_id, "fin_cuentas");
  return { codigo: nueva.codigo, creada: true };
}

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

/**
 * POST { accion: "ajuste_saldo", clave, saldo_nuevo, fecha, motivo }.
 * @param {"cliente"|"proveedor"} lado
 */
export async function ajustarSaldo(sesion, d, lado) {
  const e = sesion.empresa_id;
  const cliente = lado === "cliente";
  const cuentas = await leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`);
  const cc = [...(cliente ? cuentasDeudores(cuentas) : cuentasProveedores(cuentas))];
  if (!cc.length) return NextResponse.json({ error: cliente ? "Falta la cuenta \"Deudores por Ventas\" en el plan de cuentas" : "Falta la cuenta \"Proveedores\" en el plan de cuentas" }, { status: 400 });
  const [ops, personas] = await Promise.all([
    leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${lista(cc)}),cuenta_haber.in.(${lista(cc)}))&select=${COLS}`, 60000),
    cliente
      ? leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a`)
      : leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,activo`),
  ]);
  const ccSet = new Set(cc);
  const saldos = cliente ? saldosClientes(ops, ccSet, personas) : saldosProveedores(ops, ccSet, personas);
  const clave = String(d.clave || "");
  const fila = saldos.find((s) => s.clave === clave);
  if (!fila) return NextResponse.json({ error: cliente ? "No encontré ese cliente" : "No encontré ese proveedor" }, { status: 404 });
  const saldoActual = cliente ? fila.saldo : fila.deuda;
  // Primero se valida todo; la cuenta se crea solo si el ajuste va
  const previa = operacionAjusteSaldo({ lado, clave, nombre: fila.nombre, saldoActual, saldoNuevo: d.saldo_nuevo, fecha: d.fecha, motivo: d.motivo }, { cuentaCc: cc[0], cuentaAjuste: "x" });
  if (previa.error) return NextResponse.json({ error: previa.error }, { status: 400 });
  const cuenta = await cuentaDelAjuste(sesion, cuentas);
  const { op, diferencia } = operacionAjusteSaldo({ lado, clave, nombre: fila.nombre, saldoActual, saldoNuevo: d.saldo_nuevo, fecha: d.fecha, motivo: d.motivo }, { cuentaCc: cc[0], cuentaAjuste: cuenta.codigo });
  const ahora = new Date().toISOString();
  const [guardada] = (await sbPost("fin_operaciones", { ...op, empresa_id: e, cargada_por_nombre: await nombreEmpleado(sesion), created_at: ahora, updated_at: ahora }, { sesion })) || [];
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, operacion: guardada || null, diferencia, saldo_antes: saldoActual, cuenta_creada: cuenta.creada ? cuenta.codigo : null });
}
