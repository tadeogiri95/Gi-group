"use client";
// ═══════════════════════════════════════════════════════════
// Toast — Provider global + useToast() hook
//
// ENTREGA 2B: Reemplaza el patrón setToast/setTimeout
// duplicado en 7 archivos (79 líneas de código repetido).
//
// Uso:
//   import { useToast } from "../components/Toast";
//   const toast = useToast();
//   toast.success("Guardado");
//   toast.error("Falló algo");
//   toast.info("Procesando...");
// ═══════════════════════════════════════════════════════════

import { createContext, useContext, useState, useCallback, useRef } from "react";

const ToastContext = createContext(null);

const COLORS = {
  success: { bg: "bg-gypi-green/15", border: "border-gypi-green/30", text: "text-gypi-green" },
  error:   { bg: "bg-gypi-red/15",   border: "border-gypi-red/30",   text: "text-gypi-red" },
  info:    { bg: "bg-gypi-cyan/15",  border: "border-gypi-cyan/30",  text: "text-gypi-cyan" },
  warning: { bg: "bg-gypi-amber/15", border: "border-gypi-amber/30", text: "text-gypi-amber" },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const show = useCallback((msg, type = "success", duration = 3000) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const api = {
    success: (msg, ms) => show(msg, "success", ms),
    error:   (msg, ms) => show(msg, "error", ms),
    info:    (msg, ms) => show(msg, "info", ms),
    warning: (msg, ms) => show(msg, "warning", ms),
    show,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast container */}
      <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[999] flex flex-col gap-2 pointer-events-none w-[90%] max-w-sm">
        {toasts.map(t => {
          const c = COLORS[t.type] || COLORS.success;
          return (
            <div
              key={t.id}
              className={`${c.bg} ${c.text} border ${c.border} rounded-xl px-5 py-3 text-[13px] font-semibold shadow-lg animate-fade-in pointer-events-auto`}
            >
              {t.msg}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
