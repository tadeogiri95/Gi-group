// app/api/accesos/route.js — Más → 🔐 Accesos (migración 181; reglas en
// app/lib/accesos.js). Solo el titular de la cuenta.
//
//   GET   → la gente de la oficina (Dueños, Supervisores y Administración) con
//           lo que ve cada uno y si puede configurar, y los módulos de la empresa.
//   PATCH { empleado_id, puede_configurar?, modulos_ocultos? } → cambia el
//           acceso de una persona.
//   PATCH { empleado_id, titular: true } → pasa la titularidad a otro Dueño
//           (el que la deja sigue viendo todo y configurando).
//
// accesos_personas solo la usa el servidor con la service key.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { getModulosEmpresa } from "../../lib/planEnforcement";
import { accesoSesion, leerAccesos, invalidarCacheAccesos } from "../../lib/accesosServidor";
import { accesoDe, limpiarOcultos, MODULOS_SOLO_DUENO } from "../../lib/accesos";
import { MODULOS } from "../../lib/modulos";
import { logAudit } from "../../lib/audit";
import { ipCliente } from "../../lib/ip";
import { isUUID, safeErrorMessage } from "../../lib/validate";

const FALTA_MIGRACION = "Para elegir los accesos de cada persona falta correr la migración 181 en Supabase.";

const sb = () => ({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
const headers = (extra = {}) => ({ apikey: sb().key, Authorization: `Bearer ${sb().key}`, "Content-Type": "application/json", ...extra });

async function sesionTitular(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  const acceso = await accesoSesion(sesion);
  if (acceso.sin_migracion) return { response: NextResponse.json({ error: FALTA_MIGRACION, falta_migracion: true }, { status: 409 }) };
  if (!acceso.titular) return { response: NextResponse.json({ error: "Los accesos los da solo el titular de la cuenta." }, { status: 403 }) };
  return { sesion };
}

async function oficina(empresaId) {
  const r = await fetch(
    `${sb().url}/rest/v1/empleados?empresa_id=eq.${empresaId}&rol=in.(gerencial,administrativo)&activo=eq.true&select=id,nombre,apodo,legajo,rol,solo_su_division&order=nombre.asc`,
    { headers: headers() }
  );
  if (!r.ok) throw new Error(`No se pudo leer el personal (HTTP ${r.status})`);
  return r.json();
}

async function estado(empresaId) {
  const [gente, { filas, titularId }, { modulos }] = await Promise.all([
    oficina(empresaId),
    leerAccesos(empresaId),
    getModulosEmpresa(empresaId),
  ]);
  const personas = gente.map((p) => {
    const a = accesoDe({ rol: p.rol, fila: filas.get(p.id) || null, titular: p.id === titularId });
    return {
      id: p.id,
      nombre: p.nombre,
      apodo: p.apodo || null,
      legajo: p.legajo,
      rol: p.rol,
      supervisor: p.rol === "administrativo" && !!p.solo_su_division,
      titular: a.titular,
      puede_configurar: a.puede_configurar,
      ocultos: a.ocultos.filter((m) => modulos.includes(m)),
      a_mano: filas.has(p.id),
    };
  });
  personas.sort((x, y) => Number(y.titular) - Number(x.titular));
  return {
    personas,
    modulos: modulos.map((id) => ({ id, nombre: MODULOS[id]?.nombre || id, solo_dueno: MODULOS_SOLO_DUENO.includes(id) })),
  };
}

async function guardar(empresaId, fila) {
  const r = await fetch(`${sb().url}/rest/v1/accesos_personas?on_conflict=empresa_id,empleado_id`, {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ ...fila, empresa_id: empresaId, actualizado_en: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`No se pudo guardar el acceso (HTTP ${r.status}): ${await r.text().catch(() => "")}`);
}

export async function GET(request) {
  try {
    const { sesion, response } = await sesionTitular(request);
    if (response) return response;
    return NextResponse.json(await estado(sesion.empresa_id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { sesion, response } = await sesionTitular(request);
    if (response) return response;
    const e = sesion.empresa_id;
    const body = await request.json().catch(() => null);
    const empleadoId = typeof body?.empleado_id === "string" ? body.empleado_id : "";
    if (!isUUID(empleadoId)) return NextResponse.json({ error: "Persona inválida" }, { status: 400 });
    if (empleadoId === sesion.empleado_id) {
      return NextResponse.json({ error: "Tus propios accesos no se cambian: como titular ves y configurás todo." }, { status: 400 });
    }
    const persona = (await oficina(e)).find((p) => p.id === empleadoId);
    if (!persona) return NextResponse.json({ error: "Esa persona no es de la oficina de la empresa" }, { status: 404 });

    const { filas } = await leerAccesos(e);
    const antes = accesoDe({ rol: persona.rol, fila: filas.get(empleadoId) || null });

    if (body.titular === true) {
      if (persona.rol !== "gerencial") return NextResponse.json({ error: "La titularidad solo se pasa a otro Dueño." }, { status: 400 });
      await guardar(e, { empleado_id: empleadoId, es_titular: true, puede_configurar: true, modulos_ocultos: [], actualizado_por: sesion.empleado_id });
      await guardar(e, { empleado_id: sesion.empleado_id, es_titular: false, puede_configurar: true, modulos_ocultos: [], actualizado_por: sesion.empleado_id });
    } else {
      const puede = typeof body.puede_configurar === "boolean" ? body.puede_configurar : antes.puede_configurar;
      let ocultos = antes.ocultos;
      if (Array.isArray(body.modulos_ocultos)) {
        // La pantalla muestra solo los módulos prendidos: lo oculto de uno
        // apagado se conserva para cuando se vuelva a prender
        const { modulos } = await getModulosEmpresa(e);
        ocultos = limpiarOcultos([...body.modulos_ocultos, ...antes.ocultos.filter((m) => !modulos.includes(m))]);
      }
      // Finanzas: la base solo deja entrar al rol Dueño (RLS de la 171)
      if (persona.rol !== "gerencial") ocultos = [...new Set([...ocultos, ...MODULOS_SOLO_DUENO])];
      await guardar(e, { empleado_id: empleadoId, es_titular: false, puede_configurar: puede, modulos_ocultos: ocultos, actualizado_por: sesion.empleado_id });
    }
    invalidarCacheAccesos(e);

    logAudit({
      empresa_id: e,
      actor_id: sesion.empleado_id,
      actor_legajo: sesion.legajo,
      actor_rol: sesion.rol,
      accion: body.titular === true ? "pasar_titularidad" : "cambiar_accesos",
      entidad: "accesos_personas",
      entidad_id: empleadoId,
      datos_antes: antes,
      datos_despues: body.titular === true ? { titular: true } : { puede_configurar: body.puede_configurar, modulos_ocultos: body.modulos_ocultos },
      ip: ipCliente(request),
    });
    return NextResponse.json({ ok: true, ...(await estado(e)) });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
