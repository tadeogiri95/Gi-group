// ═══════════════════════════════════════════════════════════════
// Componente de Notificaciones Push — CORREGIDO
// VA EN: components/PushManager.jsx
// Cambios: posición relativa (no tapa nav), colores del theme, botón rechazar
// ═══════════════════════════════════════════════════════════════

"use client";
import { useState, useEffect, useCallback } from "react";
import {
  requestPushPermission,
  onForegroundMessage,
  isPushSupported,
  getPushPermissionStatus,
} from "../lib/push";
import { C, fB } from "../app/lib/theme";

export default function PushManager({ legajo, onNotification }) {
  const [status, setStatus] = useState("loading");
  const [toast, setToast] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    setStatus(getPushPermissionStatus());
  }, []);

  useEffect(() => {
    if (status !== "granted") return;
    onForegroundMessage((payload) => {
      const title = payload.notification?.title || payload.data?.title || "Notificación";
      const body = payload.notification?.body || payload.data?.body || "";
      setToast({ title, body });
      setTimeout(() => setToast(null), 6000);
      if (onNotification) onNotification(payload);
    });
  }, [status, onNotification]);

  const handleEnable = useCallback(async () => {
    if (!legajo) return;
    setRegistering(true);
    const result = await requestPushPermission(legajo);
    if (result.ok) {
      setStatus("granted");
    } else if (result.reason === "denied") {
      setStatus("denied");
    }
    setRegistering(false);
  }, [legajo]);

  const handleDismiss = () => {
    setDismissed(true);
  };

  // No mostrar si no soporta, ya concedido, o fue descartado
  if (status === "loading" || status === "unsupported" || status === "granted" || dismissed) {
    // Aún escuchar toasts si granted
    if (status === "granted" && toast) {
      return (
        <div style={styles.toast} onClick={() => setToast(null)}>
          <div style={styles.toastHeader}>
            <span style={{ fontSize: 18 }}>🔔</span>
            <strong style={{ color: C.text }}>{toast.title}</strong>
          </div>
          <p style={styles.toastBody}>{toast.body}</p>
        </div>
      );
    }
    return null;
  }

  return (
    <>
      {/* Banner para pedir permiso — POSICIÓN RELATIVA, no tapa nav */}
      {status === "default" && (
        <div style={styles.banner}>
          <div style={styles.bannerContent}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>🔔</span>
            <div style={styles.bannerText}>
              <strong style={{ color: C.text, fontSize: 13 }}>Activá las notificaciones</strong>
              <span style={{ fontSize: 11, color: C.dim }}>
                Recibí avisos de permisos y novedades
              </span>
            </div>
            <button onClick={handleEnable} disabled={registering} style={styles.bannerBtn}>
              {registering ? "..." : "Activar"}
            </button>
            <button onClick={handleDismiss} style={styles.dismissBtn}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Banner si fue denegado */}
      {status === "denied" && (
        <div style={{ ...styles.banner, background: `${C.red}10`, borderColor: `${C.red}40` }}>
          <div style={styles.bannerContent}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>🔕</span>
            <div style={styles.bannerText}>
              <strong style={{ color: C.text, fontSize: 13 }}>Notificaciones bloqueadas</strong>
              <span style={{ fontSize: 11, color: C.dim }}>
                Desbloqueá desde config del navegador
              </span>
            </div>
            <button onClick={handleDismiss} style={styles.dismissBtn}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Toast de notificación en primer plano */}
      {toast && (
        <div style={styles.toast} onClick={() => setToast(null)}>
          <div style={styles.toastHeader}>
            <span style={{ fontSize: 18 }}>🔔</span>
            <strong style={{ color: C.text }}>{toast.title}</strong>
          </div>
          <p style={styles.toastBody}>{toast.body}</p>
        </div>
      )}
    </>
  );
}

const styles = {
  banner: {
    // POSICIÓN RELATIVA — no tapa la barra de navegación
    position: "relative",
    margin: "8px 16px 0",
    zIndex: 10,
    background: `${C.surface}`,
    border: `1px solid ${C.amber}40`,
    borderRadius: 12,
    padding: "10px 14px",
    flexShrink: 0,
  },
  bannerContent: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  bannerText: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 1,
    fontFamily: fB,
  },
  bannerBtn: {
    flexShrink: 0,
    background: C.amber,
    color: "#000",
    border: "none",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: fB,
  },
  dismissBtn: {
    flexShrink: 0,
    background: "none",
    border: "none",
    color: C.dim,
    cursor: "pointer",
    fontSize: 14,
    padding: "4px 6px",
    lineHeight: 1,
  },
  toast: {
    position: "fixed",
    top: 16,
    left: 16,
    right: 16,
    zIndex: 10000,
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: "14px 16px",
    boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
    cursor: "pointer",
    maxWidth: 480,
    margin: "0 auto",
  },
  toastHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
    fontSize: 14,
    fontFamily: fB,
  },
  toastBody: {
    margin: 0,
    fontSize: 12,
    color: C.dim,
    paddingLeft: 26,
    fontFamily: fB,
  },
};
