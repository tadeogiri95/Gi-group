// POST /api/carga — Acopio y carga de cada OT (Órdenes de Producción, parte
// 10; ítem 39; migración 104).
//
// Body: { accion, ... }. Lo hace cualquiera de la empresa (el responsable de
// acopio y carga suele ser un operario), salvo desfirmar, que es de gestión.
//   bulto_agregar / bulto_borrar / bulto_tildar
//   bultos_pegar → varios bultos de una vez (columna ETIQUETA de la planilla),
//                  numerados a continuación de los que ya hay
//   checklist  → los puntos del checklist de carga tildados
//   faltantes  → qué falta y cuándo se entrega
//   foto       → la foto de la carga completa (subida por /api/upload)
//   firmar     → quien carga o el responsable de instalación, cada uno con su
//                usuario. Con todo cargado y tildado, o con el faltante anotado.
//   desfirmar  → gestión: borra las dos firmas para corregir la carga
// Con una firma puesta, la carga queda cerrada hasta que se desfirma.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { cargaBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { CLAVE_CHECKLIST_CARGA, estadoCarga } from "../../lib/carga";
import { normalizarChecklist } from "../../lib/avance";
import { logger } from "../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function faltaMigracion(err) {
  const m = String(err?.message);
  return m.includes("bultos_ot") || m.includes("cargas_ot");
}

const json = (body, status = 200) => NextResponse.json(body, { status });
const CERRADA = "La carga ya está firmada. Para cambiarla, un encargado tiene que deshacer las firmas.";

