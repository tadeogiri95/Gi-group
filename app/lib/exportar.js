// app/lib/exportar.js — Exportación self-service de los datos de una empresa
// (F6-01, ítem 28): un .zip con un CSV por tabla, que abre en Excel.
import { zipSync, strToU8 } from "fflate";

// Tablas que se exportan (todas filtradas por empresa_id). Quedan afuera las
// internas: sesiones, tokens de push, rate limits, métricas y auditoría.
export const TABLAS_EXPORTAR = [
  "empleados", "fichadas", "solicitudes", "registro_actividades", "proyectos",
  "geo_zonas", "geo_registros", "divisiones", "etapas", "turnos_planificados",
  "notas_calendario", "notificaciones", "reportes_obra", "mensajes_chat",
  "tipos_documento_requerido", "documentos_exigidos_empleado", "documentos_empleado",
  "reglas_bot", "suscripciones", "pagos",
];

// Columnas que nunca salen (secretos, aunque estén hasheados)
export const COLUMNAS_SECRETAS = new Set([
  "password", "admin_password", "password_reset_jti", "activacion_codigo_hash",
  "activacion_expira", "pin_hash", "pin_intentos", "pin_bloqueado_hasta",
  "email_verify_token", "token",
]);

function celda(v) {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Evita que Excel interprete una celda como fórmula (inyección CSV)
  const segura = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",;\n\r]/.test(segura) ? `"${segura.replace(/"/g, '""')}"` : segura;
}

/** Filas → CSV (separador coma, BOM para que Excel lea bien los acentos). */
export function aCsv(filas) {
  const columnas = [];
  for (const f of filas) for (const k of Object.keys(f)) if (!COLUMNAS_SECRETAS.has(k) && !columnas.includes(k)) columnas.push(k);
  const lineas = [columnas.join(","), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(","))];
  return "﻿" + lineas.join("\r\n") + "\r\n";
}

/** Saca las columnas secretas de una fila. */
export function sinSecretos(fila) {
  return Object.fromEntries(Object.entries(fila || {}).filter(([k]) => !COLUMNAS_SECRETAS.has(k)));
}

/** Arma el .zip: { "fichadas.csv": "..." } → Uint8Array. */
export function armarZip(archivos) {
  const entrada = {};
  for (const [nombre, texto] of Object.entries(archivos)) entrada[nombre] = strToU8(texto);
  return zipSync(entrada, { level: 6 });
}

export function leeme({ empresa, fecha, tablas, fallidas, truncadas }) {
  return [
    `Datos de ${empresa} exportados de Gypi el ${fecha}.`,
    "",
    "Cada archivo .csv es una tabla y se abre con Excel o Google Sheets.",
    "No incluye contraseñas, PIN ni códigos de acceso. Los archivos de documentos",
    "y fotos no van en el zip: en documentos_empleado.csv y reportes_obra.csv",
    "figura su ubicación.",
    "",
    "Tablas:",
    ...tablas.map((t) => `  - ${t.nombre}.csv: ${t.filas} filas`),
    ...(truncadas.length ? ["", `Atención: estas tablas superaron el máximo y vienen incompletas: ${truncadas.join(", ")}. Escribinos a contacto@gypi.app.`] : []),
    ...(fallidas.length ? ["", `No se pudieron exportar: ${fallidas.join(", ")}. Probá de nuevo o escribinos a contacto@gypi.app.`] : []),
    "",
  ].join("\r\n");
}
