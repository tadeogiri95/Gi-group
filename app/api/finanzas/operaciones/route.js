// /api/finanzas/operaciones — Finanzas, parte F1b: Movimientos
// (fin_operaciones, migración 171; reglas en app/lib/finanzasOperaciones.js).
//
//   GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → operaciones del período (por
//       defecto el mes en curso) y las listas para cargar una nueva: tipos,
//       cuentas, cajas y bancos, centros de costo, proveedores y OT.
//   POST { accion: "crear", operacion, confirmar_repetido? } → valida (cuentas,
//       caja, dólares, lo que pide el tipo) y la guarda. Si en la misma caja ya
//       hay otra por el mismo importe con hasta 3 días (13/11), responde 409
//       con los repetidos hasta que venga confirmar_repetido (lo mismo en
//       gasto y corregir).
//   POST { accion: "gasto", gasto } → un gasto devengado con o sin factura (y
//       su pago, si ya se pagó): reglas en app/lib/finanzasGastos.js.
//       Con proveedor sin tipo guardado, el tipo queda guardado para la próxima.
//       Una factura con el mismo número y proveedor no se carga dos veces.
//       Con gasto.vinculo ("v:<id>" mantenimiento de un vehículo, "m:<id>" falla
//       de una máquina; parte 9) el gasto queda unido a ese arreglo y no se
//       puede cargar dos veces.
//   POST { accion: "leer_gasto", archivo, tipo } → la IA lee la factura (PDF o
//       foto) y devuelve el formulario del gasto ya lleno para revisar (parte 6).
//       Con vinculo en vez de archivo, lee la factura que se subió al arreglo.
//   POST { accion: "proveedor_nuevo", nombre, cuit } → da de alta el proveedor
//       que trajo la factura (o usa el que ya tiene ese nombre).
//   POST { accion: "anular", id } → la marca anulada con quién y cuándo. No se borra.
//       Las cargadas a mano, copiadas del libro, de plazos fijos, del extracto,
//       saldos iniciales, Mi caja, FCI y títulos (12/11; finanzasCorregir.js):
//       las de una factura, un cheque o una orden se anulan desde donde salieron.
//       Un gasto se anula junto con su pago.
//   POST { accion: "anular_varias", ids } → lo mismo, varias juntas (los plazos
//       fijos repetidos, 12/11).
//   POST { accion: "corregir", id, cambios } → anula la operación ("corregida")
//       y carga una nueva con la fecha, el importe, las cuentas, la descripción
//       o la referencia cambiadas (12/11).
//   POST { accion: "comprobantes", id, comprobantes } → cambia la lista de
//       comprobantes (PDF o fotos) de un movimiento (13/11, parte 4; migración
//       187). "crear" y "gasto" también aceptan comprobantes al cargar.
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
import { ORIGEN_GASTO, PROMPT_GASTO, esquemaGasto, operacionesGasto, propuestaDeLectura, textoComprobante, tiposDeGasto, tiposParaIa } from "../../../lib/finanzasGastos";
import { leyendaTipo } from "../../../lib/finanzasTipos";
import { ErrorIa, leerDocumentoIa } from "../../../lib/facturaIa";
import { MAX_ARCHIVO_B64, TIPOS_ARCHIVO } from "../../../lib/facturasSueltas";
import { logAudit } from "../../../lib/audit";
import { ipCliente } from "../../../lib/ip";
import { esDeMantenimiento, grupoDeVinculo, vinculoValido } from "../../../lib/finanzasIntegracion";
import { avisoRepetido } from "../../../lib/finanzasComprobantes";
import { buscarComprobanteRepetido } from "../../../lib/finanzasComprobantesServidor";
import { randomUUID } from "node:crypto";
import { frenoRepetidos, repetidosEnBase } from "../../../lib/finanzasRepetidosServidor";
import { clienteDeOperacion } from "../../../lib/finanzasClientes";
import { columnasComprobantes, falta187, validarComprobantes } from "../../../lib/finanzasAdjuntos";
import { MARCA_CORREGIDA, MAX_ANULAR_JUNTAS, SE_ANULAN, operacionCorregida, puedeCorregir } from "../../../lib/finanzasCorregir";

const ANULABLES = `origen=in.(${[...SE_ANULAN].filter((o) => o !== ORIGEN_GASTO).join(",")})`;

