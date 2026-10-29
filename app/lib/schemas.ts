import { z } from "zod";

// ── Primitives ──────────────────────────────────────────────────────────────
export const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
export const slug = z.string().min(1).max(50).regex(/^[a-z0-9-]+$/);
export const color = z.string().max(20).regex(/^#[0-9a-fA-F]{3,8}$/);
export const emoji = z.string().max(4);
// Ícono de etapa o división: un emoji (algunos ocupan más de 4 letras, como
// "🛠️" o "👷‍♂️") o, en etapas viejas, el nombre de un dibujo ("Hammer")
export const icono = z.string().trim().max(40);
export const safeString = z.string().max(500);
export const shortString = z.string().max(100);
export const url = z.string().url().max(2048);
export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);
export const legajoNum = z.number().int().positive();
export const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const hora = z.string().regex(/^\d{2}:\d{2}$/);

const rolesValidos = ["operativo", "gerencial", "administrativo"] as const;
export const rol = z.enum(rolesValidos);

// ── /api/data — Whitelist de campos por tabla y operación ────────────────
// Campos que el cliente puede enviar en POST/PATCH vía /api/data.
// Todo lo que NO esté aquí se descarta silenciosamente.
// empresa_id se inyecta desde la sesión y NO debe venir del body.
export const CAMPOS_PERMITIDOS: Record<string, Record<string, string[]>> = {
  fichadas: {
    POST: ["legajo", "fecha", "ingreso", "egreso", "empleado_id"],
    PATCH: ["egreso", "horas_trabajadas", "horas_extra"],
  },
  solicitudes: {
    POST: ["legajo", "tipo", "motivo", "fecha", "desde", "hasta", "nombre_empleado", "empleado_id", "estado", "destinatario_rol", "fecha_hasta", "etiqueta"],
    PATCH: ["estado", "aprobador", "resuelto_at", "notas_gerencia"], // notas_gerencia: comentario al aprobar o rechazar (F4-07)
  },
  notificaciones: {
    POST: ["destinatario_rol", "tipo", "asunto", "detalle", "empleado_id"],
    PATCH: ["leida"],
  },
  empleados: {
    // Sin "password" ni "rol": las altas pasan por POST /api/empleados (hashea
    // bcrypt server-side y limita qué roles puede asignar cada sesión). Dejarlos
    // acá permitía crear empleados con contraseña en texto plano y que un
    // administrativo creara gerenciales salteando esa regla.
    POST: ["legajo", "nombre", "apodo", "email", "area", "division", "diagrama", "activo", "debe_cambiar_password", "estado_activacion"],
    PATCH: ["nombre", "apodo", "email", "area", "division", "diagrama", "horas_semanales", "geo_config", "activo", "debe_cambiar_password"],
  },
  registro_actividades: {
    // tipo/causa/division: antes se descartaban en silencio (auditoría F1-02); se validan en dataPolicy
    POST: ["empleado_id", "legajo", "etapa", "codigo_proyecto", "hora_inicio", "hora_fin", "duracion_min", "observaciones", "fecha", "tipo", "causa", "division"],
    // cantidad (099): lo hecho en la tarea, en la unidad de su etapa
    PATCH: ["hora_fin", "duracion_min", "observaciones", "etapa", "cantidad"],
  },
  reportes_obra: {
    POST: ["nombre", "legajo", "fecha", "texto_original", "texto_formateado", "progreso", "fotos"],
    PATCH: ["texto_formateado", "progreso"],
  },
  proyectos: {
    POST: ["estado", "ot", "cliente", "obra", "proyecto", "division", "total_modulos"],
    // prioridad (137): gerencia ordena las OT en Proyectos → Planificación
    PATCH: ["estado", "ot", "cliente", "obra", "proyecto", "division", "total_modulos", "prioridad", "tipo_proyecto", "avance_manual"],
  },
  push_tokens: {
    POST: ["legajo", "token", "plataforma"],
    PATCH: ["updated_at"],
  },
  geo_zonas: {
    POST: ["nombre", "lat", "lng", "radio", "planta_id"],
    PATCH: ["nombre", "lat", "lng", "radio", "planta_id"],
  },
  geo_registros: {
    POST: ["empleado_id", "lat", "lng", "accion"],
    PATCH: [],
  },
  config_sistema: {
    POST: ["clave", "valor"],
    PATCH: ["valor"],
  },
  notas_calendario: {
    // color: el nombre ("verde"); sin él toda nota quedaba naranja aunque se eligiera otro (R11)
    POST: ["fecha", "texto", "empleado_id", "color"],
    PATCH: ["texto"],
  },
  mensajes_chat: {
    POST: ["empleado_id", "role", "content"],
    PATCH: [],
  },
  turnos_planificados: {
    POST: ["empleado_id", "fecha", "hora_inicio", "hora_fin", "tipo"],
    PATCH: ["hora_inicio", "hora_fin", "tipo"],
  },
  etapas: {
    POST: ["codigo", "nombre", "icon", "color", "orden"],
    PATCH: ["nombre", "icon", "color", "codigo", "orden", "activa"],
  },
  divisiones: {
    POST: ["clave", "label", "icon", "color", "orden"],
    PATCH: ["label", "icon", "color", "orden", "activa"],
  },
  empresa: {
    PATCH: ["nombre", "nombre_corto", "rubro", "color_primario", "color_secundario", "color_fondo", "color_texto", "typography", "theme_preset", "logo_url", "prompt_ia_obra", "prompt_ia_chat", "timezone", "onboarding_completado"],
  },
  reglas_bot: {
    POST: ["regla", "orden"],
    PATCH: ["regla", "orden", "activa"],
  },
  invitaciones_empresa: {
    POST: ["email", "rol"],
    PATCH: ["usada"],
  },
  tipos_documento_requerido: {
    POST: ["nombre", "formatos_aceptados", "admite_multiples", "tipo_carga", "orden"],
    PATCH: ["nombre", "formatos_aceptados", "admite_multiples", "tipo_carga", "activo", "orden"],
  },
  documentos_exigidos_empleado: {
    POST: ["empleado_id", "tipo_documento_id"],
    PATCH: [],
  },
  // documentos_empleado no tiene entrada: es TABLAS_SOLO_LECTURA en /api/data,
  // los inserts pasan siempre por /api/documentos/upload.
  // Cambios de tiempo con motivo (145); creado_por sale de la sesión
  ajustes_tiempo_ot: {
    POST: ["ot", "etapa", "tipo", "horas", "pendiente", "dias", "motivo", "detalle", "creado_nombre"],
  },
  // Historial del checkeo manual (146); creado_por sale de la sesión
  avance_manual_historial: {
    POST: ["ot", "etapa", "pct"],
  },
};

