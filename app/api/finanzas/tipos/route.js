// /api/finanzas/tipos — Finanzas, parte 2: pasar a los tipos de operación
// nuevos (lista y equivalencias en app/lib/finanzasTipos.js). Sin migración.
//
//   GET → qué va a cambiar: cuántas operaciones de cada tipo viejo pasan a
//       cuál nuevo, las que no tenían tipo y se adivinan por sus cuentas, los
//       tipos que se crean y los que se apagan, y los proveedores con un tipo
//       viejo. También si ya se pasó.
//   POST { accion: "pasar" } → lo hace: crea o completa los tipos nuevos,
//       reescribe el tipo de las operaciones (todas, también las anuladas) y
//       de los proveedores, apaga los viejos y anota la fecha en
//       config_sistema ("finanzas_tipos"). Desde ahí el libro recibe la lista
//       y el script reescribe T-OPERACIONES (con copia de respaldo). Se puede
//       volver a apretar: lo que ya está igual no cambia.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbHeaders, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { CLAVE_TIPOS, TIPOS_NUEVOS, VERSION_TIPOS, planTipos } from "../../../lib/finanzasTipos";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const enc = (s) => encodeURIComponent(String(s));

async function config(e) {
  const [c] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_TIPOS}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  return c?.valor || null;
}

async function leerTodo(sesion) {
  const e = sesion.empresa_id;
  const [tipos, operaciones, proveedores, cuentas, tesoreria] = await Promise.all([
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,activo&order=codigo.asc`),
    leer(sesion, `fin_operaciones?empresa_id=eq.${e}&select=id,tipo,cuenta_debe,cuenta_haber&order=id.asc`, 300000),
    leer(sesion, `proveedores?empresa_id=eq.${e}&fin_tipo=not.is.null&select=id,fin_tipo`, 10000),
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,tipo,moneda`),
  ]);
  return { tipos, operaciones, proveedores, cuentas, tesoreria };
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  try {
    const datos = await leerTodo(sesion);
    const plan = planTipos(datos);
    return NextResponse.json({
      ...plan, adivinadas: plan.adivinadas.length,
      lista: TIPOS_NUEVOS.map((t) => ({ codigo: t.codigo, nombre: t.nombre, grupo: t.grupo, linea: t.linea, viejos: t.viejos })),
      pasado: (await config(sesion.empresa_id))?.pasado_at || null,
    });
  } catch (err) {
    return errorFinanzas(err, "tipos GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (d?.accion !== "pasar") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  try {
    const plan = planTipos(await leerTodo(sesion));

    // 1. Los tipos nuevos (alta o completar), antes de usarlos
    if (plan.crear.length) {
      const r = await fetch(`${SB_URL}/rest/v1/fin_tipos_operacion?on_conflict=empresa_id,codigo`, {
        method: "POST",
        headers: await sbHeaders({ sesion }, { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(plan.crear.map((t) => ({ ...t, empresa_id: e, updated_at: ahora }))),
      });
      if (!r.ok) throw new Error(`POST fin_tipos_operacion: ${await r.text()}`);
    }
    // 2. Las operaciones, de a un tipo viejo por vez (updated_at: el libro las vuelve a bajar)
    for (const c of plan.cambios) {
      await sbPatch(`fin_operaciones?empresa_id=eq.${e}&tipo=eq.${enc(c.viejo)}`, { tipo: c.nuevo, updated_at: ahora }, { sesion });
    }
    // Las que no tenían tipo, agrupadas por el tipo que se les adivinó
    const porNuevo = new Map();
    for (const a of plan.adivinadas) porNuevo.set(a.nuevo, [...(porNuevo.get(a.nuevo) || []), a.id]);
    for (const [nuevo, ids] of porNuevo) {
      for (let i = 0; i < ids.length; i += 200) {
        await sbPatch(`fin_operaciones?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + 200).join(",")})`, { tipo: nuevo, updated_at: ahora }, { sesion });
      }
    }
    // 3. Los proveedores con un tipo viejo
    for (const p of plan.proveedores) {
      await sbPatch(`proveedores?empresa_id=eq.${e}&fin_tipo=eq.${enc(p.viejo)}`, { fin_tipo: p.nuevo }, { sesion });
    }
    // 4. Los tipos viejos se apagan (no se borran)
    for (const codigo of plan.desactivar) {
      await sbPatch(`fin_tipos_operacion?empresa_id=eq.${e}&codigo=eq.${enc(codigo)}`, { activo: false, updated_at: ahora }, { sesion });
    }
    // 5. Queda anotado: el libro recibe la lista y su script reescribe T-OPERACIONES
    const valor = { version: VERSION_TIPOS, pasado_at: ahora };
    const ya = await config(e);
    if (ya) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_TIPOS}`, { valor });
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_TIPOS, valor });

    broadcastRefresh(e, "fin_operaciones");
    return NextResponse.json({
      ok: true, operaciones: plan.operaciones, tipos_creados: plan.crear.length, tipos_apagados: plan.desactivar.length,
      proveedores: plan.proveedores.reduce((s, p) => s + p.n, 0), sin_tipo: plan.sin_tipo,
    });
  } catch (err) {
    return errorFinanzas(err, "tipos POST");
  }
}
