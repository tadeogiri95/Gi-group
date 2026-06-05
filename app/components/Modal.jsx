"use client";
// ═══════════════════════════════════════════════════════════
// Modal — Genérico con backdrop, ESC para cerrar, focus trap
//
// ENTREGA 2B: Reemplaza 3+ implementaciones distintas de modal.
//
// Uso:
//   <Modal open={show} onClose={() => setShow(false)} title="Editar">
//     <p>Contenido</p>
//   </Modal>
//
// Props:
//   open      — boolean
//   onClose   — callback
//   title     — string (opcional)
//   maxWidth  — string (default "max-w-md")
//   children  — contenido del modal
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback } from "react";

export default function Modal({ open, onClose, title, maxWidth = "max-w-md", children }) {
  const dialogRef = useRef(null);

  // ESC para cerrar
  const handleKey = useCallback((e) => {
    if (e.key === "Escape") onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKey);
      // Bloquear scroll del body
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, handleKey]);

  // Focus trap básico
  useEffect(() => {
    if (open && dialogRef.current) {
      const focusable = dialogRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) focusable[0].focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className={`relative ${maxWidth} w-full bg-gypi-surface rounded-2xl border border-gypi-border-hi overflow-hidden animate-fade-in`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-[15px] font-bold text-gypi-text font-heading m-0">{title}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-gypi-dim hover:text-gypi-text text-sm font-bold border-none cursor-pointer"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        )}

        {/* Content */}
        <div className={`px-5 pb-5 ${title ? "" : "pt-5"} overflow-y-auto`} style={{ maxHeight: "70vh" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
