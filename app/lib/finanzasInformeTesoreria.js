// app/lib/finanzasInformeTesoreria.js — Finanzas → Informes → 🏧 Informe de
// tesorería (pedido de Tadeo del 19/11). Sin migración: se arma en el momento,
// siempre con los datos de hoy (los cheques y los plazos fijos no guardan cómo
// estaban otros días), con lo que ya devuelven /api/finanzas/tesoreria,
// /inversiones, /plazos-fijos y /cheques.
//
//   1. Cajas y bancos: el saldo de cada una, en pesos y en dólares.
//   2. Inversiones: FCI (saldo en Gypi), títulos públicos y privados
//      (láminas × cotización) y plazos fijos vigentes.
//   3. Calce de cheques a pagar y plazos fijos: lo que se debita de cheques
//      propios contra lo que entra por plazos fijos que vencen, sin contar la
//      plata de los bancos (respuesta de Tadeo). Por semana (8 semanas) y por
//      día (los próximos 15), con la diferencia y el acumulado.
//   4. Cheques a cobrar: los de terceros en cartera, por semana según el día
//      en que se acreditan.
import { fechaDebito, fechaDeposito } from "./finanzasDiasHabiles";
import { $, B, F, N, NB, T, dma, esc, hojaInforme } from "./finanzasInformes";
import { movimientoCaja } from "./finanzasOperaciones";

export const SEMANAS_CALCE = 8;
export const DIAS_CALCE = 15;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dm = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const diaSemana = (f) => DIAS[new Date(`${f}T12:00:00Z`).getUTCDay()];
const mon = (m) => (m === "USD" ? "USD" : "ARS");


/** El saldo de cada caja con las operaciones (en su moneda), como en Cajas y bancos. */
const saldoDe = (caja, ops) => centavos(ops.reduce((s, op) => s + movimientoCaja(op, caja), 0));

/**
 * Los tramos de una lista de movimientos con fecha: "Vencidos" (antes de hoy),
 * uno por cada período y "Más adelante" si hace falta.
 * @param {{ fecha: string }[]} items
 * @param {{ desde: string, hasta: string, etiqueta: string }[]} periodos
 */
function repartir(items, periodos, { masAdelante = true } = {}) {
  const hoy = periodos[0].desde;
  const ultimo = periodos[periodos.length - 1].hasta;
  const tramos = [
    { id: "vencidos", etiqueta: "Vencidos (sin debitar)", desde: null, hasta: sumarDias(hoy, -1), items: [] },
    ...periodos.map((p) => ({ id: p.desde, ...p, items: [] })),
  ];
  if (masAdelante) tramos.push({ id: "despues", etiqueta: `Después del ${dm(ultimo)}`, desde: sumarDias(ultimo, 1), hasta: null, items: [] });
  for (const it of items) {
    const t = tramos.find((x) => (x.desde == null || it.fecha >= x.desde) && (x.hasta == null || it.fecha <= x.hasta));
    if (t) t.items.push(it);
  }
  for (const t of tramos) t.items.sort((a, b) => a.fecha.localeCompare(b.fecha) || b.importe - a.importe);
  return tramos;
}

export function periodosSemanas(hoy, semanas = SEMANAS_CALCE) {
  return Array.from({ length: semanas }, (_, i) => {
    const desde = sumarDias(hoy, i * 7);
    const hasta = sumarDias(desde, 6);
    return { desde, hasta, etiqueta: `Semana ${i + 1} · ${dm(desde)} al ${dm(hasta)}` };
  });
}

export function periodosDias(hoy, dias = DIAS_CALCE) {
  return Array.from({ length: dias }, (_, i) => {
    const f = sumarDias(hoy, i);
    return { desde: f, hasta: f, etiqueta: `${i === 0 ? "Hoy" : diaSemana(f)} ${dm(f)}` };
  });
}

/** Cada tramo del calce con lo que se debita, lo que entra, la diferencia y el acumulado. */
function calce(items, periodos, opts) {
  let acumulado = 0;
  return repartir(items, periodos, opts)
    .filter((t) => t.id !== "vencidos" || t.items.length)
    .map((t) => {
      const cheques = centavos(t.items.filter((x) => x.clase === "cheque").reduce((s, x) => s + x.importe, 0));
      const plazos = centavos(t.items.filter((x) => x.clase === "plazo").reduce((s, x) => s + x.importe, 0));
      const diferencia = centavos(plazos - cheques);
      acumulado = centavos(acumulado + diferencia);
      return { id: t.id, etiqueta: t.etiqueta, desde: t.desde, hasta: t.hasta, cheques, plazos, diferencia, acumulado, items: t.items };
    });
}

