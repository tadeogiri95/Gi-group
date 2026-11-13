// /api/finanzas/banco — Finanzas, parte F5a: subir el extracto del banco,
// ver qué ya está en Gypi y cargar lo que falta (reglas en
// app/lib/finanzasBanco.js y app/lib/finanzasExtracto.js). Sin migración.
//
//   POST multipart { file, cuenta } → lee el extracto (resumen en PDF, Excel
//       .xlsx o .xls, CSV o el ".xls" que es una tabla HTML) y devuelve cada renglón
//       con la operación de Gypi que le corresponde o la sugerencia de tipo,
//       lo de Gypi que no apareció en el banco y el control del saldo.
//   POST { accion: "confirmar", cuenta, filas: [{ fecha, descripcion,
//       comprobante, importe, marca, tipo, contra, entidad?, proveedor_id?,
//       cliente_id?, forzar? }] } → una operación por renglón (origen "banco").
//       Lo que se confirma enseña para la próxima. 13/11: un renglón igual a
//       algo que ya está en la cuenta (mismo importe, hasta 3 días) da 409
//       salvo que venga con forzar ("es otro distinto").
//   13/11 (parte 5): cada renglón sin pareja que coincide con algo que Gypi
//       espera (cheque por debitar o en cartera, orden de pago por
//       transferencia, plazo fijo vencido) trae "pendiente": se completa con
//       su pantalla en vez de cargarse nuevo. "confirmar" recibe también
//       archivo, desde, hasta y movimientos, y deja registrada la carga
//       (migración 188, fin_cargas_banco).
//   GET ?cuenta=X → las últimas cargas de esa cuenta. GET ?carga=id → la
//       carga con sus operaciones.
//   POST { accion: "deshacer", id, ops?: [id] } → anula las operaciones de
//       la carga (todas o las elegidas). Si no queda ninguna viva, la carga
//       queda deshecha.
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
import { FECHA, hoyAr } from "../../../lib/finanzasOperaciones";
import { idsParaDeshacer, pendientesDelExtracto } from "../../../lib/finanzasExtractoPendientes";
import { CLAVE_PLAZOS_FIJOS, leerGuardados, pathOpsPlazos, vencidosPendientes } from "../../../lib/finanzasPlazosFijos";
import { claseDeArchivo, grillaDeArchivo, movimientosDeGrilla, movimientosDePdf } from "../../../lib/finanzasExtracto";
import {
  CLAVE_REGLAS_BANCO, DIAS_EMPAREJAR, DIAS_SOSPECHA, MAX_MOVIMIENTOS, ORIGEN_BANCO, controlSaldo, emparejarExtracto, entidadDe, juntarReglas,
  operacionDeMovimiento, parecidosEnGypi, reglasDeConfirmados, repetidosEnCuenta, saldoPorOrigen, sugerir,
} from "../../../lib/finanzasBanco";

import { respuestaRepetidos } from "../../../lib/finanzasRepetidos";
import { repetidosEnBase } from "../../../lib/finanzasRepetidosServidor";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;
// Todo lo de la operación: desde el extracto se abre su detalle para corregirla o anularla (12/11)
const COLUMNAS = "*";
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

