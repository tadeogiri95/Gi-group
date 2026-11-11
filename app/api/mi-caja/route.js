// /api/mi-caja — Finanzas, parte F3b: Mi caja (migración 176; reglas en
// app/lib/finanzasMiCaja.js). Para cualquier empleado que sea responsable de
// una caja (fin_tesoreria.responsable_id), sin entrar a Finanzas.
//
//   GET → sus cajas activas, con el saldo, los últimos movimientos y los
//       conceptos (los tipos de gasto e ingreso que el dueño no escondió). Sin cajas a cargo (o sin el módulo, o
//       sin la 171) devuelve { cajas: [] } y la pantalla no muestra nada.
//   POST { accion: "cargar", cuenta, clase: "gasto"|"ingreso", concepto,
//       importe, fecha, descripcion?, comprobante_url?, tipo_cambio? }
//       → la operación entra a su caja como "para revisar" y se avisa a los
//       dueños. Si la carga el dueño, entra confirmada.
//   POST { accion: "anular", id } → anula una propia que el dueño todavía no
//       revisó (para corregir un error). No se borra.
//   Pases entre personas (10/11; reglas en app/lib/finanzasPases.js):
//   POST { accion: "pasar", cuenta, hacia, importe, fecha, descripcion?, tipo_cambio? }
//       → queda pendiente y se avisa al responsable de la otra caja.
//   POST { accion: "recibir", id } → el que recibe confirma: se anota la
//       transferencia entre las dos cajas, confirmada.
//   POST { accion: "rechazar", id } → no la recibió: no se anota nada y se
//       avisa al que la pasó y a los dueños.
//   POST { accion: "cancelar", id } → el que la pasó la saca mientras está pendiente.
//   Mi caja fácil (parte 10 del plan del 11/11):
//   POST { accion: "leer_ticket", cuenta, comprobante_url } → la IA lee la
//       foto del ticket (ya subida) y devuelve importe, fecha, comercio (unido
//       a un proveedor de la lista por CUIT o nombre), CUIT, letra, punto de
//       venta, número, IVA, detalle y concepto para llenar el formulario, y
//       avisa si ese comprobante ya está cargado. No guarda nada.
//   En "cargar" (11/11): el mismo comprobante del mismo proveedor, cargado
//       por cualquier camino (Mi caja, gasto, S.O.S, factura de OC), no entra
//       dos veces (409). Sin número, si en la caja hay otro del mismo importe
//       con pocos días de diferencia, pregunta (409 parecido) y se guarda con
//       igual_confirmado: true.
//
// El titular de la cuenta (11/11, pedido de Tadeo) carga en cualquier caja o
// banco activo, no solo en los suyos: en Mi caja elige la caja de la lista y
// lo que carga entra confirmado. Los pases entre personas siguen siendo solo
// de las cajas que tiene a cargo (no ve ni confirma los pases de otros).
//
// La RLS de fin_operaciones es solo del rol gerencial: esta ruta va con la
// clave de servicio y siempre filtra por la empresa y las cajas del que pide.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../lib/sbHelpers";
import { getModulosEmpresa, rechazarSiSinPlan } from "../../lib/planEnforcement";
import { broadcastRefresh } from "../../lib/broadcast";
import { enviarPushLegajos } from "../../lib/pushGerencia";
import { logger } from "../../lib/logger";
import { safeErrorMessage } from "../../lib/validate";
import { hoyAr, plata } from "../../lib/finanzasOperaciones";
import { CLAVE_MI_CAJA, ORIGEN_MI_CAJA, PROMPT_TICKET, comprobanteValido, conceptosMiCaja, esquemaTicket, propuestaTicket, referenciaTicket, resumenMiCaja, validarMovimientoMiCaja } from "../../lib/finanzasMiCaja";
import { avisoRepetido, fechaDma } from "../../lib/finanzasComprobantes";
import { buscarComprobanteRepetido, buscarMovimientoParecido } from "../../lib/finanzasComprobantesServidor";
import { ErrorIa, leerDocumentoIa } from "../../lib/facturaIa";
import { MAX_ARCHIVO_B64 } from "../../lib/facturasSueltas";
import { checkRateLimit } from "../../lib/rateLimitMemory";
import { logAudit } from "../../lib/audit";
import { ipCliente } from "../../lib/ip";
import { accesoSesion } from "../../lib/accesosServidor";
import { CLAVE_PASES, ORIGEN_PASE, destinosPase, guardarPases, leerPases, operacionDePase, pasesDe, validarPase } from "../../lib/finanzasPases";

