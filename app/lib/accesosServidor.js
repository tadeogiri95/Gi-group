// app/lib/accesosServidor.js — Lee y aplica los accesos por persona
// (migración 181; reglas en app/lib/accesos.js).
//
// accesos_personas solo la usa el servidor con la service key (RLS sin
// permisos para la app). Se guarda un minuto por empresa; al cambiar algo
// desde Más → Accesos se borra.
import { NextResponse } from "next/server";
import { accesoDe, accesoSinMigracion, esOficina, MENSAJE_SIN_CONFIGURAR } from "./accesos";
import { MODULOS } from "./modulos";
import { requireModulo } from "./planEnforcement";

const CACHE_MS = 60 * 1000;
const cache = new Map(); // empresa_id → { ts, filas, titularId, sinMigracion }

export function invalidarCacheAccesos(empresaId) {
  if (empresaId) cache.delete(empresaId);
  else cache.clear();
}

function headers() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

const faltaTabla = (status, texto) => (status === 404 || status === 400 || status === 500)
  && /accesos_personas|42P01|PGRST20[05]|schema cache/.test(texto);

/**
 * Sin titular marcado (una empresa nueva, después de la 181), el titular es el
 * Dueño con el email de la empresa o, si no aparece, el Dueño más antiguo.
 */
async function titularPorDefecto(empresaId) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const [rEmp, rDuenos] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/empresa?id=eq.${empresaId}&select=admin_email&limit=1`, { headers: headers() }),
    fetch(`${SB_URL}/rest/v1/empleados?empresa_id=eq.${empresaId}&rol=eq.gerencial&activo=eq.true&select=id,email,created_at&order=created_at.asc&limit=50`, { headers: headers() }),
  ]);
  if (!rEmp.ok || !rDuenos.ok) return null;
  const email = String((await rEmp.json())?.[0]?.admin_email || "").toLowerCase();
  const duenos = await rDuenos.json();
  const conEmail = email ? duenos.find((d) => String(d.email || "").toLowerCase() === email) : null;
  return (conEmail || duenos[0])?.id || null;
}

/** { filas: Map(empleado_id → fila), titularId, sinMigracion } de la empresa. */
export async function leerAccesos(empresaId) {
  const guardado = cache.get(empresaId);
  if (guardado && Date.now() - guardado.ts < CACHE_MS) return guardado;
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const r = await fetch(
    `${SB_URL}/rest/v1/accesos_personas?empresa_id=eq.${empresaId}&select=empleado_id,es_titular,puede_configurar,modulos_ocultos,actualizado_en`,
    { headers: headers() }
  );
  let dato;
  if (r.ok) {
    const lista = await r.json();
    const filas = new Map(lista.map((f) => [f.empleado_id, f]));
    const titularId = lista.find((f) => f.es_titular)?.empleado_id || (await titularPorDefecto(empresaId));
    dato = { ts: Date.now(), filas, titularId, sinMigracion: false };
  } else {
    const texto = await r.text().catch(() => "");
    if (!faltaTabla(r.status, texto)) throw new Error(`No se pudieron leer los accesos (HTTP ${r.status})`);
    dato = { ts: Date.now(), filas: new Map(), titularId: null, sinMigracion: true };
  }
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  cache.set(empresaId, dato);
  return dato;
}

/** Acceso de la sesión: { titular, puede_configurar, ocultos[, sin_migracion] }. */
export async function accesoSesion(sesion) {
  if (!sesion?.empresa_id || !esOficina(sesion.rol)) return accesoDe({ rol: sesion?.rol });
  const { filas, titularId, sinMigracion } = await leerAccesos(sesion.empresa_id);
  if (sinMigracion) return accesoSinMigracion(sesion.rol);
  const titular = !!sesion.empleado_id && sesion.empleado_id === titularId;
  return accesoDe({ rol: sesion.rol, fila: filas.get(sesion.empleado_id) || null, titular });
}

/** 403 si el titular le ocultó el módulo a esta persona; null para seguir. */
export async function rechazarSiOculto(sesion, modulo) {
  const { ocultos } = await accesoSesion(sesion);
  if (!ocultos.includes(modulo)) return null;
  const nombre = MODULOS[modulo]?.nombre || modulo;
  return NextResponse.json(
    { ok: false, error: `No tenés acceso a ${nombre}. Lo habilita el titular de la cuenta.`, tipo: "sin_acceso", modulo },
    { status: 403 }
  );
}

/** Como requireModulo (la empresa lo tiene) y además la persona lo puede ver. */
export async function requireModuloSesion(sesion, modulo) {
  return (await requireModulo(sesion.empresa_id, modulo)) || (await rechazarSiOculto(sesion, modulo));
}

/** 403 si la persona no puede cambiar la configuración; null para seguir. */
export async function rechazarSiNoConfigura(sesion) {
  const { puede_configurar } = await accesoSesion(sesion);
  if (puede_configurar) return null;
  return NextResponse.json({ ok: false, error: MENSAJE_SIN_CONFIGURAR, tipo: "sin_configurar" }, { status: 403 });
}
