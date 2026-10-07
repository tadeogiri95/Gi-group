// app/lib/perfilFiscal.js — Datos fiscales del cliente para la Factura C
// (F6-02, F6-11, D15, ítem 26). Lo usan el servidor y la pantalla.

export const CONDICIONES_IVA = {
  responsable_inscripto: { nombre: "IVA Responsable Inscripto", arca: 1 },
  monotributo: { nombre: "Responsable Monotributo", arca: 6 },
  exento: { nombre: "IVA Sujeto Exento", arca: 4 },
  consumidor_final: { nombre: "Consumidor Final", arca: 5 },
};

/** Solo los dígitos del CUIT: "20-40937847-2" → "20409378472". */
export function limpiarCuit(cuit) {
  return String(cuit || "").replace(/\D/g, "");
}

/** CUIT válido (11 dígitos y dígito verificador módulo 11). */
export function cuitValido(cuit) {
  const c = limpiarCuit(cuit);
  if (!/^\d{11}$/.test(c)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((t, p, i) => t + p * Number(c[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9; // los CUIT con verificador 10 se reasignan con prefijo 23/33; se acepta el 9
  return dv === Number(c[10]);
}

export function formatearCuit(cuit) {
  const c = limpiarCuit(cuit);
  return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c;
}

/**
 * Valida el perfil fiscal. Devuelve { ok: true, perfil } con los datos limpios
 * o { ok: false, error }.
 */
export function validarPerfilFiscal(datos = {}) {
  const razon_social = String(datos.razon_social || "").trim().replace(/\s+/g, " ");
  const condicion_iva = String(datos.condicion_iva || "");
  const domicilio_fiscal = String(datos.domicilio_fiscal || "").trim().replace(/\s+/g, " ");
  const cuit = limpiarCuit(datos.cuit);
  if (razon_social.length < 2 || razon_social.length > 120) return { ok: false, error: "Escribí la razón social (como figura en ARCA)." };
  if (!CONDICIONES_IVA[condicion_iva]) return { ok: false, error: "Elegí la condición frente al IVA." };
  if (!cuitValido(cuit)) return { ok: false, error: "El CUIT no es válido. Revisá los 11 números." };
  if (domicilio_fiscal.length < 5 || domicilio_fiscal.length > 200) return { ok: false, error: "Escribí el domicilio fiscal." };
  return { ok: true, perfil: { razon_social, cuit, condicion_iva, domicilio_fiscal } };
}

/** ¿Está completo para facturar? */
export function perfilCompleto(empresa) {
  return validarPerfilFiscal(empresa || {}).ok;
}