/**
 * El informe completo.
 * @param {{ hoy: string, tesoreria?: object[], operaciones?: object[], inversiones?: object, plazos?: object[], cheques?: object[], feriados?: Iterable<string>|null, quien?: (c: object) => string }} d
 */
export function informeTesoreria({ hoy, tesoreria = [], operaciones = [], inversiones = {}, plazos = [], cheques = [], feriados = null, quien = (c) => c.beneficiario || c.recibido_de || c.librador || "" }) {
  const fer = feriados ? new Set(feriados) : null;

  // 1. Cajas y bancos
  const opsHoy = operaciones.filter((op) => !op.anulada_at && String(op.fecha || "") <= hoy);
  const cajas = tesoreria
    .filter((t) => t.tipo === "caja" || t.tipo === "banco" || t.tipo === "otro" || !t.tipo)
    .map((t) => ({ cuenta: t.cuenta, nombre: t.nombre, tipo: t.tipo || "otro", moneda: mon(t.moneda), activa: t.activa !== false, saldo: saldoDe(t, opsHoy) }))
    .filter((c) => c.activa || Math.abs(c.saldo) >= 0.01)
    .sort((a, b) => (a.tipo === b.tipo ? a.nombre.localeCompare(b.nombre) : a.tipo === "caja" ? -1 : b.tipo === "caja" ? 1 : a.tipo.localeCompare(b.tipo)));
  const fondos = {};
  for (const m of ["ARS", "USD"]) {
    const xs = cajas.filter((c) => c.moneda === m);
    fondos[m] = { cajas: xs, total: centavos(xs.reduce((s, c) => s + c.saldo, 0)) };
  }

  // 2. Inversiones
  const fci = (inversiones.fci || []).map((f) => ({ nombre: f.nombre, moneda: mon(f.moneda), saldo: centavos(f.saldo) })).filter((f) => Math.abs(f.saldo) >= 0.01);
  const tit = inversiones.titulos || {};
  const especies = (tit.especies || []).filter((e) => Number(e.laminas) > 0).map((e) => ({
    especie: e.especie || e.id, nombre: e.nombre && e.nombre !== e.especie ? e.nombre : "", clase: e.clase || "",
    laminas: Number(e.laminas) || 0, cotizacion: Number(e.cotizacion) || 0, moneda: mon(e.moneda), valor: centavos(e.valor),
    fecha: e.fecha_cotizacion || "",
  }));
  const titulos = { especies, valor: centavos(tit.valor), tipo_cambio: tit.tipo_cambio || null, falta_tc: !!tit.falta_tc };
  const pfVivos = plazos
    .filter((p) => p.situacion === "vigente" || (p.situacion === "vencido"))
    .map((p) => ({ certificado: p.certificado, tipo: p.tipo || "", moneda: mon(p.moneda), depositado: centavos(p.depositado), reembolsar: centavos(p.reembolsar), interes: centavos(p.interes), vencimiento: p.vencimiento, vencido: p.situacion === "vencido" }))
    .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
  const sumaPf = (m, k) => centavos(pfVivos.filter((p) => p.moneda === m).reduce((s, p) => s + p[k], 0));
  const invertido = {
    ARS: centavos(fci.filter((f) => f.moneda === "ARS").reduce((s, f) => s + f.saldo, 0) + titulos.valor + sumaPf("ARS", "depositado")),
    USD: centavos(fci.filter((f) => f.moneda === "USD").reduce((s, f) => s + f.saldo, 0) + sumaPf("USD", "depositado")),
  };

  // 3. Calce: cheques propios por debitar contra plazos fijos en pesos que vencen desde hoy
  const aPagar = cheques
    .filter((c) => c.clase === "propio" && c.estado === "pendiente")
    .map((c) => ({ clase: "cheque", fecha: fechaDebito(c.fecha_pago, fer) || c.fecha_pago, vence: c.fecha_pago, importe: centavos(c.importe), detalle: [c.banco, c.numero ? `N° ${c.numero}` : ""].filter(Boolean).join(" "), quien: quien(c) }));
  const pfCalce = pfVivos
    .filter((p) => p.moneda === "ARS" && p.vencimiento >= hoy)
    .map((p) => ({ clase: "plazo", fecha: fechaDeposito(p.vencimiento, fer) || p.vencimiento, vence: p.vencimiento, importe: p.reembolsar, detalle: `Plazo fijo N° ${p.certificado}`, quien: p.tipo }));
  const items = [...aPagar, ...pfCalce];
  const semanal = calce(items, periodosSemanas(hoy));
  const diario = calce(items, periodosDias(hoy), { masAdelante: false });
  const pfUsd = pfVivos.filter((p) => p.moneda === "USD" && p.vencimiento >= hoy);

  // 4. Cheques a cobrar: de terceros en cartera, por el día en que se acreditan
  const aCobrar = cheques
    .filter((c) => c.clase === "tercero" && c.estado === "en_cartera")
    .map((c) => ({ clase: "cobro", fecha: fechaDebito(c.fecha_pago, fer) || c.fecha_pago, vence: c.fecha_pago, importe: centavos(c.importe), detalle: [c.banco, c.numero ? `N° ${c.numero}` : ""].filter(Boolean).join(" "), quien: quien(c) }));
  const cobrar = repartir(aCobrar, periodosSemanas(hoy))
    .filter((t) => t.items.length)
    .map((t) => ({ id: t.id, etiqueta: t.id === "vencidos" ? "Vencidos (sin depositar)" : t.etiqueta, total: centavos(t.items.reduce((s, x) => s + x.importe, 0)), items: t.items }));

  const total = (xs) => centavos(xs.reduce((s, x) => s + x.importe, 0));
  return {
    hoy,
    resumen: {
      pesos: fondos.ARS.total, dolares: fondos.USD.total, invertido_ars: invertido.ARS, invertido_usd: invertido.USD,
      cheques_pagar: total(aPagar), cheques_cobrar: total(aCobrar), plazos_calce: total(pfCalce),
    },
    fondos, fci, titulos, plazos: pfVivos, invertido,
    calce: { semanal, diario, faltante: semanal.some((t) => t.acumulado < -0.005), pf_usd: pfUsd },
    cobrar,
  };
}

