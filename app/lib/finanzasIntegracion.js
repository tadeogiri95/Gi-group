// app/lib/finanzasIntegracion.js — Finanzas, parte 9 del plan del 11/11:
// Finanzas unida con Flota, Maquinaria y Stock (/api/finanzas/integracion).
// Sin migración.
//
//   - Lo que cuesta mantener vehículos (services, reparaciones y arreglos con
//     costo, de Flota) y máquinas (fallas resueltas con costo, de Maquinaria)
//     aparece en Finanzas para cargarlo como gasto con un toque: el formulario
//     de gasto viene lleno (tipo, importe, fecha, detalle, taller) y, si tiene
//     factura, Gypi la puede leer. El gasto queda unido al arreglo con un
//     origen_id fijo (g + a|b + id en hexadecimal), así nunca se carga dos veces.
//   - Si ese costo ya se cargó a mano (antes de que existiera esta unión), el
//     Dueño lo quita con "Ya está cargado": queda anotado en config_sistema
//     (finanzas_costos_quitados) y se puede volver a mostrar.
//   - El stock valorizado (stock × último precio de compra, de Planta → Stock)
//     contra el saldo de las cuentas de bienes de cambio en Gypi.
import { clavePersona } from "./finanzasPersonas";

export const TIPO_VEHICULO = "GASTOS DE LOGÍSTICA";
export const TIPO_MAQUINA = "GASTOS DE MANTENIMIENTO";
const PREFIJO = { vehiculo: "a", maquina: "b" };
const MODULO = { a: "vehiculo", b: "maquina" };
export const MESES_ATRAS = 12;
/** Quién figura como "cargada por" en los gastos que Gypi pasa solo desde Mantenimiento (auditoría 12/11, parte 9). */
export const CARGADA_POR = "Gypi (de Mantenimiento)";
/** ¿Esta operación la creó Gypi desde Mantenimiento? (el devengado, no su pago) */
export const esDeMantenimiento = (op) => op?.origen === "gasto" && op?.cargada_por_nombre === CARGADA_POR && !String(op?.origen_id || "").endsWith("-p");
export const CLAVE_QUITADOS = "finanzas_costos_quitados";
const MAX_QUITADOS = 1000;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** "v:12" (mantenimiento de un vehículo) o "m:7" (falla de una máquina) → { modulo, id }, o null. */
export function vinculoValido(v) {
  const m = /^([vm]):(\d{1,12})$/.exec(String(v ?? ""));
  if (!m) return null;
  const id = Number(m[2]);
  return id > 0 && Number.isSafeInteger(id) ? { modulo: m[1] === "v" ? "vehiculo" : "maquina", id } : null;
}

/** El origen_id del gasto unido a un arreglo: "ga00000000000c" (compatible con los gastos: g + 12 hexadecimales). */
export function grupoDeVinculo({ modulo, id }) {
  const hex = Number(id).toString(16);
  if (!PREFIJO[modulo] || hex.length > 11) return null;
  return `g${PREFIJO[modulo]}${hex.padStart(11, "0")}`;
}

/** Al revés: de qué arreglo salió un gasto (o null si se cargó suelto). */
export function vinculoDeGrupo(origenId) {
  const m = /^g([ab])([0-9a-f]{11})(-p)?$/.exec(String(origenId ?? ""));
  if (!m) return null;
  return { modulo: MODULO[m[1]], id: parseInt(m[2], 16) };
}

const nombreVehiculo = (v) => txt([v?.marca, v?.modelo].filter(Boolean).join(" ") || "Vehículo", 80) + (v?.patente ? ` ${String(v.patente).toUpperCase()}` : "");
const nombreMaquina = (m) => txt(m ? `${m.codigo ? `${m.codigo} · ` : ""}${m.nombre || ""}` : "Máquina", 100);
const QUE = { service: "Service", reparacion: "Reparación", arreglo: "Arreglo" };

/** Lo guardado en config_sistema → { "v:12": { at, por } } (solo vínculos válidos). */
export function leerQuitados(valor) {
  const out = {};
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return out;
  for (const [k, v] of Object.entries(valor)) if (vinculoValido(k)) out[k] = { at: txt(v?.at, 40) || null, por: txt(v?.por, 120) || null };
  return out;
}

/** Suma o saca un vínculo de la lista de quitados (los más viejos se van si pasa de 1000). */
export function cambiarQuitados(valor, vinculo, quitar, { at, por } = {}) {
  const lista = leerQuitados(valor);
  delete lista[vinculo];
  if (quitar) lista[vinculo] = { at: at || null, por: por || null };
  const claves = Object.keys(lista);
  return Object.fromEntries(claves.slice(Math.max(0, claves.length - MAX_QUITADOS)).map((k) => [k, lista[k]]));
}

/**
 * Los costos de Flota y Maquinaria que todavía no están en Finanzas (y cuántos ya).
 * Los que el Dueño marcó "Ya está cargado" van aparte, en quitados.
 * @returns {{ pendientes: object[], quitados: object[], cargados: { n: number, total: number } }}
 */
