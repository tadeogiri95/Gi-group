// /api/finanzas/devengamiento — Finanzas → 📆 Devengamiento (parte 8 del
// plan de Tesorería, 13/11; reglas en app/lib/finanzasDevengamiento.js). Sin
// migración.
//
//   GET ?mes=AAAA-MM → cada renglón con su total del mes (y el del mes
//       anterior), "Falta este mes", las propuestas de los recurrentes, el
//       S.O.S ventas contra las entregas y las listas para cargar un gasto o
//       un asiento ahí mismo.
//   POST { accion: "ocultar", id, oculto } → oculta o vuelve a mostrar un renglón.
//   POST { accion: "ventas", texto, archivo } → el CSV de ventas del S.O.S:
//       se guarda el total de cada mes (solo como dato, no es una operación).
//
// Solo el rol Dueño. La configuración va en config_sistema ("finanzas_devengamiento").
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { listasFinanzas } from "../../../lib/finanzasListas";
import { finDeMes, mesesHasta } from "../../../lib/finanzasResultados";
import { CLAVE_DEVENGAMIENTO, configDevengamiento, devengamientoDelMes, itemDevengamiento, ventasSosPorMes } from "../../../lib/finanzasDevengamiento";

export const maxDuration = 60;

const MAX_TEXTO = 3_000_000;
const COLUMNAS = "id,fecha,cuenta_debe,cuenta_haber,neto,total,total_ars,estado,origen,anulada_at";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

async function leerConfig(e) {
  const cfg = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_DEVENGAMIENTO}&select=valor&limit=1`, { silent: true, fallback: [] });
  return { existe: Boolean(cfg?.length), valor: configDevengamiento(cfg?.[0]?.valor) };
}

async function guardarConfig(e, existe, valor) {
  if (existe) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_DEVENGAMIENTO}`, { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_DEVENGAMIENTO, valor });
}

/** El plan de cuentas con su renglón del EERR (sin la migración 179, sin él: va por el nombre). */
async function cuentasConLinea(sesion) {
  const e = sesion.empresa_id;
  try {
    return await leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,linea_eerr,activa&order=codigo.asc`);
  } catch {
    return leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,activa&order=codigo.asc`);
  }
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const hoy = hoyAr();
  const pedido = new URL(request.url).searchParams.get("mes");
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(pedido || "")) ? pedido : hoy.slice(0, 7);
  const desde = `${mesesHasta(mes, 13)[0]}-01`;
  try {
    const [cuentas, ops, config, listas] = await Promise.all([
      cuentasConLinea(sesion),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=gte.${desde}&fecha=lte.${finDeMes(mes)}&select=${COLUMNAS}&order=fecha.asc,id.asc`, 200000),
      leerConfig(e),
      listasFinanzas(sesion),
    ]);
    return NextResponse.json({ ...devengamientoDelMes(mes, { ops, cuentas, config: config.valor, hoy }), hoy, listas });
  } catch (err) {
    return errorFinanzas(err, "devengamiento GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const e = sesion.empresa_id;
  const d = await request.json().catch(() => null);
  try {
    if (d?.accion === "ocultar") {
      if (!itemDevengamiento(String(d.id || ""))) return NextResponse.json({ error: "No existe ese renglón" }, { status: 400 });
      const { existe, valor } = await leerConfig(e);
      const ocultos = new Set(valor.ocultos);
      if (d.oculto === false) ocultos.delete(d.id);
      else ocultos.add(d.id);
      await guardarConfig(e, existe, { ...valor, ocultos: [...ocultos] });
      return NextResponse.json({ ok: true, ocultos: [...ocultos] });
    }
    if (d?.accion === "ventas") {
      const texto = typeof d.texto === "string" ? d.texto : "";
      if (!texto.trim()) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
      if (texto.length > MAX_TEXTO) return NextResponse.json({ error: "El archivo es demasiado grande" }, { status: 400 });
      const { meses, errores } = ventasSosPorMes(texto);
      if (!Object.keys(meses).length) return NextResponse.json({ error: errores[0] || "No encontré comprobantes en el archivo" }, { status: 400 });
      const { existe, valor } = await leerConfig(e);
      const subido = new Date().toISOString();
      const archivo = String(d.archivo || "").slice(0, 200);
      // El archivo nuevo reemplaza los meses que trae; los demás quedan
      const ventas_sos = { ...valor.ventas_sos };
      for (const [mes, x] of Object.entries(meses)) ventas_sos[mes] = { ...x, archivo, subido };
      await guardarConfig(e, existe, { ...valor, ventas_sos });
      return NextResponse.json({ ok: true, meses, errores: errores.slice(0, 20) });
    }
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return errorFinanzas(err, "devengamiento POST");
  }
}
