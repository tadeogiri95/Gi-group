// /api/finanzas/unificados — Finanzas, parte 5: cliente que también es
// proveedor (reglas en app/lib/finanzasUnificados.js). Sin migración.
//
//   GET → los clientes unidos con un proveedor, con lo que nos debe, lo que le
//       debemos y el neto; las uniones que sugiere Gypi (mismo CUIT o nombre);
//       y las listas de clientes y proveedores para unir a mano.
//   POST { accion: "unir", cliente_id, proveedor_id }
//   POST { accion: "separar", cliente_id }
//   POST { accion: "compensar", cliente_id, fecha, importe, descripcion? }
//       → una operación Proveedores al debe / Deudores por Ventas al haber.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { cuentasDeudores } from "../../../lib/finanzasClientes";
import { cuentasProveedores } from "../../../lib/finanzasProveedores";
import { CLAVE_UNIFICADOS, cuentasUnificadas, leerPares, operacionCompensacion, sugerirPares } from "../../../lib/finanzasUnificados";

const COLUMNAS = "id,fecha,proveedor_id,cliente_id,entidad,total_ars,cuenta_debe,cuenta_haber,anulada_at";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const filtroConfig = (e) => `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_UNIFICADOS}`;

async function leerTodo(sesion) {
  const e = sesion.empresa_id;
  const [cuentas, clientes, proveedores, cfg] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
    leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,cuit,alias,activo,unido_a&order=nombre.asc,id.asc`, 10000),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,cuit,activo&order=nombre.asc,id.asc`, 10000),
    sbGet(`${filtroConfig(e)}&select=valor&limit=1`, { silent: true, fallback: [] }),
  ]);
  const cuentasDeu = cuentasDeudores(cuentas);
  const cuentasProv = cuentasProveedores(cuentas);
  const pares = leerPares(cfg?.[0]?.valor).filter((p) => clientes.some((c) => Number(c.id) === p.cliente_id) && proveedores.some((x) => Number(x.id) === p.proveedor_id));
  const lado = [...cuentasDeu, ...cuentasProv];
  // Lo que toca Deudores por Ventas o Proveedores (los nombres escritos sin id también cuentan)
  const ops = pares.length && lado.length
    ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${lado.join(",")}),cuenta_haber.in.(${lado.join(",")}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, 100000)
    : [];
  const unificadas = cuentasUnificadas(pares, { ops, clientes, proveedores, cuentasDeu, cuentasProv });
  return { clientes, proveedores, pares, unificadas, cuentaDeudores: [...cuentasDeu][0] || null, cuentaProveedores: [...cuentasProv][0] || null, existe: Boolean(cfg?.[0]) };
}

async function guardarPares(e, pares, existe) {
  const valor = { pares, actualizado_at: new Date().toISOString() };
  if (existe) await sbPatch(filtroConfig(e), { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_UNIFICADOS, valor });
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  try {
    const d = await leerTodo(sesion);
    return NextResponse.json({
      unificadas: d.unificadas,
      sugeridas: sugerirPares(d.clientes, d.proveedores, d.pares),
      clientes: d.clientes.filter((c) => !c.unido_a && c.activo !== false).map((c) => ({ id: c.id, nombre: c.nombre })),
      proveedores: d.proveedores.filter((p) => p.activo !== false).map((p) => ({ id: p.id, nombre: p.nombre })),
    });
  } catch (err) {
    return errorFinanzas(err, "unificados GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!["unir", "separar", "compensar"].includes(d?.accion)) return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const e = sesion.empresa_id;
  const clienteId = Number(d.cliente_id);
  try {
    const datos = await leerTodo(sesion);
    if (d.accion === "unir") {
      const proveedorId = Number(d.proveedor_id);
      const c = datos.clientes.find((x) => Number(x.id) === clienteId && !x.unido_a);
      const p = datos.proveedores.find((x) => Number(x.id) === proveedorId);
      if (!c || !p) return NextResponse.json({ error: "Elegí un cliente y un proveedor de la lista" }, { status: 400 });
      const otro = datos.pares.find((x) => x.proveedor_id === proveedorId && x.cliente_id !== clienteId);
      if (otro) return NextResponse.json({ error: `${p.nombre} ya está unido con otro cliente` }, { status: 409 });
      const pares = [...datos.pares.filter((x) => x.cliente_id !== clienteId), { cliente_id: clienteId, proveedor_id: proveedorId }];
      await guardarPares(e, pares, datos.existe);
      return NextResponse.json({ ok: true });
    }
    if (d.accion === "separar") {
      if (!datos.pares.some((x) => x.cliente_id === clienteId)) return NextResponse.json({ error: "Ese cliente no está unido" }, { status: 400 });
      await guardarPares(e, datos.pares.filter((x) => x.cliente_id !== clienteId), datos.existe);
      return NextResponse.json({ ok: true });
    }
    const cuenta = datos.unificadas.find((x) => x.cliente_id === clienteId);
    const r = operacionCompensacion(d, { cuenta, cuentaDeudores: datos.cuentaDeudores, cuentaProveedores: datos.cuentaProveedores });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    const ahora = new Date().toISOString();
    await sbPost("fin_operaciones", {
      ...r.op, empresa_id: e, origen_id: `cp${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      cargada_por_nombre: "Gypi (compensación)", created_at: ahora, updated_at: ahora,
    }, { sesion });
    broadcastRefresh(e, "fin_operaciones");
    return NextResponse.json({ ok: true, importe: r.op.total });
  } catch (err) {
    return errorFinanzas(err, `unificados ${d.accion}`);
  }
}
