// /api/finanzas/inversiones — FCI y títulos públicos y privados (pedido del
// 12/11; reglas en app/lib/finanzasInversiones.js). Sin migración: los
// títulos van en config_sistema ("finanzas_titulos").
//
//   GET → los FCI con su saldo en Gypi, los títulos con láminas, cotización y
//       valor, el saldo de la cuenta de títulos, y las cajas y bancos.
//   POST { accion: "fci", cuenta, saldo_real, fecha } → la diferencia con el
//       saldo de Gypi entra como intereses (o baja).
//   POST { accion: "titulo_alta", especie: { especie, nombre, clase, moneda, laminas, cotizacion, por }, como, importe?, caja?, fecha }
//       → agrega el título. como: "cargada" (ya está en la cuenta, no se carga
//       nada), "inicial" (la tenía y no estaba: contra Ajuste De Capital) o
//       "compra" (sale la plata de la caja o banco).
//   POST { accion: "titulo_mover", id, como: "compra"|"venta", laminas, importe, caja, fecha }
//   POST { accion: "cotizar", cotizaciones: { id: número }, tipo_cambio?, fecha }
//       → guarda las cotizaciones y lleva la cuenta a lo que valen.
//   POST { accion: "titulo_quitar", id } → saca de la lista uno sin láminas.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import {
  CLAVE_TITULOS, MAX_ESPECIES, ajusteFci, ajusteTitulos, contextoInversiones, especieValida, leerTitulos, movimientoTitulo, saldoHasta, valorEspecie, valorTitulos,
} from "../../../lib/finanzasInversiones";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const COLS = "id,fecha,total,total_ars,cuenta_debe,cuenta_haber,anulada_at";

