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
    .map((t) => ({ id: t.id, desde: t.desde, hasta: t.hasta, etiqueta: t.id === "vencidos" ? "Vencidos (sin depositar)" : t.etiqueta, total: centavos(t.items.reduce((s, x) => s + x.importe, 0)), items: t.items }));

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

/*
 * El PDF en 4 páginas fijas (pedido de Tadeo del 20/11: hasta 4 páginas, sin
 * saltos de página ni cuadros cortados, texto y gráficos equilibrados):
 *   1. Panorama de hoy: los números grandes, un párrafo con lo importante y
 *      "¿Dónde está la plata?".
 *   2. Fondos e inversiones, lado a lado.
 *   3. Calce de cheques y plazos fijos: por semana (gráfico y tabla) y por día.
 *   4. Cheques a cobrar.
 * Cada página es un bloque del alto de una hoja A4 y el PDF corta entre ellas
 * (pdfDeHtml con bloques ".pagina"). Lo que no entra se resume con "y N más
 * (en el Excel)": nunca se parte una tabla.
 */
export const PAGINA_ALTO_PX = 1040; // una hoja A4 a 718 px de ancho (pdfDeHtml: 1046)
export const MAX_FILAS_FONDOS = 26;
export const MAX_COBROS = 26;

const ESTILO_PAGINAS = `body{padding:0;font-size:11px}
.pagina{height:${PAGINA_ALTO_PX}px;overflow:hidden;position:relative;padding:14px 16px 0;box-sizing:border-box}
.pagina+.pagina{border-top:1px dashed #e3e7eb}
.cabecera{padding:10px 14px;margin-bottom:8px}.cabecera h1{font-size:18px}
.pagina>h2{font-size:15px;margin:0 0 8px;padding:6px 10px}
h3{font-size:12px;margin:12px 0 4px;color:#0e7490}
th,td{padding:3px 6px}
.kpi{padding:6px 8px;flex:1 1 0;min-width:0}.kpi span{font-size:10px}.kpi b{font-size:12px;white-space:nowrap}
.texto{font-size:12px;line-height:1.55;margin:6px 0 10px;color:#1f2937}
.texto b{font-variant-numeric:tabular-nums}
.resumen{background:#f6f8fa;border-left:4px solid #0e7490;border-radius:6px;padding:8px 12px}
.pie-pagina{position:absolute;left:16px;right:16px;bottom:10px;font-size:9px;color:#6b7280;display:flex;justify-content:space-between}
.cols{display:flex;gap:14px;align-items:flex-start}.cols>div{flex:1;min-width:0}`;

/** Plata corta para los textos: "$ 2,5 M", "USD 4.200". */
const corto = (n, m = "ARS") => (m === "USD" ? esc(plata(n, "USD")) : `$&nbsp;${esc(compacto(n)).replace(/ /g, "&nbsp;")}`);
const semanaTxt = (t) => (t.id === "vencidos" ? "los cheques vencidos" : t.id === "despues" ? "después de las 8 semanas" : `la semana del ${dm(t.desde)} al ${dm(t.hasta)}`);

