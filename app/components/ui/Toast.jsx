'use client';
import { useState, useEffect, useCallback, createContext, useContext } from 'react';

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
    };
  }
  return ctx;
}

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
      className="flex items-center gap-2.5 py-3 px-4 rounded-xl bg-gypi-surface cursor-pointer max-w-[400px] transition-all duration-200"
      style={{
        border: `1px solid ${toast.color}40`,
        boxShadow: `0 4px 20px var(--color-bg, #F7F7F5)80`,
        transform: visible && !exiting ? 'translateY(0)' : 'translateY(-12px)',
        opacity: visible && !exiting ? 1 : 0,
      }}
    >
      {toast.variant && iconMap[toast.variant] && (
        <span className="flex shrink-0" style={{ color: toast.color }}>
          {iconMap[toast.variant]}
        </span>
      )}
      <span className="text-[13px] font-semibold text-gypi-text font-body flex-1">{toast.message}</span>
    </div>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none w-[90%] max-w-[420px]">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto w-full">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((message, color = AMBER, opts = {}) => {
    const id = ++toastId;
    setToasts(prev => [...prev.slice(-3), { id, message, color, ...opts }]);
  }, []);

  const api = {
    show,
    success: (msg, opts) => show(msg, GREEN, { variant: 'success', ...opts }),
    error: (msg, opts) => show(msg, RED, { variant: 'error', ...opts }),
    info: (msg, opts) => show(msg, AMBER, { variant: 'info', ...opts }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function ToastInline({ toast }) {
  if (!toast) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-[90%] max-w-[400px] pointer-events-auto">
      <div
        className="flex items-center gap-2.5 py-3 px-4 rounded-xl bg-gypi-surface animate-[fadeIn_0.2s_ease]"
        style={{
          border: `1px solid ${toast.color}40`,
          boxShadow: `0 4px 20px var(--color-bg, #F7F7F5)80`,
        }}
      >
        <span className="text-[13px] font-semibold text-gypi-text font-body">
          {toast.msg}
        </span>
      </div>
    </div>
  );
}

export default ToastProvider;
