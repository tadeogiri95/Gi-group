// app/lib/ot.js — Encontrar la OT al iniciar una tarea (F4-11, D8, ítem 20):
// por el código escaneado y por las usadas hace poco en este dispositivo.

const soloDigitos = (s) => String(s ?? "").replace(/\D/g, "");

/**
 * Proyecto que corresponde a un código leído con la cámara. Acepta el código
 * tal cual ("1234", "OT-1234", "OT 001234"), un link con ?ot=1234 o el texto
 * de nuestras etiquetas.
 * @returns {object | null}
 */
export function otDesdeCodigo(texto, proyectos = []) {
  let valor = String(texto ?? "").trim();
  if (!valor) return null;
  try {
    const ot = new URL(valor).searchParams.get("ot");
    if (ot) valor = ot;
  } catch { /* no es un link */ }
  const exacto = proyectos.find((p) => String(p.ot).trim().toLowerCase() === valor.toLowerCase());
  if (exacto) return exacto;
  const sinPrefijo = valor.replace(/^ot[\s:#-]*/i, "");
  const porTexto = proyectos.find((p) => String(p.ot).trim().toLowerCase() === sinPrefijo.toLowerCase());
  if (porTexto) return porTexto;
  const digitos = soloDigitos(sinPrefijo);
  if (!digitos || digitos.length !== sinPrefijo.replace(/\s/g, "").length) return null;
  return proyectos.find((p) => soloDigitos(p.ot) && Number(soloDigitos(p.ot)) === Number(digitos)) || null;
}

// ─── OTs recientes en este dispositivo (por empleado) ───
const CLAVE = "gypi_ots_recientes";
const MAX_RECIENTES = 5;

export function recordarOT(empleadoId, ot) {
  if (!empleadoId || ot === null || ot === undefined || ot === "") return;
  try {
    const todos = new Map(Object.entries(JSON.parse(localStorage.getItem(CLAVE) || "{}")));
    const lista = [String(ot), ...(todos.get(String(empleadoId)) || []).filter((x) => x !== String(ot))].slice(0, MAX_RECIENTES);
    todos.set(String(empleadoId), lista);
    localStorage.setItem(CLAVE, JSON.stringify(Object.fromEntries(todos)));
  } catch { /* sin almacenamiento: se ignora */ }
}

/** Proyectos usados hace poco por ese empleado que siguen en la lista, del más reciente al más viejo. */
export function otsRecientes(empleadoId, proyectos = []) {
  try {
    const lista = new Map(Object.entries(JSON.parse(localStorage.getItem(CLAVE) || "{}"))).get(String(empleadoId)) || [];
    return lista.map((ot) => proyectos.find((p) => String(p.ot) === ot)).filter(Boolean);
  } catch {
    return [];
  }
}
