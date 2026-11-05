// app/lib/esquemaMigraciones.js — Chequeo de la base (auditoría 01/11, PR 7):
// qué migraciones de supabase/migrations todavía no se corrieron en Supabase.
// En la auditoría se encontró la 117 sin correr y nadie se había enterado:
// Instalaciones daba error sin explicar por qué.
//
// Cada migración deja algo que se puede ver desde afuera: una tabla, una
// columna, una vista o una función. Se mira eso, solo leyendo, sin migración
// propia: primero con el índice de la API de Supabase (una sola consulta) y,
// si no está disponible, preguntando tabla por tabla con limit=0.
// Las que solo cambian permisos, crons o restricciones (090-096, 119, 143) no
// dejan rastro visible y no se chequean. La 111 tampoco: su columna la saca la
// 112. Si una migración nueva borra o renombra algo de otra, corregir acá la
// de antes para no avisar de más.
//
// Al sumar una migración nueva que crea tablas o columnas, agregarla acá.

// Migraciones que crean algo que otra posterior saca: no se chequean
export const SIN_CHEQUEO = ["111_etapas_tipo_pieza.sql"];

export const MIGRACIONES = [
  { n: 97, archivo: "097_ot_entrega_cantidad.sql", nombre: "Entrega y cantidad de OT", tablas: { proyectos: ["cantidad", "fecha_entrega", "terminado_planilla"] } },
  { n: 98, archivo: "098_rutas_division.sql", nombre: "Rutas por división", tablas: { divisiones: ["ruta_etapas"] } },
  { n: 99, archivo: "099_paradas_cantidades.sql", nombre: "Paradas con cantidades", tablas: { v_resumen_diario: [], registro_actividades: ["cantidad"], etapas: ["unidad"] } },
  { n: 100, archivo: "100_avance_etapas.sql", nombre: "Avance de etapas y liberación", tablas: { avance_etapas: [], proyectos: ["liberacion", "liberada_at", "liberada_por", "puntos_criticos"], etapas: ["condicion_cierre"] } },
  { n: 101, archivo: "101_modulos_no_conformidades.sql", nombre: "Módulos y no conformidades", tablas: { no_conformidades: [], proyectos: ["total_modulos"] } },
  { n: 102, archivo: "102_costo_hora.sql", nombre: "Costo hora", tablas: { costos_empresa: [] } },
  { n: 103, archivo: "103_sueltos_ot.sql", nombre: "Sueltos de OT", tablas: { sueltos_ot: [] } },
  { n: 104, archivo: "104_acopio_carga.sql", nombre: "Acopio y carga", tablas: { bultos_ot: [], cargas_ot: [] } },
  { n: 105, archivo: "105_acta_instalacion.sql", nombre: "Acta de instalación", tablas: { actas_ot: [], pendientes_obra: [], bultos_ot: ["descargado", "descargado_at", "descargado_por"] } },
  { n: 106, archivo: "106_stock_articulos.sql", nombre: "Stock: artículos", tablas: { articulos_stock: [] } },
  { n: 107, archivo: "107_movimientos_stock.sql", nombre: "Stock: movimientos", tablas: { movimientos_stock: [] } },
  { n: 108, archivo: "108_necesidades_stock.sql", nombre: "Stock: necesidades", tablas: { necesidades_stock: [] } },
  { n: 109, archivo: "109_piezas_ot.sql", nombre: "Piezas de OT", tablas: { piezas_ot: [] } },
  { n: 110, archivo: "110_pasos_pieza.sql", nombre: "Escaneo de piezas", tablas: { pasos_pieza: [] } },
  // 112 saca etapas.tipo_pieza (la de la 111): la 111 queda cubierta por la 112
  { n: 112, archivo: "112_etapas_por_pieza.sql", nombre: "Etapas escaneadas por pieza", tablas: { etapas: ["por_pieza", "columna_pieza"] } },
  { n: 113, archivo: "113_compras_pedidos.sql", nombre: "Compras: pedidos", tablas: { proveedores: [], pedidos_compra: [] } },
  { n: 114, archivo: "114_compras_ordenes.sql", nombre: "Compras: órdenes", tablas: { ordenes_compra: [], ordenes_compra_items: [], articulos_stock: ["multiplo", "plazo_dias", "proveedor_principal", "ultimo_precio"], pedidos_compra: ["orden_id"] } },
  { n: 115, archivo: "115_compras_recepciones.sql", nombre: "Compras: recepciones", tablas: { recepciones_compra: [], recepciones_compra_items: [], ordenes_compra: ["factura_fecha", "factura_numero", "tipo_cambio"] } },
  { n: 116, archivo: "116_empleados_instalador.sql", nombre: "Empleados instaladores", tablas: { empleados: ["es_instalador"] } },
  { n: 117, archivo: "117_reportes_instalacion.sql", nombre: "Reportes de instalación", tablas: { reportes_instalacion: [], modulos_instalados: [], pendientes_obra: ["modulo", "piezas", "porcentaje", "reporte_id"] } },
  { n: 118, archivo: "118_v_avance_piezas.sql", nombre: "Avance por escaneo", tablas: { v_avance_piezas: [] } },
  { n: 120, archivo: "120_observacion_oc.sql", nombre: "Observación en OC", tablas: { ordenes_compra_items: ["observacion"] } },
  { n: 121, archivo: "121_pedidos_compra_cambios.sql", nombre: "Corrección de pedidos", tablas: { pedidos_compra_cambios: [], pedidos_compra: ["editado_at", "editado_por", "editado_por_nombre"] } },
  { n: 122, archivo: "122_factura_oc_impuestos.sql", nombre: "Factura de OC con IVA", tablas: { ordenes_compra_items: ["cantidad_facturada", "iva_alicuota"], ordenes_compra: ["factura_otros_impuestos"] } },
  { n: 123, archivo: "123_oc_cerrar_faltantes.sql", nombre: "Cerrar OC con faltantes", tablas: { ordenes_compra: ["cerrada_at", "cerrada_motivo", "cerrada_por", "cerrada_por_nombre"], pedidos_compra: ["faltante_de"] } },
  { n: 124, archivo: "124_articulos_alta.sql", nombre: "Alta de artículos", tablas: { articulos_alta: [], articulos_stock: ["origen", "pack"] } },
  { n: 125, archivo: "125_cotizaciones_oc.sql", nombre: "Cotizaciones", tablas: { ordenes_compra_cotizaciones: [] } },
  { n: 126, archivo: "126_flota_vehiculos.sql", nombre: "Flota: vehículos", tablas: { vehiculos: [], vehiculo_papeles: [], empleados: ["licencia_categoria", "licencia_vencimiento"] } },
  { n: 127, archivo: "127_checklist_vehiculos.sql", nombre: "Flota: checklist", tablas: { flota_config: [], vehiculo_checklists: [] } },
  { n: 128, archivo: "128_alertas_flota.sql", nombre: "Flota: alertas", tablas: { vehiculos: ["aviso_at", "aviso_firma", "frecuencias", "service_fecha", "service_km"] } },
  { n: 129, archivo: "129_arreglos_flota.sql", nombre: "Flota: arreglos", tablas: { vehiculo_mantenimientos: [], vehiculo_arreglos: [] } },
  { n: 130, archivo: "130_compras_transacciones.sql", nombre: "Compras: recepción segura", funciones: ["compras_anular_recepcion", "compras_estado_orden", "compras_factura", "compras_recibir"] },
  { n: 131, archivo: "131_modulos_apagados.sql", nombre: "Módulos apagados", tablas: { empresa_modulos: ["apagado"] } },
  { n: 132, archivo: "132_maquinaria.sql", nombre: "Maquinaria", tablas: { maquinas: [], maquina_tareas: [], maquina_registros: [] } },
  { n: 133, archivo: "133_responsables_mantenimiento.sql", nombre: "Responsables de mantenimiento", tablas: { empleados: ["es_mantenimiento"], vehiculos: ["mant_responsable_id", "mant_suplente_id"], maquinas: ["aviso_at", "aviso_firma", "responsable_id", "suplente_id"] } },
  { n: 134, archivo: "134_fallas_maquinaria.sql", nombre: "Fallas de máquinas", tablas: { maquina_fallas: [] } },
  { n: 135, archivo: "135_ot_semana_objetivo.sql", nombre: "Semana objetivo de OT", tablas: { proyectos: ["fecha_objetivo", "semana_objetivo"] } },
  { n: 136, archivo: "136_ot_material_produccion.sql", nombre: "Material de OT", tablas: { proyectos: ["fondos", "metros_canto", "placas", "placas_mecanizadas"] } },
  { n: 137, archivo: "137_ot_prioridad.sql", nombre: "Prioridad de OT", tablas: { proyectos: ["prioridad"] } },
  { n: 138, archivo: "138_planes_produccion.sql", nombre: "Planes de producción", tablas: { planes_produccion: [], plan_produccion_items: [] } },
  { n: 139, archivo: "139_ot_tipo_proyecto.sql", nombre: "Tipo de proyecto", tablas: { proyectos: ["tipo_proyecto"] } },
  { n: 140, archivo: "140_empleados_puesto_planta.sql", nombre: "Puesto en planta", tablas: { empleados: ["puesto_planta"] } },
  { n: 141, archivo: "141_proyectos_avance_manual.sql", nombre: "Avance manual de OT", tablas: { proyectos: ["avance_manual"] } },
  { n: 142, archivo: "142_precios_ot.sql", nombre: "Precios de OT", tablas: { precios_ot: [] } },
  { n: 144, archivo: "144_semana_editable.sql", nombre: "Semana editable", tablas: { proyectos: ["semana_app", "semana_app_at", "semana_planilla"] } },
  { n: 145, archivo: "145_ajustes_tiempo_ot.sql", nombre: "Ajustes de tiempo", tablas: { ajustes_tiempo_ot: [] } },
  { n: 146, archivo: "146_informe_produccion.sql", nombre: "Informe de producción", tablas: { informes_produccion: [], avance_manual_historial: [] } },
  { n: 147, archivo: "147_retrabajos_ot.sql", nombre: "Retrabajos", tablas: { retrabajos_ot: [] } },
  { n: 148, archivo: "148_retrabajos_anular.sql", nombre: "Anular retrabajos", tablas: { retrabajos_ot: ["anulado_at", "anulado_nombre"] } },
  { n: 149, archivo: "149_avisos_fin_proceso.sql", nombre: "Avisos de fin de proceso", tablas: { avisos_fin_proceso: [] } },
  { n: 150, archivo: "150_minutas.sql", nombre: "Minutas", tablas: { minutas: [], minuta_items: [] } },
  { n: 151, archivo: "151_pausas_ot.sql", nombre: "OT en pausa", tablas: { pausas_ot: [] } },
  { n: 152, archivo: "152_unidad_compra_oc.sql", nombre: "Unidad de compra en OC", tablas: { ordenes_compra_items: ["factor", "unidad_stock"] } },
  { n: 153, archivo: "153_instalacion_ot.sql", nombre: "Días de instalación de OT", tablas: { proyectos: ["dias_instalacion", "personas_instalacion", "prioridad_instalacion"] } },
  { n: 154, archivo: "154_planes_instalacion.sql", nombre: "Plan de instalación", tablas: { planes_instalacion: [], plan_instalacion_items: [] } },
  { n: 156, archivo: "156_flota_fotos_poliza.sql", nombre: "Fotos del vehículo y póliza en PDF", tablas: { vehiculos: ["fotos"], vehiculo_papeles: ["archivo_path", "archivo_nombre"] } },
  { n: 157, archivo: "157_instalacion_desde.sql", nombre: "Mover obras en el Gantt de instalación", tablas: { proyectos: ["instalacion_desde"] } },
  { n: 159, archivo: "159_diseno_tecnica_clase.sql", nombre: "Diseño y Técnica: etapas y clase A/B/C", tablas: { proyectos: ["etapas_diseno", "clase_auto", "clase_complejidad"] } },
  { n: 160, archivo: "160_diseno_tecnica_tiempos.sql", nombre: "Diseño y Técnica: tiempos a mano", tablas: { proyectos: ["dias_diseno", "horas_tecnica"] } },
];

