// /api/finanzas/banco — Finanzas, parte F5a: subir el extracto del banco,
// ver qué ya está en Gypi y cargar lo que falta (reglas en
// app/lib/finanzasBanco.js y app/lib/finanzasExtracto.js). Sin migración.
//
//   POST multipart { file, cuenta } → lee el extracto (resumen en PDF, Excel
//       .xlsx, CSV o el ".xls" que es una tabla HTML) y devuelve cada renglón
//       con la operación de Gypi que le corresponde o la sugerencia de tipo,
//       lo de Gypi que no apareció en el banco y el control del saldo.
//   POST { accion: "confirmar", cuenta, filas: [{ fecha, descripcion,
//       comprobante, importe, marca, tipo, contra, entidad?, proveedor_id?,
//       cliente_id? }] } → una operación por renglón (origen "banco"). Lo que
//       se confirma enseña para la próxima.
//   POST { accion: "aprender", cuenta, reglas } → suma las reglas que la
//       pantalla sacó del libro (la hoja T-OPERACIONES se lee en el teléfono o
//       la computadora: el libro pesa demasiado para subirlo).
//
// Solo el rol Dueño. Las operaciones van con su pase (la base también lo
// exige); las reglas, en config_sistema con la llave del servidor.
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA } from "../../../lib/finanzasOperaciones";
import { claseDeArchivo, grillaDeCsv, grillaDeHtml, movimientosDeGrilla, movimientosDePdf } from "../../../lib/finanzasExtracto";
import {
  CLAVE_REGLAS_BANCO, DIAS_EMPAREJAR, MAX_MOVIMIENTOS, ORIGEN_BANCO, controlSaldo, emparejarExtracto, entidadDe, juntarReglas,
  operacionDeMovimiento, reglasDeConfirmados, sugerir,
} from "../../../lib/finanzasBanco";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;
const COLUMNAS = "id,fecha,tipo,proveedor_id,entidad,total,total_ars,cuenta_debe,cuenta_haber,descripcion,referencia,origen,origen_id,anulada_at";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);
const mover = (fecha, d) => new Date(Date.parse(`${fecha}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`)) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function leerReglas(e) {
  const [fila] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_REGLAS_BANCO}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  return fila?.valor && typeof fila.valor === "object" ? fila.valor : null;
}

