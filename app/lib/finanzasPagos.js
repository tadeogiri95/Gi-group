// app/lib/finanzasPagos.js — Finanzas, parte F2b (2): órdenes de pago
// (migración 175). Reglas puras; las usan /api/finanzas/pagos, la página del
// CFO (/op/<token>) y la pantalla Finanzas → 💸 Pagos.
//
//   - El dueño arma la orden desde la ficha del proveedor: qué compras paga
//     (informativo) y con qué formas: efectivo (una caja), transferencia (un
//     banco), e-cheq (siempre Credicoop) o cheques de terceros de la cartera.
//     El total es la suma de las formas.
//   - borrador → para aprobar (se manda el link por WhatsApp al CFO) →
//     aprobada o rechazada (lo decide el CFO en la página, sin usuario) →
//     pagada (la marca el dueño: recién ahí se mueve la plata) · anulada.
//   - Al pagarla: efectivo y transferencia son "PAGO A PROVEEDORES"
//     (Proveedores contra la caja o el banco); el e-cheq es un cheque propio
//     nuevo (con su "PAGO A PROVEEDORES"); el cheque de terceros pasa a
//     entregado (con su operación), como en Finanzas → Cheques.
import { BANCO_ECHEQ, cuentaBancoDe, cuentasCheques } from "./finanzasCheques";
import { plata } from "./finanzasOperaciones";

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
  para_aprobar: { nombre: "Esperando al CFO", icono: "⏳" },
  aprobada: { nombre: "Aprobada, falta pagar", icono: "✅" },
  rechazada: { nombre: "Rechazada", icono: "❌" },
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
export function validarOrden(f = {}, { proveedores = [], tesoreria = [], cheques = [] } = {}) {
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
      formas.push({ forma, importe, fecha_pago: x.fecha_pago, numero: txt(x.numero, 40) || null, cuenta: cuentaBancoDe(BANCO_ECHEQ, tesoreria) });
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

/** "Efectivo · Caja Principal", "E-cheq Credicoop · se debita el 10/12/26"… */
export function textoForma(x) {
  if (x.forma === "efectivo" || x.forma === "transferencia") return `${FORMAS_PAGO[x.forma]}${x.cuenta_nombre ? ` · ${x.cuenta_nombre}` : ""}`;
  if (x.forma === "echeq") return `${FORMAS_PAGO.echeq}${x.numero ? ` N° ${x.numero}` : ""} · se debita el ${fechaCorta(x.fecha_pago)}`;
  return [`Cheque${x.banco ? ` ${x.banco}` : " de terceros"}${x.numero ? ` N° ${x.numero}` : ""}`, x.fecha_pago ? `vence el ${fechaCorta(x.fecha_pago)}` : null, x.librador].filter(Boolean).join(" · ");
}

/** Lo que se puede hacer con la orden según su estado. */
export function accionesOrden(estado) {
  return {
    borrador: ["mandar", "anular"],
    para_aprobar: ["mandar", "anular"],
    aprobada: ["pagar", "anular"],
    rechazada: ["mandar", "anular"],
    pagada: ["anular"],
  }[estado] || [];
}

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
    facturas: (orden.facturas || []).map((f) => ({ fecha: f.fecha, detalle: f.detalle, importe: f.importe })),
    formas: (orden.formas || []).map((x) => ({ texto: textoForma(x), importe: x.importe })),
    decision: orden.decidida_at ? { por: orden.decidida_por_nombre || null, nota: orden.decision_nota || null, at: orden.decidida_at } : null,
  };
}

/** Mensaje de WhatsApp para el CFO. */
export function textoWhatsappCfo(orden, url, { empresa = "", cfo = "" } = {}) {
  return [
    `${cfo ? `Hola ${cfo}, ` : ""}te paso la orden de pago N° ${orden.numero}${empresa ? ` de ${empresa}` : ""} para que la apruebes.`,
    `Proveedor: ${orden.proveedor_nombre}`,
    `Total: ${plata(orden.total, "ARS")}`,
    ...(orden.formas || []).map((x) => `• ${textoForma(x)}: ${plata(x.importe, "ARS")}`),
    "",
    `Para aprobarla o rechazarla abrí este link: ${url}`,
  ].join("\n");
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ESCAPES.get(ch));

/** La orden lista para imprimir o guardar en PDF (hoja A4). */
export function htmlOrdenPago({ empresa = {}, orden }) {
  const logo = /^https:\/\//.test(String(empresa?.logo_url || "")) ? empresa.logo_url : null;
  const nombre = empresa?.razon_social || empresa?.nombre || "";
  const est = ESTADOS_ORDEN[orden.estado];
  const facturas = (orden.facturas || []).map((f) => `<tr><td>${esc(fechaCorta(f.fecha))}</td><td>${esc(f.detalle)}</td><td class="n">${esc(plata(f.importe))}</td></tr>`).join("");
  const formas = (orden.formas || []).map((x) => `<tr><td>${esc(textoForma(x))}</td><td class="n">${esc(plata(x.importe))}</td></tr>`).join("");
  const decision = orden.decidida_at
    ? `<p class="nota"><b>${orden.estado === "rechazada" ? "Rechazada" : "Aprobada"}</b>${orden.decidida_por_nombre ? ` por ${esc(orden.decidida_por_nombre)}` : ""} el ${esc(fechaCorta(String(orden.decidida_at).slice(0, 10)))}.${orden.decision_nota ? ` ${esc(orden.decision_nota)}` : ""}</p>`
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
  ${orden.notas ? `<p class="nota">${esc(orden.notas)}</p>` : ""}
  ${decision}
  <div class="firmas"><div>Preparó${orden.cargada_por_nombre ? `: ${esc(orden.cargada_por_nombre)}` : ""}</div><div>Aprobó</div></div>
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
