import { z } from "zod";

// ── Primitives ──────────────────────────────────────────────────────────────
export const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
export const slug = z.string().min(1).max(50).regex(/^[a-z0-9-]+$/);
export const color = z.string().max(20).regex(/^#[0-9a-fA-F]{3,8}$/);
export const emoji = z.string().max(4);
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
    PATCH: ["estado", "ot", "cliente", "obra", "proyecto", "division", "total_modulos"],
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
const etapasPieza = z.array(z.enum(["corte", "canto", "cnc", "especial"])).min(1).max(4)
  .transform((l) => ["corte", "canto", "cnc", "especial"].filter((e) => l.includes(e as never)));
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

export const configPostBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_division"),
    clave: z.string().min(1).max(50),
    label: shortString,
    icon: emoji.optional(),
    color: color.optional(),
    orden: z.number().int().min(0).max(999).optional(),
  }),
  z.object({
    action: z.literal("add_etapa"),
    // Sin código, el servidor usa el siguiente libre (pantalla de Rutas)
    codigo: z.number().int().optional(),
    nombre: shortString,
    icon: emoji.optional(),
    color: color.optional(),
    orden: z.number().int().min(0).max(999).optional(),
    unidad: unidadEtapa,
    condicion_cierre: condicionCierre,
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
    icon: emoji.optional(),
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
    icon: emoji.optional(),
    color: color.optional(),
    codigo: z.number().int().optional(),
    orden: z.number().int().min(0).max(999).optional(),
    activa: z.boolean().optional(),
    unidad: unidadEtapa,
    condicion_cierre: condicionCierre,
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
