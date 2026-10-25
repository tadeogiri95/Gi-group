// app/lib/maquinaria.js — Máquinas y su plan de mantenimiento (Mantenimiento,
// parte 33; ítem 43; migración 132; diseño en notes/diseno-menu-y-mantenimiento.md).
//
// Cada máquina tiene un plan: tareas que se hacen cada X días, cada X horas de
// uso (si la máquina tiene horómetro) o las dos, lo que pase primero. Cada
// tarea tiene su checklist. El semáforo de una tarea sale de cuándo se hizo
// por última vez (o, sin registro, de cuándo se cargó): 🔴 vencida, 🟡 toca
// pronto, ✅ al día. El de la máquina es el peor de sus tareas; una máquina
// parada se ve en rojo. Solo avisa: no bloquea nada (Tadeo, 25/10).
//
// Las plantillas por tipo están armadas con las máquinas de la empresa
// (Tadeo, 25/10). Lo diario (limpiar viruta, purgar el compresor) va como un
// punto del checklist semanal para no llenar de avisos todos los días; si se
// quiere diario, se cambia en la tarea.

export const CRITICIDADES = [
  { id: "A", nombre: "A · Crítica", detalle: "Si se para, se para la producción" },
  { id: "B", nombre: "B · Importante", detalle: "Se puede esperar unos días" },
  { id: "C", nombre: "C · Puede esperar", detalle: "Hay otra o no frena nada" },
];

export const ESTADOS_MAQUINA = [
  { id: "en_servicio", nombre: "En servicio" },
  { id: "parada", nombre: "Parada" },
  { id: "fuera_de_servicio", nombre: "Fuera de servicio" },
];

const pt = (id, nombre, valor = null) => ({ id, nombre, valor });
const tarea = (nombre, { dias = null, horas = null, puntos, seguridad = CORTAR_ENERGIA, insumos = null, quien = "interno", parar = true, minutos = null }) => ({
  nombre, cada_dias: dias, cada_horas: horas, aviso_dias: avisoDiasPorDefecto(dias), aviso_horas: avisoHorasPorDefecto(horas),
  checklist: puntos, seguridad, insumos, quien, parar_maquina: parar, duracion_min: minutos,
});
const CORTAR_ENERGIA = "Cortar la energía y bloquear el tablero antes de empezar";
const SIN_AIRE = "Cortar la energía, cerrar el aire y descargar la presión antes de empezar";

/** Cuántos días antes se pone en amarillo, según cada cuánto se hace. */
export function avisoDiasPorDefecto(dias) {
  if (!dias || dias <= 1) return 0;
  if (dias <= 7) return 1;
  if (dias <= 31) return 3;
  if (dias <= 120) return 7;
  return 15;
}

/** Cuántas horas antes se pone en amarillo: un 10 % de la frecuencia. */
export function avisoHorasPorDefecto(horas) {
  return horas ? Math.max(1, Math.round(horas / 10)) : 0;
}

