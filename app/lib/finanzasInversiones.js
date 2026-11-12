// app/lib/finanzasInversiones.js — FCI y títulos públicos y privados (pedido
// de Tadeo del 12/11; /api/finanzas/inversiones). Sin migración: la lista de
// títulos va en config_sistema ("finanzas_titulos").
//
// FCI: se carga el saldo real que dice el banco. La diferencia con el saldo de
// Gypi son los intereses ganados hasta ese día (o, si bajó, se descuentan):
// RENDIMIENTOS FINANCIEROS, Debe el FCI / Haber Intereses Ganados.
//
// Títulos: cada especie (GD35, AL30, YPF…) con sus láminas y su cotización.
// El valor es láminas × cotización (los bonos cotizan cada 100 láminas; las
// acciones, por una). Comprar o vender mueve la plata y las láminas; al
// actualizar las cotizaciones, la diferencia entre lo que valen y el saldo de
// la cuenta entra como Diferencia cotización Títulos. Lo que está en dólares
// se pasa a pesos con el tipo de cambio del día.

export const CLAVE_TITULOS = "finanzas_titulos";
export const ORIGEN_FCI = "fci";
export const ORIGEN_TITULOS = "titulos";
export const MAX_ESPECIES = 100;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const sinAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const fechaDm = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");
const fechaValida = (f) => FECHA.test(String(f || "")) && !Number.isNaN(Date.parse(`${f}T12:00:00Z`));
const plata = (n) => `$ ${centavos(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** El primer tipo de operación activo de la lista (por código, sin acentos). */
function tipoDe(tipos, codigos) {
  const vivos = tipos.filter((t) => t.activo !== false);
  for (const c of codigos) {
    const t = vivos.find((x) => sinAcentos(x.codigo) === sinAcentos(c));
    if (t) return t.codigo;
  }
  return null;
}
const cuentaPorNombre = (cuentas, re) => cuentas.find((c) => c.activa !== false && re.test(sinAcentos(c.nombre)))?.codigo || null;

/**
 * Los tipos y las cuentas que hacen falta, buscados por nombre como en el libro.
 * @returns {{ ctx?: object, errores: string[] }}
 */
export function contextoInversiones({ tipos = [], cuentas = [] }) {
  const errores = [];
  const rendimiento = tipoDe(tipos, ["RENDIMIENTOS FINANCIEROS", "COBRO RENDIMIENTOS FINANCIEROS"]);
  const intereses = cuentaPorNombre(cuentas, /^INTERESES GANADOS$/);
  const diferencia = cuentaPorNombre(cuentas, /^DIFERENCIA COTIZACION TITULOS$/) || cuentaPorNombre(cuentas, /^RESULTADO POR TENENCIA$/) || intereses;
  const titulos = cuentaPorNombre(cuentas, /^TITULOS? PUBLICOS Y PRIVADOS$/) || cuentaPorNombre(cuentas, /TITULOS? PUBLICOS/);
  const ajuste = cuentaPorNombre(cuentas, /^AJUSTE DE CAPITAL$/);
  const compra = tipoDe(tipos, ["COMPRA TÍTULOS", "COMPRA TITULOS PUBLICOS", "INVERSIONES FINANCIERAS", "TRANSF INTERNA"]);
  const venta = tipoDe(tipos, ["VENTA TÍTULOS PÚBLICOS", "VENTA TITULOS", "INVERSIONES FINANCIERAS", "TRANSF INTERNA"]);
  const inicial = tipoDe(tipos, ["SALDO INICIAL"]);
  if (!rendimiento) errores.push("Falta el tipo de operación RENDIMIENTOS FINANCIEROS: revisá la lista de tipos en Configuración");
  if (!intereses) errores.push("Falta la cuenta Intereses Ganados en el plan de cuentas");
  return { errores, ctx: { rendimiento, intereses, diferencia, titulos, ajuste, compra, venta, inicial } };
}

/** El saldo de una cuenta en Gypi hasta una fecha (incluida). */
export function saldoHasta(ops = [], cuenta, fecha = "9999-12-31", moneda = "ARS") {
  let s = 0;
  for (const op of ops) {
    if (op.anulada_at || op.fecha > fecha) continue;
    const imp = moneda === "USD" ? Number(op.total) || 0 : Number(op.total_ars) || 0;
    if (op.cuenta_debe === cuenta) s += imp;
    if (op.cuenta_haber === cuenta) s -= imp;
  }
  return centavos(s);
}

const base = (fecha, tipo, debe, haber, importe, descripcion, origen, origenId) => ({
  fecha, tipo, proveedor_id: null, entidad: null, iva: 0, otros_impuestos: 0, moneda: "ARS", tipo_cambio: null,
  neto: importe, total: importe, total_ars: importe, cuenta_debe: debe, cuenta_haber: haber,
  descripcion: txt(descripcion, 500), referencia: null, origen, origen_id: origenId, estado: "confirmada",
});

/* ─── FCI ─────────────────────────────────────────────────────────────── */

/**
 * La operación que deja el FCI con el saldo real: la diferencia son los
 * intereses (o lo que bajó). null si ya da igual.
 * @returns {{ op?: object|null, diferencia?: number, saldo_gypi?: number, errores: string[] }}
 */
export function ajusteFci({ caja, ops = [], saldoReal, fecha, hoy, ctx }) {
  const errores = [];
  if (!caja || caja.tipo !== "fci") errores.push("Elegí el fondo común de inversión");
  else if (caja.moneda === "USD") errores.push("Por ahora el FCI se actualiza solo en pesos");
  const real = Number(saldoReal);
  if (!Number.isFinite(real) || real < 0 || real >= 1e13) errores.push("El saldo real tiene que ser un número de cero para arriba");
  if (!fechaValida(fecha)) errores.push("La fecha no es válida");
  else if (hoy && fecha > hoy) errores.push("La fecha no puede ser futura");
  if (!ctx?.rendimiento || !ctx?.intereses) errores.push("Faltan el tipo RENDIMIENTOS FINANCIEROS o la cuenta Intereses Ganados");
  if (errores.length) return { errores };
  const saldoGypi = saldoHasta(ops, caja.cuenta, fecha);
  const diferencia = centavos(real - saldoGypi);
  if (Math.abs(diferencia) < 0.01) return { op: null, diferencia: 0, saldo_gypi: saldoGypi, errores };
  const sube = diferencia > 0;
  const op = base(
    fecha, ctx.rendimiento,
    sube ? caja.cuenta : ctx.intereses, sube ? ctx.intereses : caja.cuenta,
    Math.abs(diferencia),
    `${sube ? "Intereses" : "Baja"} del FCI al ${fechaDm(fecha)} (saldo real ${plata(real)}, en Gypi ${plata(saldoGypi)})`,
    ORIGEN_FCI, `fci${caja.cuenta}:${fecha}`,
  );
  return { op, diferencia, saldo_gypi: saldoGypi, errores };
}

/* ─── Títulos ─────────────────────────────────────────────────────────── */

/** Una especie como llega del navegador → limpia, o null. */
export function especieValida(e = {}) {
  const especie = txt(e.especie, 20).toUpperCase();
  const laminas = Number(e.laminas);
  const cotizacion = Number(e.cotizacion);
  const por = Number(e.por) === 1 ? 1 : 100;
  if (!especie || !/^[A-Z0-9.\- ]+$/.test(especie)) return null;
  if (!Number.isFinite(laminas) || laminas < 0 || laminas >= 1e12) return null;
  if (!Number.isFinite(cotizacion) || cotizacion < 0 || cotizacion >= 1e10) return null;
  return {
    id: txt(e.id, 40) || especie,
    especie, nombre: txt(e.nombre, 80), clase: e.clase === "privado" ? "privado" : "publico",
    moneda: e.moneda === "USD" ? "USD" : "ARS", laminas: Math.round(laminas * 10000) / 10000, cotizacion: Math.round(cotizacion * 10000) / 10000, por,
    fecha_cotizacion: fechaValida(e.fecha_cotizacion) ? e.fecha_cotizacion : null,
  };
}

/** La lista guardada (vieja o rota → vacía). */
export function leerTitulos(valor) {
  const lista = Array.isArray(valor?.especies) ? valor.especies : [];
  const vistos = new Set();
  const especies = [];
  for (const e of lista) {
    const v = especieValida(e);
    if (!v || vistos.has(v.id)) continue;
    vistos.add(v.id);
    especies.push(v);
  }
  const tc = Number(valor?.tipo_cambio);
  return { especies: especies.slice(0, MAX_ESPECIES), cuenta: txt(valor?.cuenta, 40) || null, tipo_cambio: tc > 0 ? tc : null };
}

/** Lo que vale una especie en su moneda. */
export const valorEspecie = (e) => centavos(((Number(e.laminas) || 0) * (Number(e.cotizacion) || 0)) / (Number(e.por) === 1 ? 1 : 100));

/** Lo que vale todo, en pesos (lo que está en dólares, con el tipo de cambio). */
export function valorTitulos(especies = [], tipoCambio = null) {
  let ars = 0;
  let faltaTc = false;
  for (const e of especies) {
    const v = valorEspecie(e);
    if (e.moneda === "USD") {
      if (!(tipoCambio > 0)) { if (v > 0) faltaTc = true; continue; }
      ars += v * tipoCambio;
    } else ars += v;
  }
  return { ars: centavos(ars), falta_tc: faltaTc };
}

/**
 * La operación que deja la cuenta de títulos con lo que valen: la diferencia
 * entra (o sale) como diferencia de cotización. null si da igual.
 */
export function ajusteTitulos({ cuenta, ops = [], especies = [], tipoCambio = null, fecha, ctx }) {
  const errores = [];
  if (!cuenta) errores.push("Falta la cuenta de los títulos (Titulo Públicos y Privados)");
  if (!fechaValida(fecha)) errores.push("La fecha no es válida");
  if (!ctx?.rendimiento || !ctx?.diferencia) errores.push("Faltan el tipo RENDIMIENTOS FINANCIEROS o la cuenta de diferencia de cotización");
  const valor = valorTitulos(especies, tipoCambio);
  if (valor.falta_tc) errores.push("Hay títulos en dólares: poné el tipo de cambio");
  if (errores.length) return { errores };
  const saldo = saldoHasta(ops, cuenta, fecha);
  const diferencia = centavos(valor.ars - saldo);
  if (Math.abs(diferencia) < 0.01) return { op: null, diferencia: 0, saldo, valor: valor.ars, errores };
  const sube = diferencia > 0;
  const op = base(
    fecha, ctx.rendimiento, sube ? cuenta : ctx.diferencia, sube ? ctx.diferencia : cuenta, Math.abs(diferencia),
    `${sube ? "Suba" : "Baja"} de cotización de los títulos al ${fechaDm(fecha)} (valen ${plata(valor.ars)}, en Gypi ${plata(saldo)})`,
    ORIGEN_TITULOS, `tit:${fecha}`,
  );
  return { op, diferencia, saldo, valor: valor.ars, errores };
}

/**
 * Comprar, vender o dar de alta una tenencia que ya se tenía.
 *   compra: Debe títulos / Haber la caja o banco, por lo que se pagó.
 *   venta: Debe la caja o banco / Haber títulos, por lo que se cobró.
 *   inicial: Debe títulos / Haber Ajuste De Capital (la tenencia que había y no estaba cargada).
 * @returns {{ op?: object, laminas?: number, errores: string[] }}
 */
export function movimientoTitulo({ especie, como, laminas, importe, caja, fecha, hoy, cuenta, ctx, tesoreria = [] }) {
  const errores = [];
  const l = Number(laminas);
  const imp = centavos(importe);
  if (!especie) errores.push("Elegí el título");
  if (!["compra", "venta", "inicial"].includes(como)) errores.push("Elegí si es compra, venta o tenencia que ya tenías");
  if (!(l > 0) || l >= 1e12) errores.push("Las láminas tienen que ser más de cero");
  if (!(imp > 0) || imp >= 1e13) errores.push("El importe en pesos tiene que ser mayor a cero");
  if (!fechaValida(fecha)) errores.push("La fecha no es válida");
  else if (hoy && fecha > hoy) errores.push("La fecha no puede ser futura");
  if (!cuenta) errores.push("Falta la cuenta de los títulos (Titulo Públicos y Privados)");
  const c = tesoreria.find((t) => t.cuenta === caja && t.activa !== false);
  if (como !== "inicial" && (!c || c.moneda === "USD")) errores.push("Elegí la caja o el banco en pesos de donde sale o adonde entra la plata");
  if (como === "venta" && especie && l > (Number(especie.laminas) || 0) + 1e-9) errores.push(`Tenés ${especie.laminas} láminas de ${especie.especie}: no se pueden vender más`);
  const tipo = como === "compra" ? ctx?.compra : como === "venta" ? ctx?.venta : ctx?.inicial;
  if (!tipo) errores.push(como === "inicial" ? "Falta el tipo SALDO INICIAL" : "Falta un tipo para comprar o vender títulos (INVERSIONES FINANCIERAS o TRANSF INTERNA)");
  if (como === "inicial" && !ctx?.ajuste) errores.push("Falta la cuenta Ajuste De Capital");
  if (errores.length) return { errores };
  const texto = `${l} láminas de ${especie.especie}${especie.nombre ? ` (${especie.nombre})` : ""}`;
  const marca = `${especie.id}:${como}:${fecha}:${Date.now().toString(36)}`.slice(0, 60);
  let op;
  if (como === "compra") op = base(fecha, tipo, cuenta, caja, imp, `Compra de ${texto}`, ORIGEN_TITULOS, `tim:${marca}`);
  else if (como === "venta") op = base(fecha, tipo, caja, cuenta, imp, `Venta de ${texto}`, ORIGEN_TITULOS, `tim:${marca}`);
  else op = base(fecha, tipo, cuenta, ctx.ajuste, imp, `Tenencia que ya había: ${texto}`, ORIGEN_TITULOS, `tim:${marca}`);
  const nuevas = como === "venta" ? (Number(especie.laminas) || 0) - l : (Number(especie.laminas) || 0) + l;
  return { op, laminas: Math.round(nuevas * 10000) / 10000, errores };
}
