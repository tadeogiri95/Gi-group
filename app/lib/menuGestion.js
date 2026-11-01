// app/lib/menuGestion.js — Menú "Más" de gestión (reforma UX R5).
//
// Como máximo dos niveles: la lista y la pantalla. Lo de todos los días va
// arriba y lo que se configura una vez, abajo. Cada sección aparece una sola
// vez; lo que la empresa no contrató se ve con 🔒, lo que apagó en Módulos
// no se ve y lo que el rol no puede usar no se muestra (el supervisor no ve
// Empresa ni Facturación).
import { seccionBloqueada, seccionApagada, tieneModulo, moduloApagado, conRegistroTareas } from "./modulos";

// Botones de la barra de gestión que agrupan pantallas en pestañas (menú
// nuevo, parte 32): Proyectos (OT y reportes de producción), Inventario
// (Stock y Compras) y Mantenimiento (Flota vehicular y Maquinaria, parte 33).
// Reemplazan a "Planta".
// Cada pestaña es de un módulo: lo apagado no se ve y lo no contratado va con
// 🔒. "En vivo" sale del registro de tareas y no se muestra sin él (2026-10).
export const BOTONES_GESTION = {
  // Auditoría 01/11 (PR 3): "Proyectos" pasa a llamarse "Producción" e
  // "Inventario", "Materiales"; los ids quedan igual (enlaces y avisos viejos).
  proyectos: {
    label: "Producción",
    detalle: "Órdenes de trabajo, planificación y reportes",
    opciones: [
      { id: "vivo", label: "En vivo", modulo: "actividad", conTareas: true },
      { id: "ot", label: "OT", modulo: "proyectos" },
      { id: "reportes", label: "Reportes", modulo: "actividad" },
      // Planificación de la producción (parte 38): solo la arma gerencia
      { id: "planificacion", label: "Planificación", modulo: "proyectos", soloGerencia: true },
    ],
  },
  inventario: {
    label: "Materiales",
    detalle: "Stock y compras",
    opciones: [
      { id: "stock", label: "Stock", modulo: "stock" },
      { id: "compras", label: "Compras", modulo: "compras" },
    ],
  },
  mantenimiento: {
    label: "Mantenimiento",
    detalle: "Flota vehicular y maquinaria",
    opciones: [
      { id: "flota", label: "Flota vehicular", modulo: "flota" },
      { id: "maquinaria", label: "Maquinaria", modulo: "maquinaria" },
    ],
  },
};

/** Pestañas de un botón para esta empresa: sin lo apagado, lo que pide el
 *  registro de tareas ni lo que es solo de gerencia (si no lo es el usuario). */
export function opcionesBoton(boton, empresa, usuario = null) {
  return (BOTONES_GESTION[boton]?.opciones || [])
    .filter((o) => (!o.conTareas || conRegistroTareas(empresa)) && !moduloApagado(empresa, o.modulo))
    .filter((o) => !o.soloGerencia || usuario?.rol === "gerencial");
}

/** ¿Va el botón en la barra? Solo si la empresa tiene alguno de sus módulos. */
export function conBoton(boton, empresa) {
  return opcionesBoton(boton, empresa).some((o) => tieneModulo(empresa, o.modulo));
}

// Los enlaces viejos a "Planta" (?screen=planta, "planta:compras") van al botón nuevo
const PLANTA_A_BOTON = { vivo: "proyectos", ot: "proyectos", reportes: "proyectos", stock: "inventario", compras: "inventario", flota: "mantenimiento", maquinaria: "mantenimiento" };

export function esSupervisor(usuario) {
  return usuario?.rol === "administrativo" && !!usuario?.solo_su_division;
}

