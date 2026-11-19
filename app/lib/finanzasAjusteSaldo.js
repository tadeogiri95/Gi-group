// app/lib/finanzasAjusteSaldo.js — Ajuste de saldo de un cliente o un
// proveedor (pedido de Tadeo 19/11, punto 15 del plan). Sin migración.
//
// Cuando la cuenta corriente de alguien no da lo que tiene que dar (una
// diferencia vieja, un redondeo, algo que nunca se cargó), se deja en el
// saldo correcto con un asiento contra "Ajuste de resultados de ejercicios
// anteriores" (patrimonio neto, 03.03.01). Así:
//   - no toca ninguna caja ni banco (no es plata que entra o sale);
//   - no cambia el resultado del período (la cuenta es del patrimonio, no
//     está en el estado de resultados);
//   - queda en la cuenta corriente, con el motivo, y se puede anular.
// Si el plan de cuentas no tiene la cuenta, Gypi la crea (03.03.01.001.001 o
// el primer código libre de ese rubro).
//
// Cliente (Deudores por Ventas): saldo = lo que nos debe.
//   sube → Debe Deudores / Haber Ajuste;  baja → Debe Ajuste / Haber Deudores
// Proveedor (Proveedores): saldo = lo que le debemos.
//   sube → Debe Ajuste / Haber Proveedores;  baja → Debe Proveedores / Haber Ajuste

export const ORIGEN_AJUSTE_SALDO = "ajuste_saldo";
export const TIPO_AJUSTE_SALDO = "AJUSTE DE SALDO";
export const NOMBRE_CUENTA_AJUSTE = "Ajuste de resultados de ejercicios anteriores";
export const RUBRO_AJUSTE = "03.03.01";
export const MAX_MOTIVO_AJUSTE = 300;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const CUENTA_AJUSTE_ANTERIORES = /^ajuste (de )?resultados? (de )?ejercicios? anteriores$/;

/** El código de la cuenta "Ajuste de resultados de ejercicios anteriores", o "". */
export function cuentaAjusteAnteriores(cuentas = []) {
  const c = cuentas.find((x) => x.activa !== false && CUENTA_AJUSTE_ANTERIORES.test(sinTildes(x.nombre)));
  return c?.codigo || "";
}

/** La cuenta para sumar al plan: primer código libre de 03.03.01.001.NNN. */
export function cuentaAjusteNueva(cuentas = []) {
  const usados = new Set(cuentas.map((c) => String(c.codigo || "").trim()));
  let n = 1;
  while (usados.has(`${RUBRO_AJUSTE}.001.${String(n).padStart(3, "0")}`) && n < 999) n++;
  return { codigo: `${RUBRO_AJUSTE}.001.${String(n).padStart(3, "0")}`, nombre: NOMBRE_CUENTA_AJUSTE, rubro: "PATRIMONIO NETO", naturaleza: "H", activa: true };
}

/** Lee un importe escrito ("1.234,56", "-500", "0"); null si no es un número. */
export function leerImporte(v) {
  if (typeof v === "number") return Number.isFinite(v) ? centavos(v) : null;
  let s = String(v ?? "").replace(/\s|\$/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? centavos(n) : null;
}

/**
 * La operación del ajuste.
 * @param {{ lado: "cliente"|"proveedor", clave: string, nombre: string, saldoActual: number, saldoNuevo: any, fecha: string, motivo: string }} d
 *   clave: "c<id>" / "p<id>" de la lista, o "e<nombre>" si no está en la lista.
 * @param {{ cuentaCc: string, cuentaAjuste: string }} cuentas
 * @returns {{ op?: object, diferencia?: number, error?: string }}
 */
export function operacionAjusteSaldo(d = {}, { cuentaCc, cuentaAjuste } = {}) {
  const cliente = d.lado === "cliente";
  if (!cliente && d.lado !== "proveedor") return { error: "¿De un cliente o de un proveedor?" };
  if (!cuentaCc) return { error: cliente ? "Falta la cuenta \"Deudores por Ventas\" en el plan de cuentas" : "Falta la cuenta \"Proveedores\" en el plan de cuentas" };
  if (!cuentaAjuste) return { error: `Falta la cuenta "${NOMBRE_CUENTA_AJUSTE}"` };
  const nuevo = leerImporte(d.saldoNuevo);
  if (nuevo === null) return { error: "Escribí en cuánto tiene que quedar el saldo" };
  if (!FECHA.test(String(d.fecha || ""))) return { error: "La fecha no es válida" };
  const motivo = txt(d.motivo, MAX_MOTIVO_AJUSTE);
  if (motivo.length < 3) return { error: "Escribí el motivo del ajuste (queda en la cuenta corriente)" };
  const clave = String(d.clave || "");
  const m = /^([cpe])(.+)$/.exec(clave);
  if (!m || (m[1] === "c" && !cliente) || (m[1] === "p" && cliente)) return { error: cliente ? "No encontré ese cliente" : "No encontré ese proveedor" };
  const id = m[1] === "e" ? null : Number(m[2]);
  if (m[1] !== "e" && !Number.isInteger(id)) return { error: "No encontré a quién ajustar" };
  const nombre = txt(d.nombre, 120);
  if (m[1] === "e" && !nombre) return { error: "Falta el nombre" };
  const diferencia = centavos(nuevo - centavos(d.saldoActual));
  if (Math.abs(diferencia) < 0.01) return { error: "El saldo ya es ese: no hay nada que ajustar" };
  const total = Math.abs(diferencia);
  const sube = diferencia > 0;
  // Cliente: sube lo que nos debe = Deudores al debe. Proveedor: sube lo que le debemos = Proveedores al haber.
  const ccAlDebe = cliente ? sube : !sube;
  return {
    diferencia,
    op: {
      fecha: d.fecha, tipo: TIPO_AJUSTE_SALDO,
      proveedor_id: !cliente && id ? id : null,
      ...(cliente && id ? { cliente_id: id } : {}),
      entidad: nombre || null,
      proyecto_id: null, centro_costo: null,
      neto: total, iva: 0, otros_impuestos: 0, total, moneda: "ARS", tipo_cambio: null, total_ars: total,
      cuenta_debe: ccAlDebe ? cuentaCc : cuentaAjuste,
      cuenta_haber: ccAlDebe ? cuentaAjuste : cuentaCc,
      descripcion: `Ajuste de saldo · ${motivo}`.slice(0, 500),
      referencia: null, origen: ORIGEN_AJUSTE_SALDO, origen_id: clave.slice(0, 60), estado: "confirmada",
    },
  };
}
