// /api/agenda — "➕ Nuevo" cliente o proveedor sin cambiar de pantalla
// (parte 4 del plan Finanzas e Inventario, 11/11). Reglas en
// app/lib/altaPersona.js.
//
//   POST { nombre, cuit?, rol: "proveedor"|"cliente", clave?, es_otro? }
//     → busca en la agenda única (proveedores + clientes + hoja PERSONAS):
//       - si ya está (mismo CUIT o mismo nombre), devuelve esa persona y, si no
//         tenía el rol, se lo da (pasa a ser proveedor o cliente);
//       - si hay nombres parecidos y no dijo "es otro", devuelve { preguntar,
//         parecidos } para que la persona elija;
//       - si no, lo da de alta.
//     Con clave (eligió un parecido) usa ese renglón de la agenda.
//
// Pueden dar de alta proveedores el Dueño, administración (compras) y quien
// tiene una caja a cargo (Mi caja). Clientes, solo el Dueño (Finanzas).
// La agenda tiene datos personales (hoja PERSONAS) que solo ve el Dueño, por
// eso va con la clave del servidor y filtro de empresa explícito, y a la
// pantalla vuelve solo el nombre, el CUIT y los ids.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../lib/planEnforcement";
import { broadcastRefresh } from "../../lib/broadcast";
import { safeErrorMessage } from "../../lib/validate";
import { logger } from "../../lib/logger";
import { puedeComprar } from "../../lib/compras";
import { esDuenoFinanzas } from "../../lib/finanzas";
import { CLAVE_UNIFICADOS, leerPares } from "../../lib/finanzasUnificados";
import { armarAgenda } from "../../lib/finanzasPersonas";
import { buscarEnAgenda, cuitConGuiones, personaElegible, textoParecido, tieneRol, validarAlta } from "../../lib/altaPersona";

const sinTabla = (err) => /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(String(err?.message));
const leer = (path) => sbGetAll(path, { maxFilas: 10000 }).then((r) => r.data || []).catch((err) => {
  if (sinTabla(err)) return [];
  throw err;
});

/** ¿Puede dar de alta? Dueño y administración siempre; los demás si tienen una caja a cargo. */
async function puedeDarAlta(sesion) {
  if (esDuenoFinanzas(sesion) || puedeComprar(sesion.rol)) return true;
  if (!sesion.empleado_id) return false;
  const cajas = await sbGet(`fin_tesoreria?empresa_id=eq.${sesion.empresa_id}&responsable_id=eq.${sesion.empleado_id}&activa=eq.true&select=cuenta&limit=1`, { silent: true, fallback: [] });
  return !!cajas?.length;
}

