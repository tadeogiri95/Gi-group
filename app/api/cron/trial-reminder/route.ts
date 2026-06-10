import { NextRequest, NextResponse } from "next/server";
import { sendTrialVencimiento } from "../../../lib/email";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  });
  return r.json();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const now = new Date();

  function rangoFecha(dias: number): { desde: string; hasta: string } {
    const desde = new Date(now);
    desde.setDate(desde.getDate() + dias);
    desde.setHours(0, 0, 0, 0);
    const hasta = new Date(desde);
    hasta.setHours(23, 59, 59, 999);
    return { desde: desde.toISOString(), hasta: hasta.toISOString() };
  }

  const [r7, r1] = [rangoFecha(7), rangoFecha(1)];

  const [trials7, trials1]: [{ empresa_id: string }[], { empresa_id: string }[]] = await Promise.all([
    sbGet(`suscripciones?estado=eq.trial&trial_fin=gte.${r7.desde}&trial_fin=lte.${r7.hasta}&select=empresa_id`),
    sbGet(`suscripciones?estado=eq.trial&trial_fin=gte.${r1.desde}&trial_fin=lte.${r1.hasta}&select=empresa_id`),
  ]);

  const todos: { empresa_id: string; dias: number }[] = [
    ...(trials7 ?? []).map((s) => ({ empresa_id: s.empresa_id, dias: 7 })),
    ...(trials1 ?? []).map((s) => ({ empresa_id: s.empresa_id, dias: 1 })),
  ];

  if (todos.length === 0) return NextResponse.json({ ok: true, enviados: 0 });

  const ids = [...new Set(todos.map((t) => t.empresa_id))].join(",");
  const empresas: { id: string; nombre: string; nombre_corto: string; slug: string; admin_email: string }[] =
    await sbGet(`empresa?id=in.(${ids})&select=id,nombre,nombre_corto,slug,admin_email`);

  const empMap = Object.fromEntries((empresas ?? []).map((e) => [e.id, e]));

  let enviados = 0;
  for (const { empresa_id, dias } of todos) {
    const e = empMap[empresa_id];
    if (!e?.admin_email) continue;
    await sendTrialVencimiento({
      to: e.admin_email,
      nombre: e.nombre_corto || e.nombre,
      empresa: e.nombre_corto || e.nombre,
      slug: e.slug,
      diasRestantes: dias,
    });
    enviados++;
  }

  console.log(`[trial-reminder] Emails enviados: ${enviados}`);
  return NextResponse.json({ ok: true, enviados });
}
