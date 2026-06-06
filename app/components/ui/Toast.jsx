'use client';
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { C, fB } from '../../lib/theme';

// ═══════════════════════════════════════════════════════
// Toast — Notificaciones con auto-dismiss
// Ubicación: app/components/ui/Toast.jsx
// ═══════════════════════════════════════════════════════
//
// Reemplaza los showToast inline que cada pantalla reimplementa.
// Provee un Context para usar desde cualquier componente.
//
// Setup (en layout o provider):
//   <ToastProvider>
//     <App />
//   </ToastProvider>
//
// Uso en componentes:
//   const toast = useToast();
//   toast.success("Guardado correctamente");
//   toast.error("No se pudo guardar");
//   toast.info("Procesando...");
//   toast.show("Mensaje custom", C.amber);

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback para uso sin provider (backward compat)
    return {
      show: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
    };
  }
  return ctx;
}

// ─── Toast item ───
function ToastItem({ toast, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(toast.id), 200);
    }, toast.duration || 3500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const iconMap = {
    success: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    error: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
    info: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  };

  return (
    <div
      onClick={() => { setExiting(true); setTimeout(() => onDismiss(toast.id), 200); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderRadius: 12,
        background: C.surface,
        border: `1px solid ${toast.color}40`,
        boxShadow: `0 4px 20px ${C.bg}80`,
        cursor: 'pointer',
        transform: visible && !exiting ? 'translateY(0)' : 'translateY(-12px)',
        opacity: visible && !exiting ? 1 : 0,
        transition: 'all 0.2s ease',
        maxWidth: 400,
      }}
    >
      {toast.variant && iconMap[toast.variant] && (
        <span style={{ display: 'flex', color: toast.color, flexShrink: 0 }}>
          {iconMap[toast.variant]}
        </span>
      )}
      <span style={{
        fontSize: 13, fontWeight: 600, color: C.text,
        fontFamily: fB, flex: 1,
      }}>{toast.message}</span>
    </div>
  );
}

// ─── Toast container ───
function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8,
      alignItems: 'center',
      pointerEvents: 'none',
      width: '90%', maxWidth: 420,
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'auto', width: '100%' }}>
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

// ─── Provider ───
let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((message, color = C.amber, opts = {}) => {
    const id = ++toastId;
    setToasts(prev => [...prev.slice(-3), { id, message, color, ...opts }]);
  }, []);

  const api = {
    show,
    success: (msg, opts) => show(msg, C.green, { variant: 'success', ...opts }),
    error: (msg, opts) => show(msg, C.red, { variant: 'error', ...opts }),
    info: (msg, opts) => show(msg, C.amber, { variant: 'info', ...opts }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Standalone (backward compat con el patrón actual) ───
// Para pantallas que ya tienen su propio state de toast:
//   <ToastInline toast={toast} />
export function ToastInline({ toast }) {
  if (!toast) return null;
  return (
    <div style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, width: '90%', maxWidth: 400,
      pointerEvents: 'auto',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderRadius: 12,
        background: C.surface, border: `1px solid ${toast.color}40`,
        boxShadow: `0 4px 20px ${C.bg}80`,
        animation: 'fadeIn 0.2s ease',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: fB }}>
          {toast.msg}
        </span>
      </div>
    </div>
  );
}

export default ToastProvider;
