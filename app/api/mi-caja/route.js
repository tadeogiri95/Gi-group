// /api/mi-caja — Finanzas, parte F3b: Mi caja (migración 176; reglas en
// app/lib/finanzasMiCaja.js). Para cualquier empleado que sea responsable de
// una caja (fin_tesoreria.responsable_id), sin entrar a Finanzas.
//
//   GET → sus cajas activas, con el saldo, los últimos movimientos y los
//       conceptos que eligió el dueño. Sin cajas a cargo (o sin el módulo, o
//       sin la 171) devuelve { cajas: [] } y la pantalla no muestra nada.
//   POST { accion: "cargar", cuenta, clase: "gasto"|"ingreso", concepto,
//       importe, fecha, descripcion?, comprobante_url?, tipo_cambio? }
//       → la operación entra a su caja como "para revisar" y se avisa a los
//       dueños. Si la carga el dueño, entra confirmada.
//   POST { accion: "anular", id } → anula una propia que el dueño todavía no
//       revisó (para corregir un error). No se borra.
//
// La RLS de fin_operaciones es solo del rol gerencial: esta ruta va con la
// clave de servicio y siempre filtra por la empresa y las cajas del que pide.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../lib/sbHelpers";
import { getModulosEmpresa, rechazarSiSinPlan } from "../../lib/planEnforcement";
import { broadcastRefresh } from "../../lib/broadcast";
import { enviarPushLegajos } from "../../lib/pushGerencia";
import { logger } from "../../lib/logger";
import { safeErrorMessage } from "../../lib/validate";
import { hoyAr, plata } from "../../lib/finanzasOperaciones";
import { CLAVE_MI_CAJA, ORIGEN_MI_CAJA, conceptosMiCaja, resumenMiCaja, validarMovimientoMiCaja } from "../../lib/finanzasMiCaja";

const COLUMNAS = "id,fecha,tipo,total,moneda,total_ars,cuenta_debe,cuenta_haber,descripcion,origen,estado,anulada_at";
const sinTabla = (err) => /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(String(err?.message));

/** Las cajas activas a cargo del que pide (null si no corresponde mirar). */
async function misCajas(sesion) {
  if (!sesion.empleado_id) return [];
  const { modulos } = await getModulosEmpresa(sesion.empresa_id);
  if (!modulos.includes("finanzas")) return [];
  const { data } = await sbGetAll(`fin_tesoreria?empresa_id=eq.${sesion.empresa_id}&responsable_id=eq.${sesion.empleado_id}&activa=eq.true&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`, { maxFilas: 50 });
  return data || [];
}

async function conceptos(empresaId) {
  const [cfg, tipos] = await Promise.all([
    sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_MI_CAJA}&select=valor&limit=1`, { silent: true, fallback: [] }),
    sbGetAll(`fin_tipos_operacion?empresa_id=eq.${empresaId}&select=codigo,nombre,cuenta_debe,cuenta_haber,activo&order=codigo.asc`, { maxFilas: 2000 }).then((r) => r.data),
  ]);
  return { lista: conceptosMiCaja(cfg?.[0]?.valor, tipos), tipos };
}

const enLista = (cajas) => encodeURIComponent(cajas.map((c) => `"${String(c.cuenta).replace(/"/g, "")}"`).join(","));

export async function GET(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  try {
    const cajas = await misCajas(sesion);
    if (!cajas.length) return NextResponse.json({ cajas: [] });
    const e = sesion.empresa_id;
    const [{ lista, tipos }, ops] = await Promise.all([
      conceptos(e),
      sbGetAll(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${enLista(cajas)}),cuenta_haber.in.(${enLista(cajas)}))&select=${COLUMNAS},comprobante_url&order=fecha.asc,id.asc`, { maxFilas: 20000 })
        .catch((err) => {
          // Sin la 176 todavía: sin la foto, pero el saldo se ve igual
          if (/comprobante_url/.test(String(err?.message))) return sbGetAll(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${enLista(cajas)}),cuenta_haber.in.(${enLista(cajas)}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, { maxFilas: 20000 });
          throw err;
        })
        .then((r) => r.data),
    ]);
    const nombres = new Map(tipos.map((t) => [t.codigo, t.nombre || t.codigo]));
    return NextResponse.json({ cajas: cajas.map((c) => resumenMiCaja(ops, c, nombres)), conceptos: lista, hoy: hoyAr() });
  } catch (err) {
    if (sinTabla(err)) return NextResponse.json({ cajas: [] });
    logger.error("[mi-caja] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

async function nombreEmpleado(sesion) {
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function avisarDuenos(empresaId, { quien, op, caja }) {
  try {
    const { data: duenos } = await sbGetAll(`empleados?empresa_id=eq.${empresaId}&rol=eq.gerencial&activo=eq.true&select=legajo&order=legajo.asc`);
    const gasto = op.cuenta_haber === caja.cuenta;
    await enviarPushLegajos(empresaId, (duenos || []).map((x) => x.legajo), {
      title: `📱 ${quien || "Alguien"} cargó ${gasto ? "un gasto" : "plata recibida"} en su caja`,
      body: `${plata(op.total, op.moneda)} · ${op.descripcion}`.slice(0, 180),
      data: { tipo: "mi_caja" },
    });
  } catch { /* el aviso no frena la carga */ }
}

async function cargar(sesion, d, cajas) {
  const e = sesion.empresa_id;
  const caja = cajas.find((c) => c.cuenta === d.cuenta);
  if (!caja) return NextResponse.json({ error: "Esa caja no está a tu cargo" }, { status: 403 });
  const { lista } = await conceptos(e);
  const { op, errores } = validarMovimientoMiCaja(d, {
    caja, conceptos: lista, confirmada: sesion.rol === "gerencial",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, empresaId: e, hoy: hoyAr(),
  });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const fila = { ...op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora };
  if (!fila.comprobante_url) delete fila.comprobante_url; // sin foto anda aunque falte la 176
  const [o] = (await sbPost("fin_operaciones", fila)) || [];
  broadcastRefresh(e, "fin_operaciones");
  if (sesion.rol !== "gerencial") await avisarDuenos(e, { quien, op, caja });
  return NextResponse.json({ ok: true, operacion: o ? { id: o.id, estado: o.estado } : null });
}

async function anular(sesion, d, cajas) {
  const id = Number(d.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta el movimiento" }, { status: 400 });
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  const filas = await sbPatch(
    `fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&origen=eq.${ORIGEN_MI_CAJA}&estado=eq.para_revisar&anulada_at=is.null&or=(cuenta_debe.in.(${enLista(cajas)}),cuenta_haber.in.(${enLista(cajas)}))`,
    { anulada_at: ahora, anulada_por_nombre: await nombreEmpleado(sesion), updated_at: ahora },
  );
  if (!filas?.length) return NextResponse.json({ error: "Ese movimiento ya lo revisó el dueño o no es de tu caja: pedile que lo corrija" }, { status: 404 });
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!d || typeof d !== "object") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  try {
    const cajas = await misCajas(sesion);
    if (!cajas.length) return NextResponse.json({ error: "No tenés ninguna caja a cargo" }, { status: 403 });
    if (d.accion === "cargar") return await cargar(sesion, d, cajas);
    if (d.accion === "anular") return await anular(sesion, d, cajas);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    if (/comprobante_url/.test(String(err?.message))) return NextResponse.json({ error: "Para guardar la foto del ticket falta correr la migración 176 en Supabase." }, { status: 409 });
    logger.error(`[mi-caja] ${d.accion}`, err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