const ORIGENES_COMPRA = ["factura_oc", "factura_oc_otra", "factura_suelta"];
const COLUMNAS = "id,fecha,tipo,proveedor_id,cliente_id,entidad,proyecto_id,centro_costo,neto,iva,otros_impuestos,total,moneda,tipo_cambio,total_ars,cuenta_debe,cuenta_haber,descripcion,referencia,origen,origen_id,estado,cargada_por_nombre,anulada_at,anulada_por_nombre,created_at";

async function listas(sesion) {
  const e = sesion.empresa_id;
  const leer = (path) => sbGetAll(path, { sesion, maxFilas: 5000 }).then((r) => r.data);
  const [tipos, cuentas, tesoreria, centros, proveedores, proyectos] = await Promise.all([
    leer(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,pide_entidad,pide_ot,pide_cc,descripcion,activo&order=codigo.asc`),
    leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,activa&order=codigo.asc`),
    leer(`fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=cuenta.asc`),
    leer(`fin_centros_costo?empresa_id=eq.${e}&select=codigo,nombre,division,activo&order=codigo.asc`),
    leer(`proveedores?empresa_id=eq.${e}&select=id,nombre,cuit,fin_tipo,activo&order=nombre.asc,id.asc`),
    leer(`proyectos?empresa_id=eq.${e}&select=id,ot,cliente,obra,descripcion,estado&order=id.desc`),
  ]);
  return { tipos, cuentas, tesoreria, centros, proveedores, proyectos };
}

/** Los clientes de la lista (sin la 177, ninguno): para dejar el cobro a mano en su cuenta (13/11). */
async function clientesDe(sesion) {
  return sbGetAll(`fin_clientes?empresa_id=eq.${sesion.empresa_id}&select=id,nombre,alias,activo,unido_a&order=id.asc`, { sesion, maxFilas: 5000 })
    .then((r) => r.data || []).catch(() => []);
}

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

/** El arreglo de Flota o Maquinaria al que se une un gasto (parte 9), o null. */
async function costoVinculado(sesion, v) {
  const e = sesion.empresa_id;
  const path = v.modulo === "vehiculo"
    ? `vehiculo_mantenimientos?id=eq.${v.id}&empresa_id=eq.${e}&select=id,costo,factura_url&limit=1`
    : `maquina_fallas?id=eq.${v.id}&empresa_id=eq.${e}&estado=eq.resuelta&select=id,costo,factura_url&limit=1`;
  const [fila] = (await sbGet(path, { sesion, silent: true, fallback: [] })) || [];
  return fila || null;
}