// ── Schemas Zod por endpoint ────────────────────────────────────────────────

export const fichadaPost = z.object({
  legajo: z.union([z.number(), z.string()]),
  fecha: fecha,
  ingreso: hora.optional(),
  egreso: hora.optional(),
  empleado_id: uuid.optional(),
}).strict();

export const solicitudPost = z.object({
  legajo: z.union([z.number(), z.string()]),
  tipo: z.enum(["permiso", "vacaciones", "justificacion", "tardanza", "ausencia", "cambio_horario", "hora_extra", "salida_anticipada", "otro"]),
  motivo: safeString.optional(),
  fecha: fecha.optional(),
  fecha_inicio: fecha.optional(),
  fecha_fin: fecha.optional(),
  nombre_empleado: shortString.optional(),
  empleado_id: uuid.optional(),
  destinatario_rol: z.string().max(50).optional(),
}).strict();

export const notificacionPost = z.object({
  destinatario_rol: z.string().max(50),
  tipo: z.string().max(50),
  asunto: safeString,
  detalle: z.string().max(2000).optional(),
  empleado_id: uuid.optional(),
}).strict();

export const empleadoPost = z.object({
  legajo: z.union([z.number(), z.string()]),
  nombre: shortString,
  apodo: shortString.optional(),
  email: z.string().email().max(254).optional().nullable(),
  area: shortString.optional(),
  division: shortString.optional().nullable(),
  rol: rol.optional(),
  diagrama: z.record(z.string(), z.any()).optional(),
  activo: z.boolean().optional(),
  password: z.string().max(200).optional(),
  debe_cambiar_password: z.boolean().optional(),
  estado_activacion: z.string().max(50).optional(),
}).strict();

export const turnoPost = z.object({
  empleado_id: uuid,
  fecha: fecha,
  hora_inicio: hora,
  hora_fin: hora,
  tipo: z.string().max(50).optional(),
}).strict();

export const actividadPost = z.object({
  empleado_id: uuid,
  legajo: z.union([z.number(), z.string()]).optional(),
  etapa: z.number(),
  codigo_proyecto: z.string().max(50).optional(),
  hora_inicio: z.string().max(30).optional(),
  hora_fin: z.string().max(30).optional().nullable(),
  duracion_min: z.number().optional(),
  observaciones: z.string().max(2000).optional().nullable(),
  fecha: fecha.optional(),
}).strict();

// ── /api/fichar ─────────────────────────────────────────────────────────────
export const ficharBody = z.object({
  accion: z.enum(["ingreso", "egreso"]),
  geo_lat: latitude.optional().nullable(),
  geo_lng: longitude.optional().nullable(),
  geo_precision: z.number().min(0).max(100000).optional().nullable(), // metros, coords.accuracy del teléfono
  forzar_cierre_tarea: z.boolean().optional(),
  // Sin conexión (F4-05, ítem 21): id de la operación (idempotencia) y cuándo se hizo
  op_id: z.string().uuid().optional(),
  momento: z.string().datetime({ offset: true }).optional(),
}).strip();

// ── /api/actividad (ítem 21): iniciar o finalizar una tarea ────────────────
export const actividadBody = z.object({
  accion: z.enum(["iniciar", "finalizar"]),
  etapa: z.number().int().min(0).max(999).optional(),
  codigo_proyecto: z.union([z.string().trim().max(40), z.number()]).optional().nullable(),
  tipo: z.enum(["N", "R", "E", "C"]).optional(),
  // Código de la lista de causas de la empresa (099): hasta 4 letras o números
  causa: z.string().regex(/^[A-Z0-9]{1,4}$/).optional().nullable(),
  observaciones: z.string().trim().max(500).optional().nullable(),
  op_id: z.string().uuid().optional(),
  momento: z.string().datetime({ offset: true }).optional(),
}).strict().refine((b) => b.accion !== "iniciar" || b.etapa != null, { message: "Falta la etapa" })
  .refine((b) => b.accion !== "iniciar" || b.etapa !== 0 || !!b.causa, { message: "Una espera necesita la causa" })
  .refine((b) => b.accion !== "iniciar" || b.etapa === 0 || (b.codigo_proyecto != null && String(b.codigo_proyecto) !== ""), { message: "Falta la OT" });

// ── /api/avance (100): avance de etapas por OT y liberación ───────────────
export const avanceBody = z.object({
  accion: z.enum(["terminar", "aprobar", "reabrir", "no_aplica", "liberar", "desliberar", "puntos"]),
  ot: z.union([z.string().trim().min(1).max(40), z.number()]).transform(String),
  etapa: z.number().int().min(1).max(999).optional(),
  liberacion: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  puntos_criticos: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((b) => !["terminar", "aprobar", "reabrir", "no_aplica"].includes(b.accion) || b.etapa != null, { message: "Falta la etapa" });

// ── /api/no-conformidades (101): piezas con defecto por OT ────────────────
const etapaNc = z.number().int().min(1).max(999).nullable().optional();
export const noConformidadBody = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("crear"),
    ot: z.union([z.string().trim().min(1).max(40), z.number()]).transform(String),
    defecto: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/),
    pieza: z.string().trim().max(80).nullable().optional().transform((v) => v || null),
    cantidad: z.number().int().min(1).max(9999).optional(),
    etapa_detecta: etapaNc,
    etapa_origen: etapaNc,
    nota: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  }).strict(),
  z.object({
    accion: z.literal("decidir"),
    id: z.number().int().positive(),
    decision: z.enum(["reprocesar", "rehacer", "usar_igual", "descartar"]).nullable(),
    minutos_retrabajo: z.number().int().min(0).max(99999).nullable().optional(),
    etapa_origen: etapaNc,
  }).strict(),
  z.object({
    accion: z.literal("borrar"),
    id: z.number().int().positive(),
  }).strict(),
]);

// ── /api/sueltos (103): hoja de sueltos y herrajes por OT ─────────────────
const textoSuelto = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const camposSuelto = {
  tipo: textoSuelto(30),
  codigo: textoSuelto(40),
  descripcion: textoSuelto(200),
  medida: textoSuelto(40),
  cantidad: z.number().positive().max(99999).optional(),
  va_con: textoSuelto(80),
};
const otSuelto = z.union([z.string().trim().min(1).max(40), z.number()]).transform(String);
export const sueltosBody = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("agregar"),
    ot: otSuelto,
    items: z.array(z.object(camposSuelto).strict().refine((i) => !!(i.codigo || i.descripcion), { message: "Cada ítem necesita código o descripción" })).min(1).max(300),
  }).strict(),
  z.object({ accion: z.literal("tildar"), id: z.number().int().positive(), columna: z.enum(["acopio", "carga"]), valor: z.boolean() }).strict(),
  z.object({ accion: z.literal("borrar"), id: z.number().int().positive() }).strict(),
  z.object({ accion: z.literal("vaciar"), ot: otSuelto }).strict(),
]);

