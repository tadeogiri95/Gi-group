// GET /api/cron/reengagement-onboarding
// Corre diariamente (vercel.json). Busca empresas activas que se
// registraron hace 3, 7 o 14 días y todavía no completaron el
// onboarding (onboarding_completado=false) — les manda un recordatorio.
import { NextRequest, NextResponse } from "next/server";
import { sendOnboardingRecordatorio } from "../../../lib/email";
import { logger } from "../../../lib/logger";
import { logEvent, EVT } from "../../../lib/analytics";

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

    function rangoFecha(diasAtras: number): { desde: string; hasta: string } {
      const desde = new Date(now);
      desde.setDate(desde.getDate() - diasAtras);
      desde.setHours(0, 0, 0, 0);
      const hasta = new Date(desde);
      hasta.setHours(23, 59, 59, 999);
      return { desde: desde.toISOString(), hasta: hasta.toISOString() };
    }

    // Días desde el registro a notificar: 3, 7 y 14 (último recordatorio).
    const INTERVALOS = [3, 7, 14];
    const rangos = INTERVALOS.map((d) => ({ dias: d, rango: rangoFecha(d) }));

    const resultados = await Promise.all(
      rangos.map(({ rango }) =>
        sbGet(
          `empresa?activa=eq.true&onboarding_completado=eq.false&created_at=gte.${rango.desde}&created_at=lte.${rango.hasta}&select=id,nombre,nombre_corto,slug,admin_email`
        )
      )
    );

    type Empresa = { id: string; nombre: string; nombre_corto: string; slug: string; admin_email: string };
    const todos: { empresa: Empresa; dias: number }[] = resultados.flatMap(
      (rows: Empresa[], i: number) => (rows ?? []).map((e) => ({ empresa: e, dias: rangos[i].dias }))
    );

    if (todos.length === 0) return NextResponse.json({ ok: true, enviados: 0 });

    const enviosOk = await Promise.allSettled(
      todos.map(({ empresa, dias }) => {
        if (!empresa.admin_email) return Promise.resolve(false);
        logEvent(EVT.REENGAGEMENT_ONBOARDING, { empresa_id: empresa.id, meta: { dias } });
        return sendOnboardingRecordatorio({
          to: empresa.admin_email,
          nombre: empresa.nombre_corto || empresa.nombre,
          empresa: empresa.nombre_corto || empresa.nombre,
          slug: empresa.slug,
          dias,
          empresaId: empresa.id,
        }).then(() => true);
      })
    );
    const enviados = enviosOk.filter((r) => r.status === "fulfilled" && r.value === true).length;

    logger.debug(`[reengagement-onboarding] Emails enviados: ${enviados}`);
    return NextResponse.json({ ok: true, enviados });

  } catch (e) {
    logger.error("[reengagement-onboarding] Error fatal — cron abortado", e as Error);
    return NextResponse.json({ error: "Error interno del cron", detail: (e as Error).message }, { status: 500 });
  }
}
