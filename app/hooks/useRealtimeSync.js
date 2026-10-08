"use client";
// Suscribe al canal de la empresa y llama onRefresh(tabla) cuando llega un broadcast
// Si NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado, no hace nada (polling sigue activo)
import { useEffect, useRef } from "react";

export function useRealtimeSync(empresaId, onRefresh) {
  const channelRef = useRef(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh; // siempre la última versión sin re-suscribir

  useEffect(() => {
    if (!empresaId) return;
    // El cliente de Supabase pesa: se baja recién con la sesión iniciada, no
    // con la pantalla de ingreso (app liviana)
    let cancelado = false;
    let supabase = null;
    import("../lib/realtime").then(({ getRealtimeClient }) => {
      if (cancelado) return;
      supabase = getRealtimeClient();
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
    }).catch(() => {}); // sin Realtime sigue el refresco cada 2 min

    return () => {
      cancelado = true;
      if (supabase && channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [empresaId]);
}