// ── /api/piezas (109): piezas de la OT con etiqueta QR (OP parte 17) ────────
// Códigos de las etapas de la empresa por las que pasa la pieza (112), en orden
const codigoEtapaPieza = z.number().int().min(1).max(9999);
const etapasPieza = z.array(codigoEtapaPieza).max(40).transform((l) => [...new Set(l)]);
const nombrePieza = z.string().trim().min(1).max(80);
const medidaPieza = z.number().positive().max(99999).nullable().optional().transform((v) => v ?? null);
export const piezasBody = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("cargar"),
    ot: otSuelto,
    renglones: z.array(z.object({
      nombre: nombrePieza,
      modulo: textoSuelto(40),
      material: textoSuelto(120),
      l1: medidaPieza,
      l2: medidaPieza,
      cantidad: z.number().int().min(1).max(500),
      etapas: etapasPieza,
    }).strict()).min(1).max(1000)
      .refine((l) => l.reduce((n, r) => n + r.cantidad, 0) <= 3000, { message: "Una OT puede tener hasta 3000 piezas" })
      .refine((l) => new Set(l.map((r) => r.nombre)).size === l.length, { message: "Hay renglones con el mismo nombre" }),
  }).strict(),
  z.object({ accion: z.literal("etapas"), ot: otSuelto, nombre: nombrePieza, etapas: etapasPieza }).strict(),
  z.object({ accion: z.literal("vaciar"), ot: otSuelto }).strict(),
]);

// ── /api/piezas/paso (110): escaneo de piezas en cada etapa (OP parte 18) ──
const etapaPieza = codigoEtapaPieza;
export const pasoPiezaBody = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("escanear"),
    codigo: z.string().trim().min(1).max(200),
    etapa: etapaPieza,
    // Desde la cola sin señal (colaOffline): id de la operación y cuándo se escaneó
    op_id: z.string().uuid().optional(),
    momento: z.string().datetime({ offset: true }).optional(),
  }).strict(),
  z.object({ accion: z.literal("deshacer"), pieza_id: z.number().int().positive(), etapa: etapaPieza }).strict(),
  // Deshacer el escaneo de una etiqueta de módulo: todas sus piezas en esa etapa
  z.object({ accion: z.literal("deshacer_modulo"), ot: z.string().trim().min(1).max(40), modulo: z.string().trim().min(1).max(40), etapa: etapaPieza }).strict(),
]);

// ── /api/stock/movimientos (107): retiros, ingresos, ajustes y devoluciones ──
const skuMovimiento = z.string().trim().min(1).max(60).regex(/^[\w.-]+$/, "Código de artículo inválido");
const cantidadMovimiento = z.number().finite().refine((n) => n !== 0 && Math.abs(n) < 1e10, { message: "Cantidad inválida" });
export const movimientoStockBody = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("registrar"),
    tipo: z.enum(["consumo", "devolucion", "ingreso", "ajuste"]),
    sku: skuMovimiento,
    cantidad: cantidadMovimiento,
    ot: otSuelto.nullable().optional().transform((v) => v || null),
    proveedor: textoSuelto(120),
    comprobante: textoSuelto(60),
    precio_unitario: z.number().finite().min(0).max(1e11).nullable().optional().transform((v) => v ?? null),
    notas: textoSuelto(300),
  }).strict().refine((m) => m.tipo === "ajuste" || m.cantidad > 0, { message: "La cantidad tiene que ser mayor a cero", path: ["cantidad"] }),
  z.object({ accion: z.literal("anular"), id: z.number().int().positive() }).strict(),
]);

// ── /api/stock/articulos (124): artículo nuevo con los campos de ARTICULOS ──
const listaTablas = (max: number) => z.string().trim().min(1, "Falta completar").max(max);
const numeroOpcional = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().optional().transform((v) => v ?? null);
export const articuloNuevoBody = z.object({
  nombre_articulo: z.string().trim().min(2, "Escribí el nombre del artículo").max(150).transform((v) => v.replace(/\s+/g, " ")),
  division: listaTablas(60),
  familia: listaTablas(80),
  tipo: listaTablas(60),
  marca: listaTablas(80),
  color: listaTablas(80),
  unidad: listaTablas(20),
  pack: listaTablas(40),
  categoria: z.enum(["A", "B", "C"]).optional().default("C"),
  stock_seguridad: numeroOpcional(0, 1e9),
  factor_tiempo: z.number().int().min(0).max(3650).nullable().optional().transform((v) => v ?? null),
  proveedor_principal: textoSuelto(120),
  lote_minimo: numeroOpcional(0.001, 1e9),
}).strict();

