// /api/finanzas/clientes — Finanzas, parte F4a (migración 177): clientes, su
// cuenta corriente y los cobros (reglas en app/lib/finanzasClientes.js).
//
//   GET → los clientes, las operaciones contra Deudores por Ventas (todas las
//       fechas), las cajas y bancos, las OT y el plan de cuentas. El saldo y
//       los movimientos los arma la pantalla.
//   POST { accion: "crear", cliente } / { accion: "editar", id, cliente, activo? }
//   POST { accion: "traer_de_ot" } → suma los clientes de las OT que faltan.
//   POST { accion: "unir", a, b } → b pasa a ser otro nombre de a (queda inactivo)
//       y sus operaciones pasan a a.
//   POST { accion: "cobrar", cliente_id, fecha, proyecto_id?, notas?, formas: [...] }
//       → las operaciones del cobro y los cheques recibidos (a la cartera).
//   POST { accion: "anular_cobro", grupo } → anula todo el cobro (no se borra);
//       no se puede si un cheque del cobro ya se depositó o entregó.
//   POST { accion: "saldos_iniciales", fecha, filas: [{ cliente_id?, nombre, saldo }] }
//       → el saldo de cada cliente a la fecha de corte contra Ajuste De Capital
//       (los que no están en la lista se crean). Reemplaza el anterior.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA } from "../../../lib/finanzasOperaciones";
import { CUENTA_AJUSTE_CAPITAL, ORIGEN_SALDO_INICIAL } from "../../../lib/finanzasProveedores";
import { operacionAlta } from "../../../lib/finanzasCheques";
import {
  ORIGEN_COBRO, armarCobro, clientesNuevosDeOt, cuentasDeudores, emparejarCliente, operacionSaldoInicialCliente, unirClientes, validarCliente,
} from "../../../lib/finanzasClientes";

