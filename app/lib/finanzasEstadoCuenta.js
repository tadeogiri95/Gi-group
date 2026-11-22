// app/lib/finanzasEstadoCuenta.js — Finanzas → 📒 Cuentas corrientes:
// 📄 Estado de cuenta en PDF para mandarle al cliente o al proveedor (pedido
// de Tadeo del 20/11). Sin migración.
//
// Respuestas de Tadeo (20/11):
//  - Por defecto todo el historial; se pueden elegir fechas.
//  - Sin datos de pago al pie por ahora.
//  - Del cliente no se dice "Factura": cada renglón es la OT (código, obra y
//    descripción) con su monto.
//  - El que es cliente y proveedor sale en un solo PDF, con las dos cuentas y el neto.
//
// El PDF SALE DE LA EMPRESA: acá solo entra lo que se le puede mostrar al
// otro. Nada de costos, márgenes, valores estimados por materiales, cuentas
// contables, quién cargó ni descripciones internas de las operaciones.
//  - Cliente: cada OT con PRECIO en el Plan (sin IVA, o con IVA si se tilda)
//    y cada cobro ("Pago recibido", con su OT si tiene). Las OT sin PRECIO no
//    se valorizan: van en una lista aparte "con monto a confirmar".
//  - Proveedor: los movimientos de la cuenta Proveedores (compras, notas de
//    crédito, pagos), con el número de comprobante; las compras pendientes se
//    calculan como en la ficha (los pagos van a las más viejas primero).
//
// 22/11 (pedido de Tadeo): cada cobro y cada pago dice su medio
// ("Transferencia · Galicia", "Efectivo", "Cheque o e-cheq"…), y del cliente
// se separan las OT entregadas (terminadas en el Plan) de las que faltan
// entregar, cada una con su importe, lo pagado y lo que falta. Los pagos sin
// OT van primero a las entregadas más viejas.

import { CLASES_COMPRA, ORIGEN_COMPRA_MANUAL, ORIGEN_SALDO_INICIAL, pendientesProveedor } from "./finanzasProveedores";
import { ORIGEN_AJUSTE_SALDO } from "./finanzasAjusteSaldo";
import { IVA_OT } from "./finanzasOtClientes";
import { partesOt } from "./nombreOt";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const entre = (f, desde, hasta) => (!desde || f >= desde) && (!hasta || f <= hasta);
const dias = (desde, hasta) => Math.max(0, Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000));
const porFecha = (a, b) => (a.fecha === b.fecha ? a.orden - b.orden : a.fecha < b.fecha ? -1 : 1);

/** "OT 7795 · Edificio Norte · Cocina": la OT sin el nombre del cliente (ya está arriba). */
export function conceptoOt(o) {
  const { codigo, proyecto, descripcion } = partesOt({ ot: o.ot, obra: o.obra, descripcion: o.descripcion, cliente: o.cliente || "" });
  return { concepto: codigo ? `OT ${codigo}` : "OT", detalle: [proyecto, descripcion].filter(Boolean).join(" · ") };
}

/** Movimientos con saldo anterior, cargos y abonos del período, y saldo renglón por renglón. */
function conSaldo(eventos, { desde, hasta }) {
  const orden = [...eventos].sort(porFecha);
  let anterior = 0;
  let saldo = 0;
  let cargos = 0;
  let abonos = 0;
  const movimientos = [];
  for (const ev of orden) {
    if (hasta && ev.fecha > hasta) continue;
    const efecto = centavos((ev.cargo || 0) - (ev.abono || 0));
    if (desde && ev.fecha < desde) { anterior = centavos(anterior + efecto); continue; }
    if (!movimientos.length) saldo = anterior;
    saldo = centavos(saldo + efecto);
    cargos = centavos(cargos + (ev.cargo || 0));
    abonos = centavos(abonos + (ev.abono || 0));
    movimientos.push({ fecha: ev.fecha, concepto: ev.concepto, detalle: ev.detalle || "", cargo: ev.cargo || 0, abono: ev.abono || 0, saldo });
  }
  return { anterior, cargos, abonos, saldo: centavos(anterior + cargos - abonos), movimientos };
}

/**
 * La cuenta del cliente, armada con lo que devuelve cuentasPorOt (sin materiales:
 * las OT sin PRECIO quedan sin valor y van "a confirmar").
 * @param {{ ots: object[], cobros: object[] }} c
 * @param {{ conIva?: boolean, desde?: string, hasta?: string, hoy: string }} o
 */
