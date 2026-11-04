'use client';
// app/hooks/usePdfsOt.js — La lista de PDF de la carpeta de Drive de las OT
// (04/11; app/lib/pdfOt.js). Se lee una vez cada 5 minutos y se comparte
// entre las pantallas. null mientras no llega o si la carpeta no está
// conectada (entonces no se muestra ningún botón 📄).
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

const VIGENCIA_MS = 5 * 60 * 1000;
let enCurso = null;
let leidoEn = 0;

/** Para los tests: olvida lo leído. */
export function olvidarPdfsOt() { enCurso = null; }

function leer() {
  if (!enCurso || Date.now() - leidoEn > VIGENCIA_MS) {
    leidoEn = Date.now();
    enCurso = apiFetch("/api/proyectos/pdfs")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.conectado ? (Array.isArray(j.archivos) ? j.archivos : []) : null))
      .catch(() => { enCurso = null; return null; });
  }
  return enCurso;
}

/** Lista de PDF [{ nombre, id, fecha }], o null si no hay carpeta conectada. */
export function usePdfsOt(activo = true) {
  const [archivos, setArchivos] = useState(null);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    leer().then((a) => { if (vivo) setArchivos(a); });
    return () => { vivo = false; };
  }, [activo]);
  return archivos;
}