async function cargarAgenda(e) {
  const [personas, proveedores, clientes, pares] = await Promise.all([
    leer(`fin_personas?empresa_id=eq.${e}&select=id,nombre,alias,cuit,proveedor_id,cliente_id,activo,unido_a&order=nombre.asc,id.asc`),
    leer(`proveedores?empresa_id=eq.${e}&select=id,nombre,cuit,activo&order=nombre.asc`),
    leer(`fin_clientes?empresa_id=eq.${e}&select=id,nombre,cuit,alias,activo,unido_a&order=nombre.asc`),
    sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_UNIFICADOS}&select=valor&limit=1`, { silent: true, fallback: [] }).then((r) => leerPares(r?.[0]?.valor)),
  ]);
  return armarAgenda({ personas, proveedores, clientes, pares });
}

const sinComodines = (s) => encodeURIComponent(String(s).replace(/[%_*,()]/g, ""));

/** El proveedor con ese nombre (la base no deja repetirlo) o uno nuevo. */
async function proveedorPara(e, nombre, cuit) {
  const [igual] = (await sbGet(`proveedores?empresa_id=eq.${e}&nombre=ilike.${sinComodines(nombre)}&select=id&limit=1`, { silent: true, fallback: [] })) || [];
  if (igual?.id) return Number(igual.id);
  const ahora = new Date().toISOString();
  const [fila] = (await sbPost("proveedores", { empresa_id: e, nombre: nombre.slice(0, 120), cuit: cuitConGuiones(cuit), activo: true, created_at: ahora, updated_at: ahora })) || [];
  return fila?.id ? Number(fila.id) : null;
}

/** El cliente con ese nombre o uno nuevo. */
async function clientePara(e, nombre, cuit) {
  const [igual] = (await sbGet(`fin_clientes?empresa_id=eq.${e}&nombre=ilike.${sinComodines(nombre)}&activo=eq.true&select=id&limit=1`, { silent: true, fallback: [] })) || [];
  if (igual?.id) return Number(igual.id);
  const ahora = new Date().toISOString();
  const [fila] = (await sbPost("fin_clientes", { empresa_id: e, nombre: nombre.slice(0, 120), cuit: cuitConGuiones(cuit), created_at: ahora, updated_at: ahora })) || [];
  return fila?.id ? Number(fila.id) : null;
}

/** Deja anotado en la agenda (hoja PERSONAS) que esa persona ahora es proveedor o cliente. */
async function anotarEnPersona(e, entrada, cambios) {
  try {
    const ahora = new Date().toISOString();
    if (entrada.persona_id) {
      await sbPatch(`fin_personas?id=eq.${entrada.persona_id}&empresa_id=eq.${e}`, { ...cambios, updated_at: ahora });
      return;
    }
    // Era solo proveedor o solo cliente: se crea su renglón para que queden juntos
    const ambos = { proveedor_id: entrada.proveedor_id || null, cliente_id: entrada.cliente_id || null, ...cambios };
    if (!ambos.proveedor_id || !ambos.cliente_id) return;
    await sbPost("fin_personas", { empresa_id: e, nombre: entrada.nombre, alias: [], cuit: entrada.cuit || null, ...ambos, created_at: ahora, updated_at: ahora });
  } catch (err) {
    if (!sinTabla(err)) throw err; // sin la migración 180 no hay agenda de personas: no pasa nada
  }
}

/** Le da el rol a alguien que ya está en la agenda. */
async function darRol(e, entrada, rol, cuit) {
  if (tieneRol(entrada, rol)) return entrada;
  const id = rol === "cliente" ? await clientePara(e, entrada.nombre, entrada.cuit || cuit) : await proveedorPara(e, entrada.nombre, entrada.cuit || cuit);
  if (!id) throw new Error(`No se pudo dar de alta el ${rol}`);
  const cambios = rol === "cliente" ? { cliente_id: id } : { proveedor_id: id };
  await anotarEnPersona(e, entrada, cambios);
  return { ...entrada, ...cambios };
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const d = await request.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    const { errores, alta } = validarAlta(d);
    if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
    if (alta.rol === "cliente" && !esDuenoFinanzas(sesion)) return NextResponse.json({ error: "Los clientes los da de alta el dueño" }, { status: 403 });
    if (!(await puedeDarAlta(sesion))) return NextResponse.json({ error: "No tenés permiso para dar de alta proveedores" }, { status: 403 });

    const e = sesion.empresa_id;
    const agenda = await cargarAgenda(e);
    const elegida = d.clave ? agenda.find((x) => x.clave === String(d.clave)) : null;
    if (d.clave && !elegida) return NextResponse.json({ error: "Esa persona ya no está en la agenda: volvé a buscar" }, { status: 404 });
    const { igual, parecidos } = elegida ? { igual: elegida, parecidos: [] } : buscarEnAgenda(alta, agenda);

    if (igual) {
      const ya = tieneRol(igual, alta.rol);
      const persona = await darRol(e, igual, alta.rol, alta.cuit);
      if (!ya) broadcastRefresh(e, alta.rol === "cliente" ? "finanzas" : "proveedores");
      return NextResponse.json({ ok: true, persona: personaElegible(persona), ya_estaba: ya, era_de_agenda: !ya });
    }
    if (parecidos.length && !d.es_otro) {
      return NextResponse.json({ ok: true, preguntar: true, parecidos: parecidos.map((p) => ({ ...personaElegible(p), texto: textoParecido(p) })) });
    }
    const id = alta.rol === "cliente" ? await clientePara(e, alta.nombre, alta.cuit) : await proveedorPara(e, alta.nombre, alta.cuit);
    if (!id) return NextResponse.json({ error: `No se pudo dar de alta el ${alta.rol}` }, { status: 500 });
    broadcastRefresh(e, alta.rol === "cliente" ? "finanzas" : "proveedores");
    const nueva = { clave: alta.rol === "cliente" ? `c${id}` : `p${id}`, nombre: alta.nombre, cuit: alta.cuit, proveedor_id: alta.rol === "proveedor" ? id : null, cliente_id: alta.rol === "cliente" ? id : null };
    return NextResponse.json({ ok: true, persona: personaElegible(nueva), nueva: true });
  } catch (err) {
    logger.error("[agenda] POST", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
