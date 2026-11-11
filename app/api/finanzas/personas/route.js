// /api/finanzas/personas — Finanzas, parte 4 del plan del 11/11 (migración
// 180): la agenda única de clientes y proveedores (reglas en
// app/lib/finanzasPersonas.js).
//
//   GET → la agenda (personas + proveedores + clientes, sin repetir) y los
//       posibles repetidos para que el dueño decida.
//   POST { accion: "importar", texto, ver? } → lo pegado de la hoja PERSONAS.
//       Con ver: true solo dice qué haría. Lo que ya está no se duplica: se le
//       completan los datos que le faltan.
//   POST { accion: "guardar", clave, persona } → guarda los datos de un renglón
//       de la agenda (y los copia al proveedor y al cliente que le corresponden).
//   POST { accion: "unir", a, b } → b es la misma persona que a: queda como otro
//       nombre de a.
//   POST { accion: "proveedor", clave } → lo da de alta como proveedor (si no lo
//       era) y devuelve proveedor_id, para elegirlo en un pago o un cheque.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { CLAVE_UNIFICADOS, leerPares } from "../../../lib/finanzasUnificados";
import {
  CAMPOS_PERSONA, armarAgenda, leerPersonasPegadas, planImportarPersonas, posiblesRepetidos, validarPersona,
} from "../../../lib/finanzasPersonas";

const COLS_PERSONA = "id,nombre,alias,cuit,telefono,email,direccion,contacto,notas,id_planilla,proveedor_id,cliente_id,activo,unido_a";
const FALTA_180 = "Para la agenda de personas falta correr la migración 180 en Supabase.";
const falta180 = (err) => /fin_personas/.test(String(err?.message)) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(String(err?.message));
const MAX_PEGADO = 400000;