async function procesar(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const quien = sesion.empleado_id || null;
  const ahora = new Date().toISOString();

  // ─── La OT (por su número, o por el bulto) ───
  let bulto = null;
  let ot = datos.ot;
  if (datos.id) {
    [bulto] = (await sbGet(`bultos_ot?id=eq.${datos.id}&empresa_id=eq.${e}&select=id,ot,numero&limit=1`, opts)) || [];
    if (!bulto) return json({ error: "No encontré ese bulto" }, 404);
    ot = bulto.ot;
  } else {
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=id,ot&limit=1`, opts)) || [];
    if (!proyecto) return json({ error: "No encontré esa OT" }, 404);
    ot = proyecto.ot;
  }
  const otq = encodeURIComponent(ot);
  const filtroCarga = `cargas_ot?empresa_id=eq.${e}&ot=eq.${otq}`;
  const [carga] = (await sbGet(`${filtroCarga}&select=*&limit=1`, opts)) || [];
  const firmada = !!(carga?.firma_carga_por || carga?.firma_instalacion_por);

  const guardarCarga = async (cambios) => {
    const fila = { ...cambios, updated_at: ahora };
    const [res] = carga
      ? (await sbPatch(filtroCarga, fila, opts)) || []
      : (await sbPost("cargas_ot", { empresa_id: e, ot, ...fila }, opts)) || [];
    broadcastRefresh(e, "cargas_ot");
    return json({ ok: true, carga: res || null });
  };

  if (datos.accion === "desfirmar") {
    if (!ROLES_GESTION.has(sesion.rol)) return json({ error: "Solo un encargado puede deshacer las firmas" }, 403);
    if (!carga) return json({ ok: true, carga: null });
    return guardarCarga({ firma_carga_por: null, firma_carga_at: null, firma_instalacion_por: null, firma_instalacion_at: null });
  }

  if (datos.accion === "firmar") {
    const col = datos.rol === "carga" ? "firma_carga" : "firma_instalacion";
    const otra = datos.rol === "carga" ? "firma_instalacion" : "firma_carga";
    if (carga?.[`${col}_por`]) return json({ error: "Esa firma ya está puesta" }, 409);
    if (quien && carga?.[`${otra}_por`] === quien) {
      return json({ error: "Las dos firmas tienen que ser de personas distintas: quien carga y el responsable de instalación" }, 400);
    }
    const [bultos, sueltos, config] = await Promise.all([
      sbGet(`bultos_ot?empresa_id=eq.${e}&ot=eq.${otq}&select=cargado`, opts),
      sbGet(`sueltos_ot?empresa_id=eq.${e}&ot=eq.${otq}&select=carga`, { ...opts, silent: true, fallback: [] }),
      sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CHECKLIST_CARGA}&select=valor&limit=1`, { ...opts, silent: true, fallback: [] }),
    ]);
    const estado = estadoCarga({ bultos: bultos || [], sueltos: sueltos || [], carga, checklist: config?.[0]?.valor?.lista });
    if (!estado.puedeFirmar) {
      const motivo = estado.bultos ? `${estado.pendientes.join(". ")}. Completalo o anotá el faltante con su fecha.` : "Primero armá la lista de bultos.";
      return json({ error: motivo, pendientes: estado.pendientes }, 400);
    }
    return guardarCarga({ [`${col}_por`]: quien, [`${col}_at`]: ahora });
  }

  if (firmada) return json({ error: CERRADA }, 409);

  switch (datos.accion) {
    case "bulto_agregar": {
      const [ultimo] = (await sbGet(`bultos_ot?empresa_id=eq.${e}&ot=eq.${otq}&select=numero&order=numero.desc&limit=1`, opts)) || [];
      const numero = (ultimo?.numero || 0) + 1;
      if (numero > 999) return json({ error: "Una OT tiene hasta 999 bultos" }, 400);
      const [fila] = (await sbPost("bultos_ot", { empresa_id: e, ot, numero, contenido: datos.contenido ?? null, creado_por: quien }, opts)) || [];
      broadcastRefresh(e, "bultos_ot");
      return json({ ok: true, bulto: fila || null });
    }
    case "bultos_pegar": {
      const [ultimo] = (await sbGet(`bultos_ot?empresa_id=eq.${e}&ot=eq.${otq}&select=numero&order=numero.desc&limit=1`, opts)) || [];
      const desde = (ultimo?.numero || 0) + 1;
      if (desde + datos.contenidos.length - 1 > 999) return json({ error: "Una OT tiene hasta 999 bultos" }, 400);
      const filas = datos.contenidos.map((contenido, i) => ({ empresa_id: e, ot, numero: desde + i, contenido, creado_por: quien }));
      const creados = (await sbPost("bultos_ot", filas, opts)) || [];
      broadcastRefresh(e, "bultos_ot");
      return json({ ok: true, bultos: creados });
    }
    case "bulto_tildar": {
      const cambios = datos.valor ? { cargado: true, cargado_por: quien, cargado_at: ahora } : { cargado: false, cargado_por: null, cargado_at: null };
      const [fila] = (await sbPatch(`bultos_ot?id=eq.${bulto.id}&empresa_id=eq.${e}`, cambios, opts)) || [];
      broadcastRefresh(e, "bultos_ot");
      return json({ ok: true, bulto: fila || null });
    }
    case "bulto_borrar": {
      await sbDelete(`bultos_ot?id=eq.${bulto.id}&empresa_id=eq.${e}`, opts);
      // Los que siguen se corren un número: la lista queda "1 de N" sin huecos
      const siguientes = (await sbGet(`bultos_ot?empresa_id=eq.${e}&ot=eq.${otq}&numero=gt.${bulto.numero}&select=id,numero&order=numero.asc`, opts)) || [];
      for (const b of siguientes) await sbPatch(`bultos_ot?id=eq.${b.id}&empresa_id=eq.${e}`, { numero: b.numero - 1 }, opts);
      broadcastRefresh(e, "bultos_ot");
      return json({ ok: true });
    }
    case "checklist":
      return guardarCarga({ checklist: normalizarChecklist(datos.items) });
    case "faltantes":
      return guardarCarga({ faltantes: datos.texto, faltantes_fecha: datos.texto ? datos.fecha : null });
    case "foto": {
      // Solo fotos subidas por /api/upload para esta empresa
      if (datos.url && !datos.url.startsWith(`${SB_URL}/storage/v1/object/public/reportes-obra/${e}/`)) {
        return json({ error: "La foto tiene que subirse desde la app" }, 400);
      }
      return guardarCarga({ foto_url: datos.url });
    }
    default:
      return json({ error: "Acción desconocida" }, 400);
  }
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(cargaBody, raw);
    if (parsed.response) return parsed.response;
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;
    try {
      return await procesar(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) return json({ error: "Para acopio y carga falta correr la migración 104 en Supabase." }, 409);
      throw err;
    }
  } catch (err) {
    logger.error("[carga] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
