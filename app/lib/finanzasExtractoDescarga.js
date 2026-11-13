// app/lib/finanzasExtractoDescarga.js — Finanzas: descargar el extracto de
// cajas y bancos en PDF o Excel (pedido de Tadeo del 13/11). Sin migración:
// se arma en el navegador con las operaciones que ya trae Cajas y bancos.
//
//   - Solo lo que movió plata en una caja o banco (como un extracto de
//     banco). Las operaciones anuladas no salen.
//   - Un bloque por cada caja o banco, con saldo inicial (todo lo anterior a
//     "desde"), ingresos, egresos y saldo final, y el detalle con el saldo
//     renglón por renglón. Las cajas en dólares van en dólares, con su total
//     aparte.
//   - Con filtros (tipo, proveedor, OT, centro de costo, buscador) el
//     detalle, los ingresos y los egresos son solo de lo filtrado; el saldo
//     inicial y el final siguen siendo los de toda la cuenta (y no va el saldo
//     renglón por renglón, que no cerraría).
//   - Un pase entre dos cajas sale en las dos: en una entra y en la otra sale.
import { filtrarOperaciones, movimientoCaja, plata } from "./finanzasOperaciones";
import { NOMBRE_GRUPO, ORDEN_TIPOS } from "./finanzasTesoreria";
import { ESTILO, armarXlsx } from "./xlsxSimple";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SIN_NOMBRES = { entidad: (op) => op?.entidad || "", ot: () => "" };
export const FILTROS_EXTRACTO = ["tipo", "proveedor", "proyecto", "centro", "buscar"];

const ordenOp = (a, b) => (a.fecha === b.fecha ? Number(a.id) - Number(b.id) : a.fecha < b.fecha ? -1 : 1);

/** ¿Hay algún filtro que deje afuera operaciones de la cuenta? */
export function hayFiltros(filtros = {}) {
  return FILTROS_EXTRACTO.some((k) => String(filtros[k] ?? "").trim() !== "");
}

/**
 * Arma el extracto.
 * @param {{
 *   operaciones: any[], tesoreria: any[], desde: string, hasta: string,
 *   filtros?: { caja?: string, tipo?: string, proveedor?: string, proyecto?: string, centro?: string, buscar?: string },
 *   nombres?: { entidad: (op: any) => string, ot: (op: any) => string },
 *   nombreTipo?: (codigo: string) => string, nombreCuenta?: (codigo: string) => string,
 * }} d
 */
export function armarExtracto({ operaciones = [], tesoreria = [], desde, hasta, filtros = {}, nombres = SIN_NOMBRES, nombreTipo = (t) => t, nombreCuenta = (c) => c }) {
  const filtrado = hayFiltros(filtros);
  const porCuenta = new Map(tesoreria.map((t) => [t.cuenta, t]));
  const vivas = operaciones.filter((op) => !op.anulada_at);
  const textoDe = (op) => `${nombres.entidad(op)} ${nombres.ot(op)}`;
  const elegidas = tesoreria
    .filter((t) => !filtros.caja || t.cuenta === filtros.caja)
    // Primero las de pesos y después las de dólares; dentro, cajas, bancos, FCI… y por nombre
    .sort((a, b) => (Number(a.moneda === "USD") - Number(b.moneda === "USD"))
      || (ORDEN_TIPOS.indexOf(a.tipo) - ORDEN_TIPOS.indexOf(b.tipo)) || String(a.nombre).localeCompare(String(b.nombre), "es"));

  const bloques = [];
  for (const caja of elegidas) {
    const moneda = caja.moneda === "USD" ? "USD" : "ARS";
    let inicial = 0;
    const delPeriodo = [];
    for (const op of vivas) {
      const m = movimientoCaja(op, caja);
      if (!m) continue;
      if (op.fecha < desde) inicial += m;
      else if (op.fecha <= hasta) delPeriodo.push(op);
    }
    delPeriodo.sort(ordenOp);
    inicial = centavos(inicial);
    const final = centavos(delPeriodo.reduce((s, op) => s + movimientoCaja(op, caja), inicial));
    const lista = filtrado ? filtrarOperaciones(delPeriodo, { ...filtros, caja: "", revisar: false, anuladas: false }, textoDe) : delPeriodo;
    // Sin movimientos y sin saldo (o con filtros que no encuentran nada): no va
    if (!filtros.caja && !lista.length && (filtrado || (Math.abs(inicial) < 0.01 && Math.abs(final) < 0.01))) continue;
    let saldo = inicial;
    let ingresos = 0;
    let egresos = 0;
    const filas = lista.map((op) => {
      const m = movimientoCaja(op, caja);
      saldo = centavos(saldo + m);
      if (m > 0) ingresos += m; else egresos -= m;
      const otra = op.cuenta_debe === caja.cuenta ? op.cuenta_haber : op.cuenta_debe;
      return {
        id: op.id,
        fecha: op.fecha,
        tipo: nombreTipo(op.tipo) || op.tipo || "",
        para_revisar: op.estado === "para_revisar",
        quien: nombres.entidad(op) || "",
        ot: nombres.ot(op) || "",
        descripcion: op.descripcion || "",
        referencia: op.referencia || "",
        contra: porCuenta.get(otra)?.nombre || nombreCuenta(otra) || otra || "",
        entra: m > 0 ? centavos(m) : 0,
        sale: m < 0 ? centavos(-m) : 0,
        saldo: filtrado ? null : saldo,
      };
    });
    bloques.push({
      cuenta: caja.cuenta, nombre: caja.nombre, tipo: caja.tipo, grupo: NOMBRE_GRUPO[caja.tipo] || "Otros", moneda,
      saldo_inicial: inicial, ingresos: centavos(ingresos), egresos: centavos(egresos), saldo_final: final, filas,
    });
  }

  const totales = {};
  for (const b of bloques) {
    const t = (totales[b.moneda] ||= { cuentas: 0, saldo_inicial: 0, ingresos: 0, egresos: 0, saldo_final: 0 });
    t.cuentas += 1;
    for (const k of ["saldo_inicial", "ingresos", "egresos", "saldo_final"]) t[k] = centavos(t[k] + b[k]);
  }
  return { desde, hasta, filtrado, bloques, totales, movimientos: bloques.reduce((s, b) => s + b.filas.length, 0) };
}

