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
import { movimientoCaja, plata } from "./finanzasOperaciones";

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

/** Más apretado que los otros informes, para que entre en 3 hojas A4. */
const ESTILO_CORTO = "body{padding:16px;font-size:11px}.cabecera{padding:10px 14px;margin-bottom:8px}.cabecera h1{font-size:17px}h2{font-size:13px;margin:0 0 6px;padding:4px 8px}section{margin:10px 0 0}th,td{padding:2px 5px}.kpi{padding:5px 8px;flex:1 1 110px}.kpi b{font-size:13px}p{margin:2px 0 4px}";
export const MAX_COBROS = 15;


/** { titulo, html, hojas } para los botones 📄 PDF y 📊 Excel. */
export function exportarInformeTesoreria(r, { empresa = "" } = {}) {
  const titulo = `Informe de tesorería al ${dma(r.hoy)}`;
  const sub = "Posición de fondos, inversiones, calce de cheques y plazos fijos, y cheques a cobrar";
  // 19/11 (Tadeo): conciso, 3 páginas como máximo. Fondos e inversiones lado a
  // lado, la tabla diaria solo con los días que tienen algo y sin el detalle de
  // cada cheque del calce (los montos están en el gráfico); cobros hasta MAX_COBROS.
  const cuerpo = () => {
    const fila = (nombre, valor, m = "ARS", extra = "") => `<tr><td>${nombre}</td><td class="n${valor < 0 ? " rojo" : ""}">${$(valor, m)}${extra}</td></tr>`;
    const tot = (nombre, valor, m = "ARS") => `<tr class="tot"><td>${esc(nombre)}</td><td class="n">${$(valor, m)}</td></tr>`;
    const sec = (nombre) => `<tr class="sec"><td colspan="2">${esc(nombre)}</td></tr>`;
    const fondos = ["ARS", "USD"].filter((m) => r.fondos[m].cajas.length).map((m) => sec(m === "USD" ? "En dólares" : "En pesos")
      + r.fondos[m].cajas.map((c) => fila(esc(c.nombre), c.saldo, m)).join("") + tot(`Total ${m === "USD" ? "dólares" : "pesos"}`, r.fondos[m].total, m)).join("");
    const inv = [
      r.fci.length ? sec("FCI") + r.fci.map((f) => fila(esc(f.nombre), f.saldo, f.moneda)).join("") : "",
      r.titulos.especies.length ? sec(`Títulos${r.titulos.tipo_cambio ? ` (dólar a ${plata(r.titulos.tipo_cambio)})` : ""}`) + r.titulos.especies.map((e) => fila(`${esc(e.especie)} <span class="dim">· ${esc(e.laminas.toLocaleString("es-AR"))} lám.</span>`, e.valor, e.moneda)).join("") : "",
      r.plazos.length ? sec("Plazos fijos (capital)") + r.plazos.map((p) => fila(`N° ${esc(p.certificado)} <span class="${p.vencido ? "rojo" : "dim"}">· vence ${esc(dm(p.vencimiento))}</span>`, p.depositado, p.moneda)).join("") : "",
    ].join("");
    const invTot = inv ? tot("Total invertido en pesos", r.invertido.ARS) + (r.invertido.USD ? tot("Total invertido en dólares", r.invertido.USD, "USD") : "") : "";
    const diasConAlgo = r.calce.diario.filter((t) => t.cheques || t.plazos);
    const cobros = r.cobrar.flatMap((t) => t.items);
    const cobrar = cobros.length ? `<table><thead><tr><th>Se acredita</th><th>Banco y número</th><th>De quién</th><th class="n">Importe</th></tr></thead><tbody>${cobros.slice(0, MAX_COBROS).map((x) => `<tr><td>${esc(dma(x.fecha))}</td><td>${esc(x.detalle)}</td><td>${esc(x.quien)}</td><td class="n">${$(x.importe)}</td></tr>`).join("")}
${cobros.length > MAX_COBROS ? `<tr><td colspan="4" class="dim">… y ${cobros.length - MAX_COBROS} cheques más (están en el Excel)</td></tr>` : ""}
<tr class="tot"><td colspan="3">Total a cobrar</td><td class="n">${$(r.resumen.cheques_cobrar)}</td></tr></tbody></table>` : '<p class="dim">No hay cheques de terceros en cartera.</p>';
    return `<div class="kpis">${kpi("Pesos en cajas y bancos", $(r.resumen.pesos))}${kpi("Dólares en cajas y bancos", $(r.resumen.dolares, "USD"))}${kpi("Invertido", $(r.resumen.invertido_ars) + (r.resumen.invertido_usd ? ` + ${$(r.resumen.invertido_usd, "USD")}` : ""))}${kpi("Cheques a pagar", $(r.resumen.cheques_pagar), "rojo")}${kpi("Cheques a cobrar", $(r.resumen.cheques_cobrar), "verde")}</div>
<section><h2>1. Posición de fondos e inversiones</h2>${svgReparto(repartoFondos(r))}
<div style="display:flex;gap:14px;align-items:flex-start"><div style="flex:1;min-width:0"><table><thead><tr><th>Cajas y bancos</th><th class="n">Saldo</th></tr></thead><tbody>${fondos || '<tr><td colspan="2" class="dim">No hay cajas ni bancos.</td></tr>'}</tbody></table></div>
<div style="flex:1;min-width:0"><table><thead><tr><th>Inversiones</th><th class="n">Valor</th></tr></thead><tbody>${inv + invTot || '<tr><td colspan="2" class="dim">No hay inversiones cargadas.</td></tr>'}</tbody></table>${r.titulos.falta_tc ? '<p class="rojo">Falta el tipo de cambio: los títulos en dólares no suman.</p>' : ""}</div></div></section>
<section><h2>2. Calce de cheques a pagar y plazos fijos · por semana</h2><p class="dim">Solo cheques contra plazos fijos en pesos, sin los bancos. Diferencia = plazos fijos − cheques; en rojo, falta plata.</p>
${svgCalce(r.calce.semanal, "Calce por semana")}${tablaCalce(r.calce.semanal.filter((t) => t.id !== "despues" || t.cheques || t.plazos), "Semana")}</section>
<section><h2>3. Calce por día · próximos ${DIAS_CALCE} días</h2>${svgCalce(r.calce.diario, "Calce por día")}${diasConAlgo.length ? tablaCalce(diasConAlgo, "Día con movimiento") : '<p class="dim">No hay cheques ni plazos fijos en los próximos días.</p>'}</section>
<section><h2>4. Cheques a cobrar</h2>${cobros.length ? svgCobrar(r) : ""}${cobrar}</section>`;
  };
  const filasCalce = (xs) => xs.map((t) => [t.etiqueta, N(t.cheques), N(t.plazos), N(t.diferencia), NB(t.acumulado)]);
  const cabCalce = (c) => [B(c), B("Cheques a debitar"), B("Vencen plazos fijos"), B("Diferencia"), B("Acumulado")];
  return {
    titulo,
    html: () => hojaInforme({ titulo, subtitulo: sub, empresa, cuerpo: cuerpo().replace("<div class=\"kpis\">", `<style>${ESTILO_CORTO}</style><div class="kpis">`) }),
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

/* ─── Gráficos (19/11, pedido de Tadeo) ─────────────────────────────────
   Las cuentas de cada gráfico salen de acá; la pantalla los dibuja con los
   colores de la app y el PDF con colores fijos (svg* de abajo). */

/** Etiqueta corta de un tramo del calce para el eje del gráfico. */
export const etiquetaCorta = (t) => (t.id === "vencidos" ? "Vencidos" : t.id === "despues" ? "Después" : dm(t.desde));

/** ¿Dónde está la plata? (en pesos): cajas, bancos, FCI, títulos y plazos fijos, con el %. */
export function repartoFondos(r) {
  const suma = (xs) => centavos(xs.reduce((s, x) => s + x, 0));
  const ars = r.fondos.ARS.cajas;
  const partes = [
    { id: "caja", nombre: "Cajas", valor: suma(ars.filter((c) => c.tipo === "caja").map((c) => c.saldo)) },
    { id: "banco", nombre: "Bancos", valor: suma(ars.filter((c) => c.tipo !== "caja").map((c) => c.saldo)) },
    { id: "fci", nombre: "FCI", valor: suma(r.fci.filter((f) => f.moneda === "ARS").map((f) => f.saldo)) },
    { id: "titulos", nombre: "Títulos", valor: centavos(r.titulos.valor) },
    { id: "plazo_fijo", nombre: "Plazos fijos", valor: suma(r.plazos.filter((p) => p.moneda === "ARS").map((p) => p.depositado)) },
  ].filter((p) => p.valor > 0.005);
  const total = suma(partes.map((p) => p.valor));
  let desde = 0;
  return {
    total,
    partes: partes.map((p) => {
      const pct = total > 0 ? (p.valor / total) * 100 : 0;
      const parte = { ...p, pct: Math.round(pct * 10) / 10, desde };
      desde += pct;
      return parte;
    }),
  };
}

/** Cheques a cobrar por semana (las 8, aunque alguna esté vacía; vencidos y después si hay). */
export function serieCobrar(r) {
  const por = new Map(r.cobrar.map((t) => [t.id, t.total]));
  const semanas = periodosSemanas(r.hoy).map((p) => ({ id: p.desde, desde: p.desde, total: por.get(p.desde) || 0 }));
  return [
    ...(por.has("vencidos") ? [{ id: "vencidos", desde: null, total: por.get("vencidos") }] : []),
    ...semanas,
    ...(por.has("despues") ? [{ id: "despues", desde: null, total: por.get("despues") }] : []),
  ].map((t) => ({ ...t, etiqueta: etiquetaCorta(t) }));
}

/**
 * Dónde va cada cosa en un gráfico de columnas: dos columnas por tramo
 * (cheques y plazos fijos) o una (cobros), y la línea del acumulado con el
 * cero marcado. Todo en un lienzo de W × H.
 * @param {{ etiqueta: string, a?: number, b?: number, linea?: number }[]} serie
 */
export function geometriaColumnas(serie, { W = 700, H = 230, linea = false } = {}) {
  // Arriba, lugar para los montos de las columnas; abajo, la fecha y la diferencia (19/11)
  const conDif = serie.some((t) => t.dif != null);
  const izq = 8, der = 8, arriba = 34, abajo = conDif ? 42 : 28;
  const alto = H - arriba - abajo;
  const valores = serie.flatMap((t) => [t.a || 0, t.b || 0, ...(linea ? [t.linea || 0] : [])]);
  const max = Math.max(1, ...valores);
  const min = Math.min(0, ...valores);
  const y = (v) => arriba + alto - ((v - min) / (max - min || 1)) * alto;
  const ancho = (W - izq - der) / Math.max(1, serie.length);
  const dos = serie.some((t) => t.b != null);
  const barra = Math.max(3, Math.min(28, ancho * (dos ? 0.34 : 0.6)));
  const cero = y(0);
  const cada = Math.ceil(serie.length / 16);
  const cols = serie.map((t, i) => {
    const x = izq + i * ancho + ancho / 2;
    const col = (v, xb) => ({ x: xb, y: Math.min(y(v || 0), cero), w: barra, h: Math.abs(cero - y(v || 0)), v: v || 0 });
    const a = col(t.a, dos ? x - barra - 1 : x - barra / 2);
    const b = dos ? col(t.b, x + 1) : null;
    // El monto arriba de cada columna; si hay dos, el de la segunda un renglón más arriba para que no se pisen
    const ambos = Math.abs(a.v) >= 0.5 && b && Math.abs(b.v) >= 0.5;
    const apretado = ambos && ancho < 70;
    const techo = apretado ? Math.min(a.y, b.y, cero) : null;
    const monto = (c, subir) => (c && Math.abs(c.v) >= 0.5 ? { x: c.x + c.w / 2, y: (apretado ? techo : Math.min(c.y, cero)) - 3 - (subir ? 11 : 0), texto: compacto(c.v) } : null);
    return {
      x, etiqueta: t.etiqueta, mostrarEtiqueta: i % cada === 0,
      a, b, montoA: monto(a, false), montoB: monto(b, apretado),
      dif: t.dif != null && (Math.abs(t.a || 0) >= 0.5 || Math.abs(t.b || 0) >= 0.5) ? { valor: t.dif, texto: `${t.dif > 0 ? "+" : ""}${compacto(t.dif)}` } : null,
      linea: linea ? y(t.linea || 0) : null,
    };
  });
  return { W, H, cero, cols, ejeY: H - abajo + 13, difY: H - abajo + 27, izq, der, puntos: linea ? cols.map((c) => `${c.x.toFixed(1)},${c.linea.toFixed(1)}`).join(" ") : "" };
}

export const serieCalce = (filas) => filas.map((t) => ({ etiqueta: etiquetaCorta(t), a: t.cheques, b: t.plazos, linea: t.acumulado, dif: t.diferencia }));

/** Un monto corto para el gráfico: 850 mil, 2,5 M, −3,3 M. */
export function compacto(n) {
  const a = Math.abs(Number(n) || 0);
  const signo = n < 0 ? "−" : "";
  if (a >= 1e9) return `${signo}${(a / 1e9).toFixed(1).replace(".", ",")} mil M`;
  if (a >= 1e6) return `${signo}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(".", ",")} M`;
  if (a >= 1e3) return `${signo}${Math.round(a / 1e3)} mil`;
  return `${signo}${Math.round(a)}`;
}

// Colores fijos del PDF (los de la pantalla salen del tema de la app)
const hex = (h) => `#${h}`;
const COLOR = { rojo: hex("c62828"), verde: hex("15803d"), cyan: hex("0e7490"), linea: hex("cfd6dd"), texto: hex("444444") };
// Bien distintos entre sí (pedido de Tadeo del 19/11): azul, naranja, violeta, verde y rosa
export const COLOR_REPARTO = { caja: hex("2563eb"), banco: hex("f97316"), fci: hex("7c3aed"), titulos: hex("16a34a"), plazo_fijo: hex("db2777") };

function svgColumnas(serie, { H = 230, linea = false, colorA = COLOR.rojo, colorB = COLOR.verde, nombreA = "", nombreB = "", nombreLinea = "", titulo = "" } = {}) {
  if (!serie.length) return "";
  const g = geometriaColumnas(serie, { linea, H });
  const rect = (c, color, nombre, et) => (c && c.h > 0.4 ? `<rect x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" width="${c.w.toFixed(1)}" height="${c.h.toFixed(1)}" rx="2" fill="${color}"><title>${esc(et)} · ${esc(nombre)} ${esc(plata(c.v))}</title></rect>` : "");
  const cuerpo = g.cols.map((c) => rect(c.a, colorA, nombreA, c.etiqueta) + rect(c.b, colorB, nombreB, c.etiqueta)
    + [[c.montoA, colorA], [c.montoB, colorB]].map(([m, color]) => (m ? `<text x="${m.x.toFixed(1)}" y="${m.y.toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${color}">${esc(m.texto)}</text>` : "")).join("")
    + (c.mostrarEtiqueta ? `<text x="${c.x.toFixed(1)}" y="${g.ejeY}" text-anchor="middle" font-size="10" fill="${COLOR.texto}">${esc(c.etiqueta)}</text>` : "")
    + (c.dif ? `<text x="${c.x.toFixed(1)}" y="${g.difY}" text-anchor="middle" font-size="9" font-weight="700" fill="${c.dif.valor < 0 ? COLOR.rojo : COLOR.verde}">${esc(c.dif.texto)}</text>` : "")).join("");
  const lin = linea ? `<polyline points="${g.puntos}" fill="none" stroke="${COLOR.cyan}" stroke-width="2.5" stroke-linejoin="round"/>${g.cols.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.linea.toFixed(1)}" r="3" fill="${COLOR.cyan}"/>`).join("")}` : "";
  const leyenda = [[colorA, nombreA], ...(nombreB ? [[colorB, nombreB]] : []), ...(linea ? [[COLOR.cyan, nombreLinea]] : [])]
    .map(([c, n]) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c}"></i>${esc(n)}</span>`).join("");
  return `<svg class="graf" viewBox="0 0 ${g.W} ${g.H}" role="img" aria-label="${esc(titulo)}" style="width:100%;height:auto;display:block;margin:6px 0 2px">
<line x1="${g.izq}" x2="${g.W - g.der}" y1="${g.cero.toFixed(1)}" y2="${g.cero.toFixed(1)}" stroke="${COLOR.linea}"/>${cuerpo}${lin}</svg>
<div style="font-size:11px;color:#4b5563;margin:0 0 8px">${leyenda}</div>`;
}

