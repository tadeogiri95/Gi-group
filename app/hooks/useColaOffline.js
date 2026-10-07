"use client";
// Estado de la cola sin conexión del empleado (ítem 21) y envío automático al
// volver la señal, al volver a la app y cada 30 s mientras quede algo.
import { useEffect, useState, useCallback } from "react";
import { pendientes, fallidas, suscribir, sincronizar, estaSincronizando, descartarFallida } from "../lib/colaOffline";

export function useColaOffline(empleadoId, { intervaloMs = 30000, alTerminar } = {}) {
  const leerEstado = useCallback(() => ({
    pendientes: empleadoId ? pendientes(empleadoId) : [],
    fallidas: empleadoId ? fallidas(empleadoId) : [],
    sincronizando: estaSincronizando(),
    enLinea: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  }), [empleadoId]);
  const [estado, setEstado] = useState(leerEstado);

  const enviar = useCallback(async () => {
    if (!empleadoId || pendientes(empleadoId).length === 0) return;
    const r = await sincronizar(empleadoId);
    if (r.enviadas > 0 || r.rechazadas > 0) alTerminar?.(r);
  }, [empleadoId, alTerminar]);

  useEffect(() => {
    setEstado(leerEstado());
    const actualizar = () => setEstado(leerEstado());
    const desuscribir = suscribir(actualizar);
    const alVolver = () => { actualizar(); enviar(); };
    const alVisible = () => { if (document.visibilityState === "visible") enviar(); };
    window.addEventListener("online", alVolver);
    window.addEventListener("offline", actualizar);
    document.addEventListener("visibilitychange", alVisible);
    const t = setInterval(() => { if (empleadoId && pendientes(empleadoId).length) enviar(); }, intervaloMs);
    enviar();
    return () => {
      desuscribir();
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", actualizar);
      document.removeEventListener("visibilitychange", alVisible);
      clearInterval(t);
    };
  }, [leerEstado, enviar, intervaloMs, empleadoId]);

  return { ...estado, enviarAhora: enviar, descartarFallida };
}
