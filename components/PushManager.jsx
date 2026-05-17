// ═══════════════════════════════════════════════════════════════
// GI GROUP — Componente de Notificaciones Push
// Este archivo VA EN: components/PushManager.jsx
// Importalo en tu layout o page principal
// ═══════════════════════════════════════════════════════════════

"use client";
import { useState, useEffect, useCallback } from "react";
import {
  requestPushPermission,
  onForegroundMessage,
  isPushSupported,
  getPushPermissionStatus,
} from "../lib/push";

export default function PushManager({ legajo, onNotification }) {
  const [status, setStatus] = useState("loading"); // loading | unsupported | default | granted | denied
  const [toast, setToast] = useState(null);
  const [registering, setRegistering] = useState(false);

  // Verificar soporte y estado actual
  useEffect(() => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    setStatus(getPushPermissionStatus());
  }, []);

  // Escuchar notificaciones en primer plano
  useEffect(() => {
    if (status !== "granted") return;

    onForegroundMessage((payload) => {
      const title = payload.notification?.title || payload.data?.title || "GI Group";
      const body = payload.notification?.body || payload.data?.body || "";

      // Mostrar toast interno
      setToast({ title, body });
      setTimeout(() => setToast(null), 6000);

      // Callback al padre por si quiere actualizar datos
      if (onNotification) onNotification(payload);
    });
  }, [status, onNotification]);

  // Pedir permiso
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

  // ─── Render ────────────────────────────────────────────────

  // No mostrar nada si no soporta o ya está granted (silencioso)
  if (status === "loading" || status === "unsupported") return null;

  return (
    <>
      {/* Banner para pedir permiso */}
      {status === "default" && (
        <div style={styles.banner}>
          <div style={styles.bannerContent}>
            <span style={styles.bellIcon}>🔔</span>
            <div style={styles.bannerText}>
              <strong>Activá las notificaciones</strong>
              <span style={styles.bannerSub}>
                Recibí avisos de permisos y novedades al instante
              </span>
            </div>
            <button
              onClick={handleEnable}
              disabled={registering}
              style={styles.bannerBtn}
            >
              {registering ? "Activando..." : "Activar"}
            </button>
          </div>
        </div>
      )}

      {/* Banner si fue denegado */}
      {status === "denied" && (
        <div style={{ ...styles.banner, background: "rgba(239,68,68,0.12)", borderColor: "#ef4444" }}>
          <div style={styles.bannerContent}>
            <span style={styles.bellIcon}>🔕</span>
            <div style={styles.bannerText}>
              <strong>Notificaciones bloqueadas</strong>
              <span style={styles.bannerSub}>
                Desbloqueá desde la config del navegador para recibirlas
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Toast de notificación en primer plano */}
      {toast && (
        <div style={styles.toast} onClick={() => setToast(null)}>
          <div style={styles.toastHeader}>
            <span style={styles.bellIcon}>🔔</span>
            <strong>{toast.title}</strong>
          </div>
          <p style={styles.toastBody}>{toast.body}</p>
        </div>
      )}
    </>
  );
}

// ─── Estilos inline (para no depender de CSS externo) ────────
const styles = {
  banner: {
    position: "fixed",
    bottom: 16,
    left: 16,
    right: 16,
    zIndex: 9999,
    background: "rgba(37,99,235,0.1)",
    border: "1px solid rgba(37,99,235,0.3)",
    borderRadius: 14,
    padding: "12px 16px",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    animation: "pushSlideUp 0.3s ease-out",
  },
  bannerContent: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  bellIcon: {
    fontSize: 24,
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontSize: 14,
    color: "#1e293b",
  },
  bannerSub: {
    fontSize: 12,
    color: "#64748b",
  },
  bannerBtn: {
    flexShrink: 0,
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "8px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  toast: {
    position: "fixed",
    top: 16,
    left: 16,
    right: 16,
    zIndex: 10000,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: "14px 16px",
    boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
    animation: "pushSlideDown 0.3s ease-out",
    cursor: "pointer",
  },
  toastHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
    fontSize: 15,
    color: "#0f172a",
  },
  toastBody: {
    margin: 0,
    fontSize: 13,
    color: "#475569",
    paddingLeft: 32,
  },
};
