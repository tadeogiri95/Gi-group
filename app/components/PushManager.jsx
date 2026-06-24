"use client";
import { useState, useEffect, useCallback } from "react";
import {
  requestPushPermission,
  onForegroundMessage,
  isPushSupported,
  getPushPermissionStatus,
  registerSW,
} from "../lib/push";

export default function PushManager({ legajo, empresaId, onNotification }) {
  const [status, setStatus] = useState("loading");
  const [toast, setToast] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) { setStatus("unsupported"); return; }
    setStatus(getPushPermissionStatus());
    // Independiente del permiso de notificaciones: el SW sirve /offline.html
    // (ver public/firebase-messaging-sw.js) y eso debe funcionar aunque el
    // usuario rechace o nunca responda el prompt de push.
    registerSW();
  }, []);

  useEffect(() => {
    if (status !== "granted") return;
    onForegroundMessage((payload) => {
      const baseTitle = payload.notification?.title || payload.data?.title || "Notificación";
      const body = payload.notification?.body || payload.data?.body || "";
      const empresaNombre = payload.data?.empresa_nombre;
      const title = empresaNombre ? `${empresaNombre} · ${baseTitle}` : baseTitle;
      setToast({ title, body });
      setTimeout(() => setToast(null), 6000);
      if (onNotification) onNotification(payload);
    });
  }, [status, onNotification]);

  const handleEnable = useCallback(async () => {
    if (!legajo) return;
    setRegistering(true);
    const result = await requestPushPermission(legajo, empresaId);
    if (result.ok) setStatus("granted");
    else if (result.reason === "denied") setStatus("denied");
    setRegistering(false);
  }, [legajo, empresaId]);

  if (status === "loading" || status === "unsupported" || (status === "granted" && !toast) || dismissed) return null;

  if (status === "granted" && toast) {
    return (
      <div className="fixed top-4 left-4 right-4 z-[10000] bg-gypi-surface border border-gypi-border rounded-[14px] py-3.5 px-4 shadow-lg cursor-pointer max-w-[480px] mx-auto" onClick={() => setToast(null)}>
        <div className="flex items-center gap-2 mb-1 text-sm font-body">
          <span className="text-lg">🔔</span>
          <strong className="text-gypi-text">{toast.title}</strong>
        </div>
        <p className="m-0 text-xs text-gypi-dim pl-[26px] font-body">{toast.body}</p>
      </div>
    );
  }

  return (
    <>
      {status === "default" && (
        <div className="relative mx-4 mt-2 z-10 bg-gypi-surface border border-gypi-amber/25 rounded-xl py-2.5 px-3.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl shrink-0">🔔</span>
            <div className="flex-1 flex flex-col gap-px font-body">
              <strong className="text-gypi-text text-[13px]">Activá las notificaciones</strong>
              <span className="text-[11px] text-gypi-dim">Recibí avisos de permisos y novedades</span>
            </div>
            <button onClick={handleEnable} disabled={registering} className="shrink-0 bg-gypi-amber text-white border-none rounded-lg py-1.5 px-3.5 text-xs font-bold cursor-pointer font-body">
              {registering ? "..." : "Activar"}
            </button>
            <button onClick={() => setDismissed(true)} className="shrink-0 bg-transparent border-none text-gypi-dim cursor-pointer text-sm p-1 leading-none">✕</button>
          </div>
        </div>
      )}

      {status === "denied" && (
        <div className="relative mx-4 mt-2 z-10 bg-gypi-red/[0.06] border border-gypi-red/25 rounded-xl py-2.5 px-3.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl shrink-0">🔕</span>
            <div className="flex-1 flex flex-col gap-px font-body">
              <strong className="text-gypi-text text-[13px]">Notificaciones bloqueadas</strong>
              <span className="text-[11px] text-gypi-dim">Desbloqueá desde config del navegador</span>
            </div>
            <button onClick={() => setDismissed(true)} className="shrink-0 bg-transparent border-none text-gypi-dim cursor-pointer text-sm p-1 leading-none">✕</button>
          </div>
        </div>
      )}
    </>
  );
}