/* ─── PDF y Excel ───────────────────────────────────────────────────── */

const tono = (n) => (n < -0.005 ? "rojo" : n > 0.005 ? "verde" : "");
const kpi = (label, valor, clase = "") => `<div class="kpi"><span>${esc(label)}</span><b class="${clase}">${valor}</b></div>`;
const num = (n, m) => (Math.abs(n) >= 0.005 ? $(n, m) : "–");

function tablaCalce(filas, titulo) {
  return `<table><thead><tr><th>${esc(titulo)}</th><th class="n">Cheques a debitar</th><th class="n">Vencen plazos fijos</th><th class="n">Diferencia</th><th class="n">Acumulado</th></tr></thead><tbody>
${filas.map((t) => `<tr><td>${esc(t.etiqueta)}</td><td class="n">${num(t.cheques)}</td><td class="n">${num(t.plazos)}</td><td class="n ${tono(t.diferencia)}">${num(t.diferencia)}</td><td class="n ${tono(t.acumulado)}"><b>${$(t.acumulado)}</b></td></tr>`).join("\n")}
</tbody></table>`;
}

const filaItem = (x) => `<tr class="sub"><td>${esc(dma(x.fecha))}</td><td>${esc(x.clase === "plazo" ? "Plazo fijo" : "Cheque")}</td><td>${esc(x.detalle)}</td><td>${esc(x.quien)}</td><td class="n">${$(x.importe)}</td></tr>`;