const MAX_SALDOS = 2000;
const COLUMNAS = "id,fecha,tipo,proveedor_id,cliente_id,entidad,proyecto_id,centro_costo,neto,total,moneda,tipo_cambio,total_ars,cuenta_debe,cuenta_haber,descripcion,referencia,origen,origen_id,estado,cargada_por_nombre,anulada_at";
const COLS_CLIENTE = "id,nombre,cuit,telefono,email,notas,alias,activo,unido_a";
const FALTA_177 = "Para los clientes falta correr la migración 177 en Supabase.";
const falta177 = (err) => /fin_clientes|cliente_id/.test(String(err?.message)) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(String(err?.message));

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);
const lista = (codigos) => encodeURIComponent(codigos.map((c) => `"${String(c).replace(/"/g, "")}"`).join(","));

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`)) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

const leerClientes = (sesion) => leer(sesion, `fin_clientes?empresa_id=eq.${sesion.empresa_id}&select=${COLS_CLIENTE}&order=nombre.asc,id.asc`);
const leerCuentas = (sesion) => leer(sesion, `fin_cuentas?empresa_id=eq.${sesion.empresa_id}&select=codigo,nombre,activa&order=codigo.asc`);
const leerTesoreria = (sesion) => leer(sesion, `fin_tesoreria?empresa_id=eq.${sesion.empresa_id}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`);
const leerProyectos = (sesion) => leer(sesion, `proyectos?empresa_id=eq.${sesion.empresa_id}&select=id,ot,cliente,obra,descripcion,estado&order=id.desc`, 10000);

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const [cuentas, clientes, tesoreria, proyectos] = await Promise.all([leerCuentas(sesion), leerClientes(sesion), leerTesoreria(sesion), leerProyectos(sesion)]);
    const deu = [...cuentasDeudores(cuentas)];
    const operaciones = deu.length
      ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${lista(deu)}),cuenta_haber.in.(${lista(deu)}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, 60000)
      : [];
    return NextResponse.json({ cuentas, clientes, tesoreria, proyectos, operaciones, cuentas_deudores: deu });
  } catch (err) {
    if (falta177(err)) return NextResponse.json({ error: FALTA_177, falta_migracion: true }, { status: 409 });
    return errorFinanzas(err, "clientes GET");
  }
}

async function guardarCliente(sesion, d) {
  const e = sesion.empresa_id;
  const { cliente, errores } = validarCliente(d.cliente || {});
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const clientes = await leerClientes(sesion);
  const id = d.accion === "editar" ? Number(d.id) : null;
  if (d.accion === "editar" && !clientes.some((c) => Number(c.id) === id)) return NextResponse.json({ error: "No encontré ese cliente" }, { status: 404 });
  const otro = emparejarCliente(cliente.nombre, clientes.filter((c) => Number(c.id) !== id));
  if (otro && d.accion === "crear") return NextResponse.json({ error: `Ya está ${otro.nombre}: si es el mismo, unilos` }, { status: 409 });
  const ahora = new Date().toISOString();
  if (d.accion === "crear") {
    const [fila] = (await sbPost("fin_clientes", { ...cliente, empresa_id: e, created_at: ahora, updated_at: ahora }, { sesion })) || [];
    return NextResponse.json({ ok: true, cliente: fila });
  }
  const cambios = { ...cliente, updated_at: ahora };
  if (typeof d.activo === "boolean") cambios.activo = d.activo;
  const [fila] = (await sbPatch(`fin_clientes?id=eq.${id}&empresa_id=eq.${e}`, cambios, { sesion })) || [];
  return NextResponse.json({ ok: true, cliente: fila });
}

async function traerDeOt(sesion) {
  const e = sesion.empresa_id;
  const [clientes, proyectos] = await Promise.all([leerClientes(sesion), leerProyectos(sesion)]);
  const nuevos = clientesNuevosDeOt(proyectos, clientes);
  const ahora = new Date().toISOString();
  for (let i = 0; i < nuevos.length; i += 500) {
    await sbPost("fin_clientes", nuevos.slice(i, i + 500).map((nombre) => ({ empresa_id: e, nombre, created_at: ahora, updated_at: ahora })), { sesion });
  }
  return NextResponse.json({ ok: true, agregados: nuevos.length });
}

async function unir(sesion, d) {
  const e = sesion.empresa_id;
  const clientes = await leerClientes(sesion);
  const a = clientes.find((c) => Number(c.id) === Number(d.a));
  const b = clientes.find((c) => Number(c.id) === Number(d.b));
  if (!a || !b || a.id === b.id || a.activo === false || b.activo === false) return NextResponse.json({ error: "Elegí dos clientes distintos" }, { status: 400 });
  const { a: ca, b: cb } = unirClientes(a, b);
  const ahora = new Date().toISOString();
  await sbPatch(`fin_clientes?id=eq.${a.id}&empresa_id=eq.${e}`, { ...ca, updated_at: ahora }, { sesion });
  await sbPatch(`fin_clientes?id=eq.${b.id}&empresa_id=eq.${e}`, { ...cb, updated_at: ahora }, { sesion });
  await sbPatch(`fin_operaciones?empresa_id=eq.${e}&cliente_id=eq.${b.id}`, { cliente_id: a.id, updated_at: ahora }, { sesion });
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true });
}

async function cobrar(sesion, d) {
  const e = sesion.empresa_id;
  const [clientes, cuentas, tesoreria, proyectos] = await Promise.all([leerClientes(sesion), leerCuentas(sesion), leerTesoreria(sesion), leerProyectos(sesion)]);
  const cliente = clientes.find((c) => Number(c.id) === Number(d.cliente_id));
  const grupo = `cb${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const { ops, cheques, total, errores } = armarCobro(d, { cliente, cuentas, tesoreria, proyectos, grupo });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const fila = (x) => ({ ...x, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora });
  if (ops.length) await sbPost("fin_operaciones", ops.map(fila), { sesion });
  for (const { cheque, op } of cheques) {
    const [ch] = (await sbPost("fin_cheques", { ...cheque, empresa_id: e, origen: "manual", cargado_por_nombre: quien, created_at: ahora, updated_at: ahora }, { sesion })) || [];
    if (!ch?.id) continue;
    const { op: alta, error } = operacionAlta(ch, cuentas, d.fecha);
    if (error) {
      await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}`, { estado: "anulado", notas: "Anulado: faltaban cuentas en el plan", updated_at: ahora }, { sesion });
      return NextResponse.json({ error }, { status: 400 });
    }
    // Las cuentas del cheque, con los datos del cobro (cliente, OT, grupo)
    const [o] = (await sbPost("fin_operaciones", fila({ ...alta, ...op, cuenta_debe: alta.cuenta_debe, cuenta_haber: alta.cuenta_haber, neto: alta.neto, total: alta.total, moneda: "ARS", tipo_cambio: null, total_ars: alta.total_ars, referencia: alta.referencia }), { sesion })) || [];
    await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}`, { op_alta_id: o?.id || null, updated_at: ahora }, { sesion });
  }
  broadcastRefresh(e, "fin_operaciones");
  if (cheques.length) broadcastRefresh(e, "fin_cheques");
  return NextResponse.json({ ok: true, grupo, total });
}

