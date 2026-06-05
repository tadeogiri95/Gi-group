"use client";
// ═══════════════════════════════════════════════════════════
// FotoViewer — Visor de fotos fullscreen con navegación
//
// ENTREGA 2B: Unifica las 2 implementaciones duplicadas en
// dashboard_gerencia.jsx y reportes_screen.jsx.
//
// Uso:
//   <FotoViewer
//     fotos={["url1", "url2"]}
//     index={0}
//     onClose={() => setViewer(null)}
//     onNav={(i) => setIndex(i)}
//   />
// ═══════════════════════════════════════════════════════════

import { useEffect, useCallback } from "react";

export default function FotoViewer({ fotos, index = 0, onClose, onNav }) {
  // Keyboard navigation
  const handleKey = useCallback((e) => {
    if (e.key === "Escape") onClose?.();
    if (e.key === "ArrowLeft" && index > 0) onNav?.(index - 1);
    if (e.key === "ArrowRight" && index < fotos.length - 1) onNav?.(index + 1);
  }, [onClose, onNav, index, fotos.length]);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  if (!fotos || fotos.length === 0) return null;

  const hasPrev = index > 0;
  const hasNext = index < fotos.length - 1;

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/92 flex flex-col items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 border-none text-white text-xl font-bold cursor-pointer z-[301] hover:bg-white/25"
        aria-label="Cerrar"
      >
        ✕
      </button>

      {/* Image */}
      <div className="relative" onClick={e => e.stopPropagation()}>
        <img
          src={fotos[index]}
          alt={`Foto ${index + 1} de ${fotos.length}`}
          className="max-w-[92vw] max-h-[80vh] object-contain rounded-xl"
        />
      </div>

      {/* Navigation */}
      {fotos.length > 1 && (
        <div className="flex items-center gap-3 mt-4" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => hasPrev && onNav?.(index - 1)}
            disabled={!hasPrev}
            className={`px-5 py-2.5 rounded-btn border-none text-base font-bold cursor-pointer ${
              hasPrev ? "bg-white/15 text-white hover:bg-white/25" : "bg-white/5 text-gypi-mute cursor-default"
            }`}
          >
            ‹ Anterior
          </button>
          <span className="text-gypi-dim text-sm">{index + 1} / {fotos.length}</span>
          <button
            onClick={() => hasNext && onNav?.(index + 1)}
            disabled={!hasNext}
            className={`px-5 py-2.5 rounded-btn border-none text-base font-bold cursor-pointer ${
              hasNext ? "bg-white/15 text-white hover:bg-white/25" : "bg-white/5 text-gypi-mute cursor-default"
            }`}
          >
            Siguiente ›
          </button>
        </div>
      )}
    </div>
  );
}