const COLUMNAS = "id,fecha,tipo,total,moneda,total_ars,cuenta_debe,cuenta_haber,descripcion,origen,estado,anulada_at";
const sinTabla = (err) => /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(String(err?.message));

/** Las cajas y bancos donde carga el titular: todos los activos (no plazos fijos ni FCI). */
const TIPOS_TITULAR = ["caja", "banco"];

/**
 * Las cajas activas donde puede cargar el que pide: las que tiene a cargo
 * (propia: true) y, si es el titular, además todas las cajas y bancos de la
 * empresa (las suyas primero). Sin el módulo, ninguna.
 */
async function misCajas(sesion) {
  if (!sesion.empleado_id) return [];
  const { modulos } = await getModulosEmpresa(sesion.empresa_id);
  if (!modulos.includes("finanzas")) return [];
  const columnas = "select=cuenta,nombre,tipo,moneda,activa,responsable_id&order=nombre.asc";
  const [{ data }, titular] = await Promise.all([
    sbGetAll(`fin_tesoreria?empresa_id=eq.${sesion.empresa_id}&responsable_id=eq.${sesion.empleado_id}&activa=eq.true&${columnas}`, { maxFilas: 50 }),
    accesoSesion(sesion).then((a) => a.titular).catch(() => false),
  ]);
  const propias = (data || []).map((c) => ({ ...c, propia: true }));
  if (!titular) return propias;
  const { data: todas } = await sbGetAll(`fin_tesoreria?empresa_id=eq.${sesion.empresa_id}&activa=eq.true&tipo=in.(${TIPOS_TITULAR.join(",")})&${columnas}`, { maxFilas: 200 });
  const ya = new Set(propias.map((c) => c.cuenta));
  return [...propias, ...(todas || []).filter((c) => !ya.has(c.cuenta)).map((c) => ({ ...c, propia: false }))];
}

/** Solo las que tiene a cargo: para los pases entre personas. */
const soloPropias = (cajas) => cajas.filter((c) => c.propia !== false);

/** Los proveedores de la empresa, para unir el comercio del ticket con uno de la lista. */
async function proveedoresDe(empresaId) {
  const { data } = await sbGetAll(`proveedores?empresa_id=eq.${empresaId}&select=id,nombre,cuit,activo&order=id.asc`, { maxFilas: 10000 }).catch(() => ({ data: [] }));
  return (data || []).filter((p) => p.activo !== false);
}

async function conceptos(empresaId) {
  const [cfg, tipos] = await Promise.all([
    sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_MI_CAJA}&select=valor&limit=1`, { silent: true, fallback: [] }),
    sbGetAll(`fin_tipos_operacion?empresa_id=eq.${empresaId}&select=codigo,nombre,grupo,descripcion,cuenta_debe,cuenta_haber,activo&order=codigo.asc`, { maxFilas: 2000 }).then((r) => r.data),
  ]);
  return { lista: conceptosMiCaja(cfg?.[0]?.valor, tipos), tipos };
}

/** Todas las cajas activas con responsable y el nombre de cada uno (para elegir a quién pasarle). */
async function cajasConResponsable(empresaId) {
  const { data: tesoreria } = await sbGetAll(`fin_tesoreria?empresa_id=eq.${empresaId}&activa=eq.true&responsable_id=not.is.null&select=cuenta,nombre,tipo,moneda,activa,responsable_id&order=nombre.asc`, { maxFilas: 200 });
  const ids = [...new Set((tesoreria || []).map((t) => t.responsable_id))];
  const personal = ids.length
    ? (await sbGetAll(`empleados?empresa_id=eq.${empresaId}&id=in.(${ids.join(",")})&select=id,nombre,legajo`, { maxFilas: 200 })).data || []
    : [];
  return { tesoreria: tesoreria || [], personal };
}

async function leerListaPases(empresaId) {
  const [fila] = (await sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_PASES}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  return { pases: leerPases(fila?.valor), existe: !!fila };
}

async function escribirListaPases(empresaId, pases, existe) {
  const valor = guardarPases(pases);
  if (existe) await sbPatch(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_PASES}`, { valor });
  else await sbPost("config_sistema", { empresa_id: empresaId, clave: CLAVE_PASES, valor });
}

const enLista = (cajas) => encodeURIComponent(cajas.map((c) => `"${String(c.cuenta).replace(/"/g, "")}"`).join(","));

