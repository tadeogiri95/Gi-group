// app/lib/finanzasCuentasPagarCobrar.js — Finanzas → Informes → 🗂 Cuentas a
// cobrar y a pagar (pedido de Tadeo del 19/11). Sin migración.
//
// Como el Estado de Resultados o el Flujo de caja, pero de lo que nos deben
// los clientes y lo que les debemos a los proveedores a una fecha: el total,
// quién debe o a quién se le debe, y hace cuánto (hasta 30 días, 31 a 60, 61
// a 90 y más de 90). Los pagos y cobros se aplican a lo más viejo primero,
// igual que en la ficha del proveedor (pendientesProveedor).
import { efectoCliente, indiceClientes, claveCliente, saldosClientes } from "./finanzasClientes";
import { claveDe, efectoDeuda, saldosProveedores } from "./finanzasProveedores";
import { $, B, N, NB, T, dma, esc, hojaInforme } from "./finanzasInformes";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const DIA = 86400000;

/** Los tramos de antigüedad, en el orden en que se muestran. */
export const TRAMOS = [
  { id: "d30", nombre: "Hasta 30 días", hasta: 30 },
  { id: "d60", nombre: "31 a 60 días", hasta: 60 },
  { id: "d90", nombre: "61 a 90 días", hasta: 90 },
  { id: "mas", nombre: "Más de 90 días", hasta: Infinity },
];

export const diasEntre = (desde, hasta) => Math.max(0, Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / DIA));
export const tramoDeDias = (dias) => TRAMOS.find((t) => dias <= t.hasta).id;
const tramosVacios = () => Object.fromEntries(TRAMOS.map((t) => [t.id, 0]));

/**
 * Lo que falta de cada deuda (venta o compra) de una persona, aplicando lo
 * cobrado o pagado a lo más viejo primero.
 * @param {{ fecha: string, efecto: number }[]} movs  + suma deuda, - la baja
 * @returns {{ fecha: string, falta: number, dias: number }[]}
 */
export function pendientesFifo(movs = [], hoy) {
  const ordenados = movs.slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const deudas = ordenados.filter((m) => m.efecto > 0).map((m) => ({ fecha: m.fecha, falta: centavos(m.efecto) }));
  let baja = centavos(ordenados.filter((m) => m.efecto < 0).reduce((s, m) => s - m.efecto, 0));
  for (const d of deudas) {
    const usa = Math.min(d.falta, baja);
    d.falta = centavos(d.falta - usa);
    baja = centavos(baja - usa);
  }
  return deudas.filter((d) => d.falta >= 0.01).map((d) => ({ ...d, dias: diasEntre(d.fecha, hoy) }));
}

/** Arma un lado (a cobrar o a pagar) a partir de los saldos y los movimientos de cada uno. */
function lado(saldos, campo, movsPorClave, hasta) {
  const deben = [];
  let aFavor = 0;
  for (const s of saldos) {
    const saldo = centavos(s[campo]);
    if (saldo <= -0.01) { aFavor += -saldo; continue; }
    if (saldo < 0.01) continue;
    const tramos = tramosVacios();
    const pend = pendientesFifo(movsPorClave.get(s.clave) || [], hasta);
    for (const p of pend) tramos[tramoDeDias(p.dias)] = centavos(tramos[tramoDeDias(p.dias)] + p.falta);
    // Si el saldo viene de otra cosa (un ajuste sin fecha clara), lo que no se explica va al tramo más nuevo
    const explicado = centavos(Object.values(tramos).reduce((a, b) => a + b, 0));
    if (Math.abs(saldo - explicado) >= 0.01) tramos.d30 = centavos(tramos.d30 + saldo - explicado);
    deben.push({ clave: s.clave, nombre: s.nombre || "Sin nombre", saldo, tramos, dias: pend.length ? Math.max(...pend.map((p) => p.dias)) : 0, ultimo: s.ultimo || "" });
  }
  deben.sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre));
  const tramos = tramosVacios();
  for (const d of deben) for (const t of TRAMOS) tramos[t.id] = centavos(tramos[t.id] + d.tramos[t.id]);
  return { total: centavos(deben.reduce((s, d) => s + d.saldo, 0)), cantidad: deben.length, a_favor: centavos(aFavor), tramos, renglones: deben };
}

/**
 * Cuentas a cobrar (clientes) y a pagar (proveedores) al día `hasta`.
 * opsClientes y opsProveedores pueden ser la misma lista (el reporte manda todas).
 * @returns {{ hasta: string, a_cobrar: object, a_pagar: object }}
 */
