// /api/finanzas/tesoreria — Finanzas, parte F3a: cajas y bancos (reglas en
// app/lib/finanzasTesoreria.js). Sin migración.
//
//   GET → las cajas y bancos, sus operaciones (todas las fechas, sin las
//       anuladas), los responsables y el plan de cuentas. El saldo y los
//       movimientos los arma la pantalla.
//   POST { accion: "saldos_iniciales", fecha, tipo_cambio?, filas: [{ cuenta, saldo }] }
//       → el saldo de cada caja a la fecha de corte, contra Ajuste De
//       Capital. Si ya tenía uno, se reemplaza (el viejo queda anulado).
//   POST { accion: "transferir", desde, hacia, importe, fecha, tipo_cambio?, descripcion? }
//       → TRANSFERENCIA ENTRE CAJAS entre dos cajas o bancos de la misma moneda.
//       Con otra igual en alguna de las dos cajas (13/11), 409 con los
//       repetidos hasta que venga confirmar_repetido.
//   F3b (Mi caja, 176):
//   POST { accion: "config_mi_caja", ocultos: { gastos: [códigos], ingresos: [códigos] } }
//       → qué tipos de operación esconde Mi caja (el resto se ofrece).
//   POST { accion: "revisar", id, tipo? } → confirma lo que cargó un
//       responsable; con tipo, se lo cambia (la caja queda donde estaba).
//   POST { accion: "anular_mi_caja", id } → anula lo que cargó un responsable.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA } from "../../../lib/finanzasOperaciones";
import { ORIGEN_SALDO_INICIAL } from "../../../lib/finanzasProveedores";
import { ORIGEN_LIBRO } from "../../../lib/finanzasHistorico";
import { cuentaAjusteDe, operacionSaldoInicialCaja, validarTransferencia } from "../../../lib/finanzasTesoreria";
import { frenoRepetidos, repetidosEnBase } from "../../../lib/finanzasRepetidosServidor";
import { CLAVE_MI_CAJA, ORIGEN_MI_CAJA, cambioDeTipoMiCaja, conceptosMiCajaTodos, leerConfigMiCaja } from "../../../lib/finanzasMiCaja";

const COLUMNAS = "id,fecha,tipo,proveedor_id,cliente_id,entidad,proyecto_id,centro_costo,neto,iva,otros_impuestos,total,moneda,tipo_cambio,total_ars,cuenta_debe,cuenta_haber,descripcion,referencia,origen,origen_id,estado,cargada_por_nombre,anulada_at,anulada_por_nombre,created_at";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await leer(sesion, `empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`)) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const [tesoreria, cuentas, personal, tipos, cfg] = await Promise.all([
      leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,responsable_id,activa&order=nombre.asc`),
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
      leer(sesion, `empleados?empresa_id=eq.${e}&activo=eq.true&select=id,nombre&order=nombre.asc`),
      leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,activo&order=codigo.asc`),
      sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_MI_CAJA}&select=valor&limit=1`, { silent: true, fallback: [] }),
    ]);
    const lista = encodeURIComponent(tesoreria.map((t) => `"${String(t.cuenta).replace(/"/g, "")}"`).join(","));
    const path = (cols) => `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${lista}),cuenta_haber.in.(${lista}))&select=${cols}&order=fecha.asc,id.asc`;
    // La foto del ticket (176): sin la migración se ve todo menos la foto
    const operaciones = tesoreria.length
      ? await leer(sesion, path(`${COLUMNAS},comprobante_url,comprobantes`), 60000)
        // Sin la 187 (varios comprobantes, 13/11) o sin la 176
        .catch((err) => {
          if (/comprobantes/.test(String(err?.message))) return leer(sesion, path(`${COLUMNAS},comprobante_url`), 60000);
          throw err;
        })
        .catch((err) => {
          if (/comprobante_url/.test(String(err?.message))) return leer(sesion, path(COLUMNAS), 60000);
          throw err;
        })
      : [];
    return NextResponse.json({ tesoreria, cuentas, personal, operaciones, tipos, mi_caja: leerConfigMiCaja(cfg?.[0]?.valor) });
  } catch (err) {
    return errorFinanzas(err, "tesoreria GET");
  }
}