/** La factura que se subió al arreglo, en base64 (solo del almacenamiento público de Gypi). */
async function facturaDelArreglo(url) {
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;
  if (!url || !String(url).startsWith(base) || /\.\.|[?#]/.test(String(url).slice(base.length))) return { error: "Ese arreglo no tiene una factura que Gypi pueda leer" };
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return { error: "No se pudo bajar la factura del arreglo" };
  const tipoHeader = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const porNombre = /\.pdf$/i.test(url) ? "application/pdf" : /\.png$/i.test(url) ? "image/png" : /\.webp$/i.test(url) ? "image/webp" : /\.jpe?g$/i.test(url) ? "image/jpeg" : "";
  const tipo = TIPOS_ARCHIVO.includes(tipoHeader) ? tipoHeader : porNombre;
  if (!TIPOS_ARCHIVO.includes(tipo)) return { error: "La factura del arreglo no es un PDF ni una foto" };
  const archivo = Buffer.from(await res.arrayBuffer()).toString("base64");
  if (archivo.length > MAX_ARCHIVO_B64) return { error: "La factura del arreglo es muy grande (hasta 3 MB)" };
  return { archivo, tipo };
}

/**
 * La misma factura (número y proveedor, o número y nombre) ya cargada y sin
 * anular: como gasto, en Mi caja, desde el S.O.S o como factura de una OC.
 */
async function facturaRepetida(sesion, gasto) {
  if (!String(gasto?.numero || "").replace(/\D/g, "")) return null;
  const proveedorId = Number(gasto.proveedor_id) || null;
  const referencia = gasto.con_factura ? textoComprobante(gasto).replace(/^Factura /, "") : String(gasto.numero);
  return buscarComprobanteRepetido(sesion.empresa_id, { referencia, proveedor_id: proveedorId, entidad: proveedorId ? null : String(gasto.entidad || "").trim() || null }, { sesion });
}

/** Parte 6: la IA lee la factura y vuelve el formulario lleno. Nada se guarda hasta que el dueño lo aprueba. */
async function leerGasto(request, sesion, d) {
  let tipo = String(d?.tipo ?? "");
  let archivo = typeof d?.archivo === "string" ? d.archivo : "";
  if (d?.vinculo) {
    const v = vinculoValido(d.vinculo);
    const item = v ? await costoVinculado(sesion, v) : null;
    if (!item) return NextResponse.json({ error: "No encontré ese arreglo" }, { status: 404 });
    const f = await facturaDelArreglo(item.factura_url);
    if (f.error) return NextResponse.json({ error: f.error }, { status: 400 });
    ({ tipo, archivo } = f);
  }
  if (!TIPOS_ARCHIVO.includes(tipo)) return NextResponse.json({ error: "Subí la factura en PDF o una foto (JPG, PNG o WEBP)" }, { status: 400 });
  if (!archivo || archivo.length > MAX_ARCHIVO_B64 || !/^[A-Za-z0-9+/=]+$/.test(archivo.slice(0, 2000))) {
    return NextResponse.json({ error: "El archivo es muy grande (hasta 3 MB) o no se pudo leer" }, { status: 400 });
  }
  const ctx = await listas(sesion);
  const deGasto = tiposDeGasto(ctx.tipos, ctx.tesoreria);
  let r;
  try {
    r = await leerDocumentoIa({
      base64: archivo, tipo, maxTokens: 2000, esquema: esquemaGasto(deGasto),
      sistema: `${PROMPT_GASTO}\n\nTipos de gasto de la empresa:\n${tiposParaIa(deGasto, leyendaTipo)}`,
    });
  } catch (err) {
    if (err instanceof ErrorIa) return NextResponse.json({ error: `${err.message} Podés cargar el gasto a mano.` }, { status: 502 });
    throw err;
  }
  logAudit({
    empresa_id: sesion.empresa_id, actor_id: sesion.empleado_id, actor_legajo: sesion.legajo, actor_rol: sesion.rol,
    accion: "chat_ia", entidad: "fin_gasto",
    datos_despues: { tipo: "factura_gasto", tokens_input: r.uso.input_tokens, tokens_output: r.uso.output_tokens, model: r.modelo },
    ip: ipCliente(request),
  });
  const propuesta = propuestaDeLectura(r.lectura, ctx);
  const repetida = await facturaRepetida(sesion, propuesta.inicial);
  if (repetida) propuesta.avisos.unshift(`⚠ ${avisoRepetido(repetida, "Esta factura")}`);
  return NextResponse.json({ ok: true, ...propuesta });
}

/** El proveedor que trajo la factura: se da de alta (o se usa el que ya tiene ese nombre). */
async function proveedorNuevo(sesion, d) {
  const nombre = String(d?.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!nombre) return NextResponse.json({ error: "Falta el nombre del proveedor" }, { status: 400 });
  const cuitDig = String(d?.cuit ?? "").replace(/\D/g, "");
  const cuit = cuitDig.length === 11 ? `${cuitDig.slice(0, 2)}-${cuitDig.slice(2, 10)}-${cuitDig.slice(10)}` : null;
  const e = sesion.empresa_id;
  const [igual] = (await sbGet(`proveedores?empresa_id=eq.${e}&nombre=ilike.${encodeURIComponent(nombre.replace(/[%_*,()]/g, ""))}&select=id,nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  if (igual) return NextResponse.json({ ok: true, proveedor: igual });
  const ahora = new Date().toISOString();
  const [fila] = (await sbPost("proveedores", { empresa_id: e, nombre, cuit, activo: true, created_at: ahora, updated_at: ahora }, { sesion })) || [];
  if (!fila?.id) return NextResponse.json({ error: "No se pudo dar de alta el proveedor" }, { status: 500 });
  broadcastRefresh(e, "proveedores");
  return NextResponse.json({ ok: true, proveedor: { id: fila.id, nombre: fila.nombre || nombre } });
}

/** Los comprobantes que manda la pantalla, revisados (finanzasAdjuntos.js). */
const adjuntos = (sesion, lista) => validarComprobantes(lista, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, empresaId: sesion.empresa_id });
const AVISO_187 = "Se guardó, pero sin los comprobantes: para adjuntarlos falta correr la migración 187 en Supabase.";

/**
 * Guarda las operaciones. Sin la 177 se guarda sin cliente_id y sin la 187 sin
 * los comprobantes (con un aviso), así la carga no se pierde.
 */
async function guardarConAdjuntos(sesion, filas, { suelta = false } = {}) {
  // Una sola (crear) va como objeto; las de un gasto, siempre como lista
  const cuerpo = (l) => (suelta ? l[0] : l);
  try {
    return { filas: (await sbPost("fin_operaciones", cuerpo(filas), { sesion })) || [], aviso: null };
  } catch (err) {
    const sinCliente = filas.some((f) => f.cliente_id) && /cliente_id/.test(String(err?.message));
    const sinAdjuntos = filas.some((f) => f.comprobantes) && falta187(err);
    if (!sinCliente && !sinAdjuntos) throw err;
    const limpias = filas.map((f) => {
      const x = { ...f };
      if (sinCliente) delete x.cliente_id;
      if (sinAdjuntos) { delete x.comprobantes; delete x.comprobante_url; }
      return x;
    });
    return { filas: (await sbPost("fin_operaciones", cuerpo(limpias), { sesion })) || [], aviso: sinAdjuntos ? AVISO_187 : null };
  }
}

/** Cambiar la lista de comprobantes de un movimiento (agregar o quitar). */
async function cambiarComprobantes(sesion, d) {
  const id = Number(d.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta la operación" }, { status: 400 });
  const { lista, error } = adjuntos(sesion, d.comprobantes);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const e = sesion.empresa_id;
  try {
    const [fila] = (await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}`, { ...columnasComprobantes(lista), updated_at: new Date().toISOString() }, { sesion })) || [];
    if (!fila) return NextResponse.json({ error: "No encontré esa operación" }, { status: 404 });
    broadcastRefresh(e, "fin_operaciones");
    return NextResponse.json({ ok: true, comprobantes: lista });
  } catch (err) {
    if (falta187(err)) return NextResponse.json({ error: "Para adjuntar comprobantes falta correr la migración 187 en Supabase." }, { status: 400 });
    throw err;
  }
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
      // Con los comprobantes (176 y 187); sin las migraciones, sin ellos
      sbGetAll(`fin_operaciones?empresa_id=eq.${e}&fecha=gte.${desde}&fecha=lte.${hasta}&select=${COLUMNAS},comprobante_url,comprobantes&order=fecha.desc,id.desc`, { sesion, maxFilas: MAX_OPERACIONES })
        .catch((err) => {
          if (!/comprobante/.test(String(err?.message))) throw err;
          return sbGetAll(`fin_operaciones?empresa_id=eq.${e}&fecha=gte.${desde}&fecha=lte.${hasta}&select=${COLUMNAS}&order=fecha.desc,id.desc`, { sesion, maxFilas: MAX_OPERACIONES });
        }),
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
      const ctx = await listas(sesion);
      const { op, errores } = validarOperacion(d.operacion, ctx);
      if (errores.length) return NextResponse.json({ error: errores.join(" "), errores }, { status: 400 });
      const adj = adjuntos(sesion, d.operacion?.comprobantes);
      if (adj.error) return NextResponse.json({ error: adj.error }, { status: 400 });
      // 13/11: mismo importe en la misma caja y fecha cerca = sospechoso (finanzasRepetidos.js)
      if (d.confirmar_repetido !== true) {
        const freno = frenoRepetidos(await repetidosEnBase(sesion, [op], { tesoreria: ctx.tesoreria }));
        if (freno) return freno;
      }
      const ahora = new Date().toISOString();
      const nueva = { ...op, empresa_id: e, cargada_por_nombre: await nombreEmpleado(sesion), created_at: ahora, updated_at: ahora };
      // 13/11: el cobro (o la venta) de un cliente queda en su cuenta corriente con su id
      const delCliente = clienteDeOperacion(op, { cuentas: ctx.cuentas, proveedores: ctx.proveedores, clientes: await clientesDe(sesion) });
      if (delCliente) Object.assign(nueva, delCliente, { proveedor_id: null });
      if (adj.lista.length) Object.assign(nueva, columnasComprobantes(adj.lista));
      const { filas: [fila], aviso } = await guardarConAdjuntos(sesion, [nueva], { suelta: true });
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true, operacion: fila, ...(aviso ? { aviso } : {}) });
    }
    if (d.accion === "gasto") {
      const ctx = await listas(sesion);
      const { ops, errores } = operacionesGasto(d.gasto || {}, ctx);
      if (errores.length) return NextResponse.json({ error: errores.join(" "), errores }, { status: 400 });
      const adjGasto = adjuntos(sesion, d.gasto?.comprobantes);
      if (adjGasto.error) return NextResponse.json({ error: adjGasto.error }, { status: 400 });
      const repetida = await facturaRepetida(sesion, d.gasto);
      if (repetida) return NextResponse.json({ error: `${avisoRepetido(repetida, "Esa factura")} Si estaba mal, anulala y cargala de nuevo.` }, { status: 409 });
      if (d.confirmar_repetido !== true) {
        const freno = frenoRepetidos(await repetidosEnBase(sesion, ops, { tesoreria: ctx.tesoreria }));
        if (freno) return freno;
      }
      let grupo = `g${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      // Parte 9: unido a un arreglo de Flota o Maquinaria, con una clave fija
      if (d.gasto?.vinculo) {
        const v = vinculoValido(d.gasto.vinculo);
        if (!v || !(await costoVinculado(sesion, v))) return NextResponse.json({ error: "No encontré ese arreglo de Flota o Maquinaria" }, { status: 404 });
        grupo = grupoDeVinculo(v);
        const [ya] = (await sbGet(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_GASTO}&origen_id=eq.${grupo}&anulada_at=is.null&select=fecha&limit=1`, { sesion, silent: true, fallback: [] })) || [];
        if (ya) return NextResponse.json({ error: `Ese arreglo ya está cargado en Finanzas (operación del ${ya.fecha.slice(8, 10)}/${ya.fecha.slice(5, 7)}/${ya.fecha.slice(0, 4)}).` }, { status: 409 });
      }
      const ahora = new Date().toISOString();
      const quien = await nombreEmpleado(sesion);
      // La factura y su pago llevan los mismos comprobantes
      const { filas, aviso } = await guardarConAdjuntos(sesion, ops.map((op, i) => ({
        ...op, empresa_id: e, origen_id: i ? `${grupo}-p` : grupo, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora,
        ...(adjGasto.lista.length ? columnasComprobantes(adjGasto.lista) : {}),
      })));
      // El proveedor sin tipo guardado se queda con este para la próxima factura
      const prov = ops[0].proveedor_id ? ctx.proveedores.find((p) => Number(p.id) === ops[0].proveedor_id) : null;
      if (prov && !prov.fin_tipo) await sbPatch(`proveedores?id=eq.${prov.id}&empresa_id=eq.${e}`, { fin_tipo: ops[0].tipo }, { sesion, silent: true }).catch(() => null);
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true, operaciones: filas, ...(aviso ? { aviso } : {}) });
    }
    if (d.accion === "comprobantes") return await cambiarComprobantes(sesion, d);
    if (d.accion === "leer_gasto") return await leerGasto(request, sesion, d);
    if (d.accion === "proveedor_nuevo") return await proveedorNuevo(sesion, d);
    if (d.accion === "anular") {
      const id = Number(d.id);
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta la operación" }, { status: 400 });
      const ahora = new Date().toISOString();
      const marca = { anulada_at: ahora, anulada_por_nombre: await nombreEmpleado(sesion), updated_at: ahora };
      // Un gasto (parte 5) se anula junto con su pago
      const [suya] = (await sbGet(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&select=origen,origen_id&limit=1`, { sesion, silent: true, fallback: [] })) || [];
      if (suya?.origen === ORIGEN_GASTO && /^g[0-9a-f]{12}/.test(String(suya.origen_id || ""))) {
        const grupo = String(suya.origen_id).slice(0, 13);
        const filas = await sbPatch(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&origen=eq.${ORIGEN_GASTO}&origen_id=in.(${grupo},${grupo}-p)`, marca, { sesion });
        if (!filas?.length) return NextResponse.json({ error: "No encontré esa operación o ya estaba anulada" }, { status: 404 });
        broadcastRefresh(e, "fin_operaciones");
        return NextResponse.json({ ok: true, operacion: filas.find((f) => f.id === id) || filas[0], anuladas: filas.length });
      }
      // Las que salieron de una factura, un cheque o una orden se anulan desde ahí
      const filas = await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null&${ANULABLES}`, marca, { sesion });
      if (!filas?.length) return NextResponse.json({ error: "No encontré esa operación, ya estaba anulada o salió de otra pantalla (se anula desde ahí)" }, { status: 404 });
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true, operacion: filas[0] });
    }
    if (d.accion === "anular_varias") {
      const ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      if (!ids.length) return NextResponse.json({ error: "Faltan las operaciones" }, { status: 400 });
      if (ids.length > MAX_ANULAR_JUNTAS) return NextResponse.json({ error: `Hasta ${MAX_ANULAR_JUNTAS} por vez` }, { status: 400 });
      const ahora = new Date().toISOString();
      const filas = await sbPatch(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&${ANULABLES}&id=in.(${ids.join(",")})`, {
        anulada_at: ahora, anulada_por_nombre: await nombreEmpleado(sesion), updated_at: ahora,
      }, { sesion });
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true, anuladas: filas?.length || 0 });
    }
    if (d.accion === "corregir") {
      const id = Number(d.id);
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta la operación" }, { status: 400 });
      const [op] = (await sbGet(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null&select=*&limit=1`, { sesion })) || [];
      if (!op) return NextResponse.json({ error: "No encontré esa operación o ya está anulada" }, { status: 404 });
      if (!puedeCorregir(op)) return NextResponse.json({ error: "Esta operación sale de otra pantalla: se corrige desde ahí" }, { status: 400 });
      const cuentas = (await sbGetAll(`fin_cuentas?empresa_id=eq.${e}&select=codigo`, { sesion, maxFilas: 5000 })).data || [];
      const { nueva, errores } = operacionCorregida(op, d.cambios || {}, { cuentas });
      if (errores.length) return NextResponse.json({ error: errores.join(" "), errores }, { status: 400 });
      // Si cambia la fecha o el importe, que no quede igual a otra (la que se corrige no cuenta)
      if (d.confirmar_repetido !== true) {
        const freno = frenoRepetidos(await repetidosEnBase(sesion, [nueva], { excluir: [id] }));
        if (freno) return freno;
      }
      const ahora = new Date().toISOString();
      const quien = await nombreEmpleado(sesion);
      // Primero se anula la vieja (si otro la anuló recién, no se carga la nueva)
      const anulada = await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, {
        anulada_at: ahora, anulada_por_nombre: `${quien || "Dueño"} ${MARCA_CORREGIDA}`.slice(0, 120), updated_at: ahora,
      }, { sesion });
      if (!anulada?.length) return NextResponse.json({ error: "Esa operación ya estaba anulada" }, { status: 409 });
      try {
        const [fila] = await sbPost("fin_operaciones", { ...nueva, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora }, { sesion });
        broadcastRefresh(e, "fin_operaciones");
        return NextResponse.json({ ok: true, operacion: fila, anulada: id });
      } catch (err) {
        // Si la nueva no se pudo guardar, la vieja vuelve a estar viva
        await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}`, { anulada_at: null, anulada_por_nombre: null, updated_at: new Date().toISOString() }, { sesion, silent: true }).catch(() => null);
        throw err;
      }
    }
    if (d.accion === "cambiar_tipo") {
      // Compra que salió sola de una factura (F2a): el dueño elige el tipo y Gypi lo recuerda para el proveedor
      const id = Number(d.id);
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta la operación" }, { status: 400 });
      const [op] = (await sbGet(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null&select=id,origen,origen_id,proveedor_id,cargada_por_nombre&limit=1`, { sesion })) || [];
      if (!op) return NextResponse.json({ error: "No encontré esa operación o está anulada" }, { status: 404 });
      // Solo las compras que salieron de una factura: las de cheques o saldos iniciales tienen sus cuentas fijas
      // y los gastos que Gypi pasó solos desde Mantenimiento (parte 9 de la auditoría del 12/11)
      const deMantenimiento = esDeMantenimiento(op);
      if (!ORIGENES_COMPRA.includes(op.origen) && !deMantenimiento) return NextResponse.json({ error: "El tipo de esta operación no se cambia: sale de otra pantalla" }, { status: 400 });
      const [tipo] = (await sbGet(`fin_tipos_operacion?empresa_id=eq.${e}&codigo=eq.${encodeURIComponent(String(d.tipo || ""))}&select=codigo,cuenta_debe,cuenta_haber,activo&limit=1`, { sesion })) || [];
      if (!tipo || tipo.activo === false) return NextResponse.json({ error: "Ese tipo de operación no existe o está desactivado" }, { status: 400 });
      if (!tipo.cuenta_debe || !tipo.cuenta_haber) return NextResponse.json({ error: `${tipo.codigo} no tiene cuentas por defecto: completalas en Configuración` }, { status: 400 });
      // Un gasto de Mantenimiento cambia solo la cuenta del gasto: la deuda (proveedor o acreedor) queda
      const [fila] = (await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}`, {
        tipo: tipo.codigo, cuenta_debe: tipo.cuenta_debe, ...(deMantenimiento ? {} : { cuenta_haber: tipo.cuenta_haber }), estado: "confirmada", updated_at: new Date().toISOString(),
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
