// app/lib/finanzasMiCaja.js — Finanzas, parte F3b: Mi caja (migración 176).
// Cada responsable de una caja (fin_tesoreria.responsable_id) carga desde el
// celular lo que gastó y la plata que recibió.
//
//   - El dueño elige en Cajas y bancos qué tipos de operación se ofrecen
//     (config_sistema finanzas_mi_caja = { gastos: [códigos], ingresos: [códigos] }).
//     El responsable ve el nombre del tipo; la cuenta la pone el tipo.
//   - Un gasto: la cuenta del tipo al debe y la caja al haber. Plata recibida:
//     la caja al debe y la cuenta del tipo al haber.
//   - Entra a la caja en el momento como "para revisar" (origen mi_caja). El
//     dueño la confirma, le cambia el tipo o la anula. Lo que carga el propio
//     dueño entra confirmado.
//   - Foto del ticket opcional (comprobante_url, subida por /api/upload).
import { movimientoCaja } from "./finanzasOperaciones";
import { leyendaTipo } from "./finanzasTipos";

export const CLAVE_MI_CAJA = "finanzas_mi_caja";
export const ORIGEN_MI_CAJA = "mi_caja";
export const MAX_MOVIMIENTOS_MI_CAJA = 50;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const lista = (v) => [...new Set((Array.isArray(v) ? v : []).map((c) => txt(c, 40)).filter(Boolean))].slice(0, 60);

/** La configuración guardada, limpia. */
export function leerConfigMiCaja(valor) {
  return { gastos: lista(valor?.gastos), ingresos: lista(valor?.ingresos) };
}

/** Los tipos que sirven para cada lado: el gasto necesita la cuenta al debe; lo recibido, al haber. */
export function tiposParaMiCaja(tipos = []) {
  const vivos = tipos.filter((t) => t.activo !== false);
  return {
    gastos: vivos.filter((t) => t.cuenta_debe),
    ingresos: vivos.filter((t) => t.cuenta_haber),
  };
}

/** Lo que ve el responsable: nombre del tipo y la cuenta que usa. */
export function conceptosMiCaja(config, tipos = []) {
  const c = leerConfigMiCaja(config);
  const sirven = tiposParaMiCaja(tipos);
  const armar = (codigos, de, lado) => codigos
    .map((codigo) => de.find((t) => t.codigo === codigo))
    .filter(Boolean)
    .map((t) => ({ codigo: t.codigo, nombre: txt(t.nombre, 80) || t.codigo, cuenta: t[lado], leyenda: leyendaTipo(t) }));
  return { gastos: armar(c.gastos, sirven.gastos, "cuenta_debe"), ingresos: armar(c.ingresos, sirven.ingresos, "cuenta_haber") };
}

