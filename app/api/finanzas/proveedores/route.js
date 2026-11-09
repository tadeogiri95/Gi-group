// /api/finanzas/proveedores — Finanzas, parte F2a (2): cuenta corriente de
// proveedores (reglas en app/lib/finanzasProveedores.js). Sin migración.
//
//   GET → las operaciones que tocan la cuenta Proveedores (todas las fechas),
//       la lista de proveedores y el plan de cuentas. El saldo, los
//       movimientos y lo pendiente los arma la pantalla.
//   POST { accion: "saldos_iniciales", fecha, filas: [{ proveedor_id?, nombre, deuda }] }
//       → carga el saldo de cada proveedor a la fecha de corte, contra Ajuste
//       De Capital. Si ya tenía un saldo inicial, se reemplaza (el viejo queda anulado).
//   POST { accion: "cuentas", cuentas: { "p12": "04.02…" } } → la cuenta de
//       cada proveedor (parte 3), en config_sistema.
//   POST { accion: "compra", clase: "sin_factura"|"nota_credito", fecha,
//       proveedor_id, importe, iva?, numero?, cuenta, descripcion? } → una
//       compra sin factura o una nota de crédito del proveedor.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA, IVA_CREDITO } from "../../../lib/finanzasOperaciones";
import {
  CLAVE_CUENTAS_PROV, CUENTA_AJUSTE_CAPITAL, ORIGEN_SALDO_INICIAL, cuentasProveedores, leerCuentasProveedores, operacionCompraManual, operacionSaldoInicial,
} from "../../../lib/finanzasProveedores";

const MAX_SALDOS = 2000;
const COLUMNAS = "id,fecha,tipo,proveedor_id,entidad,proyecto_id,neto,iva,otros_impuestos,total,moneda,tipo_cambio,total_ars,cuenta_debe,cuenta_haber,descripcion,referencia,origen,origen_id,estado,anulada_at";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);
const filtroConfig = (e) => `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CUENTAS_PROV}`;
const leerGuardadas = async (e) => leerCuentasProveedores((await sbGet(`${filtroConfig(e)}&select=valor&limit=1`, { silent: true, fallback: [] }))?.[0]?.valor);

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

