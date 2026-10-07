// GET /api/cuenta/exportar — El dueño descarga todos los datos de su empresa
// en un .zip con un CSV por tabla (F6-01, ítem 28).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet, sbGetAll } from "../../../lib/sbHelpers";
import { TABLAS_EXPORTAR, aCsv, armarZip, leeme, sinSecretos } from "../../../lib/exportar";
import { limiteExcedido } from "../../../lib/rateLimit";
import { logAudit } from "../../../lib/audit";
import { logger } from "../../../lib/logger";

export const runtime = "nodejs";

const MAX_FILAS_TABLA = 200000;

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
  const [empresa] = (await sbGet(`empresa?id=eq.${e}&select=*&limit=1`)) || [];
  if (!empresa) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  const archivos = { "empresa.csv": aCsv([sinSecretos(empresa)]) };
  const tablas = [{ nombre: "empresa", filas: 1 }];
  const fallidas = [];
  const truncadas = [];
  // De a una tabla: no hay apuro y no se satura la base
  for (const tabla of TABLAS_EXPORTAR) {
    try {
      const { data, truncado } = await sbGetAll(`${tabla}?empresa_id=eq.${e}&select=*&order=id.asc`, { maxFilas: MAX_FILAS_TABLA });
      archivos[`${tabla}.csv`] = aCsv(data);
      tablas.push({ nombre: tabla, filas: data.length });
      if (truncado) truncadas.push(tabla);
    } catch (err) {
      logger.error(`[cuenta/exportar] ${tabla}`, err);
      fallidas.push(tabla);
    }
  }
  const fecha = new Date().toISOString().slice(0, 10);
  archivos["LEEME.txt"] = leeme({ empresa: empresa.nombre, fecha, tablas, fallidas, truncadas });

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

  const zip = armarZip(archivos);
  return new Response(zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="gypi-${empresa.slug || "empresa"}-${fecha}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
