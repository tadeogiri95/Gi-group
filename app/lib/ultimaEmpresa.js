// app/lib/ultimaEmpresa.js — Recuerda en este dispositivo la última empresa
// abierta, para ofrecer volver a ella si el link falla (F4-17). Es solo una
// comodidad: si el almacenamiento no está disponible, no pasa nada.
const CLAVE = "gypi_ultima_empresa";

export function recordarEmpresa(empresa) {
  if (!empresa?.slug) return;
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ slug: empresa.slug, nombre: empresa.nombre_corto || empresa.nombre || empresa.slug }));
  } catch { /* sin almacenamiento: se ignora */ }
}

/** @returns {{ slug: string, nombre: string } | null} */
export function ultimaEmpresa() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || "null");
    return v && typeof v.slug === "string" && /^[a-z0-9-]{2,60}$/.test(v.slug) ? v : null;
  } catch {
    return null;
  }
}

/** Normaliza lo que escribe el usuario: "gypi.app/Mi-Empresa" → "mi-empresa". */
export function normalizarCodigo(texto) {
  return String(texto || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^[^/]*gypi\.app\//, "").split(/[/?#]/)[0]
    .replace(/[^a-z0-9-]/g, "");
}