export function estadoCliente(c, { conIva = true, desde = "", hasta = "", hoy }) {
  const f = conIva ? 1 + IVA_OT : 1;
  const ots = (c?.ots || []).map((o, i) => ({ ...o, fecha: o.fecha || "0000-00-00", orden: i, ...conceptoOt(o) }));
  const valorizadas = ots.filter((o) => !o.estimado && !o.sin_valor && o.valor > 0).map((o) => ({ ...o, importe: centavos(o.valor * f) }));
  const porId = new Map(ots.map((o) => [o.proyecto_id, o]));
  const cobros = (c?.cobros || []).map((x, i) => ({ ...x, orden: 100000 + i }));
  const eventos = [
    ...valorizadas.map((o) => ({ fecha: o.fecha, orden: o.orden, concepto: o.concepto, detalle: o.detalle, cargo: o.importe })),
    ...cobros.map((x) => {
      const ot = x.proyecto_id ? porId.get(x.proyecto_id) : null;
      const deOt = ot ? [ot.concepto, ot.detalle].filter(Boolean).join(" · ") : "";
      return { fecha: x.fecha, orden: x.orden, concepto: "Pago recibido", detalle: [x.medio, deOt].filter(Boolean).join(" · "), abono: x.importe };
    }),
  ];
  const cuenta = conSaldo(eventos, { desde, hasta });

  // Lo que falta de cada OT al cierre: primero los cobros de esa OT; los
  // sueltos (y lo pagado de más en otra OT) van a las entregadas más viejas y
  // después a las que faltan entregar
  const corte = hasta || hoy;
  const entregadaAl = (o) => Boolean(o.entregada) && (!o.entrega || o.entrega <= corte);
  const hastaCorte = cobros.filter((x) => x.fecha <= corte);
  const falta = new Map(valorizadas.filter((o) => o.fecha <= corte).map((o) => [o.proyecto_id, o.importe]));
  let sueltos = 0;
  for (const x of hastaCorte) {
    if (x.proyecto_id && falta.has(x.proyecto_id)) {
      const resto = falta.get(x.proyecto_id) - x.importe;
      falta.set(x.proyecto_id, centavos(Math.max(0, resto)));
      if (resto < 0) sueltos = centavos(sueltos - resto);
    } else sueltos = centavos(sueltos + x.importe);
  }
  const enCorte = [...valorizadas].filter((o) => falta.has(o.proyecto_id)).sort(porFecha);
  const ordenPago = [...enCorte.filter(entregadaAl), ...enCorte.filter((o) => !entregadaAl(o))];
  for (const o of ordenPago) {
    const resto = falta.get(o.proyecto_id);
    const usa = Math.min(resto, sueltos);
    falta.set(o.proyecto_id, centavos(resto - usa));
    sueltos = centavos(sueltos - usa);
  }
  const fila = (o) => {
    const f = falta.get(o.proyecto_id);
    const desdeCuando = entregadaAl(o) && o.entrega ? o.entrega : o.fecha;
    return {
      fecha: o.fecha, entrega: entregadaAl(o) ? o.entrega || "" : "", concepto: [o.concepto, o.detalle].filter(Boolean).join(" · "),
      importe: o.importe, pagado: centavos(o.importe - f), falta: f, dias: dias(desdeCuando, corte),
    };
  };
  const pendientes = enCorte.filter((o) => falta.get(o.proyecto_id) > 0.009).map(fila);
  // Entregadas: solo las que deben algo (las pagadas ya están en los movimientos)
  const entregadas = enCorte.filter((o) => entregadaAl(o) && falta.get(o.proyecto_id) > 0.009).map(fila);
  // Por entregar: todas, aunque estén pagadas (son anticipos de algo que falta entregar)
  const porEntregar = enCorte.filter((o) => !entregadaAl(o)).map(fila);
  const suma = (xs, k) => centavos(xs.reduce((t, x) => t + x[k], 0));
  const entrega = {
    entregadas, por_entregar: porEntregar,
    falta_entregadas: suma(entregadas, "falta"), falta_por_entregar: suma(porEntregar, "falta"),
    importe_por_entregar: suma(porEntregar, "importe"), pagado_por_entregar: suma(porEntregar, "pagado"), a_favor: sueltos,
  };
  const aConfirmar = ots
    .filter((o) => (o.estimado || o.sin_valor || !(o.valor > 0)) && entre(o.fecha, desde, corte))
    .sort(porFecha)
    .map((o) => ({ fecha: o.fecha, concepto: o.concepto, detalle: o.detalle }));
  return {
    ...cuenta, pendientes, entrega, a_confirmar: aConfirmar, con_iva: conIva,
    columnas: { cargo: "Importe OT", abono: "Pagado" },
    textos: { cargos: conIva ? "Total de OT (con IVA)" : "Total de OT (sin IVA)", abonos: "Pagado" },
  };
}

