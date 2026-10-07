"use client";
// Recarga periódica solo con la pestaña visible + recargas agrupadas (F3-04).
// Devuelve `pedir`, para avisos como los de Realtime. Ver lib/refrescoVisible.js.
import { useEffect, useRef, useCallback } from "react";
import { crearRefresco } from "../lib/refrescoVisible";

export function useRefrescoVisible(fn, { intervaloMs, activo = true }) {
  const fnRef = useRef(fn);
  // siempre la última versión sin reiniciar el intervalo
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  const refrescoRef = useRef(null);

  useEffect(() => {
    if (!activo) return;
    const r = crearRefresco(() => fnRef.current?.(), { intervaloMs });
    refrescoRef.current = r;
    r.iniciar();
    return () => {
      r.detener();
      refrescoRef.current = null;
    };
  }, [activo, intervaloMs]);

  return useCallback(() => refrescoRef.current?.pedir(), []);
}
