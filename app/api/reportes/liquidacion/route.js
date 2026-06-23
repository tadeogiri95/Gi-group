// app/api/reportes/liquidacion — Resumen de novedades para liquidación de sueldos.
//
// GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Solo lectura: agrega, por empleado activo, horas trabajadas, tardanzas,
// horas extra (fichadas.horas_extra, migración 031) y días de ausencia
// aprobados (solicitudes) — para exportar a un contador o sistema de
// sueldos sin transcribir nada a mano.
// Solo accesible para roles: gerencial, administrativo. Requiere módulo
// de plan "reportes" (mismo gate que reportes_obra en planEnforcement.js).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { getPlanEmpresa } from "../../../lib/planEnforcement";
import { planTieneModulo } from "../../../lib/plans";
import { sbGet } from "../../../lib/sbHelpers";
import { safeErrorMessage } from "../../../lib/validate";
import { logger } from "../../../lib/logger";

const ROLES_PERMITIDOS = new Set(["gerencial", "administrativo"]);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS_RANGO = 366;

// "vacaciones" y "ausencia" son los únicos tipos de `solicitudes` que
// representan un día completo fuera del trabajo — "permiso" se mide en
// horas (desde/hasta son "HH:MM", no fechas) y no debe contarse como un
// día de ausencia.
const TIPOS_AUSENCIA = ["ausencia", "vacaciones"];

const redondear = (n) => Math.round(n * 100) / 100;

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();

    if (!ROLES_PERMITIDOS.has(sesion.rol)) {
      return NextResponse.json(
        { error: "Solo gerencial o administrativo puede ver la liquidación" },
        { status: 403 }
      );
    }

    const empresaId = sesion.empresa_id;

    const { searchParams } = new URL(request.url);
    const desde = searchParams.get("desde");
    const hasta = searchParams.get("hasta");

    if (!desde || !hasta || !FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) {
      return NextResponse.json({ error: "desde y hasta son obligatorios, formato YYYY-MM-DD" }, { status: 400 });
    }
    if (desde > hasta) {
      return NextResponse.json({ error: "desde no puede ser posterior a hasta" }, { status: 400 });
    }
    const dias = (new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000;
    if (dias > MAX_DIAS_RANGO) {
      return NextResponse.json({ error: `El rango no puede superar ${MAX_DIAS_RANGO} días` }, { status: 400 });
    }

    // ─── Gate de plan: liquidación requiere el módulo "reportes" ───
    const plan = await getPlanEmpresa(empresaId);
    if (!planTieneModulo(plan, "reportes")) {
      return NextResponse.json(
        {
          error: "Los reportes de liquidación requieren plan Starter o superior.",
          upgrade_a: "starter",
          paywall: true,
        },
        { status: 402 }
      );
    }

    const [empleados, fichadas, solicitudes] = await Promise.all([
      sbGet(`empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=legajo,nombre&order=legajo.asc`),
      sbGet(`fichadas?empresa_id=eq.${empresaId}&fecha=gte.${desde}&fecha=lte.${hasta}&select=legajo,horas_trabajadas,llegada_tarde,minutos_tarde,horas_extra`),
      sbGet(`solicitudes?empresa_id=eq.${empresaId}&estado=eq.aprobado&fecha=gte.${desde}&fecha=lte.${hasta}&tipo=in.(${TIPOS_AUSENCIA.join(",")})&select=legajo`),
    ]);

    const porLegajo = new Map();
    for (const emp of empleados || []) {
      porLegajo.set(emp.legajo, {
        legajo: emp.legajo,
        nombre: emp.nombre,
        horas_trabajadas: 0,
        tardanzas: 0,
        minutos_tarde: 0,
        horas_extra: 0,
        dias_ausencia: 0,
      });
    }

    for (const f of fichadas || []) {
      const row = porLegajo.get(f.legajo);
      if (!row) continue; // empleado inactivo/borrado — no entra en la liquidación
      row.horas_trabajadas += Number(f.horas_trabajadas) || 0;
      row.horas_extra += Number(f.horas_extra) || 0;
      if (f.llegada_tarde) {
        row.tardanzas += 1;
        row.minutos_tarde += Number(f.minutos_tarde) || 0;
      }
    }

    for (const s of solicitudes || []) {
      const row = porLegajo.get(s.legajo);
      if (!row) continue;
      row.dias_ausencia += 1;
    }

    const resultado = Array.from(porLegajo.values()).map((r) => ({
      ...r,
      horas_trabajadas: redondear(r.horas_trabajadas),
      horas_extra: redondear(r.horas_extra),
    }));

    return NextResponse.json(
      { desde, hasta, empleados: resultado },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    logger.error("GET /api/reportes/liquidacion", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
