'use client';
// app/hooks/useCostoHora.js — Costo de la hora para el dueño (Órdenes de
// Producción, parte 8; ítem 39). Para cualquier otro rol no pregunta nada y
// devuelve null: los costos no salen del servidor.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

export function useCostoHora(esDueno) {
  const [costoHora, setCostoHora] = useState(null);
  useEffect(() => {
    if (!esDueno) return;
    let vivo = true;
    apiFetch("/api/costo-hora")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setCostoHora(d?.costo_hora ?? null); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [esDueno]);
  return esDueno ? costoHora : null;
}
