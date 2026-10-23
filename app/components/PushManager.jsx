"use client";
import { useState, useEffect, useCallback } from "react";
import {
  requestPushPermission,
  onForegroundMessage,
  isPushSupported,
  getPushPermissionStatus,
  registerSW,
} from "../lib/push";

// Si la persona cierra el aviso, no vuelve a salir por 30 días (antes volvía
// cada vez que abría la app). Sin almacenamiento, vuelve a salir: no es grave.
export const CLAVE_AVISO_CERRADO = "gypi_aviso_push_cerrado";
const DIAS_SIN_AVISO = 30;

export function avisoCerradoHace(ahora = Date.now()) {
  try {
    const t = Number(localStorage.getItem(CLAVE_AVISO_CERRADO));
    return Number.isFinite(t) && t > 0 && ahora - t < DIAS_SIN_AVISO * 86400000;
  } catch { return false; }
}

function recordarCierre() {
  try { localStorage.setItem(CLAVE_AVISO_CERRADO, String(Date.now())); } catch { /* sin almacenamiento */ }
}

export default function PushManager({ legajo, empresaId, onNotification }) {
  const [status, setStatus] = useState("loading");
  const [toast, setToast] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { if (avisoCerradoHace()) setDismissed(true); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  const cerrar = () => { recordarCierre(); setDismissed(true); };

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
              <span className="text-xs text-gypi-dim">Recibí avisos de permisos y novedades</span>
            </div>
            <button onClick={handleEnable} disabled={registering} className="shrink-0 bg-gypi-amber text-gypi-on-amber border-none rounded-lg py-1.5 px-3.5 text-xs font-bold cursor-pointer font-body">
              {registering ? "..." : "Activar"}
            </button>
            <button onClick={cerrar} aria-label="Cerrar aviso de notificaciones" className="shrink-0 min-w-[44px] min-h-[44px] -my-2 -mr-2 bg-transparent border-none text-gypi-dim cursor-pointer text-lg leading-none">✕</button>
          </div>
        </div>
      )}

      {status === "denied" && (
        <div className="relative mx-4 mt-2 z-10 bg-gypi-red/[0.06] border border-gypi-red/25 rounded-xl py-2.5 px-3.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl shrink-0">🔕</span>
            <div className="flex-1 flex flex-col gap-px font-body">
              <strong className="text-gypi-text text-[13px]">Notificaciones bloqueadas</strong>
              <span className="text-[12px] text-gypi-dim">Para recibir avisos: tocá el candado al lado de la dirección → Notificaciones → Permitir.</span>
            </div>
            <button onClick={cerrar} aria-label="Cerrar aviso de notificaciones" className="shrink-0 min-w-[44px] min-h-[44px] -my-2 -mr-2 bg-transparent border-none text-gypi-dim cursor-pointer text-lg leading-none">✕</button>
          </div>
        </div>
      )}
    </>
  );
}