// ── /api/compras (113): proveedores y pedidos de material (Compras parte 20) ──
const idCompras = z.number().int().positive();
const datosProveedor = {
  nombre: z.string().trim().min(1).max(120),
  cuit: textoSuelto(20),
  contacto: textoSuelto(120),
  whatsapp: textoSuelto(30),
  email: z.string().trim().max(160).email("Email inválido").nullable().optional().or(z.literal("")).transform((v) => v || null),
  plazo_dias: z.number().int().min(0).max(365).nullable().optional().transform((v) => v ?? null),
  condicion_pago: textoSuelto(120),
  notas: textoSuelto(300),
};
const datosPedido = {
  sku: skuMovimiento.nullable().optional().transform((v) => v || null),
  descripcion: textoSuelto(200),
  unidad: textoSuelto(20),
  cantidad: z.number().finite().positive().max(1e10),
  ot: otSuelto.nullable().optional().transform((v) => v || null),
  para_fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null),
  notas: textoSuelto(300),
};
const monedaOc = z.enum(["ARS", "USD"]);
const cantidadOc = z.number().finite().positive().max(1e10);
const precioOc = z.number().finite().min(0).max(1e12).nullable().optional().transform((v) => v ?? null);
export const comprasBody = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("proveedor_guardar"), id: idCompras.optional(), ...datosProveedor }).strict(),
  z.object({ accion: z.literal("proveedor_baja"), id: idCompras, activo: z.boolean() }).strict(),
  z.object({ accion: z.literal("proveedores_importar"), nombres: z.array(z.string().trim().min(1).max(120)).min(1).max(500) }).strict(),
  z.object({ accion: z.literal("pedido_crear"), ...datosPedido }).strict().refine((p) => p.sku || p.descripcion, { message: "Elegí un artículo o escribí qué necesitás", path: ["descripcion"] }),
  // Varios pedidos de una vez, pegados de la hoja INVENTARIO: un pedido por artículo
  z.object({
    accion: z.literal("pedidos_crear"),
    items: z.array(z.object({ sku: skuMovimiento, cantidad: z.number().finite().positive().max(1e10) }).strict()).min(1).max(200),
    ot: datosPedido.ot,
    para_fecha: datosPedido.para_fecha,
    notas: datosPedido.notas,
  }).strict(),
  z.object({ accion: z.literal("pedido_anular"), id: idCompras }).strict(),
  // Corregir un pedido pendiente (121): los mismos datos que al pedir
  z.object({
    accion: z.literal("pedido_editar"),
    id: idCompras,
    ...datosPedido,
  }).strict().refine((p) => p.sku || p.descripcion, { message: "Elegí un artículo o escribí qué necesitás", path: ["descripcion"] }),
  // Órdenes de compra (parte 21, migración 114)
  z.object({
    accion: z.literal("oc_crear"),
    moneda: monedaOc.optional().default("ARS"),
    lineas: z.array(z.object({
      // Sin proveedor: el renglón va a la orden "A cotizar" (125)
      proveedor_id: idCompras.nullable().optional().transform((v) => v ?? null),
      sku: skuMovimiento.nullable().optional().transform((v) => v || null),
      descripcion: z.string().trim().min(1).max(200),
      unidad: textoSuelto(20),
      cantidad: cantidadOc,
      precio_unitario: precioOc,
      pedido_id: idCompras.nullable().optional().transform((v) => v ?? null),
      ot: otSuelto.nullable().optional().transform((v) => v || null),
    }).strict()).min(1).max(200),
  }).strict(),
  z.object({
    accion: z.literal("oc_guardar"),
    id: idCompras,
    moneda: monedaOc.optional(),
    fecha_prometida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notas: z.string().trim().max(500).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
    items: z.array(z.object({
      id: idCompras, cantidad: cantidadOc, precio_unitario: precioOc,
      // Observación del renglón para el proveedor (120); undefined = no se toca
      observacion: z.string().trim().max(300).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
    }).strict()).max(200).optional(),
    quitar: z.array(idCompras).max(200).optional(),
  }).strict(),
  z.object({ accion: z.literal("oc_enviar"), id: idCompras }).strict(),
  z.object({ accion: z.literal("oc_anular"), id: idCompras }).strict(),
  // Cerrar una OC recibida en parte: lo que falta no va a llegar (123)
  z.object({ accion: z.literal("oc_cerrar_faltantes"), id: idCompras, motivo: z.string().trim().min(1, "Escribí por qué se cierra").max(300) }).strict(),
  // Orden "A cotizar": pedir cotización a proveedores, anotar lo que contestaron y elegir (125)
  z.object({ accion: z.literal("oc_cotizacion_pedir"), id: idCompras, proveedores: z.array(idCompras).min(1).max(30) }).strict(),
  z.object({
    accion: z.literal("oc_cotizacion_guardar"),
    id: idCompras,
    total: z.number().finite().min(0).max(1e12).nullable().optional().transform((v) => v ?? null),
    plazo_dias: z.number().int().min(0).max(3650).nullable().optional().transform((v) => v ?? null),
    nota: textoSuelto(300),
  }).strict(),
  z.object({ accion: z.literal("oc_cotizacion_quitar"), id: idCompras }).strict(),
  z.object({ accion: z.literal("oc_adjudicar"), id: idCompras }).strict(),
  // Recepción con remito y factura (parte 22, migración 115)
  z.object({
    accion: z.literal("recepcion_crear"),
    orden_id: idCompras,
    remito: z.string().trim().min(1, "Poné el N° de remito").max(60),
    foto_url: z.string().trim().url().max(500).nullable().optional().transform((v) => v || null),
    notas: textoSuelto(300),
    items: z.array(z.object({ item_id: idCompras, cantidad: cantidadOc }).strict()).min(1).max(200),
  }).strict(),
  z.object({ accion: z.literal("recepcion_anular"), id: idCompras }).strict(),
  z.object({
    accion: z.literal("oc_factura"),
    id: idCompras,
    factura_numero: textoSuelto(60),
    factura_fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null),
    tipo_cambio: z.number().finite().positive().max(1e7).nullable().optional().transform((v) => v ?? null),
    // Otros impuestos de toda la factura (percepciones, internos); migración 122
    otros_impuestos: z.number().finite().min(0).max(1e12).nullable().optional(),
    // Solo los renglones que cambiaron, y en cada uno solo lo que cambió
    renglones: z.array(z.object({
      item_id: idCompras,
      precio_unitario: z.number().finite().min(0).max(1e12).nullable().optional(),
      cantidad_facturada: z.number().finite().min(0).max(1e10).nullable().optional(),
      iva_alicuota: z.number().refine((v) => [21, 10.5, 27, 0].includes(v), "IVA 21, 10,5, 27 o 0").optional(),
    }).strict()).max(200).optional(),
  }).strict(),
]);

// ── /api/carga (104): acopio y carga de la OT ─────────────────────────────
const idCarga = z.number().int().positive();
export const cargaBody = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("bulto_agregar"), ot: otSuelto, contenido: textoSuelto(300) }).strict(),
  // Los bultos de la hoja CARGA de la planilla (columna ETIQUETA), en orden
  z.object({ accion: z.literal("bultos_pegar"), ot: otSuelto, contenidos: z.array(z.string().trim().min(1).max(300)).min(1).max(200) }).strict(),
  z.object({ accion: z.literal("bulto_borrar"), id: idCarga }).strict(),
  z.object({ accion: z.literal("bulto_tildar"), id: idCarga, valor: z.boolean() }).strict(),
  z.object({ accion: z.literal("checklist"), ot: otSuelto, items: z.array(z.string().trim().min(1).max(200)).max(20) }).strict(),
  z.object({
    accion: z.literal("faltantes"),
    ot: otSuelto,
    texto: textoSuelto(1000),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null),
  }).strict(),
  z.object({ accion: z.literal("foto"), ot: otSuelto, url: z.string().trim().url().max(500).nullable() }).strict(),
  z.object({ accion: z.literal("firmar"), ot: otSuelto, rol: z.enum(["carga", "instalacion"]) }).strict(),
  z.object({ accion: z.literal("desfirmar"), ot: otSuelto }).strict(),
]);