async function leerTodo(sesion) {
  const e = sesion.empresa_id;
  const [tesoreria, cuentas, tipos, cfg] = await Promise.all([
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa&order=nombre.asc`),
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,activo`),
    sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_TITULOS}&select=valor&limit=1`, { silent: true, fallback: [] }),
  ]);
  const { ctx, errores } = contextoInversiones({ tipos, cuentas });
  const guardado = leerTitulos(cfg?.[0]?.valor);
  const cuentaTitulos = guardado.cuenta || ctx.titulos;
  const fcis = tesoreria.filter((t) => t.tipo === "fci" && t.activa !== false);
  const lista = [...fcis.map((t) => t.cuenta), ...(cuentaTitulos ? [cuentaTitulos] : [])].map((c) => `"${String(c).replace(/"/g, "")}"`).join(",");
  const ops = lista
    ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(${encodeURIComponent(`cuenta_debe.in.(${lista}),cuenta_haber.in.(${lista})`)})&select=${COLS}&order=fecha.asc,id.asc`, 60000)
    : [];
  return { e, tesoreria, cuentas, ctx, errores, guardado, cuentaTitulos, fcis, ops, hay: Boolean(cfg?.length) };
}

async function guardarTitulos(sesion, base, valor) {
  const e = sesion.empresa_id;
  // config_sistema va con la clave de servicio, como las otras listas de Finanzas
  if (base.hay) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_TITULOS}`, { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_TITULOS, valor });
}

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`);
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function insertar(sesion, op) {
  if (!op) return null;
  const ahora = new Date().toISOString();
  const [fila] = (await sbPost("fin_operaciones", { ...op, empresa_id: sesion.empresa_id, cargada_por_nombre: await nombreEmpleado(sesion), created_at: ahora, updated_at: ahora }, { sesion })) || [];
  broadcastRefresh(sesion.empresa_id, "fin_operaciones");
  return fila;
}

const valorDe = (b) => ({ especies: b.guardado.especies, cuenta: b.cuentaTitulos, tipo_cambio: b.guardado.tipo_cambio });

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  try {
    const b = await leerTodo(sesion);
    const valor = valorTitulos(b.guardado.especies, b.guardado.tipo_cambio);
    return NextResponse.json({
      hoy: hoyAr(),
      avisos: b.errores,
      fci: b.fcis.map((t) => ({ cuenta: t.cuenta, nombre: t.nombre, moneda: t.moneda, saldo: saldoHasta(b.ops, t.cuenta, "9999-12-31", t.moneda) })),
      titulos: {
        cuenta: b.cuentaTitulos,
        nombre_cuenta: b.cuentas.find((c) => c.codigo === b.cuentaTitulos)?.nombre || null,
        saldo: b.cuentaTitulos ? saldoHasta(b.ops, b.cuentaTitulos) : 0,
        valor: valor.ars, falta_tc: valor.falta_tc, tipo_cambio: b.guardado.tipo_cambio,
        especies: b.guardado.especies.map((x) => ({ ...x, valor: valorEspecie(x) })),
      },
      cajas: b.tesoreria.filter((t) => t.activa !== false && (t.tipo === "banco" || t.tipo === "caja") && t.moneda !== "USD").map((t) => ({ cuenta: t.cuenta, nombre: t.nombre })),
    });
  } catch (err) {
    return errorFinanzas(err, "inversiones GET");
  }
}

const error = (msg, status = 400) => NextResponse.json({ error: msg }, { status });

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!d || typeof d !== "object") return error("Pedido inválido");
  const hoy = hoyAr();
  try {
    const b = await leerTodo(sesion);
    if (d.accion === "fci") {
      const caja = b.fcis.find((t) => t.cuenta === d.cuenta);
      const r = ajusteFci({ caja, ops: b.ops, saldoReal: d.saldo_real, fecha: d.fecha, hoy, ctx: b.ctx });
      if (r.errores.length) return error(r.errores[0]);
      const fila = await insertar(sesion, r.op);
      return NextResponse.json({ ok: true, diferencia: r.diferencia, saldo_gypi: r.saldo_gypi, operacion: fila });
    }
    if (d.accion === "titulo_alta") {
      const e = especieValida({ ...(d.especie || {}), laminas: 0 });
      if (!e) return error("Revisá el título: la especie (por ejemplo GD35), las láminas y la cotización");
      if (b.guardado.especies.length >= MAX_ESPECIES) return error(`Hasta ${MAX_ESPECIES} títulos`);
      if (b.guardado.especies.some((x) => x.especie === e.especie)) return error(`${e.especie} ya está en la lista: usá Comprar o Vender`);
      const laminas = Number(d.especie?.laminas) || 0;
      let op = null;
      let especie = { ...e, id: `${e.especie}-${Date.now().toString(36)}`.slice(0, 40), fecha_cotizacion: e.cotizacion > 0 ? (d.fecha || hoy) : null };
      if (d.como === "compra" || d.como === "inicial") {
        const m = movimientoTitulo({ especie, como: d.como, laminas, importe: d.importe, caja: d.caja, fecha: d.fecha, hoy, cuenta: b.cuentaTitulos, ctx: b.ctx, tesoreria: b.tesoreria });
        if (m.errores.length) return error(m.errores[0]);
        op = m.op;
        especie = { ...especie, laminas: m.laminas };
      } else {
        if (!(laminas >= 0)) return error("Las láminas no pueden ser negativas");
        especie = { ...especie, laminas: Math.round(laminas * 10000) / 10000 };
      }
      const fila = await insertar(sesion, op);
      await guardarTitulos(sesion, b, { ...valorDe(b), especies: [...b.guardado.especies, especie] });
      return NextResponse.json({ ok: true, especie, operacion: fila });
    }
    if (d.accion === "titulo_mover") {
      const especie = b.guardado.especies.find((x) => x.id === d.id);
      if (!especie) return error("No encontré ese título", 404);
      if (!["compra", "venta"].includes(d.como)) return error("Elegí si es compra o venta");
      const m = movimientoTitulo({ especie, como: d.como, laminas: d.laminas, importe: d.importe, caja: d.caja, fecha: d.fecha, hoy, cuenta: b.cuentaTitulos, ctx: b.ctx, tesoreria: b.tesoreria });
      if (m.errores.length) return error(m.errores[0]);
      const fila = await insertar(sesion, m.op);
      await guardarTitulos(sesion, b, { ...valorDe(b), especies: b.guardado.especies.map((x) => (x.id === especie.id ? { ...x, laminas: m.laminas } : x)) });
      return NextResponse.json({ ok: true, laminas: m.laminas, operacion: fila });
    }
    if (d.accion === "cotizar") {
      const cot = d.cotizaciones && typeof d.cotizaciones === "object" ? d.cotizaciones : {};
      const fecha = d.fecha || hoy;
      const especies = b.guardado.especies.map((x) => {
        if (!(x.id in cot)) return x;
        const n = Number(cot[x.id]);
        return Number.isFinite(n) && n >= 0 && n < 1e10 ? { ...x, cotizacion: Math.round(n * 10000) / 10000, fecha_cotizacion: fecha } : x;
      });
      const tc = Number(d.tipo_cambio) > 0 ? Number(d.tipo_cambio) : b.guardado.tipo_cambio;
      if (fecha > hoy) return error("La fecha no puede ser futura");
      const r = ajusteTitulos({ cuenta: b.cuentaTitulos, ops: b.ops, especies, tipoCambio: tc, fecha, ctx: b.ctx });
      if (r.errores.length) return error(r.errores[0]);
      const ya = r.op ? (await sbGet(`fin_operaciones?empresa_id=eq.${b.e}&origen=eq.titulos&origen_id=eq.${encodeURIComponent(r.op.origen_id)}&anulada_at=is.null&select=id&limit=1`, { sesion, silent: true, fallback: [] })) : [];
      // Una sola actualización por día: la segunda del mismo día ajusta sobre la primera
      const op = r.op && ya?.length ? { ...r.op, origen_id: `${r.op.origen_id}:${Date.now().toString(36)}` } : r.op;
      const fila = await insertar(sesion, op);
      await guardarTitulos(sesion, b, { ...valorDe(b), especies, tipo_cambio: tc || null });
      return NextResponse.json({ ok: true, diferencia: r.diferencia, valor: r.valor, operacion: fila });
    }
    if (d.accion === "titulo_quitar") {
      const especie = b.guardado.especies.find((x) => x.id === d.id);
      if (!especie) return error("No encontré ese título", 404);
      if (especie.laminas > 0) return error("Todavía tiene láminas: vendelas primero");
      await guardarTitulos(sesion, b, { ...valorDe(b), especies: b.guardado.especies.filter((x) => x.id !== especie.id) });
      return NextResponse.json({ ok: true });
    }
    return error("Acción desconocida");
  } catch (err) {
    if (/23505|duplicate/i.test(String(err?.message))) return error("Ya actualizaste el FCI con esa fecha: si estaba mal, corregí o anulá esa operación en la ficha del FCI", 409);
    return errorFinanzas(err, `inversiones ${d.accion}`);
  }
}