/** { titulo, html, hojas } para los botones 📄 PDF y 📊 Excel. */
export function exportarInformeTesoreria(r, { empresa = "" } = {}) {
  const titulo = `Informe de tesorería al ${dma(r.hoy)}`;
  const sub = "Posición de fondos, inversiones, calce de cheques y plazos fijos, y cheques a cobrar";
  const cuerpo = () => {
    const fondos = ["ARS", "USD"].filter((m) => r.fondos[m].cajas.length).map((m) => `<h3>${m === "USD" ? "En dólares" : "En pesos"}</h3><table><thead><tr><th>Caja o banco</th><th class="n">Saldo</th></tr></thead><tbody>
${r.fondos[m].cajas.map((c) => `<tr><td>${esc(c.nombre)}</td><td class="n ${c.saldo < 0 ? "rojo" : ""}">${$(c.saldo, m)}</td></tr>`).join("\n")}
<tr class="tot"><td>Total ${m === "USD" ? "en dólares" : "en pesos"}</td><td class="n">${$(r.fondos[m].total, m)}</td></tr></tbody></table>`).join("");
    const fci = r.fci.length ? `<h3>Fondos comunes de inversión</h3><table><thead><tr><th>Fondo</th><th class="n">Saldo</th></tr></thead><tbody>${r.fci.map((f) => `<tr><td>${esc(f.nombre)}</td><td class="n">${$(f.saldo, f.moneda)}</td></tr>`).join("")}</tbody></table>` : "";
    const tit = r.titulos.especies.length ? `<h3>Títulos públicos y privados</h3><table><thead><tr><th>Especie</th><th class="n">Láminas</th><th class="n">Cotización</th><th class="n">Valor</th></tr></thead><tbody>${r.titulos.especies.map((e) => `<tr><td>${esc([e.especie, e.nombre].filter(Boolean).join(" · "))}</td><td class="n">${esc(e.laminas.toLocaleString("es-AR"))}</td><td class="n">${$(e.cotizacion, e.moneda)}</td><td class="n">${$(e.valor, e.moneda)}</td></tr>`).join("")}
<tr class="tot"><td colspan="3">Total en pesos${r.titulos.tipo_cambio ? ` (dólar a ${esc($(r.titulos.tipo_cambio))})` : ""}</td><td class="n">${$(r.titulos.valor)}</td></tr></tbody></table>${r.titulos.falta_tc ? '<p class="rojo">Falta el tipo de cambio: lo que está en dólares no suma en el total.</p>' : ""}` : "";
    const pf = r.plazos.length ? `<h3>Plazos fijos vigentes</h3><table><thead><tr><th>Certificado</th><th>Vence</th><th class="n">Capital</th><th class="n">Interés</th><th class="n">Devuelve</th></tr></thead><tbody>${r.plazos.map((p) => `<tr><td>N° ${esc(p.certificado)}${p.vencido ? ' <span class="rojo">(vencido sin registrar)</span>' : ""}</td><td>${esc(dma(p.vencimiento))}</td><td class="n">${$(p.depositado, p.moneda)}</td><td class="n">${$(p.interes, p.moneda)}</td><td class="n">${$(p.reembolsar, p.moneda)}</td></tr>`).join("")}</tbody></table>` : "";
    const detalle = r.calce.semanal.filter((t) => t.items.length).map((t) => `<tr class="sec"><td colspan="5">${esc(t.etiqueta)}</td></tr>${t.items.map(filaItem).join("")}`).join("");
    const cobrar = r.cobrar.length ? `<table><thead><tr><th>Se acredita</th><th></th><th>Banco y número</th><th>De quién</th><th class="n">Importe</th></tr></thead><tbody>${r.cobrar.map((t) => `<tr class="sec"><td colspan="4">${esc(t.etiqueta)}</td><td class="n">${$(t.total)}</td></tr>${t.items.map((x) => filaItem({ ...x, clase: "cheque" })).join("")}`).join("")}
<tr class="tot"><td colspan="4">Total a cobrar</td><td class="n">${$(r.resumen.cheques_cobrar)}</td></tr></tbody></table>` : '<p class="dim">No hay cheques de terceros en cartera.</p>';
    return `<div class="kpis">${kpi("Pesos en cajas y bancos", $(r.resumen.pesos))}${kpi("Dólares en cajas y bancos", $(r.resumen.dolares, "USD"))}${kpi("Invertido", $(r.resumen.invertido_ars) + (r.resumen.invertido_usd ? ` + ${$(r.resumen.invertido_usd, "USD")}` : ""))}${kpi("Cheques a pagar", $(r.resumen.cheques_pagar), "rojo")}${kpi("Cheques a cobrar", $(r.resumen.cheques_cobrar), "verde")}</div>
<section><h2>1. Posición de fondos en cajas y bancos</h2>${fondos || '<p class="dim">No hay cajas ni bancos.</p>'}</section>
<section><h2>2. Inversiones: FCI, títulos y plazos fijos</h2>${fci + tit + pf || '<p class="dim">No hay inversiones cargadas.</p>'}</section>
<section><h2>3. Calce de cheques a pagar y plazos fijos</h2><p class="dim">Solo cheques contra plazos fijos en pesos, sin contar la plata de los bancos. Diferencia = lo que entra por plazos fijos menos lo que se debita; en rojo, falta plata.</p>
<h3>Por semana</h3>${tablaCalce(r.calce.semanal, "Semana")}
<h3>Por día (próximos ${DIAS_CALCE} días)</h3>${tablaCalce(r.calce.diario, "Día")}
${detalle ? `<h3>Detalle</h3><table><thead><tr><th>Fecha</th><th></th><th>Banco y número</th><th>Para quién</th><th class="n">Importe</th></tr></thead><tbody>${detalle}</tbody></table>` : ""}</section>
<section><h2>4. Cheques a cobrar</h2>${cobrar}</section>`;
  };
  const filasCalce = (xs) => xs.map((t) => [t.etiqueta, N(t.cheques), N(t.plazos), N(t.diferencia), NB(t.acumulado)]);
  const cabCalce = (c) => [B(c), B("Cheques a debitar"), B("Vencen plazos fijos"), B("Diferencia"), B("Acumulado")];
  return {
    titulo,
    html: () => hojaInforme({ titulo, subtitulo: sub, empresa, cuerpo: cuerpo().replace(/<h3>/g, '<h3 style="font-size:13px;margin:10px 0 4px">') }),
    hojas: () => [
      {
        nombre: "Fondos e inversiones",
        anchos: [44, 14, 18, 18, 18],
        filas: [
          [T(titulo)], empresa ? [empresa] : [], [],
          [B("Cajas y bancos"), B("Moneda"), B("Saldo")],
          ...["ARS", "USD"].flatMap((m) => [...r.fondos[m].cajas.map((c) => [c.nombre, m, N(c.saldo)]), ...(r.fondos[m].cajas.length ? [[B(`Total ${m === "USD" ? "dólares" : "pesos"}`), m, NB(r.fondos[m].total)]] : [])]),
          [],
          [B("FCI"), B("Moneda"), B("Saldo")],
          ...r.fci.map((f) => [f.nombre, f.moneda, N(f.saldo)]),
          [],
          [B("Títulos"), B("Moneda"), B("Láminas"), B("Cotización"), B("Valor")],
          ...r.titulos.especies.map((e) => [[e.especie, e.nombre].filter(Boolean).join(" · "), e.moneda, e.laminas, N(e.cotizacion), N(e.valor)]),
          [B("Total títulos en pesos"), "", "", "", NB(r.titulos.valor)],
          [],
          [B("Plazo fijo"), B("Moneda"), B("Vence"), B("Capital"), B("Devuelve")],
          ...r.plazos.map((p) => [`N° ${p.certificado}${p.vencido ? " (vencido sin registrar)" : ""}`, p.moneda, F(p.vencimiento), N(p.depositado), N(p.reembolsar)]),
        ],
      },
      {
        nombre: "Calce",
        anchos: [32, 18, 18, 18, 18],
        filas: [
          [T("Calce de cheques a pagar y plazos fijos")], ["Solo cheques contra plazos fijos en pesos, sin contar los bancos"], [],
          cabCalce("Semana"), ...filasCalce(r.calce.semanal), [],
          cabCalce("Día"), ...filasCalce(r.calce.diario), [],
          [B("Fecha"), B("Qué"), B("Banco y número"), B("Para quién"), B("Importe")],
          ...r.calce.semanal.flatMap((t) => t.items.map((x) => [F(x.fecha), x.clase === "plazo" ? "Plazo fijo" : "Cheque", x.detalle, x.quien, N(x.importe)])),
        ],
      },
      {
        nombre: "Cheques a cobrar",
        anchos: [32, 14, 26, 34, 16],
        filas: [
          [B("Semana"), B("Se acredita"), B("Banco y número"), B("De quién"), B("Importe")],
          ...r.cobrar.flatMap((t) => [[B(t.etiqueta), "", "", "", NB(t.total)], ...t.items.map((x) => ["", F(x.fecha), x.detalle, x.quien, N(x.importe)])]),
          [B("Total"), "", "", "", NB(r.resumen.cheques_cobrar)],
        ],
      },
    ],
  };
}
