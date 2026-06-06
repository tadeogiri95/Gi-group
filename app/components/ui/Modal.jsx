'use client';
import { useEffect, useRef, useCallback } from 'react';
import { C, fH, fB } from '../../lib/theme';

// ═══════════════════════════════════════════════════════
// Modal — Dialog responsive con backdrop y focus trap
// Ubicación: app/components/ui/Modal.jsx
// ═══════════════════════════════════════════════════════
//
// Mobile: bottom sheet (sube desde abajo, bordes redondeados arriba)
// Tablet+: dialog centrado clásico
//
// Uso:
//   <Modal open={showModal} onClose={() => setShowModal(false)} title="Editar empleado">
//     <form>...</form>
//   </Modal>
//
// Props:
//   open: boolean
//   onClose: () => void
//   title: string (opcional)
//   children: contenido
//   maxWidth: number (default 480)
//   closable: boolean (default true, muestra X y cierra con Esc/backdrop)

export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 480,
  closable = true,
}) {
  const dialogRef = useRef(null);
  const contentRef = useRef(null);

  // Cerrar con Escape
  useEffect(() => {
    if (!open || !closable) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, closable]);

  // Bloquear scroll del body
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  // Focus trap básico
  useEffect(() => {
    if (!open || !contentRef.current) return;
    const focusable = contentRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Dialog'}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={closable ? onClose : undefined}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          animation: 'fadeInFast 0.15s ease',
        }}
      />

      {/* Content — bottom sheet en mobile, centrado en desktop */}
      <div
        ref={contentRef}
        style={{
          position: 'relative',
          width: '100%', maxWidth,
          maxHeight: '90dvh',
          background: C.bg,
          borderRadius: '20px 20px 0 0',
          border: `1px solid ${C.border}`,
          borderBottom: 'none',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideInUp 0.2s ease',
        }}
        className="modal-content-responsive"
      >
        {/* Header */}
        {(title || closable) && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px 12px',
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}>
            {/* Drag handle — mobile indicator */}
            <div style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              width: 36, height: 4, borderRadius: 2,
              background: C.mute,
            }} className="show-mobile-only" />

            <h2 style={{
              margin: 0, fontSize: 17, fontWeight: 700,
              color: C.text, fontFamily: fH,
            }}>{title || ''}</h2>

            {closable && (
              <button
                onClick={onClose}
                aria-label="Cerrar"
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: C.surface, border: 'none',
                  color: C.dim, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body — scrollable */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 20px 24px',
          WebkitOverflowScrolling: 'touch',
        }}>
          {children}
        </div>
      </div>

      {/* CSS para hacer centrado en desktop */}
      <style>{`
        @media (min-width: 768px) {
          .modal-content-responsive {
            border-radius: 16px !important;
            border-bottom: 1px solid ${C.border} !important;
            margin: auto !important;
            max-height: 80dvh !important;
          }
        }
      `}</style>
    </div>
  );
}