const MONEDAS = [["ARS", "En pesos"], ["USD", "En dólares"]];

/** Nombre del archivo, sin extensión. */
export function nombreArchivoExtracto(ex) {
  const una = ex.bloques.length === 1 ? `-${String(ex.bloques[0].nombre).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40)}` : "";
  return `extracto${una}-${ex.desde}-a-${ex.hasta}`;
}

/* ─── Excel ──────────────────────────────────────────────────────────── */

/**
 * El .xlsx: hoja "Resumen" (una fila por cuenta, con totales por moneda) y
 * hoja "Movimientos" (todo junto, con la cuenta en cada renglón, para filtrar).
 * @param {ReturnType<typeof armarExtracto>} ex
 * @param {{ empresa?: string, filtrosTexto?: string[] }} [opciones]
 */
export function xlsxExtracto(ex, { empresa = "", filtrosTexto = [] } = {}) {
  const N = (v) => ({ v, estilo: ESTILO.numero });
  const NB = (v) => ({ v, estilo: ESTILO.numeroNegrita });
  const B = (v) => ({ v, estilo: ESTILO.negrita });
  const cabecera = [
    [{ v: `Extracto de cajas y bancos${empresa ? ` · ${empresa}` : ""}`, estilo: ESTILO.titulo }],
    [`Del ${dma(ex.desde)} al ${dma(ex.hasta)}`],
    ...(filtrosTexto.length ? [[`Filtros: ${filtrosTexto.join(" · ")}`]] : []),
    ...(ex.filtrado ? [["Con filtros: ingresos y egresos son solo de lo filtrado; el saldo inicial y el final son los de toda la cuenta."]] : []),
    [],
  ];
  const resumen = [...cabecera, ["Cuenta", "Grupo", "Moneda", "Saldo inicial", "Ingresos", "Egresos", "Saldo final", "Movimientos"].map(B)];
  for (const [moneda, titulo] of MONEDAS) {
    const bs = ex.bloques.filter((b) => b.moneda === moneda);
    if (!bs.length) continue;
    for (const b of bs) resumen.push([b.nombre, b.grupo, moneda, N(b.saldo_inicial), N(b.ingresos), N(b.egresos), N(b.saldo_final), b.filas.length]);
    const t = ex.totales[moneda];
    resumen.push([B(`Total ${titulo.toLowerCase()}`), "", B(moneda), NB(t.saldo_inicial), NB(t.ingresos), NB(t.egresos), NB(t.saldo_final), B(bs.reduce((s, b) => s + b.filas.length, 0))]);
    resumen.push([]);
  }

  const titulos = ["Cuenta", "Moneda", "Fecha", "Tipo", "Quién", "OT", "Descripción", "Referencia", "Contra cuenta", "Ingreso", "Egreso", ...(ex.filtrado ? [] : ["Saldo"])];
  const movs = [...cabecera, titulos.map(B)];
  for (const b of ex.bloques) {
    movs.push([B(b.nombre), b.moneda, { v: ex.desde, estilo: ESTILO.fecha }, B("Saldo inicial"), "", "", "", "", "", "", "", ...(ex.filtrado ? [] : [NB(b.saldo_inicial)])]);
    for (const f of b.filas) {
      movs.push([
        b.nombre, b.moneda, { v: f.fecha, estilo: ESTILO.fecha }, f.para_revisar ? `${f.tipo} (para revisar)` : f.tipo,
        f.quien, f.ot, f.descripcion, f.referencia, f.contra,
        f.entra ? N(f.entra) : "", f.sale ? N(f.sale) : "", ...(ex.filtrado ? [] : [N(f.saldo)]),
      ]);
    }
    movs.push([B(b.nombre), b.moneda, { v: ex.hasta, estilo: ESTILO.fecha }, B("Saldo final"), "", "", "", "", "", NB(b.ingresos), NB(b.egresos), ...(ex.filtrado ? [] : [NB(b.saldo_final)])]);
  }
  return armarXlsx([
    { nombre: "Resumen", filas: resumen, anchos: [34, 26, 9, 16, 16, 16, 16, 13] },
    { nombre: "Movimientos", filas: movs, anchos: [28, 8, 11, 30, 28, 30, 44, 16, 30, 15, 15, 15] },
  ]);
}