/** Los párrafos del panorama: lo importante de hoy, con los números del informe. */
export function panoramaTexto(r) {
  const res = r.resumen;
  const out = [];
  const usd = res.dolares ? ` y <b>${corto(res.dolares, "USD")}</b> en dólares` : "";
  const partes = repartoFondos(r).partes.filter((p) => p.id !== "caja" && p.id !== "banco");
  const enQue = partes.length ? ` (${partes.map((p) => `${p.id === "fci" ? "FCI" : p.nombre.toLowerCase()} ${corto(p.valor)}`).join(", ")})` : "";
  out.push(`Hoy hay <b>${corto(res.pesos)}</b> en cajas y bancos en pesos${usd}. Invertido: <b>${corto(res.invertido_ars)}</b>${enQue}${res.invertido_usd ? ` y ${corto(res.invertido_usd, "USD")}` : ""}.`);
  const sem = r.calce.semanal;
  const cheques = centavos(sem.reduce((s, t) => s + t.cheques, 0));
  const plazos = centavos(sem.reduce((s, t) => s + t.plazos, 0));
  if (cheques || plazos) {
    const dif = centavos(plazos - cheques);
    let t = `Se van a debitar <b>${corto(cheques)}</b> en cheques propios y vencen <b>${corto(plazos)}</b> en plazos fijos: ${dif < 0 ? `<b class="rojo">faltan ${corto(-dif)}</b>` : `<b class="verde">sobran ${corto(dif)}</b>`}.`;
    const peor = sem.reduce((m, x) => (x.acumulado < m.acumulado ? x : m), sem[0]);
    if (peor && peor.acumulado < -0.005) t += ` El momento más ajustado es ${semanaTxt(peor)}, con el acumulado en <b class="rojo">${corto(peor.acumulado)}</b>.`;
    else t += " Los plazos fijos alcanzan en todo momento para los cheques.";
    const venc = sem.find((x) => x.id === "vencidos");
    if (venc && venc.cheques) t += ` Hay <b class="rojo">${corto(venc.cheques)}</b> en cheques vencidos que todavía figuran sin debitar: conviene revisarlos.`;
    out.push(t);
  } else out.push("No hay cheques propios por debitar ni plazos fijos que venzan.");
  const cob = r.cobrar.filter((t) => t.id !== "vencidos");
  if (res.cheques_cobrar) {
    const mayor = cob.reduce((m, x) => (!m || x.total > m.total ? x : m), null);
    const n = r.cobrar.reduce((s, t) => s + t.items.length, 0);
    out.push(`A cobrar: <b class="verde">${corto(res.cheques_cobrar)}</b> en ${n} ${n === 1 ? "cheque" : "cheques"} de terceros${mayor ? `; lo que más entra es ${semanaTxt(mayor)} (${corto(mayor.total)})` : ""}.`);
  } else out.push("No hay cheques de terceros en cartera.");
  return out;
}