/** El texto que ve el proveedor de cada movimiento (nada de descripciones internas). */
export function conceptoProveedor(op, efecto) {
  const ref = String(op.referencia || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (op.origen === ORIGEN_SALDO_INICIAL) return { concepto: "Saldo inicial", detalle: "" };
  if (op.origen === ORIGEN_AJUSTE_SALDO) return { concepto: "Ajuste de saldo", detalle: "" };
  const nc = efecto < 0 && op.origen === ORIGEN_COMPRA_MANUAL && String(op.descripcion || "").startsWith(CLASES_COMPRA.nota_credito);
  if (nc) return { concepto: "Nota de crédito", detalle: ref ? `N° ${ref}` : "" };
  if (efecto > 0) return { concepto: ref ? `Comprobante ${ref}` : "Compra", detalle: "" };
  return { concepto: "Pago", detalle: ref ? `N° ${ref}` : "" };
}

/**
 * La cuenta del proveedor, con los movimientos de movimientosProveedor (todas las fechas).
 * @param {{ op: object, compra: number, pago: number }[]} movs
 */
export function estadoProveedor(movs, { desde = "", hasta = "", hoy }) {
  const eventos = (movs || []).map((m, i) => {
    const { concepto, detalle } = conceptoProveedor(m.op, m.compra - m.pago);
    return { fecha: m.op.fecha, orden: i, concepto, detalle: [detalle, m.medio].filter(Boolean).join(" · "), cargo: m.compra, abono: m.pago };
  });
  const cuenta = conSaldo(eventos, { desde, hasta });
  const corte = hasta || hoy;
  const pendientes = pendientesProveedor((movs || []).filter((m) => m.op.fecha <= corte), corte).map((p) => {
    const { concepto, detalle } = conceptoProveedor(p.op, 1);
    return { fecha: p.op.fecha, concepto: [concepto, detalle].filter(Boolean).join(" · "), importe: p.importe, falta: p.falta, dias: p.dias };
  });
  return {
    ...cuenta, pendientes, a_confirmar: [],
    columnas: { cargo: "Facturado", abono: "Pagado" },
    textos: { cargos: "Facturado", abonos: "Pagado" },
  };
}

/** Cómo se lee el saldo desde el lado del que recibe el PDF. */
export function textoSaldo(lado, saldo) {
  if (Math.abs(saldo) < 0.01) return "Sin saldo pendiente";
  // Cliente: + nos debe (a su cargo). Proveedor: + le debemos (a su favor). Neto: + nos debe.
  const aSuCargo = lado === "proveedor" ? saldo < 0 : saldo > 0;
  return aSuCargo ? "Saldo a su cargo" : "Saldo a su favor";
}

/** Nombre del archivo: "Estado de cuenta - Constructora Ejemplo - 2026-11-20.pdf". */
export function nombreArchivoEstado(nombre, hoy) {
  const limpio = String(nombre || "cuenta").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "cuenta";
  return `Estado de cuenta - ${limpio} - ${hoy}.pdf`;
}

/* ─── La hoja ────────────────────────────────────────────────────────── */

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ESCAPES.get(ch));
const urlSegura = (u) => (/^https:\/\/[^\s"'<>]{1,500}$/.test(String(u ?? "").trim()) ? String(u).trim() : null);
const colorSeguro = (c) => (/^#[0-9a-f]{6}$/i.test(String(c ?? "").trim()) ? String(c).trim() : null);
const fechaLarga = (f) => (FECHA_ISO.test(String(f || "")) ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");
const fechaCorta = (f) => (FECHA_ISO.test(String(f || "")) && f !== "0000-00-00" ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const pesos = (n) => {
  const v = Number(n) || 0;
  const t = Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "-" : ""}$ ${t}`;
};

function seccionHtml(titulo, s, { desde, corte }) {
  const filas = s.movimientos.map((m) => `<tr><td>${esc(fechaCorta(m.fecha))}</td><td><b>${esc(m.concepto)}</b>${m.detalle ? `<div class="sub">${esc(m.detalle)}</div>` : ""}</td><td class="n">${m.cargo ? esc(pesos(m.cargo)) : ""}</td><td class="n">${m.abono ? esc(pesos(m.abono)) : ""}</td><td class="n s">${esc(pesos(m.saldo))}</td></tr>`).join("");
  const anterior = desde ? `<tr class="ant"><td>${esc(fechaCorta(desde))}</td><td>Saldo anterior</td><td></td><td></td><td class="n s">${esc(pesos(s.anterior))}</td></tr>` : "";
  const vacio = !s.movimientos.length ? `<tr><td></td><td class="vacio">Sin movimientos${desde ? " en el período" : ""}.</td><td></td><td></td><td></td></tr>` : "";
  const tag = (d) => `<span class="tag ${d > 60 ? "tr" : d > 30 ? "ta" : "tv"}">${esc(d)} ${d === 1 ? "día" : "días"}</span>`;
  const e = s.entrega;
  const entrega = e ? `
  ${e.falta_entregadas > 0.009 || e.falta_por_entregar > 0.009 ? `<p class="aclara reparto">Del saldo: <b>${esc(pesos(e.falta_entregadas))}</b> corresponde a OT ya entregadas y <b>${esc(pesos(e.falta_por_entregar))}</b> a OT pendientes de entrega${e.a_favor > 0.009 ? `; además hay <b>${esc(pesos(e.a_favor))}</b> pagados a cuenta` : ""}.</p>` : ""}
  <h3>OT entregadas con saldo pendiente al ${esc(fechaLarga(corte))}</h3>
  ${e.entregadas.length ? `<table><thead><tr><th class="f">Entrega</th><th>OT</th><th class="n">Importe</th><th class="n">Pagado</th><th class="n">Falta</th><th class="n">Antigüedad</th></tr></thead><tbody>
  ${e.entregadas.map((p) => `<tr><td>${esc(fechaCorta(p.entrega) || "Entregada")}</td><td>${esc(p.concepto)}</td><td class="n">${esc(pesos(p.importe))}</td><td class="n">${p.pagado ? esc(pesos(p.pagado)) : ""}</td><td class="n s">${esc(pesos(p.falta))}</td><td class="n">${tag(p.dias)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td></td><td>Total</td><td></td><td></td><td class="n">${esc(pesos(e.falta_entregadas))}</td><td></td></tr></tfoot></table>` : `<p class="aclara">Todas las OT entregadas están pagadas.</p>`}
  <h3>OT pendientes de entrega al ${esc(fechaLarga(corte))}</h3>
  ${e.por_entregar.length ? `<table><thead><tr><th class="f">Fecha</th><th>OT</th><th class="n">Importe</th><th class="n">Pagado</th><th class="n">Falta</th></tr></thead><tbody>
  ${e.por_entregar.map((p) => `<tr><td>${esc(fechaCorta(p.fecha))}</td><td>${esc(p.concepto)}</td><td class="n">${esc(pesos(p.importe))}</td><td class="n">${p.pagado ? esc(pesos(p.pagado)) : ""}</td><td class="n s">${esc(pesos(p.falta))}</td></tr>`).join("")}
  </tbody><tfoot><tr><td></td><td>Total</td><td class="n">${esc(pesos(e.importe_por_entregar))}</td><td class="n">${esc(pesos(e.pagado_por_entregar))}</td><td class="n">${esc(pesos(e.falta_por_entregar))}</td></tr></tfoot></table>` : `<p class="aclara">No hay OT pendientes de entrega.</p>`}` : "";
  const pend = !e && s.pendientes.length ? `
  <h3>Pendiente de pago al ${esc(fechaLarga(corte))}</h3>
  <table><thead><tr><th class="f">Fecha</th><th>Concepto</th><th class="n">Importe</th><th class="n">Falta</th><th class="n">Antigüedad</th></tr></thead><tbody>
  ${s.pendientes.map((p) => `<tr><td>${esc(fechaCorta(p.fecha))}</td><td>${esc(p.concepto)}</td><td class="n">${esc(pesos(p.importe))}</td><td class="n s">${esc(pesos(p.falta))}</td><td class="n">${tag(p.dias)}</td></tr>`).join("")}
  </tbody></table>` : "";
  const conf = s.a_confirmar.length ? `
  <h3>OT con monto a confirmar</h3>
  <p class="aclara">Estas OT todavía no tienen el monto definido y no suman al saldo.</p>
  <table><tbody>${s.a_confirmar.map((o) => `<tr><td class="f">${esc(fechaCorta(o.fecha))}</td><td><b>${esc(o.concepto)}</b>${o.detalle ? `<div class="sub">${esc(o.detalle)}</div>` : ""}</td></tr>`).join("")}</tbody></table>` : "";
  return `<section>
  ${titulo ? `<h2>${esc(titulo)}</h2>` : "<h2>Movimientos</h2>"}
  <table><thead><tr><th class="f">Fecha</th><th>Concepto</th><th class="n">${esc(s.columnas.cargo)}</th><th class="n">${esc(s.columnas.abono)}</th><th class="n">Saldo</th></tr></thead><tbody>
  ${anterior}${filas}${vacio}
  </tbody><tfoot><tr><td></td><td>Totales${desde ? " del período" : ""}</td><td class="n">${esc(pesos(s.cargos))}</td><td class="n">${esc(pesos(s.abonos))}</td><td class="n">${esc(pesos(s.saldo))}</td></tr></tfoot></table>
  ${entrega}${pend}${conf}
</section>`;
}

/**
 * La hoja HTML del estado de cuenta (A4, para pdfDeHtml).
 * @param {{ empresa: object, nombre: string, cuit?: string, cliente?: object, proveedor?: object, desde?: string, hasta?: string, hoy: string }} e
 */
export function htmlEstadoCuenta({ empresa = {}, nombre, cuit = "", cliente = null, proveedor = null, desde = "", hasta = "", hoy }) {
  const color = colorSeguro(empresa.color);
  const logo = urlSegura(empresa.logo);
  const nombreEmpresa = empresa.nombre || "";
  const corte = hasta || hoy;
  const ambos = Boolean(cliente && proveedor);
  const lado = ambos ? "neto" : cliente ? "cliente" : "proveedor";
  const saldo = ambos ? centavos(cliente.saldo - proveedor.saldo) : (cliente || proveedor).saldo;
  const tipo = ambos ? "Cliente y proveedor" : cliente ? "Cliente" : "Proveedor";
  const periodo = desde || hasta
    ? `Período: ${desde ? fechaLarga(desde) : "desde el inicio"} al ${fechaLarga(corte)}`
    : `Todos los movimientos al ${fechaLarga(corte)}`;
  const iva = cliente ? (cliente.con_iva ? "Importes de OT con IVA" : "Importes de OT sin IVA") : "";
  const kpi = (l, v, big = false) => `<div class="k${big ? " big" : ""}"><div class="l">${esc(l)}</div><div class="v">${esc(pesos(v))}</div></div>`;
  const resumen = ambos
    ? `<div class="res">${kpi("Como cliente: " + textoSaldo("cliente", cliente.saldo).toLowerCase(), Math.abs(cliente.saldo))}${kpi("Como proveedor: " + textoSaldo("proveedor", proveedor.saldo).toLowerCase(), Math.abs(proveedor.saldo))}${kpi(Math.abs(saldo) < 0.01 ? "Saldo neto" : textoSaldo("neto", saldo) + " (neto)", Math.abs(saldo), true)}</div>`
    : (() => {
      const s = cliente || proveedor;
      return `<div class="res">${desde ? kpi(`Saldo al ${fechaCorta(desde)}`, s.anterior) : ""}${kpi(s.textos.cargos, s.cargos)}${kpi(s.textos.abonos, s.abonos)}${kpi("Saldo a la fecha", s.saldo, true)}</div>`;
    })();
  const secciones = ambos
    ? seccionHtml("Cuenta como cliente", cliente, { desde, corte }) + seccionHtml("Cuenta como proveedor", proveedor, { desde, corte })
    : seccionHtml("", cliente || proveedor, { desde, corte });
  const datosEmpresa = [empresa.cuit ? `CUIT ${empresa.cuit}` : "", empresa.domicilio || ""].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Estado de cuenta - ${esc(nombre)}</title>
<style>
  :root { --marca: #0f4c81; }
  ${color ? `:root { --marca: ${color}; }` : ""}
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", Arial, sans-serif; color: #1f2937; font-size: 11px; background: #fff; }
  .cabecera { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 3px solid var(--marca); padding-bottom: 10px; }
  .marca { display: flex; gap: 10px; align-items: center; }
  .marca img { max-height: 52px; max-width: 150px; object-fit: contain; display: block; }
  .marca b { font-size: 16px; color: var(--marca); display: block; }
  .gris { color: #6b7280; font-size: 10px; line-height: 1.6; }
  .tit { text-align: right; }
  .tit h1 { margin: 0 0 2px; font-size: 18px; color: var(--marca); letter-spacing: .5px; }
  .para { display: flex; gap: 12px; margin: 14px 0 12px; }
  .box { flex: 1; background: #f3f6fa; border-radius: 8px; padding: 10px 12px; }
  .box .l, .k .l { font-size: 9px; text-transform: uppercase; color: #6b7280; letter-spacing: .5px; }
  .box .v { font-size: 13px; font-weight: 700; margin-top: 3px; }
  .box .grande { font-size: 18px; color: var(--marca); }
  .res { display: flex; gap: 10px; margin-bottom: 6px; }
  .k { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 11px; }
  .k .v { font-size: 13px; font-weight: 700; margin-top: 3px; white-space: nowrap; }
  .k.big { background: var(--marca); border-color: var(--marca); color: #fff; }
  .k.big .l { color: rgba(255,255,255,.8); }
  .k.big .v { font-size: 15px; }
  h2 { font-size: 12px; color: var(--marca); margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .6px; }
  h3 { font-size: 11px; color: var(--marca); margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .5px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: var(--marca); color: #fff; font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; padding: 6px 7px; text-align: left; }
  th.f, td.f { width: 62px; }
  td { padding: 6px 7px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  .n { text-align: right; white-space: nowrap; }
  th.n { text-align: right; }
  .s { font-weight: 700; }
  .sub { color: #6b7280; font-size: 9.5px; margin-top: 1px; }
  tr.ant td { font-style: italic; color: #6b7280; }
  .vacio { color: #6b7280; }
  tfoot td { font-weight: 700; border-top: 2px solid var(--marca); background: #f3f6fa; }
  .tag { padding: 2px 7px; border-radius: 10px; font-size: 9px; font-weight: 700; }
  .tv { background: #dcfce7; color: #166534; } .ta { background: #fef3c7; color: #92400e; } .tr { background: #fee2e2; color: #991b1b; }
  .aclara { margin: 0 0 6px; color: #6b7280; font-size: 10px; }
  .aclara.reparto { margin: 8px 0 0; color: #374151; font-size: 11px; }
  .nota { margin-top: 16px; background: #f3f6fa; border-left: 3px solid var(--marca); padding: 9px 12px; color: #4b5563; font-size: 10px; line-height: 1.6; }
</style></head><body>
  <div class="cabecera">
    <div class="marca">${logo ? `<img src="${esc(logo)}" alt="" crossorigin="anonymous">` : ""}<div><b>${esc(nombreEmpresa)}</b>${datosEmpresa ? `<div class="gris">${esc(datosEmpresa)}</div>` : ""}</div></div>
    <div class="tit"><h1>ESTADO DE CUENTA</h1><div class="gris">${esc(tipo)}<br>Emitido el ${esc(fechaLarga(hoy))}<br>${esc(periodo)}${iva ? `<br>${esc(iva)}` : ""}</div></div>
  </div>
  <div class="para">
    <div class="box"><div class="l">${esc(tipo)}</div><div class="v">${esc(nombre)}</div>${cuit ? `<div class="sub">CUIT ${esc(cuit)}</div>` : ""}</div>
    <div class="box"><div class="l">${esc(ambos ? (Math.abs(saldo) < 0.01 ? "Saldo neto" : `${textoSaldo("neto", saldo)} (neto)`) : textoSaldo(lado, saldo))}</div><div class="v grande">${esc(pesos(Math.abs(saldo)))}</div><div class="sub">al ${esc(fechaLarga(corte))}</div></div>
  </div>
  ${resumen}
  ${secciones}
  <div class="nota">Este es nuestro registro al ${esc(fechaLarga(corte))}. Si en sus registros figura otro saldo, por favor avísenos para revisarlo juntos.</div>
</body></html>`;
}

/** Descarga el PDF (solo en el navegador). */
export async function descargarEstadoCuenta(datos) {
  const { descargarPdfDeHtml } = await import("./pdfDeHtml");
  return descargarPdfDeHtml(htmlEstadoCuenta(datos), { archivo: nombreArchivoEstado(datos.nombre, datos.hoy), bloques: ".cabecera, .para, .res, h2, h3, .aclara, tr, .nota" });
}