// "Más" agrupado por tema (auditoría 01/11, PR 3): Personas, Cómo trabaja la
// planta (toda la configuración de producción en un solo lugar), Empresa y Tu
// cuenta. Permisos y Equipo abren su propia pantalla (pantalla). Sin el botón
// Producción, las OT quedan acá.
// conProyectos: solo si la empresa tiene las OT; soloGerencia: solo el dueño.
const SECCIONES = [
  { id: "equipo", pantalla: "equipo", grupo: "personas", icono: "👥", label: "Equipo y horarios", detalle: "Personas, turnos, calendario, reportes y documentos" },
  { id: "permisos", pantalla: "solicitudes", grupo: "personas", icono: "📨", label: "Permisos", detalle: "Vacaciones, faltas y avisos del personal", conPendientes: true },
  { id: "asistencia", grupo: "personas", icono: "⏱️", label: "Reglas de asistencia y permisos", detalle: "Tolerancia, bloqueos y tipos de permiso" },
  { id: "proyectos", grupo: "planta", icono: "📋", label: "OT", detalle: "Órdenes de trabajo", soloSinProyectos: true },
  { id: "produccion", grupo: "planta", icono: "🏭", label: "Producción", detalle: "Divisiones, etapas, rutas, paradas, liberación, carga, defectos", sinSupervisor: true },
  { id: "planificacion", grupo: "planta", icono: "📅", label: "Planificación", detalle: "Tiempos, máquinas, feriados y capacidad", conProyectos: true, soloGerencia: true },
  { id: "planillas", grupo: "planta", icono: "🔗", label: "Planillas conectadas", detalle: "Plan de trabajo, MRP y scripts, todo en un lugar", conProyectos: true, sinSupervisor: true },
  { id: "admin", grupo: "empresa", icono: "🏢", label: "Datos y apariencia", detalle: "Nombre, logo, colores y resumen semanal", sinSupervisor: true },
  { id: "ubicaciones", grupo: "empresa", icono: "📍", label: "Ubicaciones y plantas", detalle: "Dónde se puede fichar" },
  { id: "reglas", grupo: "empresa", icono: "💬", label: "Asistente", detalle: "Cómo responde el asistente al equipo" },
  { id: "modulos", grupo: "empresa", icono: "🧩", label: "Módulos", detalle: "Prendé o apagá lo que usa la empresa", sinSupervisor: true },
  { id: "facturacion", grupo: "empresa", icono: "💳", label: "Plan y facturación", detalle: "Tu plan, pagos y comprobantes", soloGerencia: true },
  { id: "privacidad", grupo: "cuenta", icono: "👤", label: "Mi cuenta y privacidad", detalle: "Tus datos y cerrar sesión" },
];

export const GRUPOS = [
  { id: "personas", titulo: "Personas" },
  { id: "planta", titulo: "Cómo trabaja la planta" },
  { id: "empresa", titulo: "Empresa" },
  { id: "cuenta", titulo: "Tu cuenta" },
];

/** Secciones visibles para esta empresa y este usuario, con su candado. */
export function seccionesMas({ empresa, usuario } = {}) {
  const proyectos = conBoton("proyectos", empresa);
  return SECCIONES
    .filter((s) => !(s.soloSinProyectos && proyectos))
    .filter((s) => !(s.sinSupervisor && esSupervisor(usuario)))
    .filter((s) => !(s.conProyectos && !proyectos))
    .filter((s) => !(s.soloGerencia && usuario?.rol !== "gerencial"))
    .filter((s) => !seccionApagada(s.id, empresa))
    .map((s) => ({ ...s, bloqueado: seccionBloqueada(s.id, empresa) }));
}

export function seccionPorId(id, opciones) {
  return seccionesMas(opciones).find((s) => s.id === id) || null;
}

/**
 * Destino de navegación "pantalla" o "pantalla:sección" (p. ej. "config:ubicaciones",
 * que usa la lista de primeros pasos para abrir la sección justa).
 */
export function partirDestino(destino) {
  const [pantalla, seccion = null] = String(destino || "home").split(":");
  if (pantalla === "planta") return { pantalla: PLANTA_A_BOTON[seccion] || "proyectos", seccion };
  return { pantalla, seccion };
}
