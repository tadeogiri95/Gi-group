// app/lib/finanzasPagos.js — Finanzas, parte F2b (2): órdenes de pago
// (migración 175). Reglas puras; las usan /api/finanzas/pagos, la página del
// CFO (/op/<token>) y la pantalla Finanzas → 💸 Pagos.
//
//   - El dueño arma la orden desde la ficha del proveedor: qué compras paga
//     (informativo) y con qué formas: efectivo (una caja), transferencia (un
//     banco), e-cheq (siempre Credicoop) o cheques de terceros de la cartera.
//     El total es la suma de las formas.
//   - El dueño la paga cuando quiere (💸 Registrar pago): ahí se mueve la
//     plata. No espera a nadie.
//   - Al CFO se le manda solo para que sepa (13/11): el link por WhatsApp le
//     muestra lo que tiene preparado para firmar en el banco, antes o después
//     de pagarla. Si quiere, aprieta 👍 Visto y le avisamos al dueño.
//   - Estados en la base (los de la migración 175, sin cambiar):
//     borrador · para_aprobar = mandada al CFO · aprobada = el CFO la vio ·
//     rechazada (solo de antes del 13/11; se ve como mandada) · pagada ·
//     anulada. En una pagada, decidida_at dice si el CFO la vio.
//   - Al pagarla: efectivo y transferencia son "PAGO A PROVEEDORES"
//     (Proveedores contra la caja o el banco); el e-cheq es un cheque propio
//     nuevo (con su "PAGO A PROVEEDORES"); el cheque de terceros pasa a
//     entregado (con su operación), como en Finanzas → Cheques.
//   - 19/11 (Tadeo: la orden de pago quedaba repetida con el extracto): si
//     el extracto del banco (o una carga anterior) ya tiene la salida de esa
//     caja o banco por el mismo importe y con fecha cerca, la orden se une a
//     ese movimiento en vez de cargar otro. Uno solo → se une solo; varios →
//     se pregunta cuál. Al anular la orden, el movimiento vuelve a como estaba.
//   - 20/11 (Tadeo): cada e-cheq puede llevar el plazo fijo NUEVO que lo calza
//     (monto a depositar y vencimiento, que no puede ser después del cheque).
//   - 27/11 (Tadeo): el plazo fijo vence el día que el banco DEBITA el e-cheq
//     (fechaDebito de finanzasDiasHabiles.js: se deposita el día que vence o
//     el próximo hábil, y se debita el hábil siguiente; cuenta feriados, días
//     no laborables y feriados bancarios). Puede vencer hasta ese día.
//     Es solo informativo, no carga el plazo fijo (entra con la planilla del
//     banco). Para el CFO: "A rescatar del FCI" = transferencias + plazos
//     fijos a constituir (sumasPagos), en la orden y en el resumen.
import { BANCO_ECHEQ, cuentaBancoDe, cuentasCheques } from "./finanzasCheques";
import { plata } from "./finanzasOperaciones";
import { fechaDebito } from "./finanzasDiasHabiles";

