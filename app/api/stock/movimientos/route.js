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
//               { tipo, renglones: [{ sku, cantidad, ot? }], notas?, fecha? }.
//               22/11 (carga por tanda): también ingresos, con proveedor,
//               comprobante y precio por renglón (409 repetido si un
//               comprobante ya entró, salvo forzar); hasta 200 renglones. Se
//               revisa todo antes y se guardan todos o ninguno. Con OT, cada
//               uno suma al costo de esa OT (costoMaterialesServidor).
//   anular    → gestión, cualquiera; el resto, solo los suyos recién cargados.
//   corregir  → (19/11, punto 12; migración 199) { id, cambios: { fecha,
//               cantidad, ot, notas, precio_unitario } }, los mismos que anular.
//               El movimiento queda anulado y se carga uno nuevo con lo
//               corregido (así la planilla MRP borra el renglón viejo y escribe
//               el nuevo); los dos guardan en su historial qué cambió y quién.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { validateBody, safeErrorMessage } from "../../../lib/validate";
import { movimientoStockBody } from "../../../lib/schemas";
import { sbGet, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { broadcastRefresh } from "../../../lib/broadcast";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { puedeCargar, puedeAnular, fechaDelMovimiento, movimientoCorregido } from "../../../lib/movimientosStock";
import { entradaCorreccion, conEntrada, falta199 } from "../../../lib/historialCambios";
import { logger } from "../../../lib/logger";
import { avisoIngresoRepetido, buscarIngresoRepetido } from "../../../lib/stockIngresos";
import { avisoFaltaProveedor, faltaColumna192, proveedorDeLista } from "../../../lib/elegirDeLista";

function faltaMigracion(err) {
  return String(err?.message).includes("movimientos_stock");
}

/** Sin la migración 197 no está la columna fecha: se carga como antes (con la de hoy). */
const faltaColumnaFecha = (err) => /fecha/.test(String(err?.message)) && /42703|does not exist|PGRST204|schema cache/.test(String(err?.message));

/**
 * Guarda los movimientos. Si falta la columna proveedor_id (192) o fecha
 * (197), los guarda sin ella, como antes.
 */
async function insertarMovimientos(filas, opts) {
  let lista = Array.isArray(filas) ? filas : [filas];
  for (let intento = 0; ; intento++) {
    try {
      return await sbPost("movimientos_stock", Array.isArray(filas) ? lista : lista[0], opts);
    } catch (err) {
      if (intento >= 3) throw err;
      const campo = faltaColumna192(err) && lista.some((f) => "proveedor_id" in f) ? "proveedor_id"
        : faltaColumnaFecha(err) && lista.some((f) => "fecha" in f) ? "fecha"
          : falta199(err) && lista.some((f) => "historial" in f) ? "historial" : null;
      if (!campo) throw err;
      lista = lista.map(({ [campo]: _sin, ...f }) => f);
    }
  }
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

  const dia = fechaDelMovimiento(datos.fecha);
  if (dia.error) return NextResponse.json({ error: dia.error }, { status: 400 });

  const esIngreso = datos.tipo === "ingreso";
  // Etapa 2 (14/11, migración 192): el proveedor del ingreso es uno de la lista
  let prov = null;
  if (esIngreso && (datos.proveedor || datos.proveedor_id)) {
    const proveedores = (await sbGet(`proveedores?empresa_id=eq.${e}&select=id,nombre,activo,unido_a`, { ...opts, silent: true, fallback: [] })) || [];
    prov = proveedorDeLista({ id: datos.proveedor_id, nombre: datos.proveedor }, proveedores);
    if (!prov) return NextResponse.json({ error: avisoFaltaProveedor(datos.proveedor || ""), falta_proveedor: true }, { status: 400 });
    datos = { ...datos, proveedor: String(prov.nombre).slice(0, 120) };
  }
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
    fecha: dia.fecha,
  };
  if (prov) fila.proveedor_id = Number(prov.id);
  const [creado] = (await insertarMovimientos(fila, opts)) || [];
  broadcastRefresh(e, "movimientos_stock");
  return NextResponse.json({ ok: true, movimiento: creado || fila });
}

const enLista = (vals) => `in.(${[...new Set(vals)].map((v) => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`;