export const TIPOS_MAQUINA = [
  { id: "seccionadora", nombre: "Seccionadora", emoji: "🪚", tareas: [
    tarea("Limpieza y revisión semanal", { dias: 7, minutos: 30, puntos: [
      pt("viruta", "Viruta y polvo limpios todos los días de la semana"),
      pt("sierra", "Sierra principal: dientes sin roturas ni rebabas"),
      pt("incisor", "Incisor: filo y alineación"),
      pt("guias", "Guías y carro lubricados"),
      pt("pinzas", "Pinzas y empujador"),
      pt("aire", "Presión de aire", "bar"),
    ] }),
    tarea("Ajustes mensuales", { dias: 30, minutos: 90, puntos: [
      pt("correas", "Tensión y estado de las correas"),
      pt("alineacion", "Alineación de sierra e incisor"),
      pt("aspiracion", "Aspiración: bocas y mangueras sin tapar"),
      pt("seguridad", "Paradas de emergencia y protecciones"),
    ] }),
  ] },
  { id: "pegadora", nombre: "Pegadora de canto", emoji: "🧷", tareas: [
    tarea("Limpieza y revisión semanal", { dias: 7, minutos: 45, insumos: "Limpiador de cola, antiadherente", puntos: [
      pt("crisol", "Crisol y rodillo de cola limpios"),
      pt("refilado", "Cuchillas de refilado"),
      pt("rascadores", "Rascadores de canto y de cola"),
      pt("pulidores", "Pulidores"),
      pt("arrastre", "Cadena y patines de arrastre"),
    ] }),
    tarea("Ajustes mensuales", { dias: 30, minutos: 90, puntos: [
      pt("temperatura", "Temperatura del crisol", "°C"),
      pt("presion", "Presión de los rodillos", "bar"),
      pt("correas", "Correas y motores"),
      pt("lubricacion", "Lubricación de guías y cadena"),
    ] }),
  ] },
  { id: "cnc", nombre: "CNC", emoji: "🤖", tareas: [
    tarea("Limpieza y revisión semanal", { dias: 7, minutos: 45, insumos: "Grasa para ejes", puntos: [
      pt("mesa", "Mesa y ventosas limpias"),
      pt("aspiracion", "Aspiración y campana"),
      pt("aire", "Purga del aire y presión", "bar"),
      pt("ejes", "Ejes y husillos de bolas lubricados"),
    ] }),
    tarea("Revisión mensual", { dias: 30, minutos: 90, puntos: [
      pt("vacio", "Vacío de la mesa", "mbar"),
      pt("husillo", "Husillo: ruido y temperatura"),
      pt("herramientas", "Portaherramientas y pinzas"),
      pt("cables", "Cables y cadenas portacables"),
    ] }),
    tarea("Aceite de la bomba de vacío", { dias: 180, horas: 500, minutos: 60, insumos: "Aceite para bomba de vacío", puntos: [
      pt("aceite", "Cambio de aceite"),
      pt("filtro", "Filtro de la bomba"),
    ] }),
  ] },
  { id: "router", nombre: "Router", emoji: "🌀", tareas: [
    tarea("Limpieza y revisión semanal", { dias: 7, minutos: 30, puntos: [
      pt("mesa", "Mesa limpia"),
      pt("fresa", "Fresas y pinzas"),
      pt("guias", "Guías lubricadas"),
      pt("aspiracion", "Aspiración"),
    ] }),
    tarea("Revisión mensual", { dias: 30, minutos: 60, puntos: [
      pt("correas", "Correas"),
      pt("motor", "Motor: ruido y temperatura"),
      pt("cables", "Cables y enchufe"),
    ] }),
  ] },
  { id: "escuadradora", nombre: "Escuadradora", emoji: "📐", tareas: [
    tarea("Limpieza y revisión semanal", { dias: 7, minutos: 30, puntos: [
      pt("viruta", "Viruta y polvo limpios"),
      pt("sierra", "Sierra: dientes sin roturas"),
      pt("carro", "Carro y guías lubricados"),
      pt("protector", "Protector y cuchillo divisor"),
    ] }),
    tarea("Ajustes mensuales", { dias: 30, minutos: 60, puntos: [
      pt("alineacion", "Alineación de sierra y guía"),
      pt("correas", "Correas"),
      pt("emergencia", "Parada de emergencia"),
    ] }),
  ] },
  { id: "prensa", nombre: "Prensa hidráulica", emoji: "🗜️", tareas: [
    tarea("Revisión semanal", { dias: 7, minutos: 20, seguridad: "Bajar la prensa, cortar la energía y descargar la presión antes de empezar", puntos: [
      pt("perdidas", "Sin pérdidas de aceite"),
      pt("mangueras", "Mangueras y conexiones"),
      pt("nivel", "Nivel de aceite"),
      pt("platos", "Platos limpios y parejos"),
    ] }),
    tarea("Revisión mensual", { dias: 30, minutos: 45, puntos: [
      pt("presion", "Presión de trabajo", "bar"),
      pt("manometro", "Manómetro funcionando"),
      pt("emergencia", "Parada de emergencia y protecciones"),
    ] }),
    tarea("Cambio de aceite y filtro", { dias: 365, minutos: 180, insumos: "Aceite hidráulico, filtro", puntos: [
      pt("aceite", "Cambio de aceite"),
      pt("filtro", "Cambio de filtro"),
    ] }),
  ] },
  { id: "soldadora", nombre: "Soldadora", emoji: "⚡", tareas: [
    tarea("Revisión semanal", { dias: 7, minutos: 15, puntos: [
      pt("cables", "Cables sin cortes"),
      pt("pinza", "Pinza o torcha"),
      pt("masa", "Masa y su conexión"),
    ] }),
    tarea("Limpieza mensual", { dias: 30, minutos: 30, insumos: "Aire seco", puntos: [
      pt("interior", "Limpieza interna con aire seco"),
      pt("ventilador", "Ventilador"),
      pt("conexiones", "Conexiones y enchufe"),
    ] }),
  ] },
  { id: "compresor", nombre: "Compresor", emoji: "💨", tareas: [
    tarea("Revisión semanal", { dias: 7, minutos: 15, seguridad: SIN_AIRE, puntos: [
      pt("purga", "Agua del tanque purgada todos los días"),
      pt("aceite", "Nivel de aceite"),
      pt("perdidas", "Sin pérdidas de aire"),
      pt("filtro_aire", "Filtro de aire limpio"),
      pt("presion", "Presión de corte", "bar"),
    ] }),
    tarea("Cambio de aceite y filtros", { dias: 365, horas: 2000, minutos: 90, seguridad: SIN_AIRE, insumos: "Aceite para compresor, filtros de aire y aceite", puntos: [
      pt("aceite", "Cambio de aceite"),
      pt("filtros", "Cambio de filtros"),
      pt("correas", "Correas"),
    ] }),
    tarea("Válvula de seguridad", { dias: 365, minutos: 30, seguridad: SIN_AIRE, quien: "externo", puntos: [
      pt("valvula", "Válvula de seguridad probada"),
      pt("tanque", "Tanque sin corrosión"),
    ] }),
  ] },
  { id: "sensitiva", nombre: "Sensitiva", emoji: "🔩", tareas: [
    tarea("Revisión semanal", { dias: 7, minutos: 15, puntos: [
      pt("disco", "Disco sano y protector puesto"),
      pt("escobillas", "Escobillas"),
      pt("cable", "Cable y enchufe"),
    ] }),
    tarea("Revisión mensual", { dias: 30, minutos: 20, puntos: [
      pt("morsa", "Morsa y base firmes"),
      pt("angulo", "Ángulo de corte"),
    ] }),
  ] },
  { id: "cortadora_aluminio", nombre: "Cortadora de aluminio", emoji: "🔪", tareas: [
    tarea("Limpieza y revisión semanal", { dias: 7, minutos: 20, insumos: "Lubricante para disco", puntos: [
      pt("viruta", "Viruta limpia"),
      pt("lubricante", "Nivel de lubricante del disco"),
      pt("disco", "Disco: dientes sin roturas"),
      pt("protector", "Protector y prensas"),
    ] }),
    tarea("Revisión mensual", { dias: 30, minutos: 45, puntos: [
      pt("correa", "Correa"),
      pt("aire", "Aire y cilindros", "bar"),
      pt("angulo", "Ángulo de corte"),
    ] }),
  ] },
  { id: "otra", nombre: "Otra", emoji: "⚙️", tareas: [] },
];