/* ─── PDF (hoja HTML) ────────────────────────────────────────────────── */

/**
 * La hoja HTML del extracto (para el PDF apaisado).
 * @param {ReturnType<typeof armarExtracto>} ex
 * @param {{ empresa?: string, filtrosTexto?: string[] }} [opciones]
 */
export function htmlExtracto(ex, { empresa = "", filtrosTexto = [] } = {}) {
  const $ = (v, m) => esc(plata(v, m));
  const tono = (v) => (v < 0 ? " rojo" : "");
  const resumen = MONEDAS.map(([moneda, titulo]) => {
    const bs = ex.bloques.filter((b) => b.moneda === moneda);
    if (!bs.length) return "";
    const t = ex.totales[moneda];
    return `<h3>${titulo}</h3><table><thead><tr><th>Cuenta</th><th class="n">Saldo inicial</th><th class="n">Ingresos</th><th class="n">Egresos</th><th class="n">Saldo final</th></tr></thead><tbody>
${bs.map((b) => `<tr><td>${esc(b.nombre)} <span class="pc">· ${esc(b.grupo)}</span></td><td class="n${tono(b.saldo_inicial)}">${$(b.saldo_inicial, moneda)}</td><td class="n verde">${$(b.ingresos, moneda)}</td><td class="n rojo">${$(b.egresos, moneda)}</td><td class="n${tono(b.saldo_final)}"><b>${$(b.saldo_final, moneda)}</b></td></tr>`).join("\n")}
<tr class="res"><td>Total ${titulo.toLowerCase()}</td><td class="n">${$(t.saldo_inicial, moneda)}</td><td class="n">${$(t.ingresos, moneda)}</td><td class="n">${$(t.egresos, moneda)}</td><td class="n">${$(t.saldo_final, moneda)}</td></tr>
</tbody></table>`;
  }).join("\n");

  const bloques = ex.bloques.map((b) => {
    const m = b.moneda;
    const filas = b.filas.map((f) => `<tr><td class="f">${esc(dma(f.fecha))}</td><td>${esc(f.tipo)}${f.para_revisar ? ' <span class="aviso-mini">para revisar</span>' : ""}</td><td>${esc(f.quien)}</td><td>${esc(f.ot)}</td><td class="desc">${esc(f.descripcion)}${f.referencia ? ` <span class="pc">(${esc(f.referencia)})</span>` : ""}</td><td class="pc">${esc(f.contra)}</td><td class="n verde">${f.entra ? $(f.entra, m) : ""}</td><td class="n rojo">${f.sale ? $(f.sale, m) : ""}</td>${ex.filtrado ? "" : `<td class="n${tono(f.saldo)}">${$(f.saldo, m)}</td>`}</tr>`).join("\n");
    return `<section class="cuenta">
<h2>${esc(b.nombre)} <span>${esc(b.grupo)}${m === "USD" ? " · en dólares" : ""}</span></h2>
<div class="kpis"><div class="kpi"><span>Saldo inicial</span><b class="${tono(b.saldo_inicial)}">${$(b.saldo_inicial, m)}</b></div><div class="kpi verde"><span>Ingresos</span><b>${$(b.ingresos, m)}</b></div><div class="kpi rojo"><span>Egresos</span><b>${$(b.egresos, m)}</b></div><div class="kpi azul"><span>Saldo final</span><b class="${tono(b.saldo_final)}">${$(b.saldo_final, m)}</b></div></div>
${b.filas.length ? `<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Quién</th><th>OT</th><th>Descripción</th><th>Contra cuenta</th><th class="n">Ingreso</th><th class="n">Egreso</th>${ex.filtrado ? "" : '<th class="n">Saldo</th>'}</tr></thead><tbody>
${ex.filtrado ? "" : `<tr class="ini"><td class="f">${esc(dma(ex.desde))}</td><td colspan="7">Saldo inicial</td><td class="n">${$(b.saldo_inicial, m)}</td></tr>`}
${filas}
</tbody></table>` : '<p class="vacio">Sin movimientos en el período.</p>'}
</section>`;
  }).join("\n");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Extracto de cajas y bancos</title>
<style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;margin:0;padding:4px;font-size:11px;background:#fff}
  .cabecera{background:linear-gradient(90deg,#0e7490,#1d4ed8);color:#fff;border-radius:10px;padding:12px 16px;margin-bottom:10px}
  .cabecera h1{font-size:19px;margin:0}.cabecera p{margin:3px 0 0;opacity:.92}
  h2{font-size:14px;margin:0 0 6px;padding:5px 10px;border-radius:6px;background:#eef6f8;border-left:5px solid #0e7490}h2 span{font-weight:400;color:#555;font-size:12px;margin-left:6px}
  h3{font-size:13px;margin:10px 0 2px}
  section{margin:14px 0 0}section.resumen h2{border-color:#1d4ed8;background:#eef2fb}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:4px}
  .kpi{border:1px solid #dde3e8;border-left:5px solid #0e7490;border-radius:8px;padding:5px 9px;background:#f7fafb}.kpi span{display:block;color:#555;font-size:10px}.kpi b{font-size:14px}
  .kpi.verde{border-left-color:#15803d;background:#f0f8f2}.kpi.verde b{color:#15803d}.kpi.rojo{border-left-color:#c62828;background:#fcf0f0}.kpi.rojo b{color:#c62828}.kpi.azul{border-left-color:#1d4ed8;background:#eef2fb}
  table{width:100%;border-collapse:collapse;margin-top:4px}td,th{padding:3px 5px;border-bottom:1px solid #e6e9ec;text-align:left;vertical-align:top}
  th{color:#555;font-weight:600;background:#f2f5f7}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.f{white-space:nowrap;font-variant-numeric:tabular-nums}
  td.desc{max-width:280px;word-break:break-word}.ini td{font-weight:600;background:#f7fafb}
  .res td{font-weight:700;border-top:2px solid #1a1a1a}.pc{color:#555}.rojo{color:#c62828}.verde{color:#15803d}
  .vacio,.nota{color:#555;margin:4px 0}.aviso{color:#8a5a00;background:#fdf6e7;border-radius:6px;padding:6px 8px;margin:6px 0}
  .aviso-mini{color:#8a5a00;background:#fdf6e7;border-radius:4px;padding:0 4px;font-size:10px}
</style></head><body>
<div class="cabecera"><h1>Extracto de cajas y bancos${empresa ? ` · ${esc(empresa)}` : ""}</h1>
<p>Del ${esc(dma(ex.desde))} al ${esc(dma(ex.hasta))} · ${ex.bloques.length} ${ex.bloques.length === 1 ? "cuenta" : "cuentas"} · ${ex.movimientos} ${ex.movimientos === 1 ? "movimiento" : "movimientos"}${filtrosTexto.length ? ` · Filtros: ${esc(filtrosTexto.join(" · "))}` : ""}</p></div>
${ex.filtrado ? '<p class="aviso">Con filtros: ingresos y egresos son solo de lo filtrado; el saldo inicial y el final son los de toda la cuenta.</p>' : ""}
<section class="resumen"><h2>Resumen por cuenta</h2>${resumen || '<p class="vacio">No hay cajas ni bancos con esos filtros.</p>'}</section>
${bloques}
</body></html>`;
}

/* ─── Descargar ──────────────────────────────────────────────────────── */

/**
 * Descarga el extracto (solo en el navegador).
 * @param {ReturnType<typeof armarExtracto>} ex
 * @param {"pdf"|"xlsx"} formato
 * @param {{ empresa?: string, filtrosTexto?: string[] }} [opciones]
 */
export async function descargarExtracto(ex, formato, opciones = {}) {
  const nombre = nombreArchivoExtracto(ex);
  if (formato === "pdf") {
    const { descargarPdfDeHtml } = await import("./pdfDeHtml");
    return descargarPdfDeHtml(htmlExtracto(ex, opciones), { archivo: `${nombre}.pdf`, bloques: ".cabecera, .aviso, h2, h3, .kpis, tr", apaisado: true });
  }
  const blob = new Blob([xlsxExtracto(ex, opciones)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombre}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