// ── /api/acta (105): acta de conformidad de instalación ──────────────────
const fechaActa = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null);
const urlActa = z.string().trim().url().max(500);
export const actaBody = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("descarga"), id: idCarga, valor: z.boolean() }).strict(),
  z.object({ accion: z.literal("checklist"), ot: otSuelto, items: z.array(z.string().trim().min(1).max(200)).max(20) }).strict(),
  z.object({ accion: z.literal("observaciones"), ot: otSuelto, texto: textoSuelto(1000) }).strict(),
  z.object({
    accion: z.literal("pendiente_agregar"),
    ot: otSuelto,
    descripcion: z.string().trim().min(1).max(300),
    fecha: fechaActa,
    foto_url: urlActa.nullable().optional().transform((v) => v || null),
  }).strict(),
  z.object({ accion: z.literal("pendiente_borrar"), id: idCarga }).strict(),
  z.object({ accion: z.literal("pendiente_resolver"), id: idCarga, valor: z.boolean() }).strict(),
  z.object({ accion: z.literal("firmar"), ot: otSuelto, cliente_nombre: z.string().trim().min(2).max(120), firma_url: urlActa }).strict(),
  z.object({ accion: z.literal("reabrir"), ot: otSuelto }).strict(),
]);

// ── /api/instalacion (117): reporte diario del jefe de instalaciones ──────
const moduloInstalacion = z.string().trim().min(1).max(40);
export const reporteInstalacionBody = z.object({
  ot: otSuelto,
  modulos: z.array(moduloInstalacion).max(300).default([]),
  pendientes: z.array(z.object({
    descripcion: z.string().trim().min(1).max(300),
    modulo: moduloInstalacion.nullable().optional().transform((v) => v || null),
    piezas: z.array(z.number().int().positive()).max(500).nullable().optional().transform((v) => (v?.length ? v : null)),
    porcentaje: z.number().min(0).max(100).nullable().optional().transform((v) => (v == null ? null : Math.round(v * 100) / 100)),
  }).strict()).max(30).default([]),
  comentario: textoSuelto(1000),
  fotos: z.array(urlActa).max(4).default([]),
}).strict();

// ── /api/planificacion (138): plan de producción guardado, solo gerencia ───
const horasPlan = z.number().min(0).max(100000).transform((n) => Math.round(n * 100) / 100);
export const planProduccionBody = z.object({
  tipo: z.enum(["semana", "mes", "horizonte"]),
  desde: fecha,
  hasta: fecha,
  estado: z.enum(["borrador", "confirmado"]),
  division_id: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  horas_necesarias: horasPlan,
  horas_disponibles: horasPlan,
  horas_extra: horasPlan,
  dias_extra: z.array(z.object({ fecha, horas: horasPlan }).strict()).max(400).default([]),
  pendientes: z.array(z.object({ ot: otSuelto, horas: horasPlan }).strict()).max(500).default([]),
  items: z.array(z.object({
    ot: otSuelto,
    etapa: z.enum(["corte", "canteado", "mecanizado", "armado"]),
    fecha,
    horas: horasPlan,
    orden: z.number().int().min(0).max(100000),
  }).strict()).max(20000),
}).strict();

// ── /api/costo-hora (102): costo de la hora de mano de obra, solo el dueño ─
export const costoHoraBody = z.object({
  costo_hora: z.number().min(0).max(99999999).transform((n) => Math.round(n * 100) / 100),
}).strict();

// ── /api/kiosco (D7, ítem 19) ──────────────────────────────────────────────
export const kioscoActivarBody = z.object({
  nombre: z.string().trim().min(1).max(60).optional(),
}).strict();

export const kioscoFicharBody = z.object({
  legajo: z.union([z.number().int().positive(), z.string().regex(/^\d{1,9}$/)]),
  pin: z.string().regex(/^\d{4}$/),
  geo_lat: latitude.optional().nullable(),
  geo_lng: longitude.optional().nullable(),
  geo_precision: z.number().min(0).max(100000).optional().nullable(),
  forzar_cierre_tarea: z.boolean().optional(),
}).strict();

// ── /api/unirse ─────────────────────────────────────────────────────────────
export const unirseBody = z.object({
  action: z.enum(["verificar", "activar"]),
  slug: z.string().min(1).max(50),
  codigo: z.string().min(4).max(20),
  password: z.string().max(200).optional(),
  pin: z.string().max(10).optional(),
}).strict();

// ── /api/chat ───────────────────────────────────────────────────────────────
// El cliente ya no manda el prompt de sistema: solo el tipo de uso y los
// mensajes. El prompt lo arma el servidor (app/lib/iaPrompts.js).
export const chatBody = z.object({
  tipo: z.enum(["chat", "reporte_obra"]),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(8000),
  }).strict()).min(1).max(30),
}).strict();

// ── /api/chat/query ─────────────────────────────────────────────────────────
const safeParam = z.string().max(200).regex(/^[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s_.\-/]+$/);
export const chatQueryBody = z.object({
  query_type: z.string().max(50),
  params: z.record(z.string(), z.union([z.string().max(200), z.number()])).optional(),
}).strict();

// ── /api/config-empresa ─────────────────────────────────────────────────────
// Unidad en que se mide una etapa (099): "placas", "metros"…; vacío = sin unidad
const unidadEtapa = z.string().trim().max(20).nullable().optional().transform((v) => (v === "" ? null : v));
// Qué tiene que cumplirse para firmar el cierre de la etapa (100)
const condicionCierre = z.string().trim().max(300).nullable().optional().transform((v) => (v === "" ? null : v));
// Se escanea por pieza (112) y en qué columnas de la planilla se fija Gypi;
// vacío = pasan todas las piezas
const porPieza = z.boolean().optional();
const columnaPieza = z.string().trim().max(300).nullable().optional().transform((v) => (v === "" ? null : v));

export const configPostBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_division"),
    clave: z.string().min(1).max(50),
    label: shortString,
    icon: icono.optional(),
    color: color.optional(),
    orden: z.number().int().min(0).max(999).optional(),
  }),
  z.object({
    action: z.literal("add_etapa"),
    // Sin código, el servidor usa el siguiente libre (pantalla de Rutas)
    codigo: z.number().int().optional(),
    nombre: shortString,
    icon: icono.optional(),
    color: color.optional(),
    orden: z.number().int().min(0).max(999).optional(),
    unidad: unidadEtapa,
    condicion_cierre: condicionCierre,
    por_pieza: porPieza,
    columna_pieza: columnaPieza,
  }),
  z.object({
    action: z.literal("save_logo"),
    logo_url: z.string().max(2048).nullable(),
  }),
  z.object({
    action: z.literal("add_planta"),
    nombre: z.string().trim().min(1).max(80),
    direccion: z.string().trim().max(200).optional().nullable(),
  }),
]);

