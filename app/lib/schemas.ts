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
    PATCH: ["hora_fin", "duracion_min", "observaciones", "etapa"],
  },
  reportes_obra: {
    POST: ["nombre", "legajo", "fecha", "texto_original", "texto_formateado", "progreso", "fotos"],
    PATCH: ["texto_formateado", "progreso"],
  },
  proyectos: {
    POST: ["estado", "ot", "cliente", "obra", "proyecto", "division"],
    PATCH: ["estado", "ot", "cliente", "obra", "proyecto", "division"],
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
    POST: ["fecha", "texto", "empleado_id"],
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
  etapa: z.number().int().min(0).max(8).optional(),
  codigo_proyecto: z.union([z.string().trim().max(40), z.number()]).optional().nullable(),
  tipo: z.enum(["N", "R", "E", "C"]).optional(),
  causa: z.enum(["M", "H", "I", "O"]).optional().nullable(),
  observaciones: z.string().trim().max(500).optional().nullable(),
  op_id: z.string().uuid().optional(),
  momento: z.string().datetime({ offset: true }).optional(),
}).strict().refine((b) => b.accion !== "iniciar" || b.etapa != null, { message: "Falta la etapa" })
  .refine((b) => b.accion !== "iniciar" || b.etapa !== 0 || !!b.causa, { message: "Una espera necesita la causa" })
  .refine((b) => b.accion !== "iniciar" || b.etapa === 0 || (b.codigo_proyecto != null && String(b.codigo_proyecto) !== ""), { message: "Falta la OT" });

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
    codigo: z.number().int(),
    nombre: shortString,
    icon: emoji.optional(),
    color: color.optional(),
    orden: z.number().int().min(0).max(999).optional(),
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
