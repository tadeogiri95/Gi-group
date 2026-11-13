// app/lib/finanzasMiCaja.js — Finanzas, parte F3b: Mi caja (migración 176).
// Cada responsable de una caja (fin_tesoreria.responsable_id) carga desde el
// celular lo que gastó y la plata que recibió.
//
//   - Se ofrecen todos los tipos de gasto y de plata que entra (11/11, pedido
//     de Tadeo: antes era una lista que armaba el dueño y, al pasar a los tipos
//     nuevos, quedaron solo los de desarrollismo). El dueño puede esconder los
//     que no quiere en Cajas y bancos (config_sistema finanzas_mi_caja =
//     { ocultos: { gastos: [códigos], ingresos: [códigos] } }). La lista vieja
//     ({ gastos, ingresos }) ya no se usa. El responsable ve el nombre del
//     tipo; la cuenta la pone el tipo.
//   - Un gasto: la cuenta del tipo al debe y la caja al haber. Plata recibida:
//     la caja al debe y la cuenta del tipo al haber.
//   - Entra a la caja en el momento como "para revisar" (origen mi_caja). El
//     dueño la confirma, le cambia el tipo o la anula. Lo que carga el propio
//     dueño entra confirmado.
//   - Foto del ticket opcional (comprobante_url, subida por /api/upload). La
//     IA lee el comercio (y lo une con un proveedor de la lista por CUIT o
//     nombre), el número de factura, la fecha, el detalle y el IVA; el
//     empleado lo ve todo lleno y lo puede corregir. El número va a
//     referencia con el mismo formato que Cargar un gasto, así el mismo
//     comprobante no entra dos veces (finanzasComprobantes).
//   - 13/11: plata que entra contra Deudores por Ventas o Anticipos de
//     clientes (el cobro a un cliente) pide el cliente y, si se quiere, la
//     OT: queda en la cuenta corriente del cliente en ese momento.
import { movimientoCaja, separaIva } from "./finanzasOperaciones";
import { LETRAS, proveedorDeFactura, textoComprobante } from "./finanzasGastos";
import { TIPOS_NUEVOS, claveTipo, leyendaTipo, lineaDeLista } from "./finanzasTipos";
import { clienteDeOt, cuentasDeCliente, indiceClientes } from "./finanzasClientes";

export const CLAVE_MI_CAJA = "finanzas_mi_caja";
export const ORIGEN_MI_CAJA = "mi_caja";
export const MAX_MOVIMIENTOS_MI_CAJA = 50;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const lista = (v) => [...new Set((Array.isArray(v) ? v : []).map((c) => txt(c, 40)).filter(Boolean))].slice(0, 60);

/** La configuración guardada, limpia: los tipos que el dueño escondió. */
export function leerConfigMiCaja(valor) {
  const o = valor?.ocultos;
  return { ocultos: { gastos: lista(o?.gastos), ingresos: lista(o?.ingresos) } };
}

// Qué tipos son un gasto o plata que entra, por su renglón del flujo. Los de
// tesorería (pases entre cajas, plazo fijo, dólares), las ventas y los
// ajustes contables no se cargan desde una caja chica.
const LINEA_GASTO = /^(EGR_|INV_|DIVIDENDOS$)/;
const LINEA_INGRESO = /^(ING_|APORTES_SOCIOS$|VTA_|EGR_FINANCIEROS$)/;
const GASTO_SIN_LINEA = new Set(["INVERSIONES DESARROLLISMO"]);
// Un tipo propio de la empresa (que no está en la lista): por las palabras.
const NO_CAJA = /TESORER|TRANSFER|PLAZO FIJO|\bFCI\b|TITULO|DOLAR|VENTA|APERTURA|SALDO INICIAL|RECLASIF|AMORTIZ|DEPREC|COMPENSAC|RECHAZ|NC CLIENTE/;
const PALABRAS_GASTO = /GASTO|COMPRA|PAGO|IMPUEST|SUELDO|SERVICIO|HONORARIO|VIATICO|COMBUSTIBLE|INVERSION|MANTENIMIENTO|FLETE|INSUMO|EGRESO|RETIRO/;
const PALABRAS_INGRESO = /COBRO|INGRESO|APORTE|RENDIMIENTO|ANTICIPO|REINTEGRO|DEVOLUCION/;
const ORDEN = new Map(TIPOS_NUEVOS.map((t, i) => [claveTipo(t.codigo), i]));

