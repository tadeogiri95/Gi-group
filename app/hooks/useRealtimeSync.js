"use client";
// Suscribe al canal de la empresa y llama onRefresh(tabla) cuando llega un broadcast
// Si NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado, no hace nada (polling sigue activo)
import { useEffect, useRef } from "react";
import { getRealtimeClient } from "../lib/realtime";

export function useRealtimeSync(empresaId, onRefresh) {
  const channelRef = useRef(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh; // siempre la última versión sin re-suscribir

  useEffect(() => {
    if (!empresaId) return;
    const supabase = getRealtimeClient();
    if (!supabase) return;

    const channel = supabase.channel(`empresa_${empresaId}`);
    channel
      .on("broadcast", { event: "refresh" }, ({ payload }) => {
        onRefreshRef.current?.(payload?.tabla);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[realtime] conectado a empresa_" + empresaId);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [empresaId]);
}
