// /api/piezas/planillas — Piezas y módulos de cada OT cargados solos desde la
// carpeta de Drive con las planillas de despiece (Tadeo, 07/11;
// app/lib/planillaPiezas.js). Sin migración: todo en config_sistema
// (clave CLAVE_PLANILLAS_PIEZAS).
//
// PATCH → lo llama el script de Apps Script cada 15 minutos, con la clave
//         privada de la empresa (Authorization: Bearer gyp_…):
//   { accion: "lista", archivos: [{ nombre, id, fecha, bytes }] }
//       → { pedir: [{ ot, id, nombre }] } (los Excel que Gypi quiere leer)
//   { accion: "planilla", id, nombre, fecha, contenido } (contenido en base64)
//       → lee la hoja PLANILLA y carga las piezas de la OT.
//   Va con service_role, siempre filtrado por la empresa de la clave.
// POST  → gestión, con su sesión:
//   { accion: "conectar", carpeta } → clave nueva + código para pegar
//   { accion: "releer", ot }        → la próxima vuelta lee de nuevo el Excel
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { sbGet, sbGetAll, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { requireModulo } from "../../../lib/planEnforcement";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { broadcastRefresh } from "../../../lib/broadcast";
import { generarClave, empresaDeClave, claveValida } from "../../../lib/planillaMrp";
import { idCarpeta } from "../../../lib/pdfOt";
import { leerHojaXlsx } from "../../../lib/leerXlsx";
import { leerPiezas } from "../../../lib/piezas";
import { piezasBody } from "../../../lib/schemas";
import { guardarPiezas, reglasDeEmpresa } from "../../../lib/piezasServidor";
import {
  CLAVE_PLANILLAS_PIEZAS, HOJA_PIEZAS, MAX_BYTES_EXCEL, limpiarExcels, excelPorOt, excelsPendientes,
  tecnicaLista, textoDesdePanel, sinCodigo, resumenCarga, scriptCarpetaPiezas,
} from "../../../lib/planillaPiezas";
import { logger } from "../../../lib/logger";

export const maxDuration = 60;

const json = (body, status = 200) => NextResponse.json(body, { status });
const filtroCfg = (e) => `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLAS_PIEZAS}`;

async function leerConfig(e, opts = {}) {
  const [cfg] = (await sbGet(`${filtroCfg(e)}&select=valor&limit=1`, { silent: true, fallback: [], ...opts })) || [];
  return cfg?.valor || null;
}

/** OT de la empresa con el estado de Técnica (159). Sin la 159, ninguna está lista. */
async function proyectosDe(e) {
  try {
    const { data } = await sbGetAll(`proyectos?empresa_id=eq.${e}&select=ot,etapas_diseno&order=id.asc`, { maxFilas: 20000 });
    return data;
  } catch {
    const { data } = await sbGetAll(`proyectos?empresa_id=eq.${e}&select=ot&order=id.asc`, { maxFilas: 20000 });
    return data;
  }
}

/** El Excel del script → piezas de la OT. Devuelve el resumen que se guarda. */
async function cargarExcel(e, archivo, contenido, proyectos) {
  const ahora = new Date().toISOString();
  const ot = excelPorOt([archivo], proyectos).keys().next().value || null;
  if (!ot) return { ot: null, resumen: null, motivo: "El nombre del archivo no empieza con el número de una OT de Gypi" };
  const p = proyectos.find((x) => x.ot === ot);
  if (!tecnicaLista(p?.etapas_diseno)) return { ot, resumen: null, motivo: "La Técnica de esta OT todavía no está lista (columna EXCEL del Plan)" };
  const fallo = (error) => ({ ot, resumen: resumenCarga({ archivo, error, ahora }) });

  const bytes = Buffer.from(String(contenido || ""), "base64");
  if (!bytes.length) return fallo("el archivo llegó vacío");
  if (bytes.length > MAX_BYTES_EXCEL) return fallo("el archivo es demasiado grande");
  let filas;
  try {
    filas = leerHojaXlsx(new Uint8Array(bytes), HOJA_PIEZAS);
  } catch {
    return fallo("no es un Excel que Gypi pueda abrir");
  }
  if (!filas) return fallo(`no tiene la hoja ${HOJA_PIEZAS}`);
  const texto = textoDesdePanel(filas);
  if (!texto) return fallo("la hoja PLANILLA no tiene la columna PANEL");
  const reglas = await reglasDeEmpresa(e).catch(() => []);
  const vista = leerPiezas(texto, reglas);
  if (vista.faltaColumnas.length) return fallo(`a la hoja PLANILLA le falta: ${vista.faltaColumnas.join(", ")}`);
  const sinCod = sinCodigo(vista.renglones);
  const modulos = new Set(vista.renglones.map((r) => r.modulo).filter(Boolean)).size;
  const base = { archivo, renglones: vista.renglones.length, modulos, sinCod, errores: vista.errores, ahora };
  // Una planilla vacía (todavía sin piezas) no borra lo que ya había
  if (!vista.renglones.length) return { ot, resumen: resumenCarga({ ...base, errores: ["La hoja PLANILLA no tiene piezas"].concat(base.errores) }) };
  const valida = piezasBody.safeParse({ accion: "cargar", ot, renglones: vista.renglones });
  if (!valida.success) return fallo(valida.error.issues[0]?.message || "las piezas no se pudieron validar");
  const r = await guardarPiezas({ e, ot, renglones: valida.data.renglones, protegerEscaneadas: true });
  broadcastRefresh(e, "piezas_ot");
  return { ot, resumen: resumenCarga({ ...base, piezas: r.piezas, noBorradas: r.noBorradas }) };
}

export async function PATCH(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const clave = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const e = empresaDeClave(clave);
    const noAutorizado = json({ error: "Clave inválida" }, 401);
    if (!e) return noAutorizado;
    const rl = checkRateLimit(`planillas-piezas:${e}`, 40, 60_000);
    if (rl.limited) return json({ error: "Demasiados pedidos" }, 429);
    const v = await leerConfig(e);
    if (!claveValida(clave, v?.hash)) return noAutorizado;

    const body = await request.json().catch(() => null);
    const proyectos = await proyectosDe(e);

    if (body?.accion === "lista") {
      if (!Array.isArray(body.archivos)) return json({ error: "Falta la lista de Excel" }, 400);
      const archivos = limpiarExcels(body.archivos);
      const pedir = excelsPendientes(archivos, proyectos, v.cargas || {});
      await sbPatch(filtroCfg(e), { valor: { ...v, archivos, ultima_lectura: new Date().toISOString() } });
      return json({ ok: true, excels: archivos.length, pedir });
    }

    if (body?.accion === "planilla") {
      const [archivo] = limpiarExcels([body]);
      if (!archivo) return json({ error: "Falta el id o el nombre del Excel" }, 400);
      const { ot, resumen, motivo } = await cargarExcel(e, archivo, body.contenido, proyectos);
      if (!resumen) return json({ ok: false, ot, motivo });
      // Se vuelve a leer la config: entre la lista y este Excel pasaron otros
      const actual = (await leerConfig(e)) || v;
      await sbPatch(filtroCfg(e), { valor: { ...actual, cargas: { ...(actual.cargas || {}), [ot]: resumen } } });
      return json({ ok: !resumen.error, ot, piezas: resumen.piezas, error: resumen.error });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (err) {
    logger.error("[piezas/planillas] PATCH error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_GESTION.has(sesion.rol)) return json({ error: "Solo el encargado puede conectar la carpeta" }, 403);
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;
    const body = await request.json().catch(() => ({}));
    const e = sesion.empresa_id;
    const opts = { sesion };
    const [previa] = (await sbGet(`${filtroCfg(e)}&select=valor&limit=1`, opts)) || [];

    if (body?.accion === "releer") {
      const ot = String(body.ot || "").trim();
      if (!previa?.valor || !ot) return json({ error: "No hay nada que volver a leer" }, 400);
      const { [ot]: _fuera, ...cargas } = previa.valor.cargas || {};
      await sbPatch(filtroCfg(e), { valor: { ...previa.valor, cargas } }, opts);
      return json({ ok: true });
    }

    if (body?.accion !== "conectar") return json({ error: "Acción desconocida" }, 400);
    const carpeta = idCarpeta(body?.carpeta);
    if (!carpeta) return json({ error: "Pegá el link de la carpeta de Drive" }, 400);
    const { clave, hash } = generarClave(e);
    // Lo que ya se cargó se conserva: si es la misma carpeta, no se vuelve a leer
    const valor = { ...(previa?.valor || {}), hash, carpeta, creada_at: new Date().toISOString(), ultima_lectura: null };
    if (previa) await sbPatch(filtroCfg(e), { valor }, opts);
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_PLANILLAS_PIEZAS, valor }, opts);
    const url = `${new URL(request.url).origin}/api/piezas/planillas`;
    return json({ ok: true, script: scriptCarpetaPiezas({ url, clave, carpeta }), creada_at: valor.creada_at });
  } catch (err) {
    logger.error("[piezas/planillas] POST error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