/** ¿Es una foto subida por /api/upload para esta empresa? */
export function comprobanteValido(url, { supabaseUrl, empresaId }) {
  if (!url) return true;
  if (typeof url !== "string" || url.length > 500 || !supabaseUrl || !empresaId) return false;
  const base = `${supabaseUrl}/storage/v1/object/public/reportes-obra/${empresaId}/`;
  return url.startsWith(base) && /^[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/i.test(url.slice(base.length));
}

/**
 * Un gasto o plata recibida en Mi caja.
 * @param {{ clase: "gasto"|"ingreso", concepto: string, importe: any, fecha: string, descripcion?: string, comprobante_url?: string, tipo_cambio?: any }} f
 * @param {{ caja: any, conceptos: { gastos: any[], ingresos: any[] }, confirmada?: boolean, supabaseUrl?: string, empresaId?: string, hoy?: string }} ctx
 * @returns {{ op?: object, errores: string[] }}
 */
export function validarMovimientoMiCaja(f = {}, { caja, conceptos, confirmada = false, supabaseUrl, empresaId, hoy } = {}) {
  const errores = [];
  if (!caja || caja.activa === false) errores.push("Esa caja no está a tu cargo");
  const gasto = f.clase === "gasto";
  if (!gasto && f.clase !== "ingreso") errores.push("Elegí si es un gasto o plata que recibiste");
  const concepto = (gasto ? conceptos?.gastos : conceptos?.ingresos)?.find((c) => c.codigo === f.concepto);
  if (!concepto) errores.push(gasto ? "Elegí en qué gastaste" : "Elegí de dónde vino la plata");
  const importe = centavos(f.importe);
  if (!(importe > 0) || importe >= 1e11) errores.push("El importe tiene que ser mayor a cero");
  if (!FECHA.test(String(f.fecha || ""))) errores.push("Falta la fecha");
  else if (hoy && f.fecha > hoy) errores.push("La fecha no puede ser más adelante que hoy");
  const usd = caja?.moneda === "USD";
  const tc = usd ? Number(f.tipo_cambio) : null;
  if (usd && !(tc > 0)) errores.push("En dólares falta el tipo de cambio");
  const comprobante = txt(f.comprobante_url, 500) || null;
  if (!comprobanteValido(comprobante, { supabaseUrl, empresaId })) errores.push("La foto del ticket no es válida: sacala de nuevo");
  if (errores.length) return { errores };
  const nota = txt(f.descripcion, 300);
  return {
    errores,
    op: {
      fecha: f.fecha, tipo: concepto.codigo, proveedor_id: null, entidad: null,
      neto: importe, iva: 0, otros_impuestos: 0, total: importe, moneda: usd ? "USD" : "ARS", tipo_cambio: tc, total_ars: usd ? centavos(importe * tc) : importe,
      cuenta_debe: gasto ? concepto.cuenta : caja.cuenta,
      cuenta_haber: gasto ? caja.cuenta : concepto.cuenta,
      descripcion: txt(`${concepto.nombre} · ${caja.nombre}${nota ? ` · ${nota}` : ""}`, 500),
      origen: ORIGEN_MI_CAJA, estado: confirmada ? "confirmada" : "para_revisar",
      comprobante_url: comprobante,
    },
  };
}

/** Lo que le toca al tipo nuevo cuando el dueño lo cambia: la caja queda donde estaba. */
export function cambioDeTipoMiCaja(op, tipo, cuentasTesoreria = []) {
  const cajaAlDebe = cuentasTesoreria.includes(op.cuenta_debe);
  if (cajaAlDebe) return tipo.cuenta_haber ? { tipo: tipo.codigo, cuenta_haber: tipo.cuenta_haber } : null;
  return tipo.cuenta_debe ? { tipo: tipo.codigo, cuenta_debe: tipo.cuenta_debe } : null;
}

/** Saldo de una caja y sus últimos movimientos (el más nuevo primero), para el responsable. */
export function resumenMiCaja(ops = [], caja, nombresTipo = new Map()) {
  let saldo = 0;
  let revisar = 0;
  const movs = [];
  for (const op of ops) {
    const m = movimientoCaja(op, caja);
    if (!m) continue;
    saldo += m;
    if (op.estado === "para_revisar") revisar++;
    movs.push({
      id: op.id, fecha: op.fecha, concepto: nombresTipo.get(op.tipo) || op.tipo, descripcion: op.descripcion || "",
      entra: m > 0 ? centavos(m) : 0, sale: m < 0 ? centavos(-m) : 0, estado: op.estado, comprobante_url: op.comprobante_url || null,
      propia: op.origen === ORIGEN_MI_CAJA,
    });
  }
  movs.sort((a, b) => (a.fecha === b.fecha ? Number(b.id) - Number(a.id) : a.fecha < b.fecha ? 1 : -1));
  return { cuenta: caja.cuenta, nombre: caja.nombre, moneda: caja.moneda === "USD" ? "USD" : "ARS", saldo: centavos(saldo), para_revisar: revisar, movimientos: movs.slice(0, MAX_MOVIMIENTOS_MI_CAJA) };
}

/** Las cargadas desde Mi caja que esperan al dueño, la más vieja primero. */
export const paraRevisarMiCaja = (ops = []) => ops
  .filter((o) => o.origen === ORIGEN_MI_CAJA && o.estado === "para_revisar" && !o.anulada_at)
  .sort((a, b) => (a.fecha === b.fecha ? Number(a.id) - Number(b.id) : a.fecha < b.fecha ? -1 : 1));

// ── Mi caja fácil (parte 10 del plan del 11/11) ─────────────────────────────

/** Los conceptos con los más usados en esta caja primero (empate: el orden del dueño). */
export function conceptosPorUso(lista = [], movimientos = []) {
  const usos = new Map();
  for (const m of movimientos) {
    const k = String(m?.concepto || "");
    if (k) usos.set(k, (usos.get(k) || 0) + 1);
  }
  return lista
    .map((c, i) => ({ c, i, n: usos.get(c.nombre) || usos.get(c.codigo) || 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.c);
}

/** El día anterior a una fecha AAAA-MM-DD. */
export function ayerDe(hoy) {
  const d = new Date(`${hoy}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return hoy;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const PROMPT_TICKET = `Leés la foto de un ticket, factura o recibo de un gasto chico que pagó un empleado de una fábrica de muebles en Argentina (nafta, peaje, ferretería, comida, estacionamiento) y devolvés:
- importe: el total pagado, como número (sin el signo $). 0 si no se ve.
- fecha: la fecha del ticket en formato AAAA-MM-DD. Vacío si no se ve.
- comercio: el nombre del comercio o de quien lo emite, en pocas palabras. Vacío si no se ve.
- concepto: el código del concepto que mejor corresponde, de la lista que se te da. Vacío si ninguno corresponde.`;

/** El esquema de la lectura del ticket, con los conceptos de la caja como opciones. */
export function esquemaTicket(conceptos = []) {
  const codigos = [...new Set(conceptos.map((c) => String(c.codigo)).filter(Boolean))].slice(0, 100);
  return {
    type: "object",
    additionalProperties: false,
    required: ["importe", "fecha", "comercio", "concepto"],
    properties: {
      importe: { type: "number" },
      fecha: { type: "string" },
      comercio: { type: "string" },
      concepto: { type: "string", enum: [...codigos, ""] },
    },
  };
}

/** Lo que leyó la IA, listo para llenar el formulario (solo lo que tiene sentido). */
export function propuestaTicket(lectura = {}, { conceptos = [], hoy } = {}) {
  const importe = Number(lectura?.importe);
  const fecha = String(lectura?.fecha || "");
  const dia = new Date(`${fecha}T12:00:00Z`);
  const fechaOk = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(dia.getTime()) && dia.toISOString().slice(0, 10) === fecha
    && (!hoy || (fecha <= hoy && fecha >= `${Number(hoy.slice(0, 4)) - 1}${hoy.slice(4)}`));
  const concepto = conceptos.some((c) => c.codigo === lectura?.concepto) ? lectura.concepto : "";
  return {
    importe: Number.isFinite(importe) && importe > 0 && importe < 1e10 ? centavos(importe) : null,
    fecha: fechaOk ? fecha : null,
    concepto: concepto || null,
    descripcion: txt(lectura?.comercio, 120) || null,
  };
}