export const ORIGEN_ORDEN_PAGO = "orden_pago";
/** El tipo de los pagos (la forma sale de la caja o el banco). */
export const TIPO_PAGO_PROVEEDOR = "PAGO A PROVEEDORES";
export const FORMAS_PAGO = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  echeq: `E-cheq ${BANCO_ECHEQ}`,
  cheque_tercero: "Cheque de terceros",
};
export const ESTADOS_ORDEN = {
  borrador: { nombre: "Borrador", icono: "📝" },
  para_aprobar: { nombre: "Mandada al CFO", icono: "📲" },
  aprobada: { nombre: "Vista por el CFO", icono: "👍" },
  rechazada: { nombre: "Mandada al CFO", icono: "📲" },
  pagada: { nombre: "Pagada", icono: "💸" },
  anulada: { nombre: "Anulada", icono: "🚫" },
};
export const CLAVE_CFO = "finanzas_cfo";
export const MAX_FORMAS = 20;
export const MAX_FACTURAS = 200;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const fechaCorta = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}/${String(f).slice(2, 4)}` : "");

const cajaValida = (tesoreria, cuenta, tipo) => tesoreria.find((t) => t.cuenta === cuenta && t.tipo === tipo && t.moneda !== "USD" && t.activa !== false);

/** Cajas (efectivo) y bancos (transferencia) en pesos que se pueden usar para pagar. */
export function cuentasParaPagar(tesoreria = []) {
  const vivas = tesoreria.filter((t) => t.activa !== false && t.moneda !== "USD");
  return { cajas: vivas.filter((t) => t.tipo === "caja"), bancos: vivas.filter((t) => t.tipo === "banco") };
}

/**
 * Revisa una orden de pago nueva. El total es la suma de las formas.
 * @param {object} f { proveedor_id, fecha, facturas, formas, notas }
 * @param {{ proveedores: object[], tesoreria: object[], cheques: object[] }} ctx
 * @returns {{ orden?: object, errores: string[] }}
 */
export function validarOrden(f = {}, { proveedores = [], tesoreria = [], cheques = [], feriados = [] } = {}) {
  const sinBancos = new Set(feriados || []);
  const errores = [];
  const proveedor = proveedores.find((p) => Number(p.id) === Number(f.proveedor_id));
  if (!proveedor) errores.push("Elegí el proveedor");
  if (!FECHA.test(String(f.fecha || ""))) errores.push("Falta la fecha");
  const facturas = (Array.isArray(f.facturas) ? f.facturas : []).slice(0, MAX_FACTURAS).map((x) => ({
    op_id: Number.isInteger(Number(x?.op_id)) && Number(x.op_id) > 0 ? Number(x.op_id) : null,
    fecha: FECHA.test(String(x?.fecha || "")) ? x.fecha : null,
    detalle: txt(x?.detalle, 160),
    importe: centavos(x?.importe),
  })).filter((x) => x.importe > 0);
  const lista = Array.isArray(f.formas) ? f.formas : [];
  if (!lista.length) errores.push("Agregá con qué se paga");
  if (lista.length > MAX_FORMAS) errores.push(`Hasta ${MAX_FORMAS} formas de pago por orden`);
  const usados = new Set();
  const formas = [];
  for (const [i, x] of lista.slice(0, MAX_FORMAS).entries()) {
    const n = `Forma ${i + 1}`;
    const forma = FORMAS_PAGO[x?.forma] ? x.forma : null;
    if (!forma) { errores.push(`${n}: elegí cómo se paga`); continue; }
    if (forma === "cheque_tercero") {
      const ch = cheques.find((c) => Number(c.id) === Number(x.cheque_id));
      if (!ch || ch.clase !== "tercero" || ch.estado !== "en_cartera") { errores.push(`${n}: ese cheque ya no está en cartera`); continue; }
      if (usados.has(ch.id)) { errores.push(`${n}: ese cheque ya está en la orden`); continue; }
      usados.add(ch.id);
      formas.push({
        forma, importe: centavos(ch.importe), cheque_id: ch.id,
        banco: ch.banco || null, numero: ch.numero || null, fecha_pago: ch.fecha_pago || null, librador: ch.librador || ch.recibido_de || null,
      });
      continue;
    }
    const importe = centavos(x.importe);
    if (!(importe > 0) || importe >= 1e13) { errores.push(`${n}: revisá el importe`); continue; }
    if (forma === "echeq") {
      if (!FECHA.test(String(x.fecha_pago || ""))) { errores.push(`${n}: falta la fecha de pago del e-cheq`); continue; }
      const pf = plazoDeForma(x.plazo_fijo);
      if (pf?.error) { errores.push(`${n}: ${pf.error}`); continue; }
      const debito = venceElPlazo(x.fecha_pago, sinBancos);
      if (pf && pf.vencimiento > debito) { errores.push(`${n}: el plazo fijo tiene que vencer a más tardar el ${fechaCorta(debito)}, el día que se debita el e-cheq`); continue; }
      formas.push({ forma, importe, fecha_pago: x.fecha_pago, numero: txt(x.numero, 40) || null, cuenta: cuentaBancoDe(BANCO_ECHEQ, tesoreria), ...(pf ? { plazo_fijo: pf } : {}) });
      continue;
    }
    const caja = cajaValida(tesoreria, String(x.cuenta || ""), forma === "efectivo" ? "caja" : "banco");
    if (!caja) { errores.push(`${n}: elegí ${forma === "efectivo" ? "la caja" : "el banco"}`); continue; }
    formas.push({ forma, importe, cuenta: caja.cuenta, cuenta_nombre: txt(caja.nombre, 120) });
  }
  const total = centavos(formas.reduce((s, x) => s + x.importe, 0));
  if (!errores.length && !(total > 0)) errores.push("El total tiene que ser mayor a cero");
  if (errores.length) return { errores };
  return {
    errores,
    orden: {
      proveedor_id: proveedor.id, proveedor_nombre: txt(proveedor.nombre, 120) || "Proveedor",
      fecha: f.fecha, facturas, formas, total, notas: txt(f.notas, 500) || null,
    },
  };
}

/**
 * El plazo fijo nuevo que calza un e-cheq (20/11), como llega del navegador.
 * Vacío (sin importe) → null: el e-cheq va sin plazo fijo.
 * @returns {null | { importe: number, vencimiento: string } | { error: string }}
 */
export function plazoDeForma(p) {
  if (!p || typeof p !== "object") return null;
  const vacio = p.importe == null || String(p.importe).trim() === "";
  if (vacio && !p.vencimiento) return null;
  const importe = centavos(p.importe);
  if (!(importe > 0) || importe >= 1e13) return { error: "revisá el monto del plazo fijo" };
  if (!FECHA.test(String(p.vencimiento || ""))) return { error: "falta cuándo vence el plazo fijo" };
  return { importe, vencimiento: p.vencimiento };
}

/**
 * 27/11: el día que tiene que vencer el plazo fijo que calza un e-cheq = el
 * día que el banco lo debita (feriados: Set o lista de fechas sin bancos).
 */
export function venceElPlazo(fechaCheque, feriados = null) {
  const f = feriados instanceof Set ? feriados : new Set(feriados || []);
  return fechaDebito(fechaCheque, f) || fechaCheque;
}

/** "Plazo fijo a constituir · vence el 09/12/26" (o "" si el e-cheq no lleva). */
export const textoPlazo = (x) => (x?.plazo_fijo ? `🏦 Plazo fijo a constituir · vence el ${fechaCorta(x.plazo_fijo.vencimiento)}` : "");

/**
 * Lo que hace falta para hacer todas las operaciones (20/11), sin las
 * anuladas: transferencias, plazos fijos a constituir y lo que hay que
 * rescatar del FCI (transferencias + plazos fijos). Efectivo y cheques van
 * aparte: no salen del FCI.
 */
export function sumasPagos(ordenes = []) {
  const s = { transferencia: 0, efectivo: 0, cheques: 0, plazos: 0, cantidadPlazos: 0 };
  for (const o of ordenes) {
    if (!o || o.estado === "anulada") continue;
    for (const x of o.formas || []) {
      const imp = centavos(x.importe);
      if (x.forma === "transferencia") s.transferencia = centavos(s.transferencia + imp);
      else if (x.forma === "efectivo") s.efectivo = centavos(s.efectivo + imp);
      else if (x.forma === "echeq" || x.forma === "cheque_tercero") s.cheques = centavos(s.cheques + imp);
      if (x.forma === "echeq" && x.plazo_fijo && centavos(x.plazo_fijo.importe) > 0) {
        s.plazos = centavos(s.plazos + centavos(x.plazo_fijo.importe));
        s.cantidadPlazos += 1;
      }
    }
  }
  return { ...s, rescatar: centavos(s.transferencia + s.plazos) };
}

/** Las líneas de "A rescatar del FCI" para WhatsApp (vacío si no hay transferencias ni plazos fijos). */
export function lineasRescate(ordenes = []) {
  const t = sumasPagos(ordenes);
  if (!(t.rescatar > 0)) return [];
  return [
    `A rescatar del FCI: ${plata(t.rescatar, "ARS")}`,
    `  (transferencias ${plata(t.transferencia, "ARS")} + plazos fijos a constituir ${plata(t.plazos, "ARS")})`,
  ];
}

/** Las filas HTML de "A rescatar del FCI" para los PDF (vacío si no hay nada). */
export function htmlRescate(ordenes = []) {
  const t = sumasPagos(ordenes);
  if (!(t.rescatar > 0)) return "";
  return `<table class="rescate"><tbody>
    <tr><td colspan="2"><b>Plata para hacer todas las operaciones</b></td></tr>
    <tr><td>Transferencias</td><td class="n">${esc(plata(t.transferencia))}</td></tr>
    <tr><td>Plazos fijos a constituir${t.cantidadPlazos ? ` (${t.cantidadPlazos})` : ""}</td><td class="n">${esc(plata(t.plazos))}</td></tr>
    <tr class="tot"><td>A rescatar del FCI</td><td class="n">${esc(plata(t.rescatar))}</td></tr>
  </tbody></table>`;
}

/** Estilo de esa tabla, para pegar en el <style> de cada PDF. */
export const CSS_RESCATE = `.rescate { margin-top: 5mm; margin-left: auto; width: 115mm; border: .4mm solid #000; break-inside: avoid; }
  .rescate td { border: none; padding: 1mm 2mm; }
  .rescate .tot td { border-top: .3mm solid #000; font-size: 12pt; font-weight: 800; }
  .pf td { border-bottom: .2mm solid #999; color: #333; font-size: 9pt; padding-left: 5mm; }`;

/** "Efectivo · Caja Principal", "E-cheq Credicoop · vence el 10/12/26"… */
export function textoForma(x) {
  if (x.forma === "efectivo" || x.forma === "transferencia") return `${FORMAS_PAGO[x.forma]}${x.cuenta_nombre ? ` · ${x.cuenta_nombre}` : ""}`;
  if (x.forma === "echeq") return `${FORMAS_PAGO.echeq}${x.numero ? ` N° ${x.numero}` : ""} · vence el ${fechaCorta(x.fecha_pago)}`;
  return [`Cheque${x.banco ? ` ${x.banco}` : " de terceros"}${x.numero ? ` N° ${x.numero}` : ""}`, x.fecha_pago ? `vence el ${fechaCorta(x.fecha_pago)}` : null, x.librador].filter(Boolean).join(" · ");
}

/**
 * Lo que se puede hacer con la orden según su estado. Pagar no espera al CFO.
 * 23/11: "marcar_pagada" la deja pagada sin generar nada (el movimiento entra
 * después con el extracto del banco o la planilla de caja). Una orden así
 * todavía se puede registrar ("pagar") si hace falta.
 * @param {string} estado
 * @param {object} [orden]  la orden entera, para saber si se pagó sin registrar
 */
export function accionesOrden(estado, orden = null) {
  if (estado === "pagada" && sinRegistrar(orden)) return ["pagar", "mandar", "anular"];
  return {
    borrador: ["pagar", "marcar_pagada", "mandar", "anular"],
    para_aprobar: ["pagar", "marcar_pagada", "mandar", "anular"],
    aprobada: ["pagar", "marcar_pagada", "mandar", "anular"],
    rechazada: ["pagar", "marcar_pagada", "mandar", "anular"],
    pagada: ["mandar", "anular"],
  }[estado] || [];
}

/** 23/11: se marcó pagada sin registrar movimientos (y todavía no se registró). */
export const sinRegistrar = (o) => o?.estado === "pagada" && o?.generado?.sin_registro === true;

/** Estados en los que la orden todavía no se pagó (ni se anuló). */
export const SIN_PAGAR = ["borrador", "para_aprobar", "aprobada", "rechazada"];

/** El CFO apretó 👍 Visto (en una pagada también puede haberla visto). */
export const vistaPorCfo = (o) => Boolean(o?.decidida_at) && o?.estado !== "rechazada";

/** Ya se le mandó el link al CFO. */
export const mandadaAlCfo = (o) => Boolean(o?.enviada_at) || ["para_aprobar", "aprobada", "rechazada"].includes(o?.estado);

/**
 * Lo que genera pagar la orden.
 * @returns {{ error?: string, operaciones?: object[], emitir?: object[], entregar?: { cheque_id: number }[] }}
 *   operaciones: las de efectivo y transferencia, listas para guardar.
 *   emitir: los e-cheq nuevos (fin_cheques); su operación sale de operacionAlta.
 *   entregar: los cheques de terceros que pasan a entregado (cambioDeEstado).
 */
export function generarPago(orden, { cuentas = [], tesoreria = [] } = {}, fecha) {
  if (!FECHA.test(String(fecha || ""))) return { error: "Falta la fecha del pago" };
  const c = cuentasCheques(cuentas);
  if (!c.proveedores) return { error: "Falta la cuenta \"Proveedores\" en el plan de cuentas" };
  const operaciones = [];
  const emitir = [];
  const entregar = [];
  const ref = `OP ${orden.numero}`;
  for (const [i, x] of (orden.formas || []).entries()) {
    if (x.forma === "efectivo" || x.forma === "transferencia") {
      const caja = cajaValida(tesoreria, x.cuenta, x.forma === "efectivo" ? "caja" : "banco");
      if (!caja) return { error: `${x.cuenta_nombre || "La caja o el banco"} ya no está en la lista de cajas y bancos` };
      operaciones.push({
        fecha, tipo: TIPO_PAGO_PROVEEDOR,
        proveedor_id: orden.proveedor_id || null, entidad: orden.proveedor_id ? null : txt(orden.proveedor_nombre, 120),
        neto: x.importe, iva: 0, otros_impuestos: 0, total: x.importe, moneda: "ARS", tipo_cambio: null, total_ars: x.importe,
        cuenta_debe: c.proveedores, cuenta_haber: caja.cuenta,
        descripcion: txt(`Orden de pago N° ${orden.numero} · ${FORMAS_PAGO[x.forma]} a ${orden.proveedor_nombre}`, 500),
        referencia: ref, origen: ORIGEN_ORDEN_PAGO, origen_id: `${orden.id}:${i}`, estado: "confirmada",
      });
    } else if (x.forma === "echeq") {
      if (!c.diferidos) return { error: "Falta la cuenta \"E-cheq diferidos a pagar\" en el plan de cuentas" };
      emitir.push({
        clase: "propio", tipo: "echeq_diferido", banco: BANCO_ECHEQ, numero: x.numero || null,
        beneficiario: txt(orden.proveedor_nombre, 120), proveedor_id: orden.proveedor_id || null,
        fecha_emision: fecha, fecha_pago: x.fecha_pago, importe: x.importe,
        cuenta_banco: x.cuenta || cuentaBancoDe(BANCO_ECHEQ, tesoreria), estado: "pendiente",
        origen: "pago", referencia: ref, notas: `Orden de pago N° ${orden.numero}`,
      });
    } else if (x.forma === "cheque_tercero") {
      if (!orden.proveedor_id) return { error: "Para entregar cheques de terceros el proveedor tiene que estar en la lista" };
      entregar.push({ cheque_id: Number(x.cheque_id) });
    }
  }
  return { operaciones, emitir, entregar };
}

/** Lo que ve el CFO en la página (nada de cuentas ni datos internos de más). */
export function datosParaCfo(orden, empresa = {}) {
  return {
    empresa: { nombre: empresa.nombre || "", logo: /^https:\/\//.test(String(empresa.logo_url || "")) ? empresa.logo_url : null },
    numero: orden.numero, fecha: orden.fecha, proveedor: orden.proveedor_nombre, total: Number(orden.total) || 0,
    estado: orden.estado, notas: orden.notas || null, cargada_por: orden.cargada_por_nombre || null,
    facturas: (orden.facturas || []).map((f) => ({ fecha: f.fecha, detalle: f.detalle, importe: f.importe, comprobantes: comprobantesFactura(f) })),
    formas: (orden.formas || []).map((x) => ({ texto: textoForma(x), importe: x.importe, ...(x.plazo_fijo ? { plazo: { texto: textoPlazo(x), importe: x.plazo_fijo.importe } } : {}) })),
    rescate: sumasPagos([orden]),
    pagada: orden.estado === "pagada", pagada_fecha: orden.pagada_fecha || null,
    visto: vistaPorCfo(orden) ? { por: orden.decidida_por_nombre || null, at: orden.decidida_at } : null,
    adjuntos: adjuntosDe(orden),
  };
}

/**
 * Las facturas o presupuestos adjuntos a la orden (19/11, migración 198):
 * solo links https, con nombre y tipo, para mostrar sin riesgo.
 * @returns {{ url: string, nombre: string, tipo: "pdf"|"foto" }[]}
 */
export function adjuntosDe(orden) {
  return (Array.isArray(orden?.adjuntos) ? orden.adjuntos : [])
    .filter((a) => a && /^https:\/\//.test(String(a.url || "")))
    .map((a, i) => {
      const tipo = /\.pdf$/i.test(a.url) ? "pdf" : "foto";
      return { url: a.url, nombre: txt(a.nombre, 120) || (tipo === "pdf" ? `Archivo ${i + 1}.pdf` : `Foto ${i + 1}`), tipo };
    });
}

/**
 * 22/11: los PDF o fotos de las facturas que paga la orden. Cada factura
 * guarda op_id (la compra o gasto en fin_operaciones) y esa operación tiene
 * sus comprobantes (fin_operaciones.comprobantes, migración 187, o la foto
 * vieja comprobante_url). Antes el CFO veía la factura solo como texto.
 */
export function idsOperacionesDe(ordenes = []) {
  const ids = new Set();
  for (const o of ordenes) for (const f of o?.facturas || []) {
    const id = Number(f?.op_id);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/** { op_id: [{ url, nombre, tipo }] } con los comprobantes de cada operación (solo https). */
export function mapaComprobantes(operaciones = []) {
  const mapa = {};
  for (const op of operaciones || []) {
    const lista = Array.isArray(op?.comprobantes) ? op.comprobantes.filter((c) => c && typeof c.url === "string") : [];
    if (op?.comprobante_url && !lista.some((c) => c.url === op.comprobante_url)) lista.unshift({ url: op.comprobante_url });
    const limpios = adjuntosDe({ adjuntos: lista });
    if (limpios.length) mapa[op.id] = limpios;
  }
  return mapa;
}

/** La orden con los comprobantes puestos en cada factura (facturas[i].comprobantes). */
export function conComprobantesFacturas(orden, mapa = {}) {
  if (!orden || !Array.isArray(orden.facturas) || !orden.facturas.length) return orden;
  return { ...orden, facturas: orden.facturas.map((f) => ({ ...f, comprobantes: mapa[Number(f?.op_id)] || [] })) };
}

/**
 * Lee los comprobantes de las facturas de esas órdenes y los pone en cada
 * una. leerFilas(path) devuelve las filas (con sesión o service_role, según
 * quién llame). Si algo falla, las órdenes siguen igual, sin los links.
 */
export async function ponerComprobantesFacturas(ordenes = [], empresaId, leerFilas) {
  const ids = idsOperacionesDe(ordenes);
  if (!ids.length || !empresaId) return ordenes;
  const base = `fin_operaciones?empresa_id=eq.${empresaId}&id=in.(${ids.join(",")})`;
  let filas = null;
  try { filas = await leerFilas(`${base}&select=id,comprobantes,comprobante_url`); } catch { filas = null; }
  // Sin la 187 no existe la columna comprobantes: queda la foto vieja
  if (!Array.isArray(filas)) { try { filas = await leerFilas(`${base}&select=id,comprobante_url`); } catch { filas = null; } }
  if (!Array.isArray(filas) || !filas.length) return ordenes;
  const mapa = mapaComprobantes(filas);
  return ordenes.map((o) => conComprobantesFacturas(o, mapa));
}

/** Los comprobantes de una factura de la orden, listos para mostrar. */
export const comprobantesFactura = (f) => adjuntosDe({ adjuntos: f?.comprobantes });

/** Mensaje de WhatsApp para el CFO. */
export function textoWhatsappCfo(orden, url, { empresa = "", cfo = "" } = {}) {
  return [
    `${cfo ? `Hola ${cfo}, ` : ""}te paso la orden de pago N° ${orden.numero}${empresa ? ` de ${empresa}` : ""} para que sepas lo que hay para firmar en el banco.`,
    `Proveedor: ${orden.proveedor_nombre}`,
    `Total: ${plata(orden.total, "ARS")}`,
    ...(orden.formas || []).flatMap((x) => [`• ${textoForma(x)}: ${plata(x.importe, "ARS")}`, ...(x.plazo_fijo ? [`   ${textoPlazo(x)}: ${plata(x.plazo_fijo.importe, "ARS")}`] : [])]),
    ...(sumasPagos([orden]).plazos > 0 ? ["", ...lineasRescate([orden])] : []),
    "",
    `Para verla abrí este link: ${url}`,
  ].join("\n");
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ESCAPES.get(ch));

/** La orden lista para imprimir o guardar en PDF (hoja A4). */
export function htmlOrdenPago({ empresa = {}, orden }) {
  const logo = /^https:\/\//.test(String(empresa?.logo_url || "")) ? empresa.logo_url : null;
  const nombre = empresa?.razon_social || empresa?.nombre || "";
  const est = ESTADOS_ORDEN[orden.estado];
  const facturas = (orden.facturas || []).map((f) => {
    const links = comprobantesFactura(f).map((a) => `<a href="${esc(a.url)}">${esc(a.nombre)}</a>`).join(" · ");
    return `<tr><td>${esc(fechaCorta(f.fecha))}</td><td>${esc(f.detalle)}${links ? `<span class="chico" style="display:block">📎 ${links}</span>` : ""}</td><td class="n">${esc(plata(f.importe))}</td></tr>`;
  }).join("");
  const formas = (orden.formas || []).map((x) => `<tr><td>${esc(textoForma(x))}</td><td class="n">${esc(plata(x.importe))}</td></tr>${x.plazo_fijo ? `<tr class="pf"><td>${esc(textoPlazo(x))}</td><td class="n">${esc(plata(x.plazo_fijo.importe))}</td></tr>` : ""}`).join("");
  const adjuntos = adjuntosDe(orden).map((a) => `<li><a href="${esc(a.url)}">${esc(a.nombre)}</a></li>`).join("");
  const decision = vistaPorCfo(orden)
    ? `<p class="nota"><b>Vista por el CFO</b>${orden.decidida_por_nombre ? ` (${esc(orden.decidida_por_nombre)})` : ""} el ${esc(fechaCorta(String(orden.decidida_at).slice(0, 10)))}.</p>`
    : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Orden de pago N° ${esc(orden.numero)} · ${esc(orden.proveedor_nombre)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; font-size: 10.5pt; }
  .cabecera { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin-bottom: 6mm; }
  .cabecera img { max-height: 20mm; max-width: 50mm; object-fit: contain; display: block; margin-bottom: 2mm; }
  .der { text-align: right; }
  h1 { font-size: 16pt; margin: 0; }
  h2 { font-size: 11pt; margin: 6mm 0 2mm; }
  .chico { font-size: 9pt; color: #333; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; border-bottom: .4mm solid #000; padding: 1.5mm 1mm; font-size: 9pt; }
  td { border-bottom: .2mm solid #999; padding: 1.5mm 1mm; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  .total { margin-top: 4mm; text-align: right; font-size: 13pt; font-weight: 800; }
  .nota { margin-top: 5mm; font-size: 9.5pt; }
  ${CSS_RESCATE}
  .firmas { display: flex; gap: 20mm; margin-top: 25mm; }
  .firmas div { flex: 1; border-top: .3mm solid #000; padding-top: 1.5mm; text-align: center; font-size: 9pt; }
</style></head><body>
  <div class="cabecera">
    <div>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<b>${esc(nombre)}</b></div>
    <div class="der">
      <h1>Orden de pago N° ${esc(orden.numero)}</h1>
      <div class="chico">Fecha: ${esc(fechaCorta(orden.fecha))}</div>
      ${est ? `<div class="chico">${esc(est.nombre)}</div>` : ""}
    </div>
  </div>
  <div><b>Proveedor:</b> ${esc(orden.proveedor_nombre)}</div>
  ${facturas ? `<h2>Qué se paga</h2><table><thead><tr><th>Fecha</th><th>Compra</th><th class="n">Importe</th></tr></thead><tbody>${facturas}</tbody></table>` : ""}
  <h2>Con qué se paga</h2>
  <table><thead><tr><th>Forma</th><th class="n">Importe</th></tr></thead><tbody>${formas}</tbody></table>
  <div class="total">Total: ${esc(plata(orden.total))}</div>
  ${sumasPagos([orden]).plazos > 0 ? htmlRescate([orden]) : ""}
  ${orden.notas ? `<p class="nota">${esc(orden.notas)}</p>` : ""}
  ${adjuntos ? `<h2>Facturas y presupuestos adjuntos</h2><ul class="chico">${adjuntos}</ul>` : ""}
  ${decision}
  <div class="firmas"><div>Preparó${orden.cargada_por_nombre ? `: ${esc(orden.cargada_por_nombre)}` : ""}</div><div>Firma</div></div>
</body></html>`;
}

/** Abre la orden en una pestaña nueva con el diálogo de impresión (ahí se elige "Guardar como PDF"). */
export function imprimirOrdenPago(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlOrdenPago(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 600);
}

/* ─── Unir con lo que ya trajo el extracto (19/11) ───────────────────── */

/** Días de diferencia entre la fecha del pago y el movimiento del banco. */
export const DIAS_UNIR = 5;
/** De dónde puede venir el movimiento que ya está (no de otra orden, cheque ni plazo fijo). */
const ORIGENES_UNIBLES = new Set(["banco", "libro", "manual", null, undefined, ""]);
const diasEntre = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;

/** Lo que se muestra de un movimiento para elegir (sin datos de más). */
export function opcionUnir(o) {
  return { id: o.id, fecha: o.fecha, tipo: o.tipo || "", descripcion: txt(o.descripcion, 160), entidad: o.entidad || "", origen: o.origen || "manual", total: centavos(o.total_ars ?? o.total) };
}

/**
 * Para cada pago en efectivo o transferencia de la orden, los movimientos que
 * ya están: salen de la misma caja o banco, por el mismo importe (al centavo),
 * con hasta DIAS_UNIR días de diferencia, sin ser de otro proveedor ni de otra
 * orden de pago. Un movimiento sirve para un solo pago.
 * @param {object[]} operaciones las de generarPago
 * @param {object[]} existentes las de la base (de esas cajas y fechas)
 * @param {{ proveedorId?: number|null, elegidas?: Record<string, number|"nueva"> }} [opts]
 *   elegidas = lo que eligió el usuario para cada pago con varias opciones
 * @returns {{ unir: Map<number, object>, dudas: { i: number, importe: number, cuenta: string, opciones: object[] }[] }}
 */
export function movimientosParaUnir(operaciones = [], existentes = [], { proveedorId = null, elegidas = {} } = {}) {
  const usadas = new Set();
  const unir = new Map();
  const dudas = [];
  const vivas = existentes.filter((o) => !o.anulada_at && ORIGENES_UNIBLES.has(o.origen)
    && !/^OP \d+/.test(String(o.referencia || ""))
    && (!o.proveedor_id || !proveedorId || Number(o.proveedor_id) === Number(proveedorId)));
  operaciones.forEach((op, i) => {
    const importe = centavos(op.total_ars ?? op.total);
    const opciones = vivas
      .filter((o) => !usadas.has(o.id) && o.cuenta_haber === op.cuenta_haber && Math.abs(centavos(o.total_ars ?? o.total) - importe) < 0.01 && diasEntre(o.fecha, op.fecha) <= DIAS_UNIR)
      .sort((a, b) => diasEntre(a.fecha, op.fecha) - diasEntre(b.fecha, op.fecha) || a.id - b.id);
    if (!opciones.length) return;
    const clave = String(i);
    const eleccion = Object.prototype.hasOwnProperty.call(elegidas, clave) ? elegidas[clave] : undefined;
    if (eleccion === "nueva") return;
    const elegida = opciones.length === 1 ? opciones[0] : opciones.find((o) => Number(o.id) === Number(eleccion));
    if (elegida) {
      usadas.add(elegida.id);
      unir.set(i, elegida);
    } else {
      dudas.push({ i, importe, cuenta: op.cuenta_haber, opciones: opciones.slice(0, 5).map(opcionUnir) });
    }
  });
  return { unir, dudas };
}

/**
 * Cómo queda el movimiento del banco al unirlo con el pago: contra
 * Proveedores, con el proveedor y la referencia de la orden. "antes" guarda
 * lo que tenía, para dejarlo igual si se anula la orden.
 */
export function cambioAlUnir(existente, pago) {
  const campos = ["tipo", "cuenta_debe", "proveedor_id", "entidad", "referencia", "descripcion"];
  const antes = Object.fromEntries(campos.map((k) => [k, existente[k] ?? null]));
  const desc = String(existente.descripcion || "").trim();
  const cambios = {
    tipo: pago.tipo, cuenta_debe: pago.cuenta_debe, proveedor_id: pago.proveedor_id, entidad: pago.entidad,
    referencia: pago.referencia,
    descripcion: txt(desc ? `${pago.descripcion} · ${desc}` : pago.descripcion, 500),
  };
  return { id: existente.id, antes, cambios };
}