export async function GET(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  try {
    const cajas = await misCajas(sesion);
    if (!cajas.length) return NextResponse.json({ cajas: [] });
    const e = sesion.empresa_id;
    const [{ lista, tipos }, ops] = await Promise.all([
      conceptos(e),
      sbGetAll(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${enLista(cajas)}),cuenta_haber.in.(${enLista(cajas)}))&select=${COLUMNAS},comprobante_url&order=fecha.asc,id.asc`, { maxFilas: 20000 })
        .catch((err) => {
          // Sin la 176 todavía: sin la foto, pero el saldo se ve igual
          if (/comprobante_url/.test(String(err?.message))) return sbGetAll(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${enLista(cajas)}),cuenta_haber.in.(${enLista(cajas)}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, { maxFilas: 20000 });
          throw err;
        })
        .then((r) => r.data),
    ]);
    const nombres = new Map(tipos.map((t) => [t.codigo, t.nombre || t.codigo]));
    // Pases entre personas: nunca frenan Mi caja si algo falla
    const [{ tesoreria, personal }, { pases }] = await Promise.all([
      cajasConResponsable(e).catch(() => ({ tesoreria: [], personal: [] })),
      leerListaPases(e).catch(() => ({ pases: [] })),
    ]);
    const deCadaUno = pasesDe(pases, soloPropias(cajas).map((c) => c.cuenta));
    return NextResponse.json({
      cajas: cajas.map((c) => ({ ...resumenMiCaja(ops, c, nombres), propia: c.propia !== false, destinos: c.propia !== false ? destinosPase(c, tesoreria, personal) : [] })),
      titular: cajas.some((c) => c.propia === false),
      conceptos: lista, hoy: hoyAr(), ...deCadaUno,
    });
  } catch (err) {
    if (sinTabla(err)) return NextResponse.json({ cajas: [] });
    logger.error("[mi-caja] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

async function nombreEmpleado(sesion) {
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function avisarDuenos(empresaId, { quien, op, caja }) {
  try {
    const { data: duenos } = await sbGetAll(`empleados?empresa_id=eq.${empresaId}&rol=eq.gerencial&activo=eq.true&select=legajo&order=legajo.asc`);
    const gasto = op.cuenta_haber === caja.cuenta;
    await enviarPushLegajos(empresaId, (duenos || []).map((x) => x.legajo), {
      title: `📱 ${quien || "Alguien"} cargó ${gasto ? "un gasto" : "plata recibida"} en su caja`,
      body: `${plata(op.total, op.moneda)} · ${op.descripcion}`.slice(0, 180),
      data: { tipo: "mi_caja" },
    });
  } catch { /* el aviso no frena la carga */ }
}

async function cargar(sesion, d, cajas) {
  const e = sesion.empresa_id;
  const caja = cajas.find((c) => c.cuenta === d.cuenta);
  if (!caja) return NextResponse.json({ error: "Esa caja no está a tu cargo" }, { status: 403 });
  const [{ lista }, proveedores] = await Promise.all([conceptos(e), proveedoresDe(e)]);
  const { op, errores } = validarMovimientoMiCaja(d, {
    caja, conceptos: lista, confirmada: sesion.rol === "gerencial" || caja.propia === false,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, empresaId: e, hoy: hoyAr(), proveedores,
  });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  if (op.referencia) {
    const repetido = await buscarComprobanteRepetido(e, op);
    if (repetido) return NextResponse.json({ error: `${avisoRepetido(repetido, "Este ticket")} Si es otro, revisá el número.`, repetido: true }, { status: 409 });
  } else if (!d.igual_confirmado) {
    const igual = await buscarMovimientoParecido(e, op, caja.cuenta);
    if (igual) {
      return NextResponse.json({
        error: `Ya hay uno igual en esta caja: ${plata(igual.total, op.moneda)} del ${fechaDma(igual.fecha)}${igual.descripcion ? ` (${String(igual.descripcion).slice(0, 80)})` : ""}. ¿Es otro?`,
        parecido: true,
      }, { status: 409 });
    }
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const fila = { ...op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora };
  if (!fila.comprobante_url) delete fila.comprobante_url; // sin foto anda aunque falte la 176
  const [o] = (await sbPost("fin_operaciones", fila)) || [];
  broadcastRefresh(e, "fin_operaciones");
  if (sesion.rol !== "gerencial") await avisarDuenos(e, { quien, op, caja });
  return NextResponse.json({ ok: true, operacion: o ? { id: o.id, estado: o.estado } : null });
}

async function legajosDe(empresaId, ids = []) {
  const limpios = [...new Set(ids.filter(Boolean))];
  if (!limpios.length) return [];
  const { data } = await sbGetAll(`empleados?empresa_id=eq.${empresaId}&id=in.(${limpios.join(",")})&activo=eq.true&select=legajo`, { maxFilas: 50 });
  return (data || []).map((x) => x.legajo);
}

async function avisar(empresaId, legajos, aviso) {
  try { if (legajos.length) await enviarPushLegajos(empresaId, legajos, { ...aviso, data: { tipo: "mi_caja" } }); } catch { /* el aviso no frena */ }
}

async function pasar(sesion, d, cajas) {
  const e = sesion.empresa_id;
  const caja = cajas.find((c) => c.cuenta === d.cuenta);
  if (!caja) return NextResponse.json({ error: "Esa caja no está a tu cargo" }, { status: 403 });
  const [{ tesoreria, personal }, lista, quien] = await Promise.all([cajasConResponsable(e), leerListaPases(e), nombreEmpleado(sesion)]);
  const ahora = new Date().toISOString();
  const id = `pase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const { pase, errores } = validarPase(d, { caja, destinos: destinosPase(caja, tesoreria, personal), quien, hoy: hoyAr(), id, ahora });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  await escribirListaPases(e, [pase, ...lista.pases], lista.existe);
  broadcastRefresh(e, "fin_operaciones");
  await avisar(e, await legajosDe(e, [pase.para_id]), {
    title: `💸 ${quien || "Alguien"} te pasó ${plata(pase.importe, pase.moneda)}`,
    body: "Abrí Mi caja y confirmá si la recibiste para que entre en tu caja.",
  });
  return NextResponse.json({ ok: true, pase: { id: pase.id } });
}

/** Recibir, rechazar o cancelar un pase pendiente. */
async function resolverPase(sesion, d, cajas) {
  const e = sesion.empresa_id;
  const lista = await leerListaPases(e);
  const pase = lista.pases.find((p) => p.id === d.id && p.estado === "pendiente");
  const mias = new Set(cajas.map((c) => c.cuenta));
  const cancelar = d.accion === "cancelar";
  if (!pase || !mias.has(cancelar ? pase.desde : pase.hacia)) {
    return NextResponse.json({ error: "Ese pase ya se resolvió o no es para vos" }, { status: 404 });
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  let operacion = null;
  if (d.accion === "recibir") {
    const { tesoreria } = await cajasConResponsable(e);
    const { op, errores } = operacionDePase(pase, tesoreria);
    if (!op) return NextResponse.json({ error: errores[0] || "Una de las cajas ya no está activa: pedile al dueño que lo cargue" }, { status: 409 });
    // Dos toques seguidos no anotan dos veces
    const [ya] = (await sbGet(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_PASE}&origen_id=eq.${encodeURIComponent(op.origen_id)}&anulada_at=is.null&select=id&limit=1`, { silent: true, fallback: [] })) || [];
    const [o] = ya ? [ya] : (await sbPost("fin_operaciones", { ...op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora })) || [];
    operacion = o ? { id: o.id } : null;
  }
  const estado = d.accion === "recibir" ? "recibido" : cancelar ? "cancelado" : "rechazado";
  const nuevo = { ...pase, estado, resuelto_at: ahora, resuelto_por: quien, op_id: operacion?.id ?? null };
  await escribirListaPases(e, lista.pases.map((p) => (p.id === pase.id ? nuevo : p)), lista.existe);
  broadcastRefresh(e, "fin_operaciones");
  const monto = plata(pase.importe, pase.moneda);
  if (estado === "recibido") {
    await avisar(e, await legajosDe(e, [pase.de_id]), { title: `✓ ${pase.para_nombre} confirmó que recibió ${monto}`, body: "Ya salió de tu caja y entró en la suya." });
  } else if (estado === "rechazado") {
    const { data: duenos } = await sbGetAll(`empleados?empresa_id=eq.${e}&rol=eq.gerencial&activo=eq.true&select=legajo`, { maxFilas: 50 });
    const legajos = [...new Set([...(await legajosDe(e, [pase.de_id])), ...(duenos || []).map((x) => x.legajo)])];
    await avisar(e, legajos, { title: `⚠ ${pase.para_nombre} dice que no recibió ${monto}`, body: `${pase.de_nombre || pase.desde_nombre} lo había anotado el ${pase.fecha.split("-").reverse().join("/")}. No se anotó nada en las cajas.` });
  } else {
    await avisar(e, await legajosDe(e, [pase.para_id]), { title: `${pase.de_nombre || "Se"} canceló el pase de ${monto}`, body: "Ya no tenés que confirmarlo." });
  }
  return NextResponse.json({ ok: true, estado, operacion });
}

async function anular(sesion, d, cajas) {
  const id = Number(d.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta el movimiento" }, { status: 400 });
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  const filas = await sbPatch(
    `fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&origen=eq.${ORIGEN_MI_CAJA}&estado=eq.para_revisar&anulada_at=is.null&or=(cuenta_debe.in.(${enLista(cajas)}),cuenta_haber.in.(${enLista(cajas)}))`,
    { anulada_at: ahora, anulada_por_nombre: await nombreEmpleado(sesion), updated_at: ahora },
  );
  if (!filas?.length) return NextResponse.json({ error: "Ese movimiento ya lo revisó el dueño o no es de tu caja: pedile que lo corrija" }, { status: 404 });
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true });
}

const TIPO_FOTO = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** La IA lee la foto del ticket y vuelve el formulario lleno; el empleado revisa y guarda. */
async function leerTicket(request, sesion, d, cajas) {
  const e = sesion.empresa_id;
  if (!cajas.some((c) => c.cuenta === d.cuenta)) return NextResponse.json({ error: "Esa caja no está a tu cargo" }, { status: 403 });
  const url = String(d.comprobante_url || "");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const tipo = TIPO_FOTO[(url.match(/\.([a-z]+)$/i)?.[1] || "").toLowerCase()];
  if (!url || !tipo || !comprobanteValido(url, { supabaseUrl, empresaId: e })) return NextResponse.json({ error: "Sacá la foto del ticket de nuevo" }, { status: 400 });
  if (checkRateLimit(`mi-caja-ticket:${sesion.empleado_id || sesion.legajo}`, 20, 60 * 60 * 1000).limited) {
    return NextResponse.json({ error: "Leíste muchos tickets seguidos: cargá este a mano." }, { status: 429 });
  }
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: "No se pudo bajar la foto del ticket" }, { status: 400 });
  const archivo = Buffer.from(await res.arrayBuffer()).toString("base64");
  if (archivo.length > MAX_ARCHIVO_B64) return NextResponse.json({ error: "La foto es muy grande para leerla: cargalo a mano" }, { status: 400 });
  const [{ lista }, proveedores] = await Promise.all([conceptos(e), proveedoresDe(e)]);
  const opciones = lista.gastos;
  let r;
  try {
    r = await leerDocumentoIa({
      base64: archivo, tipo, maxTokens: 900, esquema: esquemaTicket(opciones),
      sistema: `${PROMPT_TICKET}\n\nConceptos:\n${opciones.map((c) => `- ${c.codigo}${c.nombre !== c.codigo ? ` (${c.nombre})` : ""}${c.leyenda ? `: ${c.leyenda}` : ""}`).join("\n")}`,
    });
  } catch (err) {
    if (err instanceof ErrorIa) return NextResponse.json({ error: `${err.message} Cargalo a mano.` }, { status: 502 });
    throw err;
  }
  logAudit({
    empresa_id: e, actor_id: sesion.empleado_id, actor_legajo: sesion.legajo, actor_rol: sesion.rol,
    accion: "chat_ia", entidad: "fin_mi_caja",
    datos_despues: { tipo: "ticket_mi_caja", tokens_input: r.uso.input_tokens, tokens_output: r.uso.output_tokens, model: r.modelo },
    ip: ipCliente(request),
  });
  const p = propuestaTicket(r.lectura, { conceptos: opciones, hoy: hoyAr(), proveedores });
  const referencia = referenciaTicket(p);
  const repetido = referencia ? await buscarComprobanteRepetido(e, { referencia, proveedor_id: p.proveedor_id, entidad: p.proveedor_id ? null : p.comercio }) : null;
  return NextResponse.json({ ok: true, ...p, repetido: repetido ? avisoRepetido(repetido, "Este ticket") : null });
}

export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!d || typeof d !== "object") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  try {
    const cajas = await misCajas(sesion);
    if (!cajas.length) return NextResponse.json({ error: "No tenés ninguna caja a cargo" }, { status: 403 });
    if (d.accion === "cargar") return await cargar(sesion, d, cajas);
    if (d.accion === "anular") return await anular(sesion, d, cajas);
    if (d.accion === "pasar") return await pasar(sesion, d, soloPropias(cajas));
    if (d.accion === "leer_ticket") return await leerTicket(request, sesion, d, cajas);
    if (["recibir", "rechazar", "cancelar"].includes(d.accion)) return await resolverPase(sesion, d, soloPropias(cajas));
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    if (/comprobante_url/.test(String(err?.message))) return NextResponse.json({ error: "Para guardar la foto del ticket falta correr la migración 176 en Supabase." }, { status: 409 });
    logger.error(`[mi-caja] ${d.accion}`, err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