async function saldosIniciales(sesion, d) {
  const e = sesion.empresa_id;
  if (!FECHA.test(String(d.fecha || ""))) return NextResponse.json({ error: "Falta la fecha de corte" }, { status: 400 });
  const lista = Array.isArray(d.filas) ? d.filas.slice(0, 200) : [];
  if (!lista.length) return NextResponse.json({ error: "No hay saldos para cargar" }, { status: 400 });
  const [tesoreria, cuentas] = await Promise.all([
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa`),
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
  ]);
  // 13/11: con el histórico del libro pasado, el saldo ya sale de ahí (un
  // saldo inicial encima lo contaba dos veces: la apertura de junio de Credicoop)
  const conHistorico = await sbGet(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_LIBRO}&anulada_at=is.null&select=id,origen&limit=1`, { sesion, silent: true, fallback: [] });
  if ((conHistorico || []).some((o) => o.origen === ORIGEN_LIBRO)) return NextResponse.json({ error: "Ya pasaste el histórico del libro: el saldo de cada caja ya sale de ahí. Para revisar diferencias usá Configuración → Cuadrar con el libro." }, { status: 400 });
  const cuentaAjuste = cuentaAjusteDe(cuentas);
  if (!cuentaAjuste) return NextResponse.json({ error: "Falta la cuenta \"Ajuste De Capital\" en el plan de cuentas: copiá el libro en Configuración." }, { status: 400 });
  const tc = Number(d.tipo_cambio);
  const finales = [];
  for (const [i, f] of lista.entries()) {
    const caja = tesoreria.find((t) => t.cuenta === f?.cuenta);
    const saldo = Number(f?.saldo);
    if (!caja) return NextResponse.json({ error: `Fila ${i + 1}: esa caja no está en la lista de cajas y bancos` }, { status: 400 });
    if (!Number.isFinite(saldo) || Math.abs(saldo) >= 1e13) return NextResponse.json({ error: `Fila ${i + 1}: revisá el saldo` }, { status: 400 });
    if (Math.abs(saldo) < 0.01) continue;
    if (caja.moneda === "USD" && !(tc > 0)) return NextResponse.json({ error: "Para las cajas en dólares falta el tipo de cambio" }, { status: 400 });
    finales.push(operacionSaldoInicialCaja({ fecha: d.fecha, caja, saldo, tipo_cambio: tc }, cuentaAjuste));
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  // El saldo inicial anterior de cada una queda anulado (no se borra)
  const claves = lista.map((f) => `"t${String(f.cuenta).replace(/"/g, "")}"`);
  await sbPatch(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_SALDO_INICIAL}&anulada_at=is.null&origen_id=in.(${encodeURIComponent(claves.join(","))})`, {
    anulada_at: ahora, anulada_por_nombre: "Gypi (saldo inicial reemplazado)", updated_at: ahora,
  }, { sesion });
  if (finales.length) {
    await sbPost("fin_operaciones", finales.map((f) => ({ ...f, empresa_id: e, cargada_por_nombre: quien || "Gypi (copiado del libro)", created_at: ahora, updated_at: ahora })), { sesion });
  }
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, cargados: finales.length });
}

async function transferir(sesion, d) {
  const e = sesion.empresa_id;
  const tesoreria = await leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa`);
  const { op, errores } = validarTransferencia(d, tesoreria);
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  if (d.confirmar_repetido !== true) {
    const freno = frenoRepetidos(await repetidosEnBase(sesion, [op], { tesoreria }));
    if (freno) return freno;
  }
  const ahora = new Date().toISOString();
  const quien = await nombreEmpleado(sesion);
  const [o] = (await sbPost("fin_operaciones", { ...op, empresa_id: e, cargada_por_nombre: quien, created_at: ahora, updated_at: ahora }, { sesion })) || [];
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, operacion: o });
}