async function guardarReglas(e, cuenta, nuevas, actual) {
  const valor = { ...(actual || {}), [cuenta]: juntarReglas(actual?.[cuenta] || {}, nuevas) };
  if (actual) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_REGLAS_BANCO}`, { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_REGLAS_BANCO, valor });
  return Object.keys(valor[cuenta]).length;
}

async function bancoDe(sesion, cuenta) {
  const [t] = await leer(sesion, `fin_tesoreria?empresa_id=eq.${sesion.empresa_id}&cuenta=eq.${encodeURIComponent(cuenta)}&select=cuenta,nombre,tipo,moneda,activa&limit=1`);
  return t || null;
}

/** Los textos de cada página del PDF, con su posición. */
async function paginasDelPdf(bytes) {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const paginas = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    paginas.push(tc.items.map((it) => ({ str: it.str, x: it.transform?.[4], y: it.transform?.[5], w: it.width })));
  }
  return paginas;
}

async function extractoDe(bytes) {
  const clase = claseDeArchivo(bytes);
  if (clase === "pdf") return movimientosDePdf(await paginasDelPdf(bytes));
  if (clase === "xls") return { movimientos: [], error: "Es un Excel viejo (.xls): abrilo y guardalo como .xlsx o .csv, y subilo de nuevo." };
  if (clase === "xlsx") {
    const { hojasXlsx, leerHojaXlsx } = await import("../../../lib/leerXlsx");
    const [hoja] = hojasXlsx(bytes);
    return hoja ? movimientosDeGrilla(leerHojaXlsx(bytes, hoja, { maxFilas: MAX_MOVIMIENTOS + 50, maxCols: 30 }) || []) : { movimientos: [], error: "El Excel no tiene hojas" };
  }
  // El CSV del banco puede venir en latin1 (Windows): si no es UTF-8 válido, se lee así
  let texto;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { texto = new TextDecoder("latin1").decode(bytes); }
  return movimientosDeGrilla(clase === "html" ? grillaDeHtml(texto) : grillaDeCsv(texto));
}

async function leerExtracto(sesion, request) {
  const e = sesion.empresa_id;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const cuenta = String(form?.get("cuenta") || "");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Elegí el archivo del extracto" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "El archivo pesa más de 4 MB" }, { status: 413 });
  const banco = await bancoDe(sesion, cuenta);
  if (!banco) return NextResponse.json({ error: "Elegí la cuenta del banco" }, { status: 400 });
  if (banco.moneda === "USD") return NextResponse.json({ error: "Por ahora el extracto se sube solo para cuentas en pesos" }, { status: 400 });

  let ext;
  try {
    ext = await extractoDe(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "No pude leer el archivo. Probá con el Excel o el PDF que baja el banco." }, { status: 400 });
  }
  if (ext.error) return NextResponse.json({ error: ext.error }, { status: 400 });
  if (!ext.movimientos.length) return NextResponse.json({ error: "No encontré movimientos en el archivo" }, { status: 400 });
  if (ext.movimientos.length > MAX_MOVIMIENTOS) return NextResponse.json({ error: `Hasta ${MAX_MOVIMIENTOS} movimientos por vez: subí un mes por vez` }, { status: 400 });

  const fechas = ext.movimientos.map((m) => m.fecha).sort();
  const desde = mover(fechas[0], -DIAS_EMPAREJAR);
  const hasta = mover(fechas[fechas.length - 1], DIAS_EMPAREJAR);
  const c = encodeURIComponent(`"${cuenta.replace(/"/g, "")}"`);
  const [operaciones, reglasTodas, proveedores, clientes] = await Promise.all([
    leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=gte.${desde}&fecha=lte.${hasta}&or=(cuenta_debe.in.(${c}),cuenta_haber.in.(${c}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, 20000),
    leerReglas(e),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre&order=nombre.asc`, 5000).catch(() => []),
    leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo&order=nombre.asc`, 5000).catch(() => []),
  ]);
  const reglas = reglasTodas?.[cuenta] || {};
  const { filas, sin_banco } = emparejarExtracto(ext.movimientos, operaciones, cuenta);
  const ops = (o) => (o ? { id: o.id, fecha: o.fecha, tipo: o.tipo, descripcion: o.descripcion, entidad: o.entidad, origen: o.origen } : null);
  return NextResponse.json({
    ok: true,
    banco: { cuenta: banco.cuenta, nombre: banco.nombre },
    cuenta_extracto: ext.cuenta || null,
    desde: ext.desde || fechas[0], hasta: ext.hasta || fechas[fechas.length - 1],
    control: controlSaldo(ext),
    reglas: Object.keys(reglas).length,
    filas: filas.map((f) => {
      const s = f.op ? null : sugerir(f, reglas);
      return {
        fecha: f.fecha, comprobante: f.comprobante, descripcion: f.descripcion, importe: f.importe, marca: f.marca,
        op: ops(f.op), ya: f.ya,
        sugerencia: s ? { tipo: s.tipo, contra: s.contra, por: s.por, ...entidadDe(s.entidad, { proveedores, clientes }) } : null,
      };
    }),
    sin_banco: sin_banco.map(ops),
  });
}

