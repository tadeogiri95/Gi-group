// GET /api/cuenta/exportar — El dueño descarga todos los datos de su empresa
// en un .zip con un CSV por tabla (F6-01, ítem 28).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { armarRespaldo } from "../../../lib/exportarServidor";
import { limiteExcedido } from "../../../lib/rateLimit";
import { logAudit } from "../../../lib/audit";

export const runtime = "nodejs";
// 14/11: ~90 tablas
export const maxDuration = 60;

export async function GET(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (sesion.rol !== "gerencial") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede descargar todos los datos" }, { status: 403 });
  }
  if (await limiteExcedido(`exportar:${sesion.empresa_id}`, 5, { failOpen: true })) {
    return NextResponse.json({ error: "Ya descargaste los datos varias veces. Probá de nuevo en 15 minutos." }, { status: 429 });
  }

  const e = sesion.empresa_id;
  const r = await armarRespaldo(e);
  if (!r) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  const { tablas, fallidas } = r;

  logAudit({
    empresa_id: e,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion: "exportar_datos_empresa",
    entidad: "empresa",
    entidad_id: e,
    datos_despues: { tablas: tablas.length, fallidas },
  });

  return new Response(r.zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${r.nombre}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
