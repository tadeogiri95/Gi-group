// ═══════════════════════════════════════════════════════════
// API: /api/config-empresa/route.js — VERSIÓN SEGURA
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// Se elimina validarToken local y getEmpresaIdFromRequest.
// ═══════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { configPostBody, configPatchBody } from "../../lib/schemas";
import { validateBody, isUUID, safeErrorMessage } from "../../lib/validate";
import { logger } from "../../lib/logger";
import { rechazarSiSupervisor } from "../../lib/alcance";
import { ordenarPlantas } from "../../lib/plantas";
import { CLAVE_CAUSAS, normalizarCausas } from "../../lib/causas";
import { CLAVE_CHECKLIST, normalizarChecklist } from "../../lib/avance";
import { CLAVE_CHECKLIST_CARGA } from "../../lib/carga";
import { CLAVE_CHECKLIST_INSTALACION } from "../../lib/acta";
import { CLAVE_DEFECTOS, normalizarDefectos } from "../../lib/calidad";

// Sin la migración 099 no existe etapas.unidad
function faltaMigracion099(err) {
  return String(err?.message).includes("unidad");
}
function respuestaFalta099() {
  return NextResponse.json({ error: "Para guardar la unidad de la etapa falta correr la migración 099 en Supabase." }, { status: 409 });
}

// Sin la migración 100 no existe etapas.condicion_cierre
function faltaMigracion100(err) {
  return String(err?.message).includes("condicion_cierre");
}
function faltaMigracion112(err) {
  return /por_pieza|columna_pieza/.test(String(err?.message));
}
function respuestaFalta112() {
  return NextResponse.json({ error: "Para elegir qué etapas se escanean por pieza falta correr la migración 112 en Supabase." }, { status: 409 });
}
function respuestaFalta100() {
  return NextResponse.json({ error: "Para guardar la condición de cierre falta correr la migración 100 en Supabase." }, { status: 409 });
}

// Guarda un ajuste de la empresa en config_sistema (lo crea si no existe)
async function guardarConfig(empresaId, clave, valor) {
  const filtro = `config_sistema?empresa_id=eq.${empresaId}&clave=eq.${clave}`;
  const [existe] = (await sbGet(`${filtro}&select=clave&limit=1`)) || [];
  if (existe) await sbPatch(filtro, { valor });
  else await sbPost("config_sistema", { empresa_id: empresaId, clave, valor });
}

// ─── Helper: extraer empresa_id del request via auth compartido ───
async function getEmpresaIdFromRequest(request) {
  const sesion = await validarToken(request);
  return sesion?.empresa_id || null;
}

// sbPost/sbPatch lanzan Error(`POST ${path}: ${textoCrudoDePostgres}`) — un
// duplicate key (23505, ej. código de etapa o clave de división repetida
// dentro de la misma empresa) es un conflicto esperable del usuario, no un
// error interno: se detecta acá para devolver un 409 específico en vez de
// caer en el catch genérico de 500.
function esViolacionUnica(err) {
  return typeof err?.message === "string" && err.message.includes('"code":"23505"');
}

async function perteneceAEmpresa(tabla, id, empresaId) {
  const rows = await sbGet(`${tabla}?id=eq.${id}&select=empresa_id`);
  return rows.length > 0 && rows[0].empresa_id === empresaId;
}

// Baja de una planta: su gente y sus puntos de fichaje pasan a la principal,
// así nadie queda sin planta ni sin poder fichar. La principal no se da de baja.
async function darDeBajaPlanta(empresaId, id) {
  const plantas = await sbGet(`plantas?empresa_id=eq.${empresaId}&activa=eq.true&select=id,principal`);
  const planta = plantas.find((p) => p.id === id);
  if (!planta) return NextResponse.json({ error: "Planta no encontrada" }, { status: 404 });
  if (planta.principal) {
    return NextResponse.json({ error: "La planta principal no se puede dar de baja. Podés cambiarle el nombre." }, { status: 400 });
  }
  const principal = plantas.find((p) => p.principal);
  if (!principal) return NextResponse.json({ error: "Tu empresa no tiene planta principal" }, { status: 409 });
  const [movidos] = await Promise.all([
    sbPatch(`empleados?empresa_id=eq.${empresaId}&planta_id=eq.${id}`, { planta_id: principal.id }),
    sbPatch(`geo_zonas?empresa_id=eq.${empresaId}&planta_id=eq.${id}`, { planta_id: principal.id }),
  ]);
  await sbPatch(`plantas?id=eq.${id}&empresa_id=eq.${empresaId}`, { activa: false });
  return NextResponse.json({ ok: true, empleados_movidos: movidos?.length || 0 });
}

