"use client";
// app/hooks/useTecladoLista.js — elegir de una lista de sugerencias con el
// teclado (pedido de Tadeo del 22/11 para la PC): mientras se escribe en el
// buscador, ↓ y ↑ marcan un renglón, Enter lo elige y Escape borra lo
// escrito. El primero queda marcado solo, así que buscar y apretar Enter ya
// elige el primero. En el celular no cambia nada (no hay flechas).
import { useEffect, useRef, useState } from "react";

/** La clase del renglón marcado con el teclado. */
export const CLASE_MARCADA = "ring-2 ring-gypi-amber bg-gypi-surface";

/**
 * items: la lista que se ve debajo del buscador.
 * onElegir(item): lo mismo que hace el clic en el renglón.
 * onBorrar (opcional): qué hacer con Escape (por lo general, borrar lo escrito).
 * Devuelve { activa, onKeyDown, props(i) }: onKeyDown va en el <input> y
 * props(i) en cada renglón (marca el activo y lo sigue con el mouse).
 */
export function useTecladoLista(items, onElegir, onBorrar) {
  const [activa, setActiva] = useState(0);
  const lista = items || [];
  const n = lista.length;
  const clave = lista.map((x) => x?.sku ?? x?.id ?? x?.value ?? "").join("|");
  const refs = useRef([]);

  // Cambió lo que se ve (se escribió otra cosa): vuelve al primero
  useEffect(() => { setActiva(0); }, [clave]);

  const mover = (paso) => {
    if (!n) return;
    const i = (Math.min(activa, n - 1) + paso + n) % n;
    setActiva(i);
    refs.current[i]?.scrollIntoView?.({ block: "nearest" });
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { if (n) { e.preventDefault(); mover(1); } }
    else if (e.key === "ArrowUp") { if (n) { e.preventDefault(); mover(-1); } }
    else if (e.key === "Enter") {
      if (n) { e.preventDefault(); onElegir?.(lista[Math.min(activa, n - 1)]); }
    } else if (e.key === "Escape") {
      if (onBorrar && e.currentTarget?.value) { e.preventDefault(); e.stopPropagation(); onBorrar(); }
    }
  };

  const props = (i) => ({
    ref: (el) => { refs.current[i] = el; },
    "aria-current": i === Math.min(activa, n - 1) ? "true" : undefined,
    onMouseEnter: () => setActiva(i),
  });

  return { activa: Math.min(activa, Math.max(0, n - 1)), onKeyDown, props };
}
