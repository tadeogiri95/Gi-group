// app/lib/finanzasCuentaElegir.js — Finanzas (11/11, pedido de Tadeo): hay
// tipos de operación cuya cuenta cambia en cada carga, y una cuenta por defecto
// fija no sirve.
//   - Amortizaciones (DEPREC en el libro): el haber es la amortización
//     acumulada del bien que se amortiza (máquinas, rodados, inmuebles…).
//     Hay que elegirlo siempre.
//   - Costos indirectos de fabricación: el debe es la cuenta del costo
//     (insumos, electricidad, mantenimiento de máquinas…). Hay que elegirla
//     siempre.
//   - Compras (reemplaza a los costos indirectos en los tipos nuevos): las
//     mismas opciones, con Materias Primas primero. Queda la cuenta del tipo.
// Las cuentas se buscan por nombre en el plan de la empresa. Una que no está
// en el plan no aparece.

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Amortización acumulada de un bien: "Rodados - Amort.Acum.", "Maquinarias y herramientas- Amort.Acum."… */
export const AMORT_ACUM = /amort\.?\s*acum/i;
const esAmortizacion = (t) => /AMORTIZ|DEPREC/.test(sinTildes(t?.codigo).toUpperCase());
const esCif = (t) => /INDIRECTOS DE FABRICACION/.test(sinTildes(t?.codigo).toUpperCase());
const esCompra = (t) => sinTildes(t?.codigo) === "compras";

/** Las cuentas de costos indirectos más comunes, en el orden en que se muestran. */
export const CUENTAS_CIF = [
  "Insumos", "Electricidad", "Gas", "Agua Potable", "Mantenimiento Maquinas", "Mantenimiento Edilicio",
  "Combustibles Y Lubricantes", "Fletes Y Acarreos", "Viáticos", "Pasajes y Hoteles", "Gastos De Fabricacion",
];
const CUENTAS_COMPRA = ["Materias Primas", "Materias Primas Varias", ...CUENTAS_CIF];

/** El nombre corto del bien: "Rodados - Amort.Acum." → "Rodados". */
export const nombreBien = (nombre) => String(nombre || "").replace(/\s*-?\s*amort\.?\s*acum\.?\s*$/i, "").trim() || String(nombre || "");

function porNombres(cuentas, nombres) {
  const activas = cuentas.filter((c) => c.activa !== false);
  return nombres
    .map((n) => activas.find((c) => sinTildes(c.nombre) === sinTildes(n)))
    .filter(Boolean)
    .map((c) => ({ codigo: c.codigo, etiqueta: c.nombre }));
}

/**
 * Qué cuenta se elige al cargar una operación de este tipo, o null.
 * obligatoria: la cuenta del tipo no se usa sola (hay que tocar una opción
 * o elegir otra con "Cambiar cuentas").
 * @returns {{ lado: "debe"|"haber", pregunta: string, opciones: { codigo, etiqueta }[], obligatoria: boolean } | null}
 */
export function cuentaParaElegir(tipo, cuentas = []) {
  if (!tipo) return null;
  let r = null;
  if (esAmortizacion(tipo)) {
    const opciones = cuentas
      .filter((c) => c.activa !== false && AMORT_ACUM.test(String(c.nombre || "")))
      .map((c) => ({ codigo: c.codigo, etiqueta: nombreBien(c.nombre) }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
    r = { lado: "haber", pregunta: "¿Qué bien se amortiza?", opciones, obligatoria: true };
  } else if (esCif(tipo)) {
    r = { lado: "debe", pregunta: "¿Qué costo es?", opciones: porNombres(cuentas, CUENTAS_CIF), obligatoria: true };
  } else if (esCompra(tipo)) {
    r = { lado: "debe", pregunta: "¿Qué se compró?", opciones: porNombres(cuentas, CUENTAS_COMPRA), obligatoria: false };
  }
  return r && r.opciones.length ? r : null;
}

/**
 * Las cuentas con las que arranca el formulario: si es obligatorio elegir,
 * ese lado queda vacío; si no, queda la cuenta del tipo.
 */
export function cuentasIniciales(tipo, cuentas, iniciales) {
  const e = cuentaParaElegir(tipo, cuentas);
  return e?.obligatoria ? { ...iniciales, [`cuenta_${e.lado}`]: "" } : iniciales;
}

/** Error si una amortización no va contra la amortización acumulada de un bien; null si está bien. */
export function errorAmortizacion(tipo, cuentaHaber, cuentas = []) {
  if (!esAmortizacion(tipo) || !cuentaHaber) return null;
  const e = cuentaParaElegir(tipo, cuentas);
  if (!e || e.opciones.some((o) => o.codigo === cuentaHaber)) return null;
  return "Una amortización va contra la amortización acumulada del bien: elegí qué bien se amortiza (máquinas, rodados, inmuebles…).";
}