// ═══ GET ═══
export async function GET(request) {
  try {
    const empresaId = await getEmpresaIdFromRequest(request);
    if (!empresaId) return respuestaNoAutorizado();

    const [divisiones, etapas, plantas, causas, checklist, defectos, checklistCarga, checklistInstalacion] = await Promise.all([
      sbGet(`divisiones?empresa_id=eq.${empresaId}&activa=eq.true&order=orden.asc`),
      sbGet(`etapas?empresa_id=eq.${empresaId}&activa=eq.true&order=orden.asc`),
      // Sin la migración 084 la tabla no existe: la app sigue como con una sola planta
      sbGet(`plantas?empresa_id=eq.${empresaId}&activa=eq.true&select=id,nombre,direccion,principal`, { silent: true, fallback: [] }),
      // Causas de parada propias (099); sin lista, la app usa las de siempre
      sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_CAUSAS}&select=valor&limit=1`, { silent: true, fallback: [] }),
      // Checklist de liberación de la OT (100)
      sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_CHECKLIST}&select=valor&limit=1`, { silent: true, fallback: [] }),
      // Defectos de las no conformidades (101)
      sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_DEFECTOS}&select=valor&limit=1`, { silent: true, fallback: [] }),
      // Checklist de carga del camión (104)
      sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_CHECKLIST_CARGA}&select=valor&limit=1`, { silent: true, fallback: [] }),
      // Checklist de instalación en obra (105)
      sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_CHECKLIST_INSTALACION}&select=valor&limit=1`, { silent: true, fallback: [] }),
    ]);
    return NextResponse.json({
      divisiones: divisiones || [], etapas: etapas || [], plantas: ordenarPlantas(plantas),
      causas_parada: normalizarCausas(causas?.[0]?.valor?.lista),
      checklist_liberacion: normalizarChecklist(checklist?.[0]?.valor?.lista),
      defectos: normalizarDefectos(defectos?.[0]?.valor?.lista),
      checklist_carga: normalizarChecklist(checklistCarga?.[0]?.valor?.lista),
      checklist_instalacion: normalizarChecklist(checklistInstalacion?.[0]?.valor?.lista),
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    logger.error("[config-empresa] GET Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

// ═══ POST ═══
export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
    const bloqueoSupervisor = await rechazarSiSupervisor(sesion);
    if (bloqueoSupervisor) return bloqueoSupervisor;
    const empresaId = sesion.empresa_id;

    const rawBody = await request.json();
    const parsed = validateBody(configPostBody, rawBody);
    if (parsed.response) return parsed.response;
    const body = parsed.data;
    const { action } = body;

    if (action === "add_division") {
      const { clave, label, icon, color, orden } = body;
      try {
        const result = await sbPost("divisiones", {
          empresa_id: empresaId, clave, label,
          icon: icon || "📦", color: color || "#F97316", orden: orden || 99,
        });
        return NextResponse.json({ division: result[0] });
      } catch (err) {
        if (esViolacionUnica(err)) {
          return NextResponse.json({ error: "Ya existe una división con esa clave en tu empresa." }, { status: 409 });
        }
        throw err;
      }
    }

    if (action === "add_etapa") {
      const { nombre, icon, color, orden, unidad, condicion_cierre, por_pieza, columna_pieza } = body;
      if (!nombre) return NextResponse.json({ error: "nombre requerido" }, { status: 400 });
      let { codigo } = body;
      if (codigo === undefined) {
        // El siguiente número libre, contando también las etapas dadas de baja
        // (siguen ocupando su código)
        const [ultima] = await sbGet(`etapas?empresa_id=eq.${empresaId}&select=codigo&order=codigo.desc&limit=1`) || [];
        codigo = Math.max(0, Number(ultima?.codigo) || 0) + 1;
      }
      try {
        const result = await sbPost("etapas", {
          empresa_id: empresaId, codigo, nombre,
          icon: icon || "🔨", color: color || "#F97316", orden: orden || 99,
          ...(unidad ? { unidad } : {}),
          ...(condicion_cierre ? { condicion_cierre } : {}),
          ...(por_pieza ? { por_pieza } : {}),
          ...(columna_pieza ? { columna_pieza } : {}),
        });
        return NextResponse.json({ etapa: result[0] });
      } catch (err) {
        if (esViolacionUnica(err)) {
          return NextResponse.json({ error: "Ya existe una etapa con ese código en tu empresa." }, { status: 409 });
        }
        if (unidad && faltaMigracion099(err)) return respuestaFalta099();
        if (condicion_cierre && faltaMigracion100(err)) return respuestaFalta100();
        if ((por_pieza || columna_pieza) && faltaMigracion112(err)) return respuestaFalta112();
        throw err;
      }
    }

    if (action === "add_planta") {
      try {
        const [planta] = await sbPost("plantas", {
          empresa_id: empresaId, nombre: body.nombre, direccion: body.direccion || null,
        });
        return NextResponse.json({ planta });
      } catch (err) {
        if (esViolacionUnica(err)) {
          return NextResponse.json({ error: "Ya tenés una planta con ese nombre." }, { status: 409 });
        }
        throw err;
      }
    }

    if (action === "save_logo") {
      const { logo_url } = body;
      await sbPatch(`empresa?id=eq.${empresaId}`, { logo_url });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action inválido" }, { status: 400 });
  } catch (err) {
    logger.error("[config-empresa] POST Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

// ═══ PATCH ═══
export async function PATCH(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
    const bloqueoSupervisor = await rechazarSiSupervisor(sesion);
    if (bloqueoSupervisor) return bloqueoSupervisor;
    const empresaId = sesion.empresa_id;

    const rawBody = await request.json();
    const parsedPatch = validateBody(configPatchBody, rawBody);
    if (parsedPatch.response) return parsedPatch.response;
    const body = parsedPatch.data;
    const { action, id } = body;

    if (action === "update_division") {
      if (!(await perteneceAEmpresa("divisiones", id, empresaId)))
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      const { label, icon, color, orden, activa, ruta_etapas } = body;
      const updates = {};
      if (ruta_etapas !== undefined) updates.ruta_etapas = ruta_etapas?.length ? [...new Set(ruta_etapas)] : null;
      if (label !== undefined) updates.label = label;
      if (icon !== undefined) updates.icon = icon;
      if (color !== undefined) updates.color = color;
      if (orden !== undefined) updates.orden = orden;
      if (activa !== undefined) updates.activa = activa;
      try {
        const result = await sbPatch(`divisiones?id=eq.${id}&empresa_id=eq.${empresaId}`, updates);
        return NextResponse.json({ division: result[0] });
      } catch (err) {
        if (updates.ruta_etapas !== undefined && String(err?.message).includes("ruta_etapas")) {
          return NextResponse.json({ error: "Para guardar rutas falta correr la migración 098 en Supabase." }, { status: 409 });
        }
        throw err;
      }
    }

    if (action === "update_etapa") {
      if (!(await perteneceAEmpresa("etapas", id, empresaId)))
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      const { nombre, icon, color, codigo, orden, activa, unidad, condicion_cierre, por_pieza, columna_pieza } = body;
      const updates = {};
      if (por_pieza !== undefined) updates.por_pieza = por_pieza;
      if (columna_pieza !== undefined) updates.columna_pieza = columna_pieza;
      if (unidad !== undefined) updates.unidad = unidad;
      if (condicion_cierre !== undefined) updates.condicion_cierre = condicion_cierre;
      if (nombre !== undefined) updates.nombre = nombre;
      if (icon !== undefined) updates.icon = icon;
      if (color !== undefined) updates.color = color;
      if (codigo !== undefined) updates.codigo = codigo;
      if (orden !== undefined) updates.orden = orden;
      if (activa !== undefined) updates.activa = activa;
      try {
        const result = await sbPatch(`etapas?id=eq.${id}&empresa_id=eq.${empresaId}`, updates);
        return NextResponse.json({ etapa: result[0] });
      } catch (err) {
        if (esViolacionUnica(err)) {
          return NextResponse.json({ error: "Ya existe una etapa con ese código en tu empresa." }, { status: 409 });
        }
        if (updates.unidad !== undefined && faltaMigracion099(err)) return respuestaFalta099();
        if (updates.condicion_cierre !== undefined && faltaMigracion100(err)) return respuestaFalta100();
        if ((updates.por_pieza !== undefined || updates.columna_pieza !== undefined) && faltaMigracion112(err)) return respuestaFalta112();
        throw err;
      }
    }

    if (action === "update_causas") {
      // Lista de causas de parada de la empresa (099). Vacía = las de siempre.
      const lista = normalizarCausas(body.causas);
      if (lista.length !== body.causas.length) {
        return NextResponse.json({ error: "Hay códigos repetidos en las causas de parada." }, { status: 400 });
      }
      await guardarConfig(empresaId, CLAVE_CAUSAS, { lista });
      return NextResponse.json({ causas_parada: lista });
    }

    if (action === "update_checklist") {
      // Checklist de liberación de la OT (100). Vacío = sin checklist.
      const lista = normalizarChecklist(body.items);
      await guardarConfig(empresaId, CLAVE_CHECKLIST, { lista });
      return NextResponse.json({ checklist_liberacion: lista });
    }

    if (action === "update_checklist_carga") {
      // Checklist de carga del camión (104). Vacío = sin checklist.
      const lista = normalizarChecklist(body.items);
      await guardarConfig(empresaId, CLAVE_CHECKLIST_CARGA, { lista });
      return NextResponse.json({ checklist_carga: lista });
    }

    if (action === "update_checklist_instalacion") {
      // Checklist de instalación en obra (105). Vacío = sin checklist.
      const lista = normalizarChecklist(body.items);
      await guardarConfig(empresaId, CLAVE_CHECKLIST_INSTALACION, { lista });
      return NextResponse.json({ checklist_instalacion: lista });
    }

    if (action === "update_defectos") {
      // Defectos de las no conformidades (101). Vacía = los de siempre.
      const lista = normalizarDefectos(body.defectos);
      if (lista.length !== body.defectos.length) {
        return NextResponse.json({ error: "Hay códigos repetidos en los defectos." }, { status: 400 });
      }
      await guardarConfig(empresaId, CLAVE_DEFECTOS, { lista });
      return NextResponse.json({ defectos: lista });
    }

    if (action === "update_planta") {
      if (!(await perteneceAEmpresa("plantas", id, empresaId)))
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      const updates = {};
      if (body.nombre !== undefined) updates.nombre = body.nombre;
      if (body.direccion !== undefined) updates.direccion = body.direccion || null;
      try {
        const [planta] = await sbPatch(`plantas?id=eq.${id}&empresa_id=eq.${empresaId}`, updates);
        return NextResponse.json({ planta });
      } catch (err) {
        if (esViolacionUnica(err)) {
          return NextResponse.json({ error: "Ya tenés una planta con ese nombre." }, { status: 409 });
        }
        throw err;
      }
    }

    return NextResponse.json({ error: "action inválido" }, { status: 400 });
  } catch (err) {
    logger.error("[config-empresa] PATCH Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

// ═══ DELETE ═══
export async function DELETE(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
    const empresaId = sesion.empresa_id;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const id = searchParams.get("id");
    if (!id || !type) return NextResponse.json({ error: "type e id requeridos" }, { status: 400 });
    if (!isUUID(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

    if (type === "planta") {
      const bloqueoSupervisor = await rechazarSiSupervisor(sesion);
      if (bloqueoSupervisor) return bloqueoSupervisor;
      return darDeBajaPlanta(empresaId, id);
    }

    const tabla = type === "division" ? "divisiones" : type === "etapa" ? "etapas" : null;
    if (!tabla) return NextResponse.json({ error: "type inválido" }, { status: 400 });

    if (!(await perteneceAEmpresa(tabla, id, empresaId)))
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    await sbPatch(`${tabla}?id=eq.${id}&empresa_id=eq.${empresaId}`, { activa: false });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("[config-empresa] DELETE Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