export function costosMantenimiento({ mantenimientos = [], fallas = [], vehiculos = [], maquinas = [], ops = [], quitados = {} }) {
  const ya = new Set();
  let n = 0;
  let total = 0;
  for (const o of ops) {
    if (o.anulada_at || String(o.origen_id || "").endsWith("-p")) continue;
    const v = vinculoDeGrupo(o.origen_id);
    if (!v) continue;
    ya.add(`${v.modulo}:${v.id}`);
    n += 1;
    total += Number(o.total_ars ?? o.total) || 0;
  }
  const veh = new Map(vehiculos.map((v) => [v.id, v]));
  const maq = new Map(maquinas.map((m) => [m.id, m]));
  const pendientes = [
    ...mantenimientos.filter((m) => Number(m.costo) > 0 && !ya.has(`vehiculo:${m.id}`)).map((m) => ({
      vinculo: `v:${m.id}`, modulo: "vehiculo", fecha: m.fecha, costo: centavos(m.costo),
      titulo: `🚚 ${QUE[m.tipo] || "Mantenimiento"} · ${nombreVehiculo(veh.get(m.vehiculo_id))}`,
      detalle: txt(m.detalle, 300), taller: m.donde === "interno" ? "" : txt(m.taller, 120), factura_url: m.factura_url || null,
    })),
    ...fallas.filter((f) => f.estado === "resuelta" && Number(f.costo) > 0 && !ya.has(`maquina:${f.id}`)).map((f) => ({
      vinculo: `m:${f.id}`, modulo: "maquina", fecha: String(f.cerrado_at || f.created_at || "").slice(0, 10), costo: centavos(f.costo),
      titulo: `⚙ Falla · ${nombreMaquina(maq.get(f.maquina_id))}`,
      detalle: txt([f.descripcion, f.detalle].filter(Boolean).join(": "), 300), taller: "", factura_url: f.factura_url || null,
    })),
  ].filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.fecha)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const q = quitados || {};
  return {
    pendientes: pendientes.filter((p) => !q[p.vinculo]),
    quitados: pendientes.filter((p) => q[p.vinculo]).map((p) => ({ ...p, quitado: q[p.vinculo] })),
    cargados: { n, total: centavos(total) },
  };
}

/**
 * El formulario de gasto ya lleno para un costo de mantenimiento: tipo (de
 * logística para vehículos, de mantenimiento para máquinas), su cuenta, el
 * importe, la fecha, el detalle y el taller como proveedor si ya está.
 */
export function gastoDeCosto(item, { tipos = [], proveedores = [] } = {}) {
  const vivo = (codigo) => tipos.find((t) => t.codigo === codigo && t.activo !== false);
  const tipo = vivo(item.modulo === "vehiculo" ? TIPO_VEHICULO : TIPO_MAQUINA) || vivo(TIPO_MAQUINA) || vivo("OTROS GASTOS") || null;
  const clave = item.taller ? clavePersona(item.taller) : "";
  const prov = clave ? proveedores.find((p) => p.activo !== false && clavePersona(p.nombre) === clave) : null;
  return {
    vinculo: item.vinculo,
    tipo: tipo?.codigo || "", cuenta_gasto: tipo?.cuenta_debe || "",
    con_factura: false, fecha_factura: item.fecha, mes: item.fecha.slice(0, 7),
    neto: String(item.costo).replace(".", ","),
    proveedor_id: prov ? String(prov.id) : "",
    descripcion: txt(`${item.titulo.replace(/^\S+\s/, "")}${item.detalle ? ` · ${item.detalle}` : ""}${item.taller && !prov ? ` · ${item.taller}` : ""}`, 300),
  };
}

/* ─── Stock ───────────────────────────────────────────────────────────── */

/** Las cuentas de bienes de cambio (materias primas, mercaderías…): 01.01.04 del plan. */
export const cuentasBienesDeCambio = (cuentas = []) => cuentas.filter((c) => /^01\.01\.04/.test(String(c.codigo || "")));

/**
 * El stock valorizado y el saldo contable de los bienes de cambio.
 * @returns {{ valorizado, articulos, sin_precio, por_familia: { familia, valor }[], contable, cuentas: { codigo, nombre, saldo }[], diferencia }}
 */
export function stockValorizado({ articulos = [], cuentas = [], ops = [] }) {
  let valorizado = 0;
  let conStock = 0;
  let sinPrecio = 0;
  const familias = new Map();
  for (const a of articulos) {
    if (a.activo === false) continue;
    const stock = Number(a.stock) || 0;
    if (stock <= 0) continue;
    conStock += 1;
    const precio = Number(a.ultimo_precio);
    if (!(precio > 0)) { sinPrecio += 1; continue; }
    const valor = stock * precio;
    valorizado += valor;
    const fam = txt(a.familia || a.division, 80) || "Sin familia";
    familias.set(fam, (familias.get(fam) || 0) + valor);
  }
  const bc = cuentasBienesDeCambio(cuentas);
  const codigos = new Set(bc.map((c) => c.codigo));
  const saldo = new Map();
  for (const o of ops) {
    if (o.anulada_at || o.estado === "para_revisar") continue;
    const imp = Number(o.total_ars ?? o.total) || 0;
    if (codigos.has(o.cuenta_debe)) saldo.set(o.cuenta_debe, (saldo.get(o.cuenta_debe) || 0) + imp);
    if (codigos.has(o.cuenta_haber)) saldo.set(o.cuenta_haber, (saldo.get(o.cuenta_haber) || 0) - imp);
  }
  const porCuenta = bc.map((c) => ({ codigo: c.codigo, nombre: c.nombre, saldo: centavos(saldo.get(c.codigo)) })).filter((c) => Math.abs(c.saldo) >= 0.01);
  const contable = centavos(porCuenta.reduce((s, c) => s + c.saldo, 0));
  return {
    valorizado: centavos(valorizado), articulos: conStock, sin_precio: sinPrecio,
    por_familia: [...familias].map(([familia, valor]) => ({ familia, valor: centavos(valor) })).sort((a, b) => b.valor - a.valor),
    contable, cuentas: porCuenta, diferencia: centavos(valorizado - contable),
  };
}