async function confirmar(sesion, d) {
  const e = sesion.empresa_id;
  const cuenta = String(d.cuenta || "");
  const filas = Array.isArray(d.filas) ? d.filas : [];
  if (!filas.length) return NextResponse.json({ error: "Elegí qué movimientos cargar" }, { status: 400 });
  if (filas.length > MAX_MOVIMIENTOS) return NextResponse.json({ error: `Hasta ${MAX_MOVIMIENTOS} movimientos por vez` }, { status: 400 });
  const banco = await bancoDe(sesion, cuenta);
  if (!banco) return NextResponse.json({ error: "Elegí la cuenta del banco" }, { status: 400 });
  const [tipos, cuentas] = await Promise.all([
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,activo`),
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,activa`),
  ]);
  const hayTipo = new Set(tipos.filter((t) => t.activo !== false).map((t) => t.codigo));
  const hayCuenta = new Set(cuentas.filter((c) => c.activa !== false).map((c) => c.codigo));
  const ops = [];
  for (const [i, f] of filas.entries()) {
    const imp = Number(f?.importe);
    if (!FECHA.test(String(f?.fecha || "")) || !Number.isFinite(imp) || Math.abs(imp) < 0.01 || Math.abs(imp) >= 1e13) {
      return NextResponse.json({ error: `Renglón ${i + 1}: falta la fecha o el importe` }, { status: 400 });
    }
    if (!/^[0-9a-z:]{6,60}$/.test(String(f?.marca || ""))) return NextResponse.json({ error: `Renglón ${i + 1}: volvé a subir el extracto` }, { status: 400 });
    if (!hayTipo.has(f?.tipo)) return NextResponse.json({ error: `Renglón ${i + 1}: elegí el tipo de operación` }, { status: 400 });
    if (!hayCuenta.has(f?.contra) || f.contra === cuenta) return NextResponse.json({ error: `Renglón ${i + 1}: elegí la cuenta de enfrente` }, { status: 400 });
    ops.push(operacionDeMovimiento({ ...f, importe: imp }, cuenta));
  }
  // Lo que ya se cargó desde otro extracto no se repite
  const marcas = ops.map((o) => `"${o.origen_id}"`);
  const ya = new Set();
  for (let i = 0; i < marcas.length; i += 200) {
    const r = await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_BANCO}&anulada_at=is.null&origen_id=in.(${encodeURIComponent(marcas.slice(i, i + 200).join(","))})&select=origen_id`);
    r.forEach((o) => ya.add(o.origen_id));
  }
  const nuevas = ops.filter((o) => !ya.has(o.origen_id));
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  for (let i = 0; i < nuevas.length; i += 500) {
    await sbPost("fin_operaciones", nuevas.slice(i, i + 500).map((o) => ({ ...o, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora })), { sesion });
  }
  // Lo confirmado enseña para el próximo extracto
  try {
    await guardarReglas(e, cuenta, reglasDeConfirmados(filas.map((f) => ({ ...f, importe: Number(f.importe) }))), await leerReglas(e));
  } catch {
    // Las reglas son una ayuda: si no se guardan, las operaciones ya están
  }
  if (nuevas.length) broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, cargadas: nuevas.length, repetidas: ops.length - nuevas.length });
}

async function aprender(sesion, d) {
  const e = sesion.empresa_id;
  const cuenta = String(d.cuenta || "");
  if (!(await bancoDe(sesion, cuenta))) return NextResponse.json({ error: "Elegí la cuenta del banco" }, { status: 400 });
  const entrada = d.reglas && typeof d.reglas === "object" && !Array.isArray(d.reglas) ? d.reglas : null;
  if (!entrada) return NextResponse.json({ error: "No hay nada para aprender" }, { status: 400 });
  // Solo lo que tiene la forma de una regla
  const reglas = {};
  for (const [k, r] of Object.entries(entrada).slice(0, 2000)) {
    if (!/^[+-].{1,120}$/.test(k) || typeof r?.tipo !== "string" || typeof r?.contra !== "string") continue;
    reglas[k] = { tipo: r.tipo.slice(0, 80), contra: r.contra.slice(0, 40), ...(r.entidad ? { entidad: String(r.entidad).slice(0, 120) } : {}), n: Number(r.n) || 1 };
  }
  const total = await guardarReglas(e, cuenta, reglas, await leerReglas(e));
  return NextResponse.json({ ok: true, reglas: total });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  try {
    if (String(request.headers.get("content-type") || "").includes("multipart/form-data")) return await leerExtracto(sesion, request);
    const d = await request.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
    if (d.accion === "confirmar") return await confirmar(sesion, d);
    if (d.accion === "aprender") return await aprender(sesion, d);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return errorFinanzas(err, "banco");
  }
}
