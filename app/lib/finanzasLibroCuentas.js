// app/lib/finanzasLibroCuentas.js — Los 6 cambios de cuentas al libro contable
// (parte 7 del plan del 11/11; Tadeo los aprobó el 11/11 después de hacer su
// copia del libro; propuesta en https://claude.ai/artifact/Q51R5UXPq2NTPYRSiYQyYc).
//
// Gypi no toca el libro directo: manda la lista en /api/finanzas/libro y el
// script del libro la aplica UNA sola vez (versión en las propiedades del
// documento), después de dejar su copia de respaldo de dim_plan_cuentas,
// dim_tipos_op, T-OPERACIONES y CHK_CARGA (hojas que terminan en _bk_cuentas_).
//
//   1. Códigos repetidos: cada cuenta con su código propio (se busca por
//      código Y nombre: si en el libro no está igual, no se toca).
//   2. Terrenos - Valor Costo y Terrenos - Amort.Acum. se sacan (queda
//      Terreno). Solo si ninguna operación las usa.
//   3. Nombres repetidos: la cuenta que hoy no toma ninguna operación cambia
//      de nombre (el libro busca por nombre y toma la primera).
//   4. Cuentas nuevas: Faltantes y Sobrantes de Caja, Provisión SAC A Pagar y
//      Provisión Vacaciones A Pagar.
//   5. Cuentas por defecto de dim_tipos_op: las recomendadas en Gypi (por
//      nombre; el script las pasa a código con el plan ya arreglado). Los
//      renglones viejos de esos tipos sin cuenta escrita quedan con la que
//      tienen hoy (se escribe su nombre antes de cambiar el tipo).
//   6. CHK_CARGA cuenta las operaciones contra Ajuste De Capital que no son de
//      apertura, saldos ni socios.
import { TIPOS_PATRIMONIO, cuentasRecomendadas } from "./finanzasBuenasPracticas";

/** Si cambia la lista, subir la versión: el script la vuelve a aplicar una vez. */
export const VERSION_CAMBIOS_CUENTAS = 1;

/** 1. Cuentas con código repetido → su código propio (todos libres en el libro del 08/11). */
export const RECODIFICAR = [
  { nombre: "BANCO ICBC CTA CTE - Cheques Diferidos", de: "01.01.01.003.003", a: "01.01.01.004.004" },
  { nombre: "BANCO ICBC CTA CTE - E-Cheq", de: "01.01.01.003.003", a: "01.01.01.005.004" },
  { nombre: "BANCO CREDICOOP CTA CTE Especial Dolar - Cheques Diferidos", de: "01.01.01.004.006", a: "01.01.01.004.007" },
  { nombre: "BANCO CREDICOOP CTA CTE Especial Dolar - E-Cheq", de: "01.01.01.005.006", a: "01.01.01.005.007" },
  { nombre: "Compensaciones Saldos A Favor de IVA", de: "01.01.03.155.001", a: "01.01.03.156.001" },
  { nombre: "Equipos - Valor Costo", de: "01.02.02.001.020", a: "01.02.02.001.021" },
  { nombre: "Herramientas - Amort.Acum.", de: "01.02.02.001.020", a: "01.02.02.001.022" },
  { nombre: "Herramientas - Valor Costo", de: "01.02.02.001.020", a: "01.02.02.001.023" },
  { nombre: "Resultado Baja Bien de Uso", de: "04.02.01.001.020", a: "04.02.01.001.063" },
];

/** 2. Se sacan del plan (un terreno no se amortiza y ya está la cuenta Terreno). */
export const SACAR = [
  { codigo: "01.02.02.001.020", nombre: "Terrenos - Valor Costo", queda: "Terreno" },
  { codigo: "01.02.02.001.020", nombre: "Terrenos - Amort.Acum.", queda: "Terreno" },
];

/** 3. Nombres repetidos: la que hoy no usa ninguna operación cambia de nombre. */
export const RENOMBRAR = [
  { codigo: "02.01.03.002.100", nombre: "Cargas Sociales A Pagar", nuevo: "Cargas Sociales A Pagar - Detalle" },
  { codigo: "02.01.03.046.001", nombre: "IIBB Saldo a Favor", nuevo: "IIBB Saldo a Favor - Pasivo" },
  { codigo: "01.01.03.109.001", nombre: "Retencion IIBB SIFERE Sufrida", nuevo: "Retencion IIBB SIFERE Sufrida - 2" },
  { codigo: "02.01.04.009.001", nombre: "Otras Deudas en Moneda Extranjera LP", nuevo: "Otras Deudas en Moneda Extranjera" },
];

/**
 * 4. Cuentas nuevas. "como": de qué cuenta copia la clasificación (renglón
 * del estado de resultados, costo fijo o variable, reparto entre divisiones).
 * "despues": va abajo de esa cuenta en el plan.
 */
