// app/lib/tipoProyecto.js — Tipo de proyecto de cada OT (cocina, placard,
// vanitory…) para la planificación de la producción. Sale solo de la
// descripción de la OT, con palabras clave y en este orden (una OT mixta queda
// en el primer tipo que coincide); gerencia lo puede cambiar a mano
// (proyectos.tipo_proyecto, migración 139) y eso no lo pisa la sincronización.
//
// Valores por defecto de cada tipo: estudio "Mecanizados y gabinetes por
// placa" de GI Fábrica (26/10/2026, 764 OT de Muebles). Mecanizados por placa
// = los de las OT con mecanizado; gabinetes por placa = todos.
import { normalizar } from "./rutas";

export const TIPOS_PROYECTO = [
  { id: "puertas", nombre: "Puertas", mec: 1.0, gab: 2.98,
    // Solo puertas sueltas: las de un placard, vestidor o cocina van con su mueble
    palabras: [/^(?!.*(placard|placares|vestidor|cocina|alacena))(.*\bpuertas? (de )?(ingreso|interior|interiores|placa|cerradura|doble|office|bano|simple)|(p\d+ - )?puertas?\b)/] },
  { id: "lavadero", nombre: "Lavadero", mec: 2.9, gab: 1.84, palabras: [/lavadero/] },
  { id: "cocina", nombre: "Cocina", mec: 2.6, gab: 1.47, palabras: [/cocina/, /alacena/, /kitchen/, /office/, /\bisla\b/, /asador/, /bajo ?mesada/] },
  { id: "vestidor", nombre: "Vestidor", mec: 1.6, gab: 0.67, palabras: [/vestidor/] },
  { id: "placard", nombre: "Placard", mec: 1.3, gab: 0.69, palabras: [/placard/, /placares/, /zapatero/, /guardado/] },
  { id: "bano", nombre: "Baño / vanitory", mec: 4.2, gab: 2.95, palabras: [/vanit/, /\bbanos?\b/, /antebano/, /espejo/, /bacha/] },
  { id: "rack", nombre: "Rack TV / living", mec: 7.4, gab: 1.18, palabras: [/rack/, /living/, /\btv\b/] },
  { id: "revestimiento", nombre: "Revestimiento / paneles", mec: 1.0, gab: 1.82, palabras: [/revest/, /\brev\b/, /panel/, /boiserie/] },
  { id: "dormitorio", nombre: "Dormitorio", mec: 3.9, gab: 1.82, palabras: [/dorm/, /respaldo/, /mesas? de luz/, /\bcama\b/, /habitacion/, /\bhab\b/, /cajonera/] },
  { id: "escritorio", nombre: "Escritorio / mesas", mec: 3.1, gab: 2.69, palabras: [/escritorio/, /esritorio/, /\bmesas?\b/, /biblioteca/] },
  { id: "comercial", nombre: "Comercial / institucional", mec: 3.3, gab: 1.37,
    palabras: [/recepcion/, /oficina/, /administracion/, /coworking/, /consultorio/, /\blocal\b/, /mostrador/, /vestuario/, /\bsum\b/, /jefatura/, /hotel/] },
  { id: "otros", nombre: "Otros", mec: 3.1, gab: 1.21, palabras: [] },
];

/** Para una OT sin descripción (o un tipo que no existe): el promedio de todas. */
export const TIPO_GLOBAL = { id: "global", nombre: "Sin tipo (promedio)", mec: 2.7, gab: 1.31 };

const POR_ID = new Map(TIPOS_PROYECTO.map((t) => [t.id, t]));
export const esTipoProyecto = (id) => POR_ID.has(id);
export const nombreTipo = (id) => POR_ID.get(id)?.nombre || TIPO_GLOBAL.nombre;

/** Tipo según la descripción; null si no hay descripción. */
export function tipoAutomatico(descripcion) {
  const d = normalizar(descripcion || "").toLowerCase();
  if (!d.trim()) return null;
  return (TIPOS_PROYECTO.find((t) => t.palabras.some((p) => p.test(d))) || POR_ID.get("otros")).id;
}

/** { id, manual }: el elegido a mano, o el que sale de la descripción (id null = sin tipo). */
export function tipoDeOt(proyecto) {
  if (esTipoProyecto(proyecto?.tipo_proyecto)) return { id: proyecto.tipo_proyecto, manual: true };
  return { id: tipoAutomatico(proyecto?.descripcion), manual: false };
}