export const configPatchBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_division"),
    id: uuid,
    label: shortString.optional(),
    icon: icono.optional(),
    color: color.optional(),
    orden: z.number().int().min(0).max(999).optional(),
    activa: z.boolean().optional(),
    // Ruta de etapas (098): códigos en orden; null o [] = sin ruta
    ruta_etapas: z.array(z.number().int().min(1).max(999)).max(40).nullable().optional(),
  }),
  z.object({
    action: z.literal("update_etapa"),
    id: uuid,
    nombre: shortString.optional(),
    icon: icono.optional(),
    color: color.optional(),
    codigo: z.number().int().optional(),
    orden: z.number().int().min(0).max(999).optional(),
    activa: z.boolean().optional(),
    unidad: unidadEtapa,
    condicion_cierre: condicionCierre,
    por_pieza: porPieza,
    columna_pieza: columnaPieza,
  }),
  z.object({
    // Checklist de liberación de la OT (100); [] = sin checklist
    action: z.literal("update_checklist"),
    items: z.array(z.string().trim().min(1).max(200)).max(20),
  }),
  z.object({
    // Checklist de carga del camión (104); [] = sin checklist
    action: z.literal("update_checklist_carga"),
    items: z.array(z.string().trim().min(1).max(200)).max(20),
  }),
  z.object({
    // Checklist de instalación en obra (105); [] = sin checklist
    action: z.literal("update_checklist_instalacion"),
    items: z.array(z.string().trim().min(1).max(200)).max(20),
  }),
  z.object({
    // Defectos de la empresa (101); [] vuelve a los de siempre
    action: z.literal("update_defectos"),
    defectos: z.array(z.object({
      cod: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/),
      nombre: z.string().trim().min(1).max(60),
      origen: z.number().int().min(1).max(999).nullable().optional(),
    })).max(30),
  }),
  z.object({
    // Causas de parada de la empresa (099); [] vuelve a las de siempre
    action: z.literal("update_causas"),
    causas: z.array(z.object({
      cod: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/),
      nombre: z.string().trim().min(1).max(60),
      icon: emoji.optional(),
    })).max(20),
  }),
  z.object({
    action: z.literal("update_planta"),
    id: uuid,
    nombre: z.string().trim().min(1).max(80).optional(),
    direccion: z.string().trim().max(200).optional().nullable(),
  }),
]);