const FALTA_188 = "Los movimientos se cargaron, pero para que quede registrada la carga (y se pueda deshacer entera) falta correr la migración 188 en Supabase.";
const falta188 = (err) => /fin_cargas_banco/.test(String(err?.message)) && /does not exist|42P01|PGRST20[05]|schema cache/.test(String(err?.message));
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Lo que Gypi espera que pase por el banco: cheques vivos, órdenes sin pagar y plazos vencidos sin registrar. */
async function loQueSeEspera(sesion) {
  const e = sesion.empresa_id;
  const [cheques, ordenes, plazos] = await Promise.all([
    leer(sesion, `fin_cheques?empresa_id=eq.${e}&estado=in.(pendiente,en_cartera)&select=id,clase,estado,numero,beneficiario,recibido_de,librador,fecha_pago,importe,cuenta_banco`, 5000).catch(() => []),
    leer(sesion, `fin_ordenes_pago?empresa_id=eq.${e}&estado=in.(borrador,para_aprobar,aprobada,rechazada)&select=id,numero,proveedor_nombre,fecha,estado,formas`, 2000).catch(() => []),
    (async () => {
      const hoy = hoyAr();
      const [tesoreria, cfg] = await Promise.all([
        leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&tipo=eq.plazo_fijo&select=cuenta`),
        sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLAZOS_FIJOS}&select=valor&limit=1`, { silent: true, fallback: [] }),
      ]);
      const guardados = leerGuardados(cfg?.[0]?.valor);
      if (!guardados.length) return [];
      const cuentasPf = tesoreria.map((t) => t.cuenta);
      return vencidosPendientes(guardados, await leer(sesion, pathOpsPlazos(e, cuentasPf, hoy), 20000), cuentasPf, hoy);
    })().catch(() => []),
  ]);
  return { cheques, ordenes, plazos };
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
  if (claseDeArchivo(bytes) === "pdf") return movimientosDePdf(await paginasDelPdf(bytes));
  try {
    return movimientosDeGrilla((await grillaDeArchivo(bytes, { maxFilas: MAX_MOVIMIENTOS + 50, maxCols: 30 })) || []);
  } catch {
    return { movimientos: [], error: "No pude leer ese archivo: probá guardarlo como .xlsx o .csv y subirlo de nuevo." };
  }
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
  // Toda la cuenta hasta el fin del extracto: para el saldo de Gypi y los repetidos
  const [todas, reglasTodas, proveedores, clientes, espera] = await Promise.all([
    leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=lte.${hasta}&or=(cuenta_debe.in.(${c}),cuenta_haber.in.(${c}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, 50000),
    leerReglas(e),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre&order=nombre.asc`, 5000).catch(() => []),
    leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo&order=nombre.asc`, 5000).catch(() => []),
    loQueSeEspera(sesion),
  ]);
  const reglas = reglasTodas?.[cuenta] || {};
  const operaciones = todas.filter((o) => o.fecha >= desde);
  const { filas, sin_banco } = emparejarExtracto(ext.movimientos, operaciones, cuenta);
  const parecidos = parecidosEnGypi(filas, sin_banco, cuenta);
  const pendientes = pendientesDelExtracto(filas, { ...espera, cuenta });
  const finExtracto = ext.hasta || fechas[fechas.length - 1];
  const ops = (o) => (o ? { ...o, empresa_id: undefined } : null);
  return NextResponse.json({
    ok: true,
    archivo: txt(file.name, 200) || null,
    banco: { cuenta: banco.cuenta, nombre: banco.nombre },
    cuenta_extracto: ext.cuenta || null,
    desde: ext.desde || fechas[0], hasta: ext.hasta || fechas[fechas.length - 1],
    control: controlSaldo(ext),
    reglas: Object.keys(reglas).length,
    filas: filas.map((f, i) => {
      const s = f.op ? null : sugerir(f, reglas);
      return {
        fecha: f.fecha, comprobante: f.comprobante, descripcion: f.descripcion, importe: f.importe, marca: f.marca,
        op: ops(f.op), ya: f.ya, parecido: ops(parecidos.get(i)), pendiente: pendientes.get(i) || null,
        sospecha: f.sospecha ? { nivel: f.sospecha.nivel, motivo: f.sospecha.motivo, parecida: ops(f.sospecha.parecida) } : null,
        sugerencia: s ? { tipo: s.tipo, contra: s.contra, por: s.por, ...entidadDe(s.entidad, { proveedores, clientes }) } : null,
      };
    }),
    sin_banco: sin_banco.map(ops),
    // Cómo se arma el saldo de Gypi al último día del extracto, y lo que parece cargado dos veces
    saldo_gypi: saldoPorOrigen(todas, cuenta, finExtracto),
    repetidos: repetidosEnCuenta(todas, cuenta).map((g) => ({ ...g, ops: g.ops.map(ops) })),
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
  // 13/11: lo que se parece a algo ya cargado en esta cuenta (mismo importe,
  // hasta 3 días) solo entra con "es otro distinto" en ese renglón
  const forzadas = new Set(filas.filter((f) => f?.forzar === true).map((f) => String(f.marca)));
  const { repetidos, nombres } = await repetidosEnBase(sesion, nuevas, { tesoreria: [banco] });
  const sinOk = repetidos.filter((r) => !forzadas.has(nuevas[r.i].origen_id));
  if (sinOk.length) {
    return NextResponse.json({
      ...respuestaRepetidos(sinOk, nombres),
      error: `${sinOk.length === 1 ? "Un movimiento se parece" : `${sinOk.length} movimientos se parecen`} a lo que ya está en Gypi (mismo importe, ${DIAS_SOSPECHA} días o menos). Volvé a subir el extracto y tildá "Es otro distinto" solo en los que de verdad faltan.`,
      marcas: sinOk.map((r) => nuevas[r.i].origen_id),
    }, { status: 409 });
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const ids = [];
  for (let i = 0; i < nuevas.length; i += 500) {
    const hechas = await sbPost("fin_operaciones", nuevas.slice(i, i + 500).map((o) => ({ ...o, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora })), { sesion });
    if (Array.isArray(hechas)) ids.push(...hechas.map((o) => Number(o.id)).filter(Boolean));
  }
  // 13/11 (parte 5, migración 188): la carga queda registrada para poder deshacerla
  let carga = null;
  let aviso = null;
  if (nuevas.length) {
    try {
      const [fila] = (await sbPost("fin_cargas_banco", {
        empresa_id: e, cuenta, archivo: txt(d.archivo, 200) || null,
        desde: FECHA.test(String(d.desde || "")) ? d.desde : null, hasta: FECHA.test(String(d.hasta || "")) ? d.hasta : null,
        movimientos: Math.max(Number.isInteger(d.movimientos) ? d.movimientos : 0, filas.length), cargadas: nuevas.length, op_ids: ids,
        cargada_por_nombre: quien, created_at: ahora, updated_at: ahora,
      }, { sesion })) || [];
      carga = fila?.id || null;
    } catch (err) {
      if (!falta188(err)) throw err;
      aviso = FALTA_188;
    }
  }
  // Lo confirmado enseña para el próximo extracto
  try {
    await guardarReglas(e, cuenta, reglasDeConfirmados(filas.map((f) => ({ ...f, importe: Number(f.importe) }))), await leerReglas(e));
  } catch {
    // Las reglas son una ayuda: si no se guardan, las operaciones ya están
  }
  if (nuevas.length) broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, cargadas: nuevas.length, repetidas: ops.length - nuevas.length, carga, aviso });
}

