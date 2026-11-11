// POST /api/stock/movimientos — Movimientos de stock desde la app (Stock,
// parte 14; ítem 40; migración 107).
//
// Body: { accion, ... }
//   registrar → consumo o devolución: cualquiera de la empresa (el operario
//               escanea el QR del artículo); ingreso o ajuste: solo gestión.
//               Un ingreso cuyo comprobante de ese proveedor ya entró (una
//               recepción de OC, una factura sin OC u otro ingreso) avisa con
//               409 repetido y solo se carga con forzar (11/11, parte 6).
//               El artículo tiene que estar en el stock copiado de la planilla
//               y la OT, si viene, entre las OT de la empresa.
//   registrar_varios → (11/11, parte 5) varios retiros o devoluciones juntos:
//               { tipo, renglones: [{ sku, cantidad, ot? }], notas? }. Se
//               revisa todo antes y se guardan todos o ninguno. Con OT, cada
//               uno suma al costo de esa OT (costoMaterialesServidor).
//   anular    → gestión, cualquiera; el resto, solo los suyos recién cargados.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { validateBody, safeErrorMessage } from "../../../lib/validate";
import { movimientoStockBody } from "../../../lib/schemas";
import { sbGet, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { broadcastRefresh } from "../../../lib/broadcast";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { puedeCargar, puedeAnular } from "../../../lib/movimientosStock";
import { logger } from "../../../lib/logger";
import { avisoIngresoRepetido, buscarIngresoRepetido } from "../../../lib/stockIngresos";

function faltaMigracion(err) {
  return String(err?.message).includes("movimientos_stock");
}

async function registrar(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (!puedeCargar(datos.tipo, sesion.rol)) {
    return NextResponse.json({ error: "Los ingresos y ajustes los carga la oficina" }, { status: 403 });
  }
  const [articulo] = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=eq.${encodeURIComponent(datos.sku)}&select=sku,nombre,unidad,division,activo&limit=1`, opts)) || [];
  if (!articulo) return NextResponse.json({ error: "Ese artículo no está en el stock. Puede que falte sincronizar la planilla." }, { status: 404 });
  if (articulo.activo === false) return NextResponse.json({ error: "Ese artículo ya no está en la planilla MRP" }, { status: 409 });

  let ot = null;
  if (datos.ot) {
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(datos.ot)}&select=ot&limit=1`, opts)) || [];
    if (!proyecto) return NextResponse.json({ error: `No encontré la OT ${datos.ot}` }, { status: 404 });
    ot = proyecto.ot;
  }

  const esIngreso = datos.tipo === "ingreso";
  if (esIngreso && !datos.forzar) {
    const repetido = await buscarIngresoRepetido(sbGet, e, { proveedor: datos.proveedor, comprobante: datos.comprobante }, opts);
    if (repetido) return NextResponse.json({ error: avisoIngresoRepetido(repetido), repetido: true }, { status: 409 });
  }
  const [empleado] = sesion.empleado_id
    ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const fila = {
    empresa_id: e,
    tipo: datos.tipo,
    sku: articulo.sku,
    nombre: articulo.nombre ?? null,
    unidad: articulo.unidad ?? null,
    division: articulo.division ?? null,
    cantidad: datos.cantidad,
    ot,
    proveedor: esIngreso ? datos.proveedor : null,
    comprobante: esIngreso ? datos.comprobante : null,
    precio_unitario: esIngreso ? datos.precio_unitario : null,
    notas: datos.notas,
    empleado_id: sesion.empleado_id || null,
    legajo: Number.isInteger(sesion.legajo) ? sesion.legajo : null,
    empleado_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : null,
  };
  const [creado] = (await sbPost("movimientos_stock", fila, opts)) || [];
  broadcastRefresh(e, "movimientos_stock");
  return NextResponse.json({ ok: true, movimiento: creado || fila });
}

const enLista = (vals) => `in.(${[...new Set(vals)].map((v) => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`;

