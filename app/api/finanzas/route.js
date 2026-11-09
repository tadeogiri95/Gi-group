// /api/finanzas — Finanzas, parte F1a (migración 171; app/lib/finanzas.js).
//
//   GET  → configuración: plan de cuentas, tipos de operación, cajas y bancos,
//          centros de costo, y el personal (para elegir el responsable de una caja).
//   POST { accion: "importar", tabla, filas } → copia del libro: alta o
//          reemplazo por código (lo que no viene en el libro queda como está).
//          tabla = cuentas | tipos | tesoreria | centros.
//   POST { accion: "guardar", tabla, fila } → alta o edición de una fila.
//
// Solo el rol Dueño (gerencial). El Supervisor no entra (pedido de Tadeo,
// 09/11). Lee y escribe con el pase del usuario: la base también exige el rol
// gerencial (RLS de la 171).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { sbGetAll, sbHeaders } from "../../lib/sbHelpers";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { broadcastRefresh } from "../../lib/broadcast";
import { logger } from "../../lib/logger";
import { TABLAS_FIN, esDuenoFinanzas, limpiarFila, limpiarFilas } from "../../lib/finanzas";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const FALTA = "Para Finanzas falta correr la migración 171 en Supabase.";
const faltaMigracion = (err) => /fin_(cuentas|tipos_operacion|tesoreria|centros_costo|operaciones)/.test(String(err?.message))
  && /does not exist|42P01|PGRST20[05]|schema cache/.test(String(err?.message));
const TANDA = 500;

async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!esDuenoFinanzas(sesion)) return { response: NextResponse.json({ error: "Finanzas es solo para el dueño" }, { status: 403 }) };
  const sinModulo = await requireModulo(sesion.empresa_id, "finanzas");
  if (sinModulo) return { response: sinModulo };
  return { sesion };
}

function errorDe(err, donde) {
  if (faltaMigracion(err)) return NextResponse.json({ error: FALTA, falta_migracion: true }, { status: 409 });
  logger.error(`[finanzas] ${donde}`, err);
  return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
}

/** Alta o reemplazo por clave: filas nuevas entran, las que ya están se actualizan. */
async function upsert(sesion, tabla, filas) {
  const { tabla: t, clave } = TABLAS_FIN[tabla];
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  for (let i = 0; i < filas.length; i += TANDA) {
    const tanda = filas.slice(i, i + TANDA).map((f) => ({ ...f, empresa_id: e, updated_at: ahora }));
    const r = await fetch(`${SB_URL}/rest/v1/${t}?on_conflict=empresa_id,${clave}`, {
      method: "POST",
      headers: await sbHeaders({ sesion }, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(tanda),
    });
    if (!r.ok) throw new Error(`POST ${t}: ${await r.text()}`);
  }
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const leer = (path) => sbGetAll(path, { sesion, maxFilas: 5000 }).then((r) => r.data);
    const [cuentas, tipos, tesoreria, centros, personal] = await Promise.all([
      leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,naturaleza,activa&order=codigo.asc`),
      leer(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,base_contable,cuenta_debe,cuenta_haber,pide_entidad,pide_ot,pide_cc,descripcion,activo&order=codigo.asc`),
      leer(`fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,responsable_id,activa&order=cuenta.asc`),
      leer(`fin_centros_costo?empresa_id=eq.${e}&select=codigo,nombre,division,tipo,activo&order=codigo.asc`),
      leer(`empleados?empresa_id=eq.${e}&activo=eq.true&select=id,nombre&order=nombre.asc`),
    ]);
    return NextResponse.json({ cuentas, tipos, tesoreria, centros, personal });
  } catch (err) {
    return errorDe(err, "GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!d || typeof d !== "object") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  if (!TABLAS_FIN[d.tabla]) return NextResponse.json({ error: "Tabla desconocida" }, { status: 400 });
  try {
    if (d.accion === "importar") {
      const { filas, error } = limpiarFilas(d.tabla, d.filas);
      if (error) return NextResponse.json({ error }, { status: 400 });
      await upsert(sesion, d.tabla, filas);
      broadcastRefresh(sesion.empresa_id, TABLAS_FIN[d.tabla].tabla);
      return NextResponse.json({ ok: true, copiadas: filas.length });
    }
    if (d.accion === "guardar") {
      const { fila, error } = limpiarFila(d.tabla, d.fila);
      if (error) return NextResponse.json({ error }, { status: 400 });
      await upsert(sesion, d.tabla, [fila]);
      broadcastRefresh(sesion.empresa_id, TABLAS_FIN[d.tabla].tabla);
      return NextResponse.json({ ok: true, fila });
    }
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return errorDe(err, d.accion);
  }
}