async function deshacer(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta la carga" }, { status: 400 });
  const [carga] = (await leer(sesion, `fin_cargas_banco?id=eq.${id}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
  if (!carga) return NextResponse.json({ error: "No encontré esa carga" }, { status: 404 });
  const ids = idsParaDeshacer(carga, Array.isArray(d.ops) ? d.ops : null);
  if (!ids.length) return NextResponse.json({ error: "Elegí qué movimientos deshacer" }, { status: 400 });
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  let anuladas = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const r = await sbPatch(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_BANCO}&anulada_at=is.null&id=in.(${ids.slice(i, i + 200).join(",")})`,
      { anulada_at: ahora, anulada_por_nombre: quien, updated_at: ahora }, { sesion });
    anuladas += Array.isArray(r) ? r.length : 0;
  }
  // ¿Queda alguna viva de la carga?
  const todas = idsParaDeshacer(carga);
  let vivas = 0;
  for (let i = 0; i < todas.length; i += 200) {
    vivas += (await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&id=in.(${todas.slice(i, i + 200).join(",")})&select=id`)).length;
  }
  if (!vivas) await sbPatch(`fin_cargas_banco?id=eq.${id}&empresa_id=eq.${e}`, { deshecha_at: ahora, deshecha_por_nombre: quien, updated_at: ahora }, { sesion });
  if (anuladas) broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, anuladas, vivas, deshecha: !vivas });
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const q = new URL(request.url).searchParams;
  try {
    const id = Number(q.get("carga"));
    if (Number.isInteger(id) && id > 0) {
      const [carga] = (await leer(sesion, `fin_cargas_banco?id=eq.${id}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
      if (!carga) return NextResponse.json({ error: "No encontré esa carga" }, { status: 404 });
      const ids = idsParaDeshacer(carga);
      const operaciones = [];
      for (let i = 0; i < ids.length; i += 200) {
        operaciones.push(...(await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + 200).join(",")})&select=id,fecha,tipo,entidad,descripcion,total,cuenta_debe,cuenta_haber,anulada_at&order=fecha.asc,id.asc`)));
      }
      return NextResponse.json({ carga, operaciones });
    }
    const cuenta = txt(q.get("cuenta"), 40);
    if (!cuenta) return NextResponse.json({ error: "Falta la cuenta" }, { status: 400 });
    const cargas = await leer(sesion, `fin_cargas_banco?empresa_id=eq.${e}&cuenta=eq.${encodeURIComponent(cuenta)}&select=id,cuenta,archivo,desde,hasta,movimientos,cargadas,cargada_por_nombre,deshecha_at,deshecha_por_nombre,created_at&order=created_at.desc&limit=30`, 30)
      .catch((err) => {
        if (falta188(err)) return null;
        throw err;
      });
    return NextResponse.json({ cargas: cargas || [], falta_migracion: cargas === null });
  } catch (err) {
    return errorFinanzas(err, "banco GET");
  }
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
    if (d.accion === "deshacer") return await deshacer(sesion, d);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return errorFinanzas(err, "banco");
  }
}