/** La cuenta de cada proveedor: solo códigos del plan, de proveedores que existen. */
async function guardarCuentas(sesion, d) {
  const e = sesion.empresa_id;
  const pedido = d?.cuentas && typeof d.cuentas === "object" ? d.cuentas : {};
  const [cuentas, proveedores, antes] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id`, 10000),
    leerGuardadas(e),
  ]);
  const codigos = new Set(cuentas.map((c) => c.codigo));
  const prov = cuentasProveedores(cuentas);
  const ids = new Set(proveedores.map((p) => `p${p.id}`));
  const nuevas = { ...antes };
  for (const [k, v] of Object.entries(pedido).slice(0, 5000)) {
    if (!ids.has(k)) continue;
    if (v === null || v === "") { delete nuevas[k]; continue; }
    if (!codigos.has(String(v)) || prov.has(String(v))) return NextResponse.json({ error: `La cuenta ${v} no sirve: elegí una del plan de cuentas que no sea Proveedores` }, { status: 400 });
    nuevas[k] = String(v);
  }
  const valor = { cuentas: nuevas, actualizado_at: new Date().toISOString() };
  const [ya] = (await sbGet(`${filtroConfig(e)}&select=clave&limit=1`, { silent: true, fallback: [] })) || [];
  if (ya) await sbPatch(filtroConfig(e), { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_CUENTAS_PROV, valor });
  return NextResponse.json({ ok: true, cuentas: Object.keys(nuevas).length });
}

/** Compra sin factura o nota de crédito del proveedor. */
async function cargarCompra(sesion, d) {
  const e = sesion.empresa_id;
  const [cuentas, proveedores] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id`, 10000),
  ]);
  const cuentaProveedores = [...cuentasProveedores(cuentas)][0];
  if (!cuentaProveedores) return NextResponse.json({ error: "Falta la cuenta \"Proveedores\" en el plan de cuentas" }, { status: 400 });
  const ivaCredito = cuentas.find((c) => IVA_CREDITO.test(String(c.nombre || "").trim()))?.codigo || null;
  const r = operacionCompraManual(d, {
    cuentaProveedores, ivaCredito,
    codigos: new Set(cuentas.filter((c) => c.activa !== false).map((c) => c.codigo)),
    proveedores: new Set(proveedores.map((p) => Number(p.id))),
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  const ahora = new Date().toISOString();
  const [op] = (await sbPost("fin_operaciones", {
    ...r.op, empresa_id: e, origen_id: `cm${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    cargada_por_nombre: await nombreEmpleado(sesion), created_at: ahora, updated_at: ahora,
  }, { sesion })) || [];
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, id: op?.id || null });
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const [cuentas, proveedores] = await Promise.all([
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
      leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,activo,fin_tipo&order=nombre.asc,id.asc`),
    ]);
    const prov = [...cuentasProveedores(cuentas)];
    const operaciones = prov.length
      ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${prov.join(",")}),cuenta_haber.in.(${prov.join(",")}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, 50000)
      : [];
    return NextResponse.json({ cuentas, proveedores, operaciones, cuentas_proveedores: prov, cuentas_guardadas: await leerGuardadas(e) });
  } catch (err) {
    return errorFinanzas(err, "proveedores GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  try {
    if (d?.accion === "cuentas") return await guardarCuentas(sesion, d);
    if (d?.accion === "compra") return await cargarCompra(sesion, d);
  } catch (err) {
    return errorFinanzas(err, `proveedores ${d.accion}`);
  }
  if (!d || d.accion !== "saldos_iniciales") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const e = sesion.empresa_id;
  if (!FECHA.test(String(d.fecha || ""))) return NextResponse.json({ error: "Falta la fecha de corte" }, { status: 400 });
  const lista = Array.isArray(d.filas) ? d.filas : [];
  if (!lista.length) return NextResponse.json({ error: "No hay saldos para cargar" }, { status: 400 });
  if (lista.length > MAX_SALDOS) return NextResponse.json({ error: `Hasta ${MAX_SALDOS} proveedores por vez` }, { status: 400 });
  try {
    const [cuentas, proveedores] = await Promise.all([
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
      leer(sesion, `proveedores?empresa_id=eq.${e}&select=id`),
    ]);
    const cuentaProveedores = [...cuentasProveedores(cuentas)][0];
    const cuentaAjuste = cuentas.find((c) => CUENTA_AJUSTE_CAPITAL.test(String(c.nombre || "").trim()))?.codigo;
    if (!cuentaProveedores || !cuentaAjuste) {
      return NextResponse.json({ error: "Faltan las cuentas \"Proveedores\" o \"Ajuste De Capital\" en el plan de cuentas: copiá el libro en Configuración." }, { status: 400 });
    }
    const ids = new Set(proveedores.map((p) => Number(p.id)));
    const filas = [];
    for (const [i, f] of lista.entries()) {
      const deuda = Number(f?.deuda);
      const proveedorId = f?.proveedor_id ? Number(f.proveedor_id) : null;
      const nombre = String(f?.nombre || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!Number.isFinite(deuda) || Math.abs(deuda) < 0.01) continue;
      if (Math.abs(deuda) >= 1e13) return NextResponse.json({ error: `Fila ${i + 1}: el saldo es demasiado grande` }, { status: 400 });
      if (proveedorId && !ids.has(proveedorId)) return NextResponse.json({ error: `Fila ${i + 1}: ese proveedor no está en la lista` }, { status: 400 });
      if (!proveedorId && !nombre) return NextResponse.json({ error: `Fila ${i + 1}: falta el proveedor` }, { status: 400 });
      filas.push(operacionSaldoInicial({ fecha: d.fecha, proveedor_id: proveedorId, nombre, deuda }, { cuentaProveedores, cuentaAjuste }));
    }
    // Dos nombres del libro que van al mismo proveedor de Gypi: un solo saldo
    const unidos = new Map();
    for (const f of filas) {
      const ya = unidos.get(f.origen_id);
      if (!ya) { unidos.set(f.origen_id, f); continue; }
      const deuda = (ya.cuenta_haber === cuentaProveedores ? ya.total : -ya.total) + (f.cuenta_haber === cuentaProveedores ? f.total : -f.total);
      unidos.set(f.origen_id, operacionSaldoInicial({ fecha: d.fecha, proveedor_id: f.proveedor_id, nombre: f.entidad, deuda }, { cuentaProveedores, cuentaAjuste }));
    }
    const finales = [...unidos.values()].filter((f) => f.total >= 0.01);
    const ahora = new Date().toISOString();
    // El saldo inicial anterior de cada uno queda anulado (no se borra)
    const claves = finales.map((f) => `"${f.origen_id.replace(/"/g, "")}"`);
    for (let i = 0; i < claves.length; i += 100) {
      await sbPatch(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_SALDO_INICIAL}&anulada_at=is.null&origen_id=in.(${encodeURIComponent(claves.slice(i, i + 100).join(","))})`, {
        anulada_at: ahora, anulada_por_nombre: "Gypi (saldo inicial reemplazado)", updated_at: ahora,
      }, { sesion });
    }
    for (let i = 0; i < finales.length; i += 500) {
      await sbPost("fin_operaciones", finales.slice(i, i + 500).map((f) => ({ ...f, empresa_id: e, cargada_por_nombre: "Gypi (copiado del libro)", created_at: ahora, updated_at: ahora })), { sesion });
    }
    broadcastRefresh(e, "fin_operaciones");
    return NextResponse.json({ ok: true, cargados: finales.length });
  } catch (err) {
    return errorFinanzas(err, "proveedores saldos_iniciales");
  }
}