export function tipoMaquina(id) {
  return TIPOS_MAQUINA.find((t) => t.id === id) || TIPOS_MAQUINA[TIPOS_MAQUINA.length - 1];
}

/** Las tareas de la plantilla de un tipo, listas para guardar en una máquina. */
export function tareasDePlantilla(tipo) {
  return tipoMaquina(tipo).tareas.map((t, i) => ({ ...t, checklist: t.checklist.map((p) => ({ ...p })), orden: i }));
}

/** "sec 01" → "SEC-01": el código va en mayúsculas, sin espacios de más. */
export function normalizarCodigo(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, "-").slice(0, 20);
}

/** Quién puede cargar máquinas y su plan: gerencia y Administración. */
export function puedeEditarMaquinaria(rol) {
  return rol === "gerencial" || rol === "administrativo";
}

function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(desdeISO, hastaISO) {
  return Math.round((Date.parse(`${hastaISO}T12:00:00Z`) - Date.parse(`${desdeISO}T12:00:00Z`)) / 86400000);
}

const NIVELES = ["ok", "pronto", "vencido"];
const peor = (a, b) => (NIVELES.indexOf(a) >= NIVELES.indexOf(b) ? a : b);

/**
 * Cuándo toca una tarea y cómo está:
 * { nivel: vencido | pronto | ok, proxima, dias, faltanHoras }.
 * Por días: desde la última vez (o desde el alta). Por horas: solo si la
 * máquina tiene horómetro con lectura y se sabe desde qué horas contar.
 */
