// app/api/reportes/produccion — Informe de producción (Tadeo, 29/10; migración 146).
//
//   GET ?tipo=dia|semana|mes&fecha=AAAA-MM-DD → el informe del período, armado
//                                             en el momento (informe parcial)
//   GET ?guardados=1                          → los informes que guardó el cron
//                                             cada noche (los últimos 120)
//   GET ?id=N                                 → uno guardado, entero
// Solo gerencial y administrativo. Con RLS_RUTAS=on las consultas van con el
// pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { requireModulo } from "../../../lib/planEnforcement";
import { informeDeEmpresa } from "../../../lib/informeProduccionServidor";
import { sbGetAll } from "../../../lib/sbHelpers";
import { safeErrorMessage } from "../../../lib/validate";
import { hoyArg } from "../../../lib/dates";
import { logger } from "../../../lib/logger";

const ROLES_PERMITIDOS = new Set(["gerencial", "administrativo"]);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = new Set(["dia", "semana", "mes"]);
const json = (body, status = 200) => NextResponse.json(body, { status });

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_PERMITIDOS.has(sesion.rol)) return json({ error: "Solo gerencia y administración ven el informe de producción" }, 403);
    const sinModulo = await requireModulo(sesion.empresa_id, "proyectos");
    if (sinModulo) return sinModulo;
    const e = sesion.empresa_id;
    const q = new URL(request.url).searchParams;

    if (q.get("guardados")) {
      const r = await sbGetAll(`informes_produccion?empresa_id=eq.${e}&select=id,tipo,desde,hasta,nota,created_at&order=desde.desc,id.desc`, { sesion, maxFilas: 120 })
        .catch(() => null);
      return json({ ok: true, informes: r?.data || [], falta_migracion: !r });
    }
    if (q.get("id")) {
      const id = Number(q.get("id"));
      if (!Number.isInteger(id) || id <= 0) return json({ error: "Informe inválido" }, 400);
      const r = await sbGetAll(`informes_produccion?empresa_id=eq.${e}&id=eq.${id}&select=id,tipo,desde,hasta,nota,datos,created_at`, { sesion, maxFilas: 1 });
      if (!r.data[0]) return json({ error: "No encontré ese informe" }, 404);
      return json({ ok: true, informe: r.data[0].datos, guardado: r.data[0].created_at });
    }

    const tipo = q.get("tipo") || "dia";
    const fecha = q.get("fecha") || hoyArg();
    if (!TIPOS.has(tipo)) return json({ error: "Elegí día, semana o mes" }, 400);
    if (!FECHA_RE.test(fecha) || Number.isNaN(Date.parse(fecha))) return json({ error: "Fecha inválida (AAAA-MM-DD)" }, 400);
    if (fecha > hoyArg()) return json({ error: "Ese día todavía no pasó" }, 400);
    const informe = await informeDeEmpresa(e, tipo, fecha, { sesion });
    return json({ ok: true, informe });
  } catch (err) {
    logger.error("[reportes/produccion] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