function ladosDe(t) {
  const k = claveTipo(t.codigo);
  const linea = lineaDeLista(t.codigo);
  if (linea || ORDEN.has(k)) return { gasto: LINEA_GASTO.test(linea || "") || GASTO_SIN_LINEA.has(k), ingreso: LINEA_INGRESO.test(linea || "") };
  const texto = claveTipo(`${t.codigo} ${t.grupo || ""} ${t.nombre || ""}`);
  if (NO_CAJA.test(texto)) return { gasto: false, ingreso: false };
  return { gasto: PALABRAS_GASTO.test(texto), ingreso: PALABRAS_INGRESO.test(texto) };
}

/** Los tipos que sirven para cada lado: el gasto necesita la cuenta al debe; lo recibido, al haber. */
export function tiposParaMiCaja(tipos = []) {
  const vivos = tipos
    .filter((t) => t && t.activo !== false && t.codigo)
    .map((t) => ({ t, lados: ladosDe(t), orden: ORDEN.get(claveTipo(t.codigo)) ?? 999 }))
    .sort((a, b) => a.orden - b.orden || String(a.t.nombre || a.t.codigo).localeCompare(String(b.t.nombre || b.t.codigo), "es"));
  return {
    gastos: vivos.filter((x) => x.lados.gasto && x.t.cuenta_debe).map((x) => x.t),
    ingresos: vivos.filter((x) => x.lados.ingreso && x.t.cuenta_haber).map((x) => x.t),
  };
}

/** "INVERSIÓN" → "Inversión": el grupo del tipo, para ordenar la lista larga. */
const grupoDe = (t) => {
  const g = txt(t.grupo || TIPOS_NUEVOS.find((n) => claveTipo(n.codigo) === claveTipo(t.codigo))?.grupo, 40).toLowerCase();
  return g ? g[0].toUpperCase() + g.slice(1) : "Otros";
};

/** Lo que ve el responsable: todos los tipos de gasto y de plata que entra, menos los que escondió el dueño. */
export function conceptosMiCaja(config, tipos = [], cuentas = []) {
  const { ocultos } = leerConfigMiCaja(config);
  const sirven = tiposParaMiCaja(tipos);
  const deCliente = cuentasDeCliente(cuentas);
  const armar = (de, lado, fuera) => de
    .filter((t) => !fuera.includes(t.codigo))
    .map((t) => ({
      codigo: t.codigo, nombre: txt(t.nombre, 80) || t.codigo, cuenta: t[lado], leyenda: leyendaTipo(t), grupo: grupoDe(t),
      ...(deCliente.has(t[lado]) ? { pide_cliente: true } : {}),
    }));
  return { gastos: armar(sirven.gastos, "cuenta_debe", ocultos.gastos), ingresos: armar(sirven.ingresos, "cuenta_haber", ocultos.ingresos) };
}

/** ¿Es una foto subida por /api/upload para esta empresa? */
export function comprobanteValido(url, { supabaseUrl, empresaId }) {
  if (!url) return true;
  if (typeof url !== "string" || url.length > 500 || !supabaseUrl || !empresaId) return false;
  const base = `${supabaseUrl}/storage/v1/object/public/reportes-obra/${empresaId}/`;
  // 13/11 (parte 4): también PDF, para los comprobantes de cualquier movimiento
  return url.startsWith(base) && /^[0-9a-f-]{36}\.(png|jpe?g|webp|gif|pdf)$/i.test(url.slice(base.length));
}

/**
 * Un gasto o plata recibida en Mi caja.
 * @param {{ clase: "gasto"|"ingreso", concepto: string, importe: any, fecha: string, descripcion?: string, comprobante_url?: string, tipo_cambio?: any,
 *   comercio?: string, cuit?: string, proveedor_id?: any, letra?: string, punto_venta?: string, numero?: string, neto?: any, iva?: any, otros_impuestos?: any }} f
 * @param {{ caja: any, conceptos: { gastos: any[], ingresos: any[] }, confirmada?: boolean, supabaseUrl?: string, empresaId?: string, hoy?: string, proveedores?: object[] }} ctx
 * @returns {{ op?: object, errores: string[] }}
 */