async function configMiCaja(sesion, d) {
  const e = sesion.empresa_id;
  const [tipos, cuentas] = await Promise.all([
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,activo`),
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
  ]);
  const { ocultos } = leerConfigMiCaja(d);
  const sirven = conceptosMiCajaTodos(tipos || [], cuentas || []);
  const valor = {
    ocultos: {
      gastos: ocultos.gastos.filter((k) => sirven.gastos.some((t) => t.codigo === k)),
      ingresos: ocultos.ingresos.filter((k) => sirven.ingresos.some((t) => t.codigo === k)),
    },
  };
  // config_sistema va con la clave de servicio, como el dato del CFO (F2b)
  const ya = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_MI_CAJA}&select=clave&limit=1`, { silent: true, fallback: [] });
  if (ya?.length) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_MI_CAJA}`, { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_MI_CAJA, valor });
  return NextResponse.json({ ok: true, mi_caja: valor });
}

async function revisar(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta el movimiento" }, { status: 400 });
  const [op] = (await leer(sesion, `fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&origen=eq.${ORIGEN_MI_CAJA}&anulada_at=is.null&select=id,tipo,cuenta_debe,cuenta_haber&limit=1`)) || [];
  if (!op) return NextResponse.json({ error: "No encontré ese movimiento o ya está anulado" }, { status: 404 });
  const cambios = { estado: "confirmada", updated_at: new Date().toISOString() };
  if (d.concepto) {
    // 14/11: el concepto de caja nuevo (tipo y cuenta); la caja queda donde estaba
    const [tipos, cuentas, tesoreria] = await Promise.all([
      leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,activo`),
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
      leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta`),
    ]);
    const cajaAlDebe = (tesoreria || []).some((t) => t.cuenta === op.cuenta_debe);
    const todos = conceptosMiCajaTodos(tipos || [], cuentas || []);
    const concepto = (cajaAlDebe ? todos.ingresos : todos.gastos).find((c) => c.codigo === String(d.concepto));
    if (!todos.fijos || !concepto) return NextResponse.json({ error: "Ese concepto no sirve para este movimiento" }, { status: 400 });
    Object.assign(cambios, { tipo: concepto.tipo, [cajaAlDebe ? "cuenta_haber" : "cuenta_debe"]: concepto.cuenta });
  } else if (d.tipo && d.tipo !== op.tipo) {
    const [[tipo], tesoreria] = await Promise.all([
      leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&codigo=eq.${encodeURIComponent(String(d.tipo))}&select=codigo,cuenta_debe,cuenta_haber,activo&limit=1`),
      leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta`),
    ]);
    const cambio = tipo && tipo.activo !== false ? cambioDeTipoMiCaja(op, tipo, tesoreria.map((t) => t.cuenta)) : null;
    if (!cambio) return NextResponse.json({ error: "Ese tipo no sirve para este movimiento: le falta la cuenta en Configuración" }, { status: 400 });
    Object.assign(cambios, cambio);
  }
  const [fila] = (await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, cambios, { sesion })) || [];
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, operacion: fila });
}

async function anularMiCaja(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Falta el movimiento" }, { status: 400 });
  const ahora = new Date().toISOString();
  const filas = await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&origen=eq.${ORIGEN_MI_CAJA}&anulada_at=is.null`, {
    anulada_at: ahora, anulada_por_nombre: await nombreEmpleado(sesion), updated_at: ahora,
  }, { sesion });
  if (!filas?.length) return NextResponse.json({ error: "No encontré ese movimiento o ya está anulado" }, { status: 404 });
  broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  try {
    if (d?.accion === "saldos_iniciales") return await saldosIniciales(sesion, d);
    if (d?.accion === "transferir") return await transferir(sesion, d);
    if (d?.accion === "config_mi_caja") return await configMiCaja(sesion, d);
    if (d?.accion === "revisar") return await revisar(sesion, d);
    if (d?.accion === "anular_mi_caja") return await anularMiCaja(sesion, d);
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return errorFinanzas(err, `tesoreria ${d?.accion}`);
  }
}