/** La barra de "¿Dónde está la plata?" para el PDF. */
export function svgReparto(rep) {
  if (!rep.partes.length) return "";
  const W = 700;
  const tramos = rep.partes.map((p) => `<rect x="${((p.desde / 100) * W).toFixed(1)}" y="0" width="${((p.pct / 100) * W).toFixed(1)}" height="26" fill="${COLOR_REPARTO[p.id]}"><title>${esc(p.nombre)} ${esc(String(p.pct).replace(".", ","))} %</title></rect>`
    + (p.pct >= 7 ? `<text x="${(((p.desde + p.pct / 2) / 100) * W).toFixed(1)}" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="white">${esc(String(Math.round(p.pct)))} %</text>` : "")).join("");
  const leyenda = rep.partes.map((p) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${COLOR_REPARTO[p.id]}"></i>${esc(p.nombre)} ${esc(String(p.pct).replace(".", ","))} % · ${$(p.valor)}</span>`).join("");
  return `<svg viewBox="0 0 ${W} 26" role="img" aria-label="Dónde está la plata" style="width:100%;height:auto;display:block;border-radius:6px;margin:6px 0 4px">${tramos}</svg>
<div style="font-size:11px;color:#4b5563;margin:0 0 8px;line-height:1.7">${leyenda}</div>`;
}

export const svgCalce = (filas, titulo) => svgColumnas(serieCalce(filas), { linea: true, nombreA: "Cheques a debitar", nombreB: "Vencen plazos fijos", nombreLinea: "Acumulado (debajo de la raya gris, falta plata). Abajo de cada fecha, la diferencia", titulo });
export const svgCobrar = (r) => svgColumnas(serieCobrar(r).map((t) => ({ etiqueta: t.etiqueta, a: t.total })), { H: 160, colorA: COLOR.verde, nombreA: "Cheques que se acreditan", titulo: "Cheques a cobrar por semana" });
