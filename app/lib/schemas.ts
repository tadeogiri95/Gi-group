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
    POST: ["legajo", "tipo", "motivo", "fecha", "desde", "hasta", "nombre_empleado", "empleado_id", "estado", "destinatario_rol"],
    PATCH: ["estado", "aprobador", "resuelto_at"],
  },
  notificaciones: {
    POST: ["destinatario_rol", "tipo", "asunto", "detalle", "legajo_destino", "empleado_id"],
    PATCH: ["leida"],
  },
  empleados: {
    POST: ["legajo", "nombre", "apodo", "email", "area", "division", "rol", "diagrama", "activo", "password", "debe_cambiar_password", "estado_activacion"],
    PATCH: ["nombre", "apodo", "email", "area", "division", "diagrama", "activo", "debe_cambiar_password"],
  },
  registro_actividades: {
    POST: ["empleado_id", "legajo", "etapa", "codigo_proyecto", "hora_inicio", "hora_fin", "duracion_min", "observaciones", "fecha"],
    PATCH: ["hora_fin", "duracion_min", "observaciones", "etapa"],
  },
  reportes_obra: {
    POST: ["nombre", "legajo", "fecha", "texto_original", "texto_formateado", "progreso", "fotos"],
    PATCH: ["texto_formateado", "progreso"],
  },
  proyectos: {
    POST: ["codigo", "nombre", "estado", "ot", "cliente", "obra", "proyecto", "division"],
    PATCH: ["nombre", "estado", "ot", "cliente", "obra", "proyecto", "division"],
  },
  push_tokens: {
    POST: ["legajo", "token", "plataforma"],
    PATCH: [],
  },
  geo_zonas: {
    POST: ["nombre", "lat", "lng", "radio"],
    PATCH: ["nombre", "lat", "lng", "radio"],
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
  tipo: z.enum(["permiso", "vacaciones", "justificacion", "tardanza", "ausencia", "cambio_horario", "otro"]),
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
  legajo_destino: z.union([z.number(), z.string()]).optional(),
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
  forzar_cierre_tarea: z.boolean().optional(),
}).strip();

// ── /api/unirse ─────────────────────────────────────────────────────────────
export const unirseBody = z.object({
  action: z.enum(["verificar", "activar"]),
  slug: z.string().min(1).max(50),
  legajo: z.union([z.number(), z.string().max(20)]),
  password: z.string().max(200).optional(),
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
]);

// ── /api/send-push ──────────────────────────────────────────────────────────
export const sendPushBody = z.object({
  legajo: z.union([z.number(), z.string().max(20)]).optional(),
  rol: z.string().max(30).optional(),
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
}).strict();

// ── /api/login-empresa ──────────────────────────────────────────────────────
export const loginBody = z.object({
  legajo: z.union([z.number(), z.string().max(254)]),
  password: z.string().min(1).max(200),
  empresa_id: uuid,
}).strict();

export const cambiarPasswordBody = z.object({
  action: z.literal("cambiar_password"),
  userId: uuid,
  nuevaPassword: z.string().min(8).max(200),
}).strict();
