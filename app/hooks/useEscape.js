"use client";
import { useEffect, useRef } from "react";

// Ventanas abiertas, en orden: Escape cierra solo la de arriba
const pila = [];

/** Cierra una ventana con la tecla Escape (solo la última abierta). */
export function useEscape(onClose, activo = true) {
  const ref = useRef(onClose);
  useEffect(() => { ref.current = onClose; });
  useEffect(() => {
    if (!activo) return undefined;
    const yo = {};
    pila.push(yo);
    const h = (e) => {
      if (e.key !== "Escape" || pila[pila.length - 1] !== yo) return;
      ref.current?.();
    };
    document.addEventListener("keydown", h);
    return () => {
      document.removeEventListener("keydown", h);
      const i = pila.indexOf(yo);
      if (i >= 0) pila.splice(i, 1);
    };
  }, [activo]);
}
