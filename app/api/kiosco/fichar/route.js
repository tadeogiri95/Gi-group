// app/api/kiosco/fichar/route.js — Fichar en el kiosco con legajo + PIN (D7, ítem 19).
//
// El kiosco no tiene sesión de empleado: cada fichaje se autoriza con el PIN
// del operario. El servidor decide si corresponde ingreso o egreso (incluido el
// turno noche) y usa la misma lógica que el fichaje desde el celular.
import { NextResponse } from "next/server";
import { validarKiosco } from "../../../lib/kiosco";
import { verificarPin } from "../../../lib/pinServidor";
import { procesarFichaje } from "../../../lib/ficharServidor";
import { kioscoFicharBody } from "../../../lib/schemas";
import { validateBody } from "../../../lib/validate";
import { sbGet } from "../../../lib/sbHelpers";
import { hoyArg } from "../../../lib/dates";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { logger } from "../../../lib/logger";

// Un kiosco atiende a toda la planta: el límite es por dispositivo y generoso;
// el PIN de cada operario tiene además su propio bloqueo por intentos.
const MAX_POR_MINUTO = 30;

/** "ingreso", "egreso" o "cerrada" según las fichadas de hoy y ayer (turno noche). */
async function accionQueCorresponde(empleado) {
  const hoy = hoyArg();
  const ayer = hoyArg(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const fichadas = await sbGet(
    `fichadas?empleado_id=eq.${empleado.id}&empresa_id=eq.${empleado.empresa_id}&fecha=gte.${ayer}&select=fecha,ingreso,egreso&order=fecha.desc`
  );
  if ((fichadas || []).some((f) => f.ingreso && !f.egreso)) return "egreso";
  if ((fichadas || []).some((f) => f.fecha === hoy && f.ingreso && f.egreso)) return "cerrada";
  return "ingreso";
}

export async function POST(request) {
  const kiosco = await validarKiosco(request);
  if (!kiosco) return NextResponse.json({ ok: false, error: "Este dispositivo no está activado como kiosco." }, { status: 401 });

  const rl = checkRateLimit(`kiosco:${kiosco.jti}`, MAX_POR_MINUTO, 60_000);
  if (rl.limited) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos seguidos. Esperá un momento." }, { status: 429 });
  }

  try {
    const parsed = validateBody(kioscoFicharBody, await request.json().catch(() => ({})));
    if (parsed.response) return parsed.response;
    const { legajo, pin, ...resto } = parsed.data;

    const r = await verificarPin({ empresaId: kiosco.empresa_id, legajo, pin, alBloquear: "avisá a tu supervisor" });
    if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    const emp = r.empleado;
    const persona = { nombre: emp.nombre, apodo: emp.apodo || emp.nombre };

    const accion = await accionQueCorresponde(emp);
    if (accion === "cerrada") {
      return NextResponse.json({ ok: false, ...persona, tipo: "cerrada", error: "Ya fichaste la entrada y la salida de hoy." });
    }

    const sesion = { empleado_id: emp.id, empresa_id: emp.empresa_id, legajo: emp.legajo, rol: emp.rol, jti: null };
    const res = await procesarFichaje(sesion, { accion, ...resto }, request);
    const datos = await res.json();
    return NextResponse.json({ ...datos, ...persona, accion }, { status: res.status });
  } catch (e) {
    logger.error("kiosco: error al fichar", e);
    return NextResponse.json({ ok: false, error: "No se pudo fichar. Intentá de nuevo." }, { status: 500 });
  }
}