const leer = (sesion, path, maxFilas = 10000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

async function cargar(sesion) {
  const e = sesion.empresa_id;
  const [personas, proveedores, clientes, pares] = await Promise.all([
    leer(sesion, `fin_personas?empresa_id=eq.${e}&select=${COLS_PERSONA}&order=nombre.asc,id.asc`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,cuit,contacto,whatsapp,email,notas,activo&order=nombre.asc`),
    leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,cuit,telefono,email,notas,alias,activo,unido_a&order=nombre.asc`).catch(() => []),
    sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_UNIFICADOS}&select=valor&limit=1`, { silent: true, fallback: [] }).then((r) => leerPares(r?.[0]?.valor)),
  ]);
  return { personas, agenda: armarAgenda({ personas, proveedores, clientes, pares }) };
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  try {
    const { personas, agenda } = await cargar(sesion);
    return NextResponse.json({ agenda, repetidos: posiblesRepetidos(agenda), personas_cargadas: personas.filter((p) => p.activo !== false).length });
  } catch (err) {
    if (falta180(err)) return NextResponse.json({ error: FALTA_180, falta_migracion: 180 }, { status: 409 });
    return errorFinanzas(err, "personas GET");
  }
}

/** Solo los datos con algo escrito (para completar lo que falta sin borrar). */
const conDatos = (d) => Object.fromEntries(Object.entries(d || {}).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)));

/** Crea la persona de un renglón que todavía no la tiene (solo era proveedor o cliente). */
async function asegurarPersona(sesion, entrada, datos = {}) {
  if (entrada.persona_id) return entrada.persona_id;
  const ahora = new Date().toISOString();
  const fila = {
    empresa_id: sesion.empresa_id, nombre: entrada.nombre, alias: datos.alias || [],
    proveedor_id: entrada.proveedor_id || null, cliente_id: entrada.cliente_id || null, created_at: ahora, updated_at: ahora,
  };
  for (const c of [...CAMPOS_PERSONA, "id_planilla"]) fila[c] = datos[c] ?? entrada[c] ?? null;
  const [nueva] = (await sbPost("fin_personas", fila, { sesion })) || [];
  return nueva?.id || null;
}

/** Copia los datos al proveedor y al cliente del renglón. */
async function copiarA(sesion, entrada, p) {
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  if (entrada.proveedor_id) {
    const cambios = conDatos({ cuit: p.cuit, email: p.email, whatsapp: p.telefono ? String(p.telefono).slice(0, 30) : null, contacto: p.contacto ? String(p.contacto).slice(0, 120) : null, notas: p.notas ? String(p.notas).slice(0, 300) : null });
    if (Object.keys(cambios).length) await sbPatch(`proveedores?id=eq.${entrada.proveedor_id}&empresa_id=eq.${e}`, { ...cambios, updated_at: ahora }, { sesion });
  }
  if (entrada.cliente_id) {
    const cambios = conDatos({ cuit: p.cuit, email: p.email ? String(p.email).slice(0, 120) : null, telefono: p.telefono ? String(p.telefono).slice(0, 40) : null, notas: p.notas });
    if (Object.keys(cambios).length) await sbPatch(`fin_clientes?id=eq.${entrada.cliente_id}&empresa_id=eq.${e}`, { ...cambios, updated_at: ahora }, { sesion });
  }
}

async function importar(sesion, d, agenda) {
  const texto = String(d.texto || "");
  if (texto.length > MAX_PEGADO) return NextResponse.json({ error: "Es demasiado texto: pegá la hoja en dos partes." }, { status: 400 });
  const filas = leerPersonasPegadas(texto);
  if (!filas.length) return NextResponse.json({ error: "No encontré nombres en lo pegado. Copiá la hoja PERSONAS desde los títulos (ID, NOMBRE…)." }, { status: 400 });
  const plan = planImportarPersonas(filas, agenda);
  const resumen = { leidas: filas.length, nuevas: plan.nuevas.length, completar: plan.completar.filter((c) => Object.keys(c.datos).length).length, iguales: plan.iguales, juntadas: plan.juntadas };
  if (d.ver) return NextResponse.json({ ok: true, ver: true, resumen, ejemplos: plan.nuevas.slice(0, 8).map((n) => n.nombre) });
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  const nuevas = plan.nuevas.map((n) => ({
    empresa_id: e, nombre: n.nombre, alias: n.alias || [], created_at: ahora, updated_at: ahora,
    ...Object.fromEntries([...CAMPOS_PERSONA, "id_planilla"].map((c) => [c, n[c] || null])),
  }));
  for (let i = 0; i < nuevas.length; i += 500) await sbPost("fin_personas", nuevas.slice(i, i + 500), { sesion });
  for (const { entrada, datos } of plan.completar) {
    if (!entrada.persona_id) { await asegurarPersona(sesion, entrada, datos); continue; }
    if (!Object.keys(datos).length) continue;
    const cambios = { ...datos, updated_at: ahora };
    if (datos.alias) cambios.alias = [...new Set([...(entrada.alias || []), ...datos.alias])].slice(0, 30);
    await sbPatch(`fin_personas?id=eq.${entrada.persona_id}&empresa_id=eq.${e}`, cambios, { sesion });
  }
  broadcastRefresh(e, "finanzas");
  return NextResponse.json({ ok: true, resumen });
}

async function guardar(sesion, d, agenda) {
  const entrada = agenda.find((x) => x.clave === d.clave);
  const { persona, errores } = validarPersona(d.persona || {});
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  if (!entrada) {
    const [nueva] = (await sbPost("fin_personas", { ...persona, empresa_id: e, created_at: ahora, updated_at: ahora }, { sesion })) || [];
    broadcastRefresh(e, "finanzas");
    return NextResponse.json({ ok: true, persona_id: nueva?.id || null });
  }
  const id = await asegurarPersona(sesion, entrada, persona);
  await sbPatch(`fin_personas?id=eq.${id}&empresa_id=eq.${e}`, { ...persona, updated_at: ahora }, { sesion });
  await copiarA(sesion, entrada, persona);
  broadcastRefresh(e, "finanzas");
  return NextResponse.json({ ok: true, persona_id: id });
}

async function unir(sesion, d, agenda) {
  const a = agenda.find((x) => x.clave === d.a);
  const b = agenda.find((x) => x.clave === d.b);
  if (!a || !b || a === b) return NextResponse.json({ error: "Elegí dos personas distintas de la lista" }, { status: 400 });
  if (a.proveedor_id && b.proveedor_id && a.proveedor_id !== b.proveedor_id) {
    return NextResponse.json({ error: "Los dos son proveedores distintos en Compras: juntalos primero en Proveedores." }, { status: 400 });
  }
  if (a.cliente_id && b.cliente_id && a.cliente_id !== b.cliente_id) {
    return NextResponse.json({ error: "Los dos son clientes distintos: juntalos primero en 👥 Clientes (Unir)." }, { status: 400 });
  }
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  const idA = await asegurarPersona(sesion, a);
  const cambios = { updated_at: ahora, alias: [...new Set([...(a.alias || []), b.nombre, ...(b.alias || [])])].filter((n) => n !== a.nombre).slice(0, 30) };
  if (!a.proveedor_id && b.proveedor_id) cambios.proveedor_id = b.proveedor_id;
  if (!a.cliente_id && b.cliente_id) cambios.cliente_id = b.cliente_id;
  for (const c of [...CAMPOS_PERSONA, "id_planilla"]) if (!a[c] && b[c]) cambios[c] = b[c];
  await sbPatch(`fin_personas?id=eq.${idA}&empresa_id=eq.${e}`, cambios, { sesion });
  if (b.persona_id) await sbPatch(`fin_personas?id=eq.${b.persona_id}&empresa_id=eq.${e}`, { activo: false, unido_a: idA, proveedor_id: null, cliente_id: null, updated_at: ahora }, { sesion });
  broadcastRefresh(e, "finanzas");
  return NextResponse.json({ ok: true });
}

async function hacerProveedor(sesion, d, agenda) {
  const entrada = agenda.find((x) => x.clave === d.clave);
  if (!entrada) return NextResponse.json({ error: "Esa persona no está en la agenda" }, { status: 404 });
  if (entrada.proveedor_id) return NextResponse.json({ ok: true, proveedor_id: entrada.proveedor_id });
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  // Si ya hay un proveedor con ese nombre exacto (la base no deja repetirlo), se usa ese
  const [igual] = (await sbGet(`proveedores?empresa_id=eq.${e}&nombre=ilike.${encodeURIComponent(entrada.nombre.replace(/[%_*,()]/g, ""))}&select=id&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  const proveedorId = igual?.id || ((await sbPost("proveedores", {
    empresa_id: e, nombre: entrada.nombre.slice(0, 120), cuit: entrada.cuit || null, email: entrada.email || null,
    whatsapp: entrada.telefono ? String(entrada.telefono).slice(0, 30) : null, contacto: entrada.contacto ? String(entrada.contacto).slice(0, 120) : null,
    activo: true, created_at: ahora, updated_at: ahora,
  }, { sesion })) || [])[0]?.id;
  if (!proveedorId) return NextResponse.json({ error: "No se pudo dar de alta el proveedor" }, { status: 500 });
  const id = await asegurarPersona(sesion, { ...entrada, proveedor_id: proveedorId });
  await sbPatch(`fin_personas?id=eq.${id}&empresa_id=eq.${e}`, { proveedor_id: proveedorId, updated_at: ahora }, { sesion });
  broadcastRefresh(e, "finanzas");
  return NextResponse.json({ ok: true, proveedor_id: proveedorId });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!d || typeof d !== "object") return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const { agenda } = await cargar(sesion);
    if (d.accion === "importar") return await importar(sesion, d, agenda);
    if (d.accion === "guardar") return await guardar(sesion, d, agenda);
    if (d.accion === "unir") return await unir(sesion, d, agenda);
    if (d.accion === "proveedor") return await hacerProveedor(sesion, d, agenda);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    if (falta180(err)) return NextResponse.json({ error: FALTA_180, falta_migracion: 180 }, { status: 409 });
    return errorFinanzas(err, "personas POST");
  }
}