async function registrarVarios(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (!puedeCargar(datos.tipo, sesion.rol)) return NextResponse.json({ error: "Ese movimiento lo carga la oficina" }, { status: 403 });
  const skus = datos.renglones.map((r) => r.sku);
  const ots = datos.renglones.map((r) => r.ot).filter(Boolean);
  const [articulos, proyectos, empleados] = await Promise.all([
    sbGet(`articulos_stock?empresa_id=eq.${e}&sku=${encodeURIComponent(enLista(skus))}&select=sku,nombre,unidad,division,activo`, opts),
    ots.length ? sbGet(`proyectos?empresa_id=eq.${e}&ot=${encodeURIComponent(enLista(ots))}&select=ot`, opts) : Promise.resolve([]),
    sesion.empleado_id ? sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] }) : Promise.resolve([]),
  ]);
  const porSku = new Map((articulos || []).map((a) => [a.sku, a]));
  const otsOk = new Set((proyectos || []).map((p) => String(p.ot)));
  const errores = [];
  datos.renglones.forEach((r, i) => {
    const a = porSku.get(r.sku);
    if (!a) errores.push(`Renglón ${i + 1}: el artículo ${r.sku} no está en el stock`);
    else if (a.activo === false) errores.push(`Renglón ${i + 1}: ${a.nombre || r.sku} ya no está en la planilla MRP`);
    if (r.ot && !otsOk.has(String(r.ot))) errores.push(`Renglón ${i + 1}: no encontré la OT ${r.ot}`);
  });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const quien = {
    empleado_id: sesion.empleado_id || null,
    legajo: Number.isInteger(sesion.legajo) ? sesion.legajo : null,
    empleado_nombre: empleados?.[0]?.nombre ? String(empleados[0].nombre).slice(0, 120) : null,
  };
  const filas = datos.renglones.map((r) => {
    const a = porSku.get(r.sku);
    return {
      empresa_id: e, tipo: datos.tipo, sku: a.sku, nombre: a.nombre ?? null, unidad: a.unidad ?? null, division: a.division ?? null,
      cantidad: r.cantidad, ot: r.ot ? String(r.ot) : null, proveedor: null, comprobante: null, precio_unitario: null, notas: datos.notas, ...quien,
    };
  });
  await sbPost("movimientos_stock", filas, opts);
  broadcastRefresh(e, "movimientos_stock");
  return NextResponse.json({ ok: true, cargados: filas.length });
}

async function anular(sesion, id) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const filtro = `movimientos_stock?id=eq.${id}&empresa_id=eq.${e}`;
  const [mov] = (await sbGet(`${filtro}&select=id,empleado_id,created_at,anulado&limit=1`, opts)) || [];
  if (!mov) return NextResponse.json({ error: "No encontré ese movimiento" }, { status: 404 });
  if (mov.anulado) return NextResponse.json({ ok: true, movimiento: mov });
  if (!puedeAnular(mov, { rol: sesion.rol, empleadoId: sesion.empleado_id })) {
    return NextResponse.json({ error: "Solo podés anular lo que cargaste vos hoy. Pedíselo a la oficina." }, { status: 403 });
  }
  const [fila] = (await sbPatch(filtro, { anulado: true, anulado_por: sesion.empleado_id || null, anulado_at: new Date().toISOString() }, opts)) || [];
  broadcastRefresh(e, "movimientos_stock");
  return NextResponse.json({ ok: true, movimiento: fila || null });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(movimientoStockBody, raw);
    if (parsed.response) return parsed.response;
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    // Stock es un módulo propio (viene con las OT y se puede apagar aparte, 131)
    const sinModulo = await requireModuloSesion(sesion, "stock");
    if (sinModulo) return sinModulo;
    try {
      if (parsed.data.accion === "anular") return await anular(sesion, parsed.data.id);
      if (parsed.data.accion === "registrar_varios") return await registrarVarios(sesion, parsed.data);
      return await registrar(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para cargar movimientos falta correr la migración 107 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[stock/movimientos] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
