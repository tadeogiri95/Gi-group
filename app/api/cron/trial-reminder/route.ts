import { NextRequest, NextResponse } from "next/server";
import { sendTrialVencimiento } from "../../../lib/email";
import { logger } from "../../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`sbGet ${path}: ${await r.text()}`);
  return r.json();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const now = new Date();

    function rangoFecha(dias: number): { desde: string; hasta: string } {
      const desde = new Date(now);
      desde.setDate(desde.getDate() + dias);
      desde.setHours(0, 0, 0, 0);
      const hasta = new Date(desde);
      hasta.setHours(23, 59, 59, 999);
      return { desde: desde.toISOString(), hasta: hasta.toISOString() };
    }

    // Días restantes a notificar: 11 (día 3 del trial), 4 (día 10), 7 (día 7), 1 (día 13/último)
    const INTERVALOS = [11, 7, 4, 1];
    const rangos = INTERVALOS.map((d) => ({ dias: d, rango: rangoFecha(d) }));

    const resultados = await Promise.all(
      rangos.map(({ rango }) =>
        sbGet(`suscripciones?estado=eq.trial&trial_fin=gte.${rango.desde}&trial_fin=lte.${rango.hasta}&select=empresa_id`)
      )
    );

    const todos: { empresa_id: string; dias: number }[] = resultados.flatMap(
      (rows, i) => (rows ?? []).map((s: { empresa_id: string }) => ({ empresa_id: s.empresa_id, dias: rangos[i].dias }))
    );

    if (todos.length === 0) return NextResponse.json({ ok: true, enviados: 0 });

    const ids = [...new Set(todos.map((t) => t.empresa_id))].join(",");
    const empresas: { id: string; nombre: string; nombre_corto: string; slug: string; admin_email: string }[] =
      await sbGet(`empresa?id=in.(${ids})&select=id,nombre,nombre_corto,slug,admin_email`);

    const empMap = Object.fromEntries((empresas ?? []).map((e) => [e.id, e]));

    const enviosOk = await Promise.allSettled(
      todos.map(({ empresa_id, dias }) => {
        const e = empMap[empresa_id];
        if (!e?.admin_email) return Promise.resolve(false);
        return sendTrialVencimiento({
          to: e.admin_email,
          nombre: e.nombre_corto || e.nombre,
          empresa: e.nombre_corto || e.nombre,
          slug: e.slug,
          diasRestantes: dias,
          empresaId: empresa_id,
        }).then(() => true);
      })
    );
    const enviados = enviosOk.filter((r) => r.status === "fulfilled" && r.value === true).length;

    logger.debug(`[trial-reminder] Emails enviados: ${enviados}`);
    return NextResponse.json({ ok: true, enviados });

  } catch (e) {
    logger.error("[trial-reminder] Error fatal — cron abortado", e as Error);
    return NextResponse.json({ error: "Error interno del cron", detail: (e as Error).message }, { status: 500 });
  }
}