export function estadoTarea(t, maquina, hoy) {
  let nivel = "ok";
  let proxima = null;
  let dias = null;
  let faltanHoras = null;
  if (t?.cada_dias) {
    const base = t.ultima_fecha || String(t.created_at || hoy).slice(0, 10);
    proxima = sumarDias(base, t.cada_dias);
    dias = diasEntre(hoy, proxima);
    nivel = dias < 0 ? "vencido" : dias <= (t.aviso_dias ?? 0) ? "pronto" : "ok";
  }
  const base = t?.ultima_horas ?? t?.horas_base;
  if (t?.cada_horas && maquina?.con_horometro && maquina?.horas != null && base != null) {
    faltanHoras = base + t.cada_horas - maquina.horas;
    const porHoras = faltanHoras < 0 ? "vencido" : faltanHoras <= (t.aviso_horas ?? 0) ? "pronto" : "ok";
    nivel = peor(porHoras, nivel);
  }
  return { nivel, proxima, dias, faltanHoras };
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** "Vencida hace 3 días", "Toca hoy", "Toca en 5 días", "Faltan 120 h", "Pasada por 30 h". */
export function textoEstadoTarea({ dias, faltanHoras, proxima }) {
  const partes = [];
  if (dias != null) {
    if (dias < 0) partes.push(`Vencida hace ${plural(-dias, "día", "días")}`);
    else if (dias === 0) partes.push("Toca hoy");
    else if (dias <= 31) partes.push(`Toca en ${plural(dias, "día", "días")}`);
    else partes.push(`Toca el ${proxima.split("-").reverse().join("/")}`);
  }
  if (faltanHoras != null) partes.push(faltanHoras < 0 ? `pasada por ${-faltanHoras} h` : `faltan ${faltanHoras.toLocaleString("es-AR")} h`);
  const t = partes.join(" o ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Cada 7 días", "Cada 500 h", "Cada 365 días o 2.000 h". */
export function textoFrecuencia(t) {
  const partes = [];
  if (t?.cada_dias) partes.push(plural(t.cada_dias, "día", "días"));
  if (t?.cada_horas) partes.push(`${t.cada_horas.toLocaleString("es-AR")} h`);
  return partes.length ? `Cada ${partes.join(" o ")}` : "";
}

/**
 * Semáforo de una máquina: el peor de sus tareas activas; parada es rojo y
 * fuera de servicio no avisa. Devuelve { nivel, tareas: [{ tarea, ...estado }] }
 * con lo más urgente primero.
 */
export function estadoMaquina(maquina, tareas = [], hoy) {
  if (maquina?.estado === "fuera_de_servicio") return { nivel: "fuera", tareas: [] };
  const lista = tareas
    .filter((t) => t.maquina_id === maquina.id && t.activa !== false)
    .map((t) => ({ tarea: t, ...estadoTarea(t, maquina, hoy) }))
    .sort((a, b) => NIVELES.indexOf(b.nivel) - NIVELES.indexOf(a.nivel) || (a.dias ?? 99999) - (b.dias ?? 99999));
  let nivel = lista.reduce((n, x) => peor(x.nivel, n), "ok");
  if (maquina?.estado === "parada") nivel = "vencido";
  return { nivel, tareas: lista };
}

export const SEMAFORO_MAQUINA = {
  vencido: { emoji: "🔴", texto: "Vencida" },
  pronto: { emoji: "🟡", texto: "Toca pronto" },
  ok: { emoji: "✅", texto: "Al día" },
  fuera: { emoji: "⚪", texto: "Fuera de servicio" },
};

const ORDEN_CRITICIDAD = { A: 0, B: 1, C: 2 };

/** Lo vencido y lo que toca pronto de todas las máquinas: primero lo vencido, y dentro, las A. */
export function alertasMaquinaria(maquinas = [], tareas = [], hoy) {
  const out = [];
  for (const m of maquinas.filter((x) => x.activo !== false)) {
    if (m.estado === "parada") out.push({ clave: `parada-${m.id}`, maquina: m, nivel: "vencido", parada: true, texto: "Máquina parada" });
    for (const x of estadoMaquina(m, tareas, hoy).tareas) {
      if (x.nivel !== "ok") out.push({ clave: `tarea-${x.tarea.id}`, maquina: m, ...x, texto: `${x.tarea.nombre}: ${textoEstadoTarea(x).toLowerCase()}` });
    }
  }
  return out.sort((a, b) => NIVELES.indexOf(b.nivel) - NIVELES.indexOf(a.nivel)
    || Number(!!b.parada) - Number(!!a.parada)
    || (ORDEN_CRITICIDAD[a.maquina.criticidad] ?? 1) - (ORDEN_CRITICIDAD[b.maquina.criticidad] ?? 1)
    || (a.dias ?? 99999) - (b.dias ?? 99999));
}

/**
 * Qué falta para guardar una tarea hecha: cada punto con su estado y nota en
 * los que quedaron en Revisar o Mal; la confirmación de seguridad si la tarea
 * la pide; las horas si la máquina tiene horómetro. Lista de textos (vacía = ok).
 */
export function faltantesRegistro({ tarea: t, maquina, respuestas = {}, seguridadOk, horas }) {
  const faltan = [];
  if (t?.seguridad && !seguridadOk) faltan.push("Confirmar el aviso de seguridad");
  if (maquina?.con_horometro && (horas === null || horas === undefined || horas === "" || !Number.isInteger(Number(horas)) || Number(horas) < 0)) faltan.push("Las horas del horómetro");
  for (const p of t?.checklist || []) {
    const r = respuestas[p.id] || {};
    if (!r.estado) { faltan.push(p.nombre); continue; }
    if ((r.estado === "revisar" || r.estado === "mal") && !String(r.nota ?? "").trim()) faltan.push(`${p.nombre} (falta la nota)`);
  }
  return faltan;
}

/** Las respuestas como se guardan: con los nombres, para que el historial no cambie si se edita la tarea. */
export function itemsRegistro(t, respuestas = {}) {
  return (t?.checklist || []).map((p) => {
    const r = respuestas[p.id] || {};
    const valor = r.valor === "" || r.valor == null ? null : String(r.valor).trim().slice(0, 20);
    return {
      punto: p.id, nombre: p.nombre, estado: r.estado, valor, unidad: p.valor || null,
      nota: String(r.nota ?? "").trim() || null, foto: r.foto || null,
    };
  });
}