async function anularCobro(sesion, d) {
  const e = sesion.empresa_id;
  const grupo = String(d.grupo || "");
  if (!/^cb[0-9a-f]{12}$/.test(grupo)) return NextResponse.json({ error: "Falta el cobro" }, { status: 400 });
  const ops = await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_COBRO}&anulada_at=is.null&origen_id=like.${grupo}:*&select=id`);
  if (!ops.length) return NextResponse.json({ error: "No encontré ese cobro o ya estaba anulado" }, { status: 404 });
  const ids = ops.map((o) => o.id).join(",");
  const cheques = await leer(sesion, `fin_cheques?empresa_id=eq.${e}&op_alta_id=in.(${ids})&select=id,estado,numero`);
  const usado = cheques.find((c) => c.estado !== "en_cartera" && c.estado !== "anulado");
  if (usado) return NextResponse.json({ error: `El cheque${usado.numero ? ` N° ${usado.numero}` : ""} de este cobro ya se depositó o se entregó: primero deshacé eso en Cheques` }, { status: 409 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  await sbPatch(`fin_operaciones?empresa_id=eq.${e}&id=in.(${ids})&anulada_at=is.null`, { anulada_at: ahora, anulada_por_nombre: quien, updated_at: ahora }, { sesion });
  if (cheques.length) {
    await sbPatch(`fin_cheques?empresa_id=eq.${e}&id=in.(${cheques.map((c) => c.id).join(",")})&estado=eq.en_cartera`, { estado: "anulado", estado_fecha: ahora.slice(0, 10), updated_at: ahora }, { sesion });
    broadcastRefresh(e, "fin_cheques");
  }
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true });
}

async function saldosIniciales(sesion, d) {
  const e = sesion.empresa_id;
  if (!FECHA.test(String(d.fecha || ""))) return NextResponse.json({ error: "Falta la fecha de corte" }, { status: 400 });
  const filas = Array.isArray(d.filas) ? d.filas : [];
  if (!filas.length) return NextResponse.json({ error: "No hay saldos para cargar" }, { status: 400 });
  if (filas.length > MAX_SALDOS) return NextResponse.json({ error: `Hasta ${MAX_SALDOS} clientes por vez` }, { status: 400 });
  const [cuentas, clientesAntes] = await Promise.all([leerCuentas(sesion), leerClientes(sesion)]);
  const cuentaDeudores = [...cuentasDeudores(cuentas)][0];
  const cuentaAjuste = cuentas.find((c) => CUENTA_AJUSTE_CAPITAL.test(String(c.nombre || "").trim()))?.codigo;
  if (!cuentaDeudores || !cuentaAjuste) return NextResponse.json({ error: "Faltan las cuentas \"Deudores por Ventas\" o \"Ajuste De Capital\" en el plan de cuentas: copiá el libro en Configuración." }, { status: 400 });
  const clientes = [...clientesAntes];
  const ahora = new Date().toISOString();
  // Cada fila va a un cliente de la lista; los que no están se crean
  const porCliente = new Map();
  for (const [i, f] of filas.entries()) {
    const saldo = Number(f?.saldo);
    if (!Number.isFinite(saldo) || Math.abs(saldo) < 0.01) continue;
    if (Math.abs(saldo) >= 1e13) return NextResponse.json({ error: `Fila ${i + 1}: el saldo es demasiado grande` }, { status: 400 });
    let cliente = f?.cliente_id ? clientes.find((c) => Number(c.id) === Number(f.cliente_id) && c.activo !== false) : emparejarCliente(f?.nombre, clientes);
    if (f?.cliente_id && !cliente) return NextResponse.json({ error: `Fila ${i + 1}: ese cliente no está en la lista` }, { status: 400 });
    if (!cliente) {
      const nombre = String(f?.nombre || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!nombre) return NextResponse.json({ error: `Fila ${i + 1}: falta el cliente` }, { status: 400 });
      [cliente] = (await sbPost("fin_clientes", { empresa_id: e, nombre, created_at: ahora, updated_at: ahora }, { sesion })) || [];
      if (!cliente) continue;
      clientes.push(cliente);
    }
    porCliente.set(cliente.id, { cliente, saldo: (porCliente.get(cliente.id)?.saldo || 0) + saldo });
  }
  const finales = [...porCliente.values()].filter((x) => Math.abs(x.saldo) >= 0.01)
    .map((x) => operacionSaldoInicialCliente({ fecha: d.fecha, cliente: x.cliente, saldo: x.saldo }, { cuentaDeudores, cuentaAjuste }));
  const claves = [...porCliente.keys()].map((id) => `"c${id}"`);
  for (let i = 0; i < claves.length; i += 100) {
    await sbPatch(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_SALDO_INICIAL}&anulada_at=is.null&cliente_id=not.is.null&origen_id=in.(${encodeURIComponent(claves.slice(i, i + 100).join(","))})`, {
      anulada_at: ahora, anulada_por_nombre: "Gypi (saldo inicial reemplazado)", updated_at: ahora,
    }, { sesion });
  }
  for (let i = 0; i < finales.length; i += 500) {
    await sbPost("fin_operaciones", finales.slice(i, i + 500).map((f) => ({ ...f, empresa_id: e, cargada_por_nombre: "Gypi (copiado del libro)", created_at: ahora, updated_at: ahora })), { sesion });
  }
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, cargados: finales.length, clientes_nuevos: clientes.length - clientesAntes.length });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!d || typeof d !== "object") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  try {
    if (d.accion === "crear" || d.accion === "editar") return await guardarCliente(sesion, d);
    if (d.accion === "traer_de_ot") return await traerDeOt(sesion);
    if (d.accion === "unir") return await unir(sesion, d);
    if (d.accion === "cobrar") return await cobrar(sesion, d);
    if (d.accion === "anular_cobro") return await anularCobro(sesion, d);
    if (d.accion === "saldos_iniciales") return await saldosIniciales(sesion, d);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    if (falta177(err)) return NextResponse.json({ error: FALTA_177, falta_migracion: true }, { status: 409 });
    return errorFinanzas(err, `clientes ${d.accion}`);
  }
}
