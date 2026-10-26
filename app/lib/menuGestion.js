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
  proyectos: {
    label: "Proyectos",
    detalle: "Órdenes de trabajo y reportes",
    opciones: [
      { id: "vivo", label: "En vivo", modulo: "actividad", conTareas: true },
      { id: "ot", label: "OT", modulo: "proyectos" },
      { id: "reportes", label: "Reportes", modulo: "actividad" },
      // Planificación de la producción (parte 38): solo la arma gerencia
      { id: "planificacion", label: "Planificación", modulo: "proyectos", soloGerencia: true },
    ],
  },
  inventario: {
    label: "Inventario",
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

// "Más" tiene arriba Permisos y Equipo (dejaron la barra en el menú nuevo,
// parte 32), que abren su propia pantalla (pantalla), y abajo los ajustes.
// Sin el botón Proyectos, las OT quedan acá.
const SECCIONES = [
  { id: "permisos", pantalla: "solicitudes", grupo: "dia", icono: "📨", label: "Permisos", detalle: "Permisos, vacaciones y avisos del personal", conPendientes: true },
  { id: "equipo", pantalla: "equipo", grupo: "dia", icono: "👥", label: "Equipo", detalle: "Personas, horarios, calendario, reportes y documentos" },
  { id: "proyectos", grupo: "dia", icono: "📋", label: "OT", detalle: "Órdenes de trabajo", soloSinProyectos: true },
  { id: "ubicaciones", grupo: "config", icono: "📍", label: "Ubicaciones y plantas", detalle: "Dónde se puede fichar" },
  { id: "asistencia", grupo: "config", icono: "⏱️", label: "Reglas de asistencia y permisos", detalle: "Tolerancia, bloqueos y tipos de permiso" },
  { id: "reglas", grupo: "config", icono: "💬", label: "Asistente", detalle: "Cómo responde el asistente al equipo" },
  { id: "admin", grupo: "config", icono: "🏢", label: "Empresa", detalle: "Nombre, logo, colores, divisiones y etapas", sinSupervisor: true },
  { id: "modulos", grupo: "config", icono: "🧩", label: "Módulos", detalle: "Prendé o apagá lo que usa la empresa", sinSupervisor: true },
  { id: "facturacion", grupo: "config", icono: "💳", label: "Plan y facturación", detalle: "Tu plan, pagos y comprobantes", soloDueno: true },
  { id: "privacidad", grupo: "config", icono: "👤", label: "Mi cuenta y privacidad", detalle: "Tus datos y cerrar sesión" },
];

export const GRUPOS = [
  { id: "dia", titulo: "Día a día" },
  { id: "config", titulo: "Configuración" },
];

/** Secciones visibles para esta empresa y este usuario, con su candado. */
export function seccionesMas({ empresa, usuario } = {}) {
  const proyectos = conBoton("proyectos", empresa);
  return SECCIONES
    .filter((s) => !(s.soloSinProyectos && proyectos))
    .filter((s) => !(s.sinSupervisor && esSupervisor(usuario)))
    .filter((s) => !(s.soloDueno && usuario?.rol !== "gerencial"))
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