export function validarMovimientoMiCaja(f = {}, { caja, conceptos, confirmada = false, supabaseUrl, empresaId, hoy, proveedores = [], clientes = [], proyectos = [] } = {}) {
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
  // 13/11: un cobro a un cliente dice de qué cliente es (y, si se quiere, de qué OT)
  const cliente = concepto?.pide_cliente && f.cliente_id ? clientes.find((c) => Number(c.id) === Number(f.cliente_id)) || null : null;
  if (concepto?.pide_cliente && !cliente) errores.push(f.cliente_id ? "Ese cliente no está en la lista" : "Elegí de qué cliente es la plata");
  const proyecto = f.proyecto_id ? proyectos.find((p) => Number(p.id) === Number(f.proyecto_id)) || null : null;
  if (f.proyecto_id && !proyecto) errores.push("Esa OT no está en la lista");
  // Manda el cliente de la OT, igual que en Cobrar a un cliente
  if (proyecto && cliente) {
    const indice = indiceClientes(clientes);
    const deOt = clienteDeOt(proyecto, clientes, indice);
    if (deOt && deOt !== indice.destino(cliente.id)) {
      const nombre = clientes.find((c) => Number(c.id) === deOt)?.nombre || "otro cliente";
      errores.push(`La OT ${proyecto.ot} es de ${nombre}: elegí ese cliente o sacá la OT`);
    }
  }
  const cuit = soloDigitos(f.cuit);
  if (cuit && cuit.length !== 11) errores.push("El CUIT tiene que tener 11 números");
  if (errores.length) return { errores };
  const nota = txt(f.descripcion, 300);
  const comercio = txt(f.comercio, 120);
  // El proveedor: el que se eligió (si es de la empresa), o el de la lista con ese CUIT o nombre
  const elegido = f.proveedor_id ? proveedores.find((p) => Number(p.id) === Number(f.proveedor_id)) : null;
  const proveedor = elegido || (comercio || cuit ? proveedorDeFactura({ emisor: comercio, cuit }, proveedores) : null);
  // 11/11: en sueldos, impuestos o pagos no se separa el IVA
  const imp = separaIva(concepto) ? importesTicket(f, importe) : { neto: importe, iva: 0, otros: 0, letra: importesTicket(f, importe).letra };
  const referencia = referenciaTicket(f);
  const cuitTexto = !proveedor && cuit ? `CUIT ${cuitFormato(cuit)}` : "";
  return {
    errores,
    op: {
      fecha: f.fecha, tipo: concepto.codigo, proveedor_id: proveedor && !cliente ? Number(proveedor.id) : null,
      entidad: cliente ? txt(cliente.nombre, 120) : proveedor ? null : comercio || null,
      ...(cliente ? { cliente_id: Number(cliente.id) } : {}),
      ...(proyecto ? { proyecto_id: Number(proyecto.id) } : {}),
      neto: imp.neto, iva: imp.iva, otros_impuestos: imp.otros, total: importe, moneda: usd ? "USD" : "ARS", tipo_cambio: tc, total_ars: usd ? centavos(importe * tc) : importe,
      cuenta_debe: gasto ? concepto.cuenta : caja.cuenta,
      cuenta_haber: gasto ? caja.cuenta : concepto.cuenta,
      descripcion: txt([concepto.nombre, caja.nombre, cliente?.nombre || proveedor?.nombre || comercio, proyecto?.ot ? `OT ${proyecto.ot}` : "", cuitTexto, referencia ? (imp.letra ? `Factura ${referencia}` : `Comprobante ${referencia}`) : "", nota].filter(Boolean).join(" · "), 500),
      referencia,
      origen: ORIGEN_MI_CAJA, estado: confirmada ? "confirmada" : "para_revisar",
      comprobante_url: comprobante,
    },
  };
}

const soloDigitos = (v) => String(v ?? "").replace(/\D/g, "");
const cuitFormato = (c) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);

/**
 * El número del comprobante como lo guarda Cargar un gasto: "A 00003-00012345"
 * con letra; sin letra, el número tal cual. null si no hay número.
 */
export function referenciaTicket(f = {}) {
  const numero = soloDigitos(f.numero).slice(-8);
  if (!numero) return null;
  const letra = LETRAS.includes(f.letra) ? f.letra : "";
  if (letra) return textoComprobante({ con_factura: true, letra, punto_venta: soloDigitos(f.punto_venta).slice(-5), numero }).replace(/^Factura /, "");
  const pv = soloDigitos(f.punto_venta).slice(-5);
  return pv ? `${pv.padStart(5, "0")}-${numero.padStart(8, "0")}` : numero;
}

/**
 * Neto, IVA y percepciones del ticket. Solo una factura A (o M) discrimina IVA,
 * y solo si cierran con el total: si alguien corrigió el importe, todo va al neto.
 */