/** La hoja completa del PDF, en 4 páginas. */
function paginasHtml(r, { titulo, empresa }) {
  const base = hojaInforme({ titulo, empresa, cuerpo: "" });
  const estilo = (base.match(/<style>[\s\S]*?<\/style>/) || [""])[0];
  const pie = (n) => `<div class="pie-pagina"><span>${esc([empresa, titulo].filter(Boolean).join(" · "))}</span><span>Generado por Gypi el ${esc(dma(new Date().toISOString().slice(0, 10)))} · Página ${n} de 4</span></div>`;
  const pagina = (n, contenido) => `<div class="pagina">${contenido}${pie(n)}</div>`;
  const res = r.resumen;

  // 1. Panorama
  const kpis = `<div class="kpis">${kpi("Pesos en cajas y bancos", $(res.pesos))}${kpi("Dólares en cajas y bancos", $(res.dolares, "USD"))}${kpi("Invertido", $(res.invertido_ars) + (res.invertido_usd ? ` + ${$(res.invertido_usd, "USD")}` : ""))}${kpi("Cheques a pagar", $(res.cheques_pagar), "rojo")}${kpi("Cheques a cobrar", $(res.cheques_cobrar), "verde")}</div>`;
  const p1 = pagina(1, `<div class="cabecera"><h1>${esc(titulo)}</h1><p>${esc([empresa, "Panorama financiero de hoy"].filter(Boolean).join(" · "))}</p></div>
${kpis}
<h2>Panorama de hoy</h2><div class="texto resumen">${panoramaTexto(r).map((t) => `<p>${t}</p>`).join("")}</div>
<h3>¿Dónde está la plata? (en pesos)</h3>${svgReparto(repartoFondos(r)) || '<p class="dim">No hay plata en pesos.</p>'}
<h3>Lo que hay, lo que sale y lo que entra (en pesos)</h3>${svgBalance(r)}`);

  // 2. Fondos e inversiones
  const fila = (nombre, valor, m = "ARS") => `<tr><td>${nombre}</td><td class="n${valor < 0 ? " rojo" : ""}">${$(valor, m)}</td></tr>`;
  const tot = (nombre, valor, m = "ARS") => `<tr class="tot"><td>${esc(nombre)}</td><td class="n">${$(valor, m)}</td></tr>`;
  const sec = (nombre) => `<tr class="sec"><td colspan="2">${esc(nombre)}</td></tr>`;
  const mas = (n) => (n > 0 ? `<tr><td colspan="2" class="dim">… y ${n} más (en el Excel)</td></tr>` : "");
  const recortar = (xs, max) => ({ xs: xs.slice(0, max), resto: Math.max(0, xs.length - max) });
  const fondos = ["ARS", "USD"].filter((m) => r.fondos[m].cajas.length).map((m) => {
    const { xs, resto } = recortar(r.fondos[m].cajas, MAX_FILAS_FONDOS / 2);
    return sec(m === "USD" ? "En dólares" : "En pesos") + xs.map((c) => fila(esc(c.nombre), c.saldo, m)).join("") + mas(resto) + tot(`Total ${m === "USD" ? "dólares" : "pesos"}`, r.fondos[m].total, m);
  }).join("");
  const grupo = (titulo2, xs, render) => { const { xs: v, resto } = recortar(xs, Math.floor(MAX_FILAS_FONDOS / 3)); return xs.length ? sec(titulo2) + v.map(render).join("") + mas(resto) : ""; };
  const inv = grupo("FCI", r.fci, (f) => fila(esc(f.nombre), f.saldo, f.moneda))
    + grupo(`Títulos${r.titulos.tipo_cambio ? ` (dólar a ${plata(r.titulos.tipo_cambio)})` : ""}`, r.titulos.especies, (e) => fila(`${esc(e.especie)} <span class="dim">· ${esc(e.laminas.toLocaleString("es-AR"))} lám.</span>`, e.valor, e.moneda))
    + grupo("Plazos fijos (capital)", r.plazos, (p) => fila(`N° ${esc(p.certificado)} <span class="${p.vencido ? "rojo" : "dim"}">· vence ${esc(dm(p.vencimiento))}</span>`, p.depositado, p.moneda));
  const invTot = inv ? tot("Total invertido en pesos", r.invertido.ARS) + (r.invertido.USD ? tot("Total invertido en dólares", r.invertido.USD, "USD") : "") : "";
  const nCajas = r.fondos.ARS.cajas.length + r.fondos.USD.cajas.length;
  const proxPf = r.plazos.filter((p) => !p.vencido)[0];
  const textoFondos = `Hay <b>${corto(res.pesos)}</b> en ${nCajas} ${nCajas === 1 ? "caja o banco" : "cajas y bancos"}${res.dolares ? ` y <b>${corto(res.dolares, "USD")}</b> en dólares` : ""}. `
    + `Invertido: <b>${corto(r.invertido.ARS)}</b> en ${[r.fci.length && `${r.fci.length} FCI`, r.titulos.especies.length && `${r.titulos.especies.length} ${r.titulos.especies.length === 1 ? "título" : "títulos"}`, r.plazos.length && `${r.plazos.length} ${r.plazos.length === 1 ? "plazo fijo" : "plazos fijos"}`].filter(Boolean).join(", ") || "nada"}`
    + `${proxPf ? `; el próximo plazo fijo vence el ${esc(dma(proxPf.vencimiento))} y devuelve ${corto(proxPf.reembolsar, proxPf.moneda)}` : ""}.`
    + `${r.plazos.some((p) => p.vencido) ? ' <span class="rojo">Hay plazos fijos vencidos sin registrar en Gypi.</span>' : ""}`;
  const p2 = pagina(2, `<h2>1. Posición de fondos e inversiones</h2><p class="texto">${textoFondos}</p>
<div class="cols"><div><table><thead><tr><th>Cajas y bancos</th><th class="n">Saldo</th></tr></thead><tbody>${fondos || '<tr><td colspan="2" class="dim">No hay cajas ni bancos.</td></tr>'}</tbody></table></div>
<div><table><thead><tr><th>Inversiones</th><th class="n">Valor</th></tr></thead><tbody>${inv + invTot || '<tr><td colspan="2" class="dim">No hay inversiones cargadas.</td></tr>'}</tbody></table>${r.titulos.falta_tc ? '<p class="rojo">Falta el tipo de cambio: los títulos en dólares no suman.</p>' : ""}</div></div>`);

  // 3. Calce
  const dias = r.calce.diario;
  const diasConAlgo = dias.filter((t) => t.cheques || t.plazos);
  const peorDia = dias.reduce((m, x) => (x.acumulado < m.acumulado ? x : m), dias[0]);
  const textoCalce = `${panoramaTexto(r)[1]} En los próximos ${DIAS_CALCE} días hay movimiento en ${diasConAlgo.length} ${diasConAlgo.length === 1 ? "día" : "días"}${peorDia && peorDia.acumulado < -0.005 ? `; el peor día es el ${esc(dm(peorDia.desde))}, con <b class="rojo">${corto(peorDia.acumulado)}</b> acumulado` : ""}. Solo cheques contra plazos fijos en pesos, sin la plata de los bancos.`;
  const p3 = pagina(3, `<h2>2. Calce de cheques a pagar y plazos fijos</h2><p class="texto">${textoCalce}</p>
<h3>Por semana</h3>${svgCalce(r.calce.semanal, "Calce por semana")}${tablaCalce(r.calce.semanal.filter((t) => t.id !== "despues" || t.cheques || t.plazos), "Semana")}
<h3>Por día · próximos ${DIAS_CALCE} días</h3>${svgCalce(dias, "Calce por día")}`);

  // 4. Cheques a cobrar
  const cobros = r.cobrar.flatMap((t) => t.items);
  const { xs: verCobros, resto } = recortar(cobros, MAX_COBROS);
  const p4 = pagina(4, `<h2>3. Cheques a cobrar</h2><p class="texto">${panoramaTexto(r)[2]}</p>
${cobros.length ? svgCobrar(r) : ""}
${cobros.length ? `<table><thead><tr><th>Se acredita</th><th>Banco y número</th><th>De quién</th><th class="n">Importe</th></tr></thead><tbody>${verCobros.map((x) => `<tr${x.fecha < r.hoy ? ' class="rojo"' : ""}><td>${esc(dma(x.fecha))}</td><td>${esc(x.detalle)}</td><td>${esc(x.quien)}</td><td class="n">${$(x.importe)}</td></tr>`).join("")}
${resto ? `<tr><td colspan="4" class="dim">… y ${resto} cheques más (en el Excel)</td></tr>` : ""}
<tr class="tot"><td colspan="3">Total a cobrar</td><td class="n">${$(res.cheques_cobrar)}</td></tr></tbody></table>` : ""}`);

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>${estilo}<style>${ESTILO_PAGINAS}</style></head><body>${p1}${p2}${p3}${p4}</body></html>`;
}

/** { titulo, html, hojas, bloques } para los botones 📄 PDF y 📊 Excel. */
export function exportarInformeTesoreria(r, { empresa = "" } = {}) {
  const titulo = `Informe de tesorería al ${dma(r.hoy)}`;
  const filasCalce = (xs) => xs.map((t) => [t.etiqueta, N(t.cheques), N(t.plazos), N(t.diferencia), NB(t.acumulado)]);
  const cabCalce = (c) => [B(c), B("Cheques a debitar"), B("Vencen plazos fijos"), B("Diferencia"), B("Acumulado")];
  return {
    titulo,
    html: () => paginasHtml(r, { titulo, empresa }),
    // El PDF corta entre páginas, nunca adentro de una (20/11)
    bloques: ".pagina",
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

/** Barras horizontales de la página 1: lo que hay, lo que sale y lo que entra, en pesos. */
export function balanceTesoreria(r) {
  const sem = r.calce.semanal;
  return [
    { id: "disponible", nombre: "Cajas y bancos", valor: r.resumen.pesos, color: COLOR_REPARTO.caja },
    { id: "invertido", nombre: "Invertido (FCI, títulos y plazos fijos)", valor: r.resumen.invertido_ars, color: COLOR_REPARTO.fci },
    { id: "pagar", nombre: "Cheques a pagar", valor: r.resumen.cheques_pagar, color: COLOR.rojo },
    { id: "plazos", nombre: "Plazos fijos que vencen (8 semanas)", valor: centavos(sem.reduce((s, t) => s + t.plazos, 0)), color: COLOR.verde },
    { id: "cobrar", nombre: "Cheques a cobrar", valor: r.resumen.cheques_cobrar, color: COLOR_REPARTO.titulos },
  ];
}

function svgBalance(r) {
  const items = balanceTesoreria(r);
  const W = 700, fila = 30, nombre = 250, valor = 120;
  const max = Math.max(1, ...items.map((x) => Math.abs(x.valor)));
  const ancho = W - nombre - valor - 16;
  const H = items.length * fila;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lo que hay, lo que sale y lo que entra" style="width:100%;height:auto;display:block;margin:6px 0 4px">${items.map((x, i) => {
    const y = i * fila;
    const w = Math.max(2, (Math.abs(x.valor) / max) * ancho);
    return `<text x="${nombre}" y="${y + 19}" text-anchor="end" font-size="12" fill="#222">${esc(x.nombre)}</text>`
      + `<rect x="${nombre + 8}" y="${y + 6}" width="${w.toFixed(1)}" height="${fila - 12}" rx="3" fill="${x.color}"/>`
      + `<text x="${W - 2}" y="${y + 19}" text-anchor="end" font-size="12" font-weight="700" fill="#222">${esc(plata(x.valor))}</text>`;
  }).join("")}</svg>`;
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