// ── /api/send-push ──────────────────────────────────────────────────────────
export const sendPushBody = z.object({
  // Solo dígitos: el valor se interpola en el filtro de PostgREST.
  legajo: z.union([z.number().int().positive(), z.string().regex(/^\d{1,20}$/)]).optional(),
  rol: rol.optional(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  data: z.record(z.string(), z.string().max(500)).optional(),
}).strict();

// ── /api/registro-empresa ───────────────────────────────────────────────────
export const registroEmpresaBody = z.object({
  nombre_empresa: shortString,
  nombre_admin: shortString,
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  rubro: z.string().max(50).optional(),
}).strict();

// ── /api/contacto-enterprise ────────────────────────────────────────────────
export const contactoEnterpriseBody = z.object({
  nombre: shortString,
  email: z.string().email().max(254),
  empresa: shortString,
  telefono: z.string().max(30).optional(),
  mensaje: z.string().max(1000).optional(),
}).strict();

// ── /api/contacto ────────────────────────────────────────────────────────────
export const contactoBody = z.object({
  nombre: shortString,
  email: z.string().email().max(254),
  telefono: z.string().max(30).optional(),
  mensaje: z.string().min(1).max(1000),
  // Honeypot anti-bot: campo oculto en el form que un usuario real nunca completa.
  web: z.string().max(0).optional(),
}).strict();

// ── /api/empresa PATCH ──────────────────────────────────────────────────────
export const empresaPatchBody = z.object({
  nombre: shortString.optional(),
  nombre_corto: shortString.optional(),
  rubro: z.string().max(50).optional(),
  color_primario: color.optional(),
  color_secundario: color.optional(),
  color_fondo: color.optional(),
  color_texto: color.optional(),
  typography: z.string().max(50).optional(),
  theme_preset: z.string().max(50).optional(),
  logo_url: z.string().max(2048).optional().nullable(),
  prompt_ia_obra: z.string().max(5000).optional(),
  prompt_ia_chat: z.string().max(5000).optional(),
  // Escaneo de OT con la cámara al iniciar una tarea (D8, migración 074)
  escaner_ot: z.boolean().optional(),
  resumen_semanal: z.boolean().optional(),
  // Tipos de solicitud que ofrece la empresa (H9, migración 076). null = los de siempre
  tipos_solicitud: z.array(z.object({
    clave: z.string().max(40).optional(),
    nombre: z.string().trim().min(1).max(40),
    base: z.enum(["permiso", "vacaciones", "ausencia", "justificacion", "cambio_horario", "otro"]),
    multiDia: z.boolean().optional(),
  }).strict()).max(20).nullable().optional(),
  // Reglas de asistencia de la fábrica (D5). null = sin bloqueo.
  reglas_asistencia: z.object({
    tolerancia_min: z.number().int().min(0).max(120),
    bloqueo_min: z.number().int().min(1).max(600).nullable(),
    bloqueo_tardanzas_mes: z.number().int().min(1).max(31).nullable(),
    permiso_salida_anticipada: z.boolean().optional(),
  }).strict().optional(),
}).strict();

// ── /api/login-empresa ──────────────────────────────────────────────────────
export const loginBody = z.object({
  legajo: z.union([z.number(), z.string().max(254)]),
  password: z.string().min(1).max(200),
  empresa_id: uuid,
}).strict();

// Ingreso con PIN (F4-06): solo legajo numérico, nunca email
export const loginPinBody = z.object({
  legajo: z.union([z.number().int().positive(), z.string().regex(/^\d{1,9}$/)]),
  pin: z.string().regex(/^\d{4}$/),
  empresa_id: uuid,
}).strict();

export const crearPinBody = z.object({
  pin: z.string().regex(/^\d{4}$/),
}).strict();

export const cambiarPasswordBody = z.object({
  action: z.literal("cambiar_password"),
  userId: uuid,
  nuevaPassword: z.string().min(8).max(200),
}).strict();

// POST /api/solicitudes/resolver — aprobar o rechazar (ítem 38)
export const resolverSolicitudBody = z.object({
  id: z.number().int().positive(),
  estado: z.enum(["aprobado", "rechazado"]),
  nota: z.string().trim().max(500).optional().nullable(),
}).strict();

// ── /api/flota (126): vehículos y sus papeles (Mantenimiento parte 28) ──────
const idFlota = z.number().int().positive();
const fechaFlota = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null);
const idPlantilla = z.string().trim().regex(/^[a-z0-9_]{1,40}$/);
// Parte 30 (128): lo que la empresa cambió de cada cuánto se revisa cada aspecto
const ASPECTOS_FLOTA = ["limpieza", "fluidos", "neumaticos", "luces", "itv", "documentacion", "service"] as const;
const frecuenciaFlota = z.object({
  dias: z.number().int().min(1).max(3650).optional(),
  km: z.number().int().min(1).max(1000000).optional(),
}).strict();
const frecuenciasFlota = z.partialRecord(z.enum(ASPECTOS_FLOTA), frecuenciaFlota);
const urlFoto = z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "La foto tiene que ser https");
export const flotaBody = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("vehiculo_guardar"),
    id: idFlota.optional(),
    patente: z.string().trim().min(2, "Poné la patente").max(20),
    tipo: z.enum(["auto", "utilitario", "camioneta", "camion", "acoplado", "autoelevador", "otro"]),
    marca: textoSuelto(60),
    modelo: textoSuelto(80),
    anio: z.number().int().min(1950).max(2100).nullable().optional().transform((v) => v ?? null),
    color: textoSuelto(40),
    motor: textoSuelto(40),
    chasis: textoSuelto(40),
    km: z.number().int().min(0).max(9999999).nullable().optional().transform((v) => v ?? null),
    combustible: z.enum(["nafta", "gasoil", "gnc", "electrico", "otro"]).nullable().optional().transform((v) => v ?? null),
    foto_url: urlFoto.nullable().optional().transform((v) => v || null),
    division: textoSuelto(60),
    responsable_id: uuid.nullable().optional().transform((v) => v || null),
    notas: textoSuelto(500),
    service_fecha: fechaFlota,
    service_km: z.number().int().min(0).max(9999999).nullable().optional().transform((v) => v ?? null),
    frecuencias: frecuenciasFlota.optional(),
  }).strict(),
  z.object({ accion: z.literal("vehiculo_baja"), id: idFlota, activo: z.boolean() }).strict(),
  z.object({
    accion: z.literal("papel_guardar"),
    // Con id se corrige; sin id se agrega (renovar = agregar uno nuevo)
    id: idFlota.optional(),
    vehiculo_id: idFlota,
    tipo: z.enum(["seguro", "itv", "cedula", "titulo", "patente", "matafuego", "otro"]),
    nombre: textoSuelto(80),
    numero: textoSuelto(60),
    fecha: fechaFlota,
    vencimiento: fechaFlota,
    compania: textoSuelto(80),
    cobertura: textoSuelto(120),
    resultado: z.enum(["apto", "condicional", "rechazado"]).nullable().optional().transform((v) => v ?? null),
    detalle: textoSuelto(300),
    fotos: z.array(urlFoto).max(4).default([]),
  }).strict().refine((p) => p.tipo !== "otro" || p.nombre, { message: "Poné el nombre del papel", path: ["nombre"] }),
  z.object({ accion: z.literal("papel_borrar"), id: idFlota }).strict(),
  z.object({
    accion: z.literal("licencia_guardar"),
    empleado_id: uuid,
    categoria: textoSuelto(30),
    vencimiento: fechaFlota,
  }).strict(),
  // Checklist de mantenimiento (parte 29, migración 127)
  z.object({
    accion: z.literal("checklist_crear"),
    vehiculo_id: idFlota,
    km: z.number().int().min(0).max(9999999),
    combustible: z.enum(["reserva", "1/4", "1/2", "3/4", "lleno"]).nullable().optional().transform((v) => v ?? null),
    secciones: z.array(idPlantilla).min(1).max(20),
    items: z.array(z.object({
      seccion: idPlantilla,
      seccion_nombre: z.string().trim().min(1).max(60),
      punto: idPlantilla,
      nombre: z.string().trim().min(1).max(120),
      estado: z.enum(["bien", "revisar", "mal", "na"]),
      valor: textoSuelto(20),
      unidad: textoSuelto(10),
      nota: textoSuelto(300),
      foto: urlFoto.nullable().optional().transform((v) => v || null),
      // Parte 31 (129): un punto en Mal que deja el vehículo sin poder circular
      no_circula: z.boolean().optional(),
    }).strict()).min(1).max(400),
    observaciones: textoSuelto(1000),
    fotos: z.array(urlFoto).max(4).default([]),
    firma_url: urlFoto.nullable().optional().transform((v) => v || null),
  }).strict(),
  z.object({
    accion: z.literal("checklist_plantilla_guardar"),
    // null = volver a la de fábrica
    checklist: z.array(z.object({
      id: idPlantilla,
      nombre: z.string().trim().min(1).max(60),
      emoji: z.string().trim().max(8).nullable().optional().transform((v) => v || null),
      puntos: z.array(z.object({
        id: idPlantilla,
        nombre: z.string().trim().min(1).max(120),
        valor: z.string().trim().max(10).nullable().optional().transform((v) => v || null),
        minimo: z.number().finite().min(0).max(100000).nullable().optional().transform((v) => v ?? null),
      }).strict()).min(1).max(40),
    }).strict()).min(1).max(20).nullable(),
  }).strict(),
  // Parte 31 (129): arreglos, services y reparaciones
  z.object({
    accion: z.literal("arreglo_crear"),
    vehiculo_id: idFlota,
    checklist_id: idFlota.nullable().optional().transform((v) => v ?? null),
    seccion_nombre: textoSuelto(60),
    punto_nombre: textoSuelto(120),
    descripcion: z.string().trim().min(1, "Escribí qué hay que arreglar").max(300),
    foto: urlFoto.nullable().optional().transform((v) => v || null),
    prioridad: z.enum(["no_circula", "pronto"]),
    responsable_id: uuid.nullable().optional().transform((v) => v || null),
  }).strict(),
  z.object({
    accion: z.literal("arreglo_editar"),
    id: idFlota,
    prioridad: z.enum(["no_circula", "pronto"]),
    responsable_id: uuid.nullable().optional().transform((v) => v || null),
  }).strict(),
  z.object({
    accion: z.literal("arreglo_descartar"),
    id: idFlota,
    motivo: z.string().trim().min(1, "Contá por qué se descarta").max(300),
  }).strict(),
  z.object({
    // Resolver un arreglo (arreglo_id) o cargar un service o reparación
    accion: z.literal("mantenimiento_crear"),
    vehiculo_id: idFlota,
    arreglo_id: idFlota.nullable().optional().transform((v) => v ?? null),
    tipo: z.enum(["service", "reparacion", "arreglo"]),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha"),
    km: z.number().int().min(0).max(9999999).nullable().optional().transform((v) => v ?? null),
    donde: z.enum(["taller", "interno"]).nullable().optional().transform((v) => v ?? null),
    taller: textoSuelto(120),
    detalle: z.string().trim().min(1, "Escribí qué se hizo").max(1000),
    repuestos: textoSuelto(1000),
    costo: z.number().finite().min(0).max(999999999).nullable().optional().transform((v) => v ?? null),
    factura_url: urlFoto.nullable().optional().transform((v) => v || null),
    fotos: z.array(urlFoto).max(4).default([]),
  }).strict(),
  z.object({ accion: z.literal("mantenimiento_borrar"), id: idFlota }).strict(),
  // Parte 34 (133): responsable de mantenimiento y suplente de un vehículo
  z.object({
    accion: z.literal("mantenimiento_asignar"),
    vehiculo_id: idFlota,
    responsable_id: uuid.nullable().optional().transform((v) => v || null),
    suplente_id: uuid.nullable().optional().transform((v) => v || null),
  }).strict(),
]);
// ── /api/maquinaria (132): máquinas y su plan de mantenimiento (Mantenimiento parte 33) ──
const horasMaquina = z.number().int().min(0).max(9999999);
const puntoTarea = z.object({
  id: idPlantilla,
  nombre: z.string().trim().min(1).max(120),
  valor: z.string().trim().max(10).nullable().optional().transform((v) => v || null),
}).strict();
const camposTarea = {
  nombre: z.string().trim().min(1, "Poné el nombre de la tarea").max(80),
  cada_dias: z.number().int().min(1).max(3650).nullable().optional().transform((v) => v ?? null),
  cada_horas: z.number().int().min(1).max(100000).nullable().optional().transform((v) => v ?? null),
  aviso_dias: z.number().int().min(0).max(365).default(0),
  aviso_horas: z.number().int().min(0).max(100000).default(0),
  checklist: z.array(puntoTarea).min(1, "La tarea necesita al menos un punto para revisar").max(40),
  quien: z.enum(["interno", "externo"]).default("interno"),
  duracion_min: z.number().int().min(1).max(10000).nullable().optional().transform((v) => v ?? null),
  parar_maquina: z.boolean().default(true),
  seguridad: textoSuelto(300),
  insumos: textoSuelto(300),
};
const conFrecuencia = (t: { cada_dias: number | null; cada_horas: number | null }) => t.cada_dias != null || t.cada_horas != null;
const sinFrecuencia = { message: "Poné cada cuántos días o cada cuántas horas", path: ["cada_dias"] };
export const maquinariaBody = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("maquina_guardar"),
    id: idFlota.optional(),
    codigo: z.string().trim().min(1, "Poné el código").max(20),
    nombre: z.string().trim().min(1, "Poné el nombre").max(80),
    tipo: z.string().trim().regex(/^[a-z_]{1,30}$/),
    marca: textoSuelto(60),
    modelo: textoSuelto(80),
    serie: textoSuelto(60),
    anio: z.number().int().min(1950).max(2100).nullable().optional().transform((v) => v ?? null),
    ubicacion: textoSuelto(80),
    division: textoSuelto(60),
    foto_url: urlFoto.nullable().optional().transform((v) => v || null),
    manual_url: urlFoto.nullable().optional().transform((v) => v || null),
    criticidad: z.enum(["A", "B", "C"]),
    con_horometro: z.boolean().default(false),
    horas: horasMaquina.nullable().optional().transform((v) => v ?? null),
    servicio_tecnico: textoSuelto(80),
    servicio_telefono: textoSuelto(40),
    estado: z.enum(["en_servicio", "parada", "fuera_de_servicio"]).default("en_servicio"),
    notas: textoSuelto(500),
    // Solo en el alta: cargar las tareas de la plantilla de su tipo
    con_plantilla: z.boolean().optional(),
  }).strict(),
  z.object({ accion: z.literal("maquina_baja"), id: idFlota, activo: z.boolean() }).strict(),
  z.object({ accion: z.literal("horas_guardar"), id: idFlota, horas: horasMaquina }).strict(),
  z.object({
    accion: z.literal("tarea_guardar"),
    id: idFlota.optional(),
    maquina_id: idFlota,
    ...camposTarea,
    // La última vez que se hizo, si se sabe (sin registro se cuenta desde el alta)
    ultima_fecha: fechaFlota,
    ultima_horas: horasMaquina.nullable().optional().transform((v) => v ?? null),
  }).strict().refine(conFrecuencia, sinFrecuencia),
  z.object({ accion: z.literal("tarea_borrar"), id: idFlota }).strict(),
  z.object({
    accion: z.literal("registro_crear"),
    tarea_id: idFlota,
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horas: horasMaquina.nullable().optional().transform((v) => v ?? null),
    seguridad_ok: z.boolean().default(false),
    items: z.array(z.object({
      punto: idPlantilla,
      nombre: z.string().trim().min(1).max(120),
      estado: z.enum(["bien", "revisar", "mal", "na"]),
      valor: textoSuelto(20),
      unidad: textoSuelto(10),
      nota: textoSuelto(300),
      foto: urlFoto.nullable().optional().transform((v) => v || null),
    }).strict()).min(1).max(40),
    observaciones: textoSuelto(1000),
    fotos: z.array(urlFoto).max(4).default([]),
    firma_url: urlFoto.nullable().optional().transform((v) => v || null),
  }).strict(),
  // Parte 34 (133): responsable de mantenimiento y suplente de una máquina
  z.object({
    accion: z.literal("responsables_guardar"),
    maquina_id: idFlota,
    responsable_id: uuid.nullable().optional().transform((v) => v || null),
    suplente_id: uuid.nullable().optional().transform((v) => v || null),
  }).strict(),
  // Parte 35 (134): fallas y arreglos
  z.object({
    accion: z.literal("falla_crear"),
    maquina_id: idFlota,
    descripcion: z.string().trim().min(1, "Contá qué le pasa").max(300),
    foto: urlFoto.nullable().optional().transform((v) => v || null),
    parada: z.boolean().default(false),
  }).strict(),
  z.object({
    accion: z.literal("falla_editar"),
    id: idFlota,
    responsable_id: uuid.nullable().optional().transform((v) => v || null),
    // Una falla que empeoró y dejó la máquina parada (volver atrás es arreglarla)
    parada: z.literal(true).optional(),
  }).strict(),
  z.object({
    accion: z.literal("falla_resolver"),
    id: idFlota,
    detalle: z.string().trim().min(1, "Escribí qué se hizo").max(1000),
    donde: z.enum(["interno", "externo"]).default("interno"),
    repuestos: textoSuelto(1000),
    costo: z.number().finite().min(0).max(999999999).nullable().optional().transform((v) => v ?? null),
    factura_url: urlFoto.nullable().optional().transform((v) => v || null),
    fotos: z.array(urlFoto).max(4).default([]),
  }).strict(),
  z.object({ accion: z.literal("falla_descartar"), id: idFlota, motivo: z.string().trim().min(1, "Poné el motivo").max(300) }).strict(),
]);