export function importesTicket(f = {}, total) {
  const letra = LETRAS.includes(f.letra) ? f.letra : "";
  const iva = centavos(f.iva);
  const otros = centavos(f.otros_impuestos);
  const neto = centavos(f.neto);
  const cierra = neto > 0 && iva >= 0 && otros >= 0 && Math.abs(centavos(neto + iva + otros) - total) <= 1;
  if (cierra && (iva === 0 || ["A", "M"].includes(letra))) return { neto: centavos(total - iva - otros), iva, otros, letra };
  return { neto: total, iva: 0, otros: 0, letra };
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

export const PROMPT_TICKET = `Leés la foto de un ticket, factura o recibo de un gasto que pagó un empleado de una fábrica de muebles en Argentina (nafta, peaje, ferretería, insumos, comida, estacionamiento, un repuesto) y devolvés sus datos para registrarlos en la contabilidad:
- importe: el total pagado, como número (sin el signo $). 0 si no se ve.
- fecha: la fecha del ticket o de la factura en formato AAAA-MM-DD. Vacío si no se ve.
- comercio: la razón social o el nombre de quien lo emite (el comercio, no el cliente), en pocas palabras. Vacío si no se ve.
- cuit: el CUIT de quien lo emite, solo los 11 dígitos. Vacío si no se ve.
- letra: la letra de la factura (A, B, C, M, E o X). Vacío si es un ticket o un recibo sin letra.
- punto_venta y numero: el punto de venta y el número del comprobante, solo dígitos (en "0003-00012345": punto_venta "0003", numero "00012345"; en un ticket fiscal, el número de ticket). Vacío si no se ven.
- neto: el importe sin IVA, solo si la factura discrimina IVA (factura A o M). 0 si no lo discrimina.
- iva: la suma de los IVA discriminados (21 %, 10,5 %, 27 %). 0 si no está discriminado.
- otros_impuestos: percepciones, impuestos internos y otros tributos que figuran aparte. 0 si no hay.
- detalle: qué se compró, en pocas palabras (por ejemplo "Nafta súper 40 litros", "Tornillos y tarugos", "Almuerzo 3 personas"). Vacío si no se ve.
- concepto: el código del concepto que mejor corresponde, de la lista que se te da. Vacío si ninguno corresponde.
Usá punto como separador decimal. Si algo no se puede leer, dejalo vacío o en 0; no inventes datos.`;

/** El esquema de la lectura del ticket, con los conceptos de la caja como opciones. */
export function esquemaTicket(conceptos = []) {
  const codigos = [...new Set(conceptos.map((c) => String(c.codigo)).filter(Boolean))].slice(0, 200);
  return {
    type: "object",
    additionalProperties: false,
    required: ["importe", "fecha", "comercio", "cuit", "letra", "punto_venta", "numero", "neto", "iva", "otros_impuestos", "detalle", "concepto"],
    properties: {
      importe: { type: "number" },
      fecha: { type: "string" },
      comercio: { type: "string" },
      cuit: { type: "string" },
      letra: { type: "string", enum: [...LETRAS, ""] },
      punto_venta: { type: "string" },
      numero: { type: "string" },
      neto: { type: "number" },
      iva: { type: "number" },
      otros_impuestos: { type: "number" },
      detalle: { type: "string" },
      concepto: { type: "string", enum: [...codigos, ""] },
    },
  };
}

/** Lo que leyó la IA, listo para llenar el formulario (solo lo que tiene sentido). */
export function propuestaTicket(lectura = {}, { conceptos = [], hoy, proveedores = [] } = {}) {
  const importe = Number(lectura?.importe);
  const fecha = String(lectura?.fecha || "");
  const dia = new Date(`${fecha}T12:00:00Z`);
  const fechaOk = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(dia.getTime()) && dia.toISOString().slice(0, 10) === fecha
    && (!hoy || (fecha <= hoy && fecha >= `${Number(hoy.slice(0, 4)) - 1}${hoy.slice(4)}`));
  const concepto = conceptos.some((c) => c.codigo === lectura?.concepto) ? lectura.concepto : "";
  const total = Number.isFinite(importe) && importe > 0 && importe < 1e10 ? centavos(importe) : null;
  const comercio = txt(lectura?.comercio, 120);
  const cuitDig = soloDigitos(lectura?.cuit);
  const cuit = cuitDig.length === 11 ? cuitFormato(cuitDig) : "";
  const proveedor = comercio || cuit ? proveedorDeFactura({ emisor: comercio, cuit }, proveedores) : null;
  const letra = LETRAS.includes(lectura?.letra) ? lectura.letra : "";
  const numero = soloDigitos(lectura?.numero).slice(-8);
  const imp = total ? importesTicket({ letra, neto: lectura?.neto, iva: lectura?.iva, otros_impuestos: lectura?.otros_impuestos }, total) : { neto: 0, iva: 0, otros: 0 };
  return {
    importe: total,
    fecha: fechaOk ? fecha : null,
    concepto: concepto || null,
    descripcion: txt(lectura?.detalle, 200) || null,
    comercio: proveedor?.nombre || comercio || null,
    cuit: cuit || null,
    proveedor_id: proveedor ? Number(proveedor.id) : null,
    letra: letra || null,
    punto_venta: numero ? soloDigitos(lectura?.punto_venta).slice(-5) || null : null,
    numero: numero || null,
    neto: imp.iva || imp.otros ? imp.neto : null,
    iva: imp.iva || null,
    otros_impuestos: imp.otros || null,
  };
}
