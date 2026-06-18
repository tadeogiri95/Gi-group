import { NextResponse } from "next/server";
import { validarToken } from "../../../lib/auth";
import { logEvent } from "../../../lib/analytics";

const ALLOWED_EVENTS = new Set([
  "onboarding_step",
  "onboarding_complete",
  "onboarding_skip",
]);

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const { evento, meta = {} } = await request.json();
    if (!evento || !ALLOWED_EVENTS.has(evento)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    logEvent(evento, {
      empresa_id: sesion.empresa_id,
      empleado_id: sesion.empleado_id,
      meta,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