async function registrarVarios(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (!puedeCargar(datos.tipo, sesion.rol)) return NextResponse.json({ error: "Ese movimiento lo carga la oficina" }, { status: 403 });
  const dia = fechaDelMovimiento(datos.fecha);
  if (dia.error) return NextResponse.json({ error: dia.error }, { status: 400 });
  const skus = datos.renglones.map((r) => r.sku);
  // El ingreso no lleva OT (22/11: los ingresos también van por tanda)
  const ots = datos.tipo === "ingreso" ? [] : datos.renglones.map((r) => r.ot).filter(Boolean);
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
    if (r.ot && datos.tipo !== "ingreso" && !otsOk.has(String(r.ot))) errores.push(`Renglón ${i + 1}: no encontré la OT ${r.ot}`);
  });
  // 22/11 (carga por tanda): el proveedor de cada ingreso es uno de la lista
  const esIngreso = datos.tipo === "ingreso";
  const provDe = new Map();
  if (esIngreso && datos.renglones.some((r) => r.proveedor)) {
    const proveedores = (await sbGet(`proveedores?empresa_id=eq.${e}&select=id,nombre,activo,unido_a`, { ...opts, silent: true, fallback: [] })) || [];
    datos.renglones.forEach((r, i) => {
      if (!r.proveedor || provDe.has(r.proveedor)) return;
      const p = proveedorDeLista({ nombre: r.proveedor }, proveedores);
      if (p) provDe.set(r.proveedor, p);
      else errores.push(`Renglón ${i + 1}: ${avisoFaltaProveedor(r.proveedor)}`);
    });
  }
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  // El comprobante que ya entró (una recepción de OC, una factura u otro ingreso) se confirma antes
  if (esIngreso && !datos.forzar) {
    const pares = new Map();
    for (const r of datos.renglones) {
      const p = provDe.get(r.proveedor);
      if (p && r.comprobante) pares.set(`${p.id}|${r.comprobante.toUpperCase()}`, { proveedor: p.nombre, comprobante: r.comprobante });
    }
    const repetidos = (await Promise.all([...pares.values()].map((x) => buscarIngresoRepetido(sbGet, e, x, opts)))).filter(Boolean);
    if (repetidos.length) {
      return NextResponse.json({ error: repetidos.map(avisoIngresoRepetido).join(" "), repetido: true, repetidos: repetidos.length }, { status: 409 });
    }
  }
  const quien = {
    empleado_id: sesion.empleado_id || null,
    legajo: Number.isInteger(sesion.legajo) ? sesion.legajo : null,
    empleado_nombre: empleados?.[0]?.nombre ? String(empleados[0].nombre).slice(0, 120) : null,
  };
  const filas = datos.renglones.map((r) => {
    const a = porSku.get(r.sku);
    const p = esIngreso ? provDe.get(r.proveedor) : null;
    const fila = {
      empresa_id: e, tipo: datos.tipo, sku: a.sku, nombre: a.nombre ?? null, unidad: a.unidad ?? null, division: a.division ?? null,
      cantidad: r.cantidad, ot: r.ot && !esIngreso ? String(r.ot) : null,
      proveedor: p ? String(p.nombre).slice(0, 120) : null,
      comprobante: esIngreso ? r.comprobante || null : null,
      precio_unitario: esIngreso ? r.precio_unitario ?? null : null,
      notas: datos.notas, ...quien,
      fecha: dia.fecha,
    };
    // Todas las filas con las mismas columnas (la base las guarda juntas)
    if (esIngreso) fila.proveedor_id = p ? Number(p.id) : null;
    return fila;
  });
  await insertarMovimientos(filas, opts);
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

/** Columnas que pasan del movimiento viejo al corregido. */
const COPIA = ["tipo", "sku", "nombre", "unidad", "division", "cantidad", "ot", "proveedor", "proveedor_id", "comprobante", "precio_unitario", "notas", "empleado_id", "legajo", "empleado_nombre", "fecha", "created_at", "canto"];

async function corregir(sesion, id, cambios) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const filtro = `movimientos_stock?id=eq.${id}&empresa_id=eq.${e}`;
  const [mov] = (await sbGet(`${filtro}&select=*&limit=1`, opts)) || [];
  if (!mov) return NextResponse.json({ error: "No encontré ese movimiento" }, { status: 404 });
  if (mov.anulado) return NextResponse.json({ error: "Ese movimiento ya está anulado" }, { status: 409 });
  if (!puedeAnular(mov, { rol: sesion.rol, empleadoId: sesion.empleado_id })) {
    return NextResponse.json({ error: "Solo podés corregir lo que cargaste vos hoy. Pedíselo a la oficina." }, { status: 403 });
  }
  const { campos, detalle, errores } = movimientoCorregido(mov, cambios);
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  if (campos.ot) {
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(campos.ot)}&select=ot&limit=1`, opts)) || [];
    if (!proyecto) return NextResponse.json({ error: `No encontré la OT ${campos.ot}` }, { status: 404 });
    campos.ot = proyecto.ot;
  }
  const [empleado] = sesion.empleado_id
    ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const quien = empleado?.nombre ? String(empleado.nombre).slice(0, 120) : "Oficina";
  const ahora = new Date().toISOString();
  const con199 = "historial" in mov;

  // Primero se anula el viejo (si otro lo anuló recién, no se carga el nuevo)
  const marca = { anulado: true, anulado_por: sesion.empleado_id || null, anulado_at: ahora };
  const [viejo] = (await sbPatch(`${filtro}&anulado=eq.false`, marca, opts)) || [];
  if (!viejo) return NextResponse.json({ error: "Ese movimiento ya está anulado" }, { status: 409 });
  const fila = { empresa_id: e };
  for (const c of COPIA) if (c in mov) fila[c] = mov[c];
  Object.assign(fila, campos);
  if (con199) fila.historial = conEntrada(mov.historial, entradaCorreccion({ por: quien, at: ahora, cambios: detalle, nota: `Corrige el movimiento GY-${mov.id}` }));
  let nuevo;
  try {
    [nuevo] = (await insertarMovimientos(fila, opts)) || [];
  } catch (err) {
    // Si el nuevo no se pudo guardar, el viejo vuelve a estar vivo
    await sbPatch(filtro, { anulado: false, anulado_por: null, anulado_at: null }, { ...opts, silent: true }).catch(() => null);
    throw err;
  }
  if (con199 && nuevo?.id) {
    await sbPatch(filtro, {
      historial: conEntrada(mov.historial, entradaCorreccion({ por: quien, at: ahora, cambios: detalle, nota: `Corregido: lo reemplaza el movimiento GY-${nuevo.id}` })),
    }, { ...opts, silent: true }).catch(() => null);
  }
  broadcastRefresh(e, "movimientos_stock");
  return NextResponse.json({ ok: true, movimiento: nuevo || fila, anulado: id, ...(con199 ? {} : { aviso: "Quedó corregido, pero sin historial: falta correr la migración 199 en Supabase." }) });
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
      if (parsed.data.accion === "corregir") return await corregir(sesion, parsed.data.id, parsed.data.cambios);
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