export function cuentasPagarCobrar({ opsClientes = [], opsProveedores = [], cuentasDeu, cuentasProv, clientes = [], proveedores = [], hasta, soloConfirmadas = false }) {
  // Como en las fichas, entran también las "para revisar"; el reporte financiero pide solo las confirmadas
  const hastaFin = (ops) => ops.filter((o) => !o.anulada_at && (!soloConfirmadas || o.estado !== "para_revisar") && String(o.fecha) <= hasta);
  const oc = hastaFin(opsClientes);
  const op = hastaFin(opsProveedores);
  const indice = indiceClientes(clientes);
  const movsCli = new Map();
  for (const o of oc) {
    const ef = efectoCliente(o, cuentasDeu);
    const k = ef && claveCliente(o, indice);
    if (!k) continue;
    if (!movsCli.has(k)) movsCli.set(k, []);
    movsCli.get(k).push({ fecha: o.fecha, efecto: ef });
  }
  const movsProv = new Map();
  for (const o of op) {
    const ef = efectoDeuda(o, cuentasProv);
    const k = ef && claveDe(o);
    if (!k) continue;
    if (!movsProv.has(k)) movsProv.set(k, []);
    movsProv.get(k).push({ fecha: o.fecha, efecto: ef });
  }
  return {
    hasta,
    a_cobrar: lado(saldosClientes(oc, cuentasDeu, clientes), "saldo", movsCli, hasta),
    a_pagar: lado(saldosProveedores(op, cuentasProv, proveedores), "deuda", movsProv, hasta),
  };
}

/** El % de cada tramo sobre el total (para la barra). */
export function pctTramos(l) {
  if (!(l.total > 0)) return Object.fromEntries(TRAMOS.map((t) => [t.id, 0]));
  return Object.fromEntries(TRAMOS.map((t) => [t.id, Math.round((Math.max(0, l.tramos[t.id]) / l.total) * 1000) / 10]));
}

/* ─── Para bajar en PDF o Excel ──────────────────────────────────────── */

const LADOS = {
  cobrar: { campo: "a_cobrar", titulo: "Cuentas a cobrar", quien: "Cliente", favor: "A favor de clientes" },
  pagar: { campo: "a_pagar", titulo: "Cuentas a pagar", quien: "Proveedor", favor: "A favor nuestro (anticipos)" },
};

/**
 * El informe de un lado ("cobrar" o "pagar"), listo para descargarInforme.
 * @param {ReturnType<typeof cuentasPagarCobrar>} r
 */
export function informeCuentas(r, ladoId, { empresa = "" } = {}) {
  const L = LADOS[ladoId];
  const l = r[L.campo];
  const titulo = `${L.titulo} al ${dma(r.hasta)}`;
  return {
    titulo,
    apaisado: true,
    html: () => hojaInforme({
      titulo, empresa, subtitulo: `${l.cantidad} ${l.cantidad === 1 ? "cuenta" : "cuentas"} con saldo`,
      cuerpo: `<div class="kpis">
  <div class="kpi"><span>Total</span><b>${$(l.total)}</b></div>
  ${TRAMOS.map((t) => `<div class="kpi"><span>${esc(t.nombre)}</span><b class="${t.id === "mas" && l.tramos[t.id] > 0 ? "rojo" : ""}">${$(l.tramos[t.id])}</b></div>`).join("")}
  ${l.a_favor >= 0.01 ? `<div class="kpi"><span>${esc(L.favor)}</span><b class="verde">${$(l.a_favor)}</b></div>` : ""}
</div>
<section><h2>Por ${esc(L.quien.toLowerCase())}</h2>
<table><thead><tr><th>${esc(L.quien)}</th>${TRAMOS.map((t) => `<th class="n">${esc(t.nombre)}</th>`).join("")}<th class="n">Total</th><th class="n">Lo más viejo</th></tr></thead><tbody>
${l.renglones.map((x) => `<tr><td>${esc(x.nombre)}</td>${TRAMOS.map((t) => `<td class="n">${x.tramos[t.id] ? $(x.tramos[t.id]) : ""}</td>`).join("")}<td class="n"><b>${$(x.saldo)}</b></td><td class="n${x.dias > 90 ? " rojo" : ""}">${x.dias} días</td></tr>`).join("\n")}
<tr class="tot"><td>Total</td>${TRAMOS.map((t) => `<td class="n">${$(l.tramos[t.id])}</td>`).join("")}<td class="n">${$(l.total)}</td><td></td></tr>
</tbody></table></section>`,
    }),
    hojas: () => [{
      nombre: L.titulo,
      anchos: [36, ...TRAMOS.map(() => 16), 16, 12],
      filas: [
        [T(titulo)],
        empresa ? [empresa] : [],
        [],
        [B(L.quien), ...TRAMOS.map((t) => B(t.nombre)), B("Total"), B("Días de lo más viejo")],
        ...l.renglones.map((x) => [x.nombre, ...TRAMOS.map((t) => N(x.tramos[t.id])), NB(x.saldo), x.dias]),
        [B("Total"), ...TRAMOS.map((t) => NB(l.tramos[t.id])), NB(l.total), ""],
        ...(l.a_favor >= 0.01 ? [[], [L.favor, ...TRAMOS.map(() => ""), N(l.a_favor)]] : []),
      ],
    }],
  };
}