export const NUEVAS = [
  { codigo: "04.02.01.001.064", nombre: "Faltantes y Sobrantes de Caja", rubro: "RESULTADO", como: "Gastos General", despues: "04.02.01.001.062" },
  { codigo: "02.01.03.001.002", nombre: "Provisión SAC A Pagar", rubro: "PASIVO CORRIENTE", como: "Sueldos A Pagar", despues: "02.01.03.001.001" },
  { codigo: "02.01.03.001.003", nombre: "Provisión Vacaciones A Pagar", rubro: "PASIVO CORRIENTE", como: "Sueldos A Pagar", despues: "02.01.03.001.002" },
];

/**
 * 5. Tipos viejos del libro con la cuenta equivocada (el código no existe o
 * es de otra cuenta). Por nombre de cuenta; null = ese lado no se toca.
 */
export const ARREGLOS_TIPOS = [
  { codigo: "VENTA IVA", haber: "IVA Debito Fiscal", motivo: "El código que tenía (02.01.02.006.001) no existe en el plan." },
  { codigo: "IMPUESTO DEVENG", debe: "Egresos - Otros Impuestos", haber: "Otros Impuestos Y Tributos A Pagar", motivo: "Apuntaba a Agua Potable y a Acreedores Varios; el impuesto queda a pagar en su cuenta." },
  { codigo: "PAGO IMPUESTO", debe: "Otros Impuestos Y Tributos A Pagar", motivo: "El pago baja el impuesto a pagar (no Acreedores Varios)." },
  { codigo: "PAGO TRIANGULAR", haber: "Cuenta Particular Titular O Socio", motivo: "Lo que paga un socio por la empresa va a su cuenta particular, no a Ajuste De Capital." },
  { codigo: "PROV SAC", haber: "Provisión SAC A Pagar", motivo: "Apuntaba a Cargas Sociales A Pagar." },
  { codigo: "PROV VAC", haber: "Provisión Vacaciones A Pagar", motivo: "Apuntaba a Percepción Imp. Munic. A Pagar." },
];

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** ¿Es el plan del libro de la propuesta? (alguna cuenta repetida todavía está como en el libro del 08/11) */
export function planConRepetidos(cuentas = []) {
  const hay = new Set(cuentas.map((c) => `${String(c.codigo || "").trim()}|${sinTildes(c.nombre)}`));
  return [...RECODIFICAR.map((x) => `${x.de}|${sinTildes(x.nombre)}`), ...RENOMBRAR.map((x) => `${x.codigo}|${sinTildes(x.nombre)}`)].some((k) => hay.has(k));
}

/**
 * Lo que el script aplica en el libro, o null si el plan ya no tiene nada
 * de la propuesta (otra empresa, o el libro ya arreglado y copiado a Gypi).
 * @param {{ cuentas: { codigo, nombre, activa? }[], tipos: { codigo, cuenta_debe, cuenta_haber, activo? }[] }} d  lo de Gypi (copiado del libro)
 */
export function cambiosCuentasLibro({ cuentas = [], tipos = [] } = {}) {
  if (!planConRepetidos(cuentas)) return null;
  // Las recomendadas de Gypi, contando las cuentas nuevas que el script agrega antes
  const conNuevas = [...cuentas, ...NUEVAS.filter((n) => !cuentas.some((c) => c.codigo === n.codigo)).map((n) => ({ codigo: n.codigo, nombre: n.nombre }))];
  const nombre = new Map(conNuevas.map((c) => [c.codigo, c.nombre]));
  const porTipo = new Map();
  for (const r of cuentasRecomendadas(tipos, conNuevas)) {
    const debe = r.recomendada.debe !== r.actual.debe ? nombre.get(r.recomendada.debe) || null : null;
    const haber = r.recomendada.haber !== r.actual.haber ? nombre.get(r.recomendada.haber) || null : null;
    if (debe || haber) porTipo.set(sinTildes(r.codigo), { codigo: r.codigo, debe, haber, motivo: r.motivo });
  }
  for (const a of ARREGLOS_TIPOS) {
    if (!porTipo.has(sinTildes(a.codigo))) porTipo.set(sinTildes(a.codigo), { codigo: a.codigo, debe: a.debe || null, haber: a.haber || null, motivo: a.motivo });
  }
  return {
    version: VERSION_CAMBIOS_CUENTAS,
    recodificar: RECODIFICAR,
    sacar: SACAR,
    renombrar: RENOMBRAR,
    nuevas: NUEVAS,
    tipos: [...porTipo.values()],
    ajuste: { nombre: "Ajuste De Capital", permitidos: TIPOS_PATRIMONIO.source },
  };
}