/** Lo que pide una migración, como lista de { tabla, columnas } y funciones. */
const tablasDe = (m) => Object.entries(m.tablas || {}).map(([tabla, columnas]) => ({ tabla, columnas }));

/**
 * Migraciones que faltan según el índice OpenAPI de PostgREST (GET /rest/v1/).
 * @param {{ definitions?: object, paths?: object }} spec
 * @returns {object[]|null} null si el índice no sirve para decidir
 */
export function faltantesDesdeIndice(spec, migraciones = MIGRACIONES) {
  const defs = spec?.definitions;
  if (!defs || typeof defs !== "object" || !Object.keys(defs).length) return null;
  const paths = spec.paths || {};
  return migraciones.filter((m) => {
    const faltaTabla = tablasDe(m).some(({ tabla, columnas }) => {
      const props = defs[tabla]?.properties;
      return !props || columnas.some((c) => !(c in props));
    });
    const faltaFuncion = (m.funciones || []).some((f) => !(`/rpc/${f}` in paths));
    return faltaTabla || faltaFuncion;
  });
}

/** Una tabla con sus columnas existe si PostgREST la deja leer (200); 400/404 = falta. */
export async function faltaTabla(consultar, { tabla, columnas }) {
  const select = columnas.length ? columnas.join(",") : "*";
  const status = await consultar(`${tabla}?select=${select}&limit=0`);
  if (status >= 200 && status < 300) return false;
  if (status === 400 || status === 404) return true;
  throw new Error(`No se pudo revisar ${tabla} (HTTP ${status})`);
}

/**
 * Plan B, sin índice: tabla por tabla. Las funciones no se pueden mirar así
 * sin ejecutarlas, y quedan sin chequear.
 * @param {(ruta: string) => Promise<number>} consultar  devuelve el status HTTP
 */
export async function faltantesProbando(consultar, migraciones = MIGRACIONES) {
  const out = [];
  for (const m of migraciones) {
    const tablas = tablasDe(m);
    if (!tablas.length) continue;
    const faltas = await Promise.all(tablas.map((t) => faltaTabla(consultar, t)));
    if (faltas.some(Boolean)) out.push(m);
  }
  return out;
}

/** Lo que se le muestra a la pantalla: número, archivo y nombre. */
export const resumenFaltantes = (lista) => lista.map(({ n, archivo, nombre }) => ({ n, archivo, nombre }));

/** "117 (Reportes de instalación) y 150 (Minutas)" */
export function textoFaltantes(lista) {
  const partes = lista.map((m) => `${String(m.n).padStart(3, "0")} (${m.nombre})`);
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}
