// app/lib/exportar.js — Exportación self-service de los datos de una empresa
// (F6-01, ítem 28): un .zip con un CSV por tabla, que abre en Excel.
import { zipSync, strToU8 } from "fflate";

// Tablas que se exportan (todas filtradas por empresa_id). Quedan afuera las
// internas: sesiones, tokens de push, rate limits, métricas y auditoría.
export const TABLAS_EXPORTAR = [
  // Personal
  "empleados", "fichadas", "solicitudes", "registro_actividades", "divisiones", "etapas", "turnos_planificados",
  "geo_zonas", "geo_registros", "notas_calendario", "notificaciones", "mensajes_chat",
  "tipos_documento_requerido", "documentos_exigidos_empleado", "documentos_empleado", "reglas_bot",
  // Producción e instalación (14/11: el respaldo trae todo lo cargado en Gypi)
  "proyectos", "plantas", "avance_etapas", "avance_manual_historial", "pasos_pieza", "piezas_ot", "pausas_ot",
  "horas_ot", "ajustes_tiempo_ot", "retrabajos_ot", "avisos_fin_proceso", "no_conformidades", "destinos_ot",
  "bultos_ot", "sueltos_ot", "cargas_ot", "actas_ot", "pendientes_obra", "reportes_obra", "reportes_instalacion",
  "planes_produccion", "plan_produccion_items", "planes_instalacion", "plan_instalacion_items", "informes_produccion",
  "minutas", "minuta_items", "precios_ot", "precios_fijos_ot", "costos_finales_ot", "costos_empresa",
  // Stock y compras
  "articulos_stock", "articulos_alta", "asociaciones_articulos", "movimientos_stock", "remitos_stock", "necesidades_stock",
  "proveedores", "precios_articulos", "pedidos_compra", "pedidos_compra_cambios", "ordenes_compra", "ordenes_compra_items",
  "ordenes_compra_cotizaciones", "ordenes_compra_facturas", "recepciones_compra", "recepciones_compra_items",
  "facturas_sueltas", "facturas_sueltas_renglones",
  // Flota y maquinaria
  "vehiculos", "vehiculo_papeles", "vehiculo_checklists", "vehiculo_mantenimientos", "vehiculo_arreglos", "flota_config",
  "maquinas", "maquina_tareas", "maquina_registros", "maquina_fallas",
  // Finanzas
  "fin_cuentas", "fin_tipos_operacion", "fin_centros_costo", "fin_tesoreria", "fin_operaciones", "fin_cheques",
  "fin_clientes", "fin_personas", "fin_ordenes_pago", "fin_resumenes_pago", "fin_liquidaciones", "fin_cargas_banco",
  "fin_meses_cerrados",
  // Cuenta
  "suscripciones", "pagos",
];

/** Las que no tienen columna id: se exportan sin ordenar. */
export const TABLAS_SIN_ID = new Set([
  "articulos_stock", "asociaciones_articulos", "costos_empresa", "fin_centros_costo", "fin_cuentas", "fin_meses_cerrados",
  "fin_tesoreria", "fin_tipos_operacion", "flota_config", "horas_ot", "necesidades_stock", "precios_fijos_ot", "precios_ot",
]);

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
