'use client';
import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    if (!open) return;
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const handler = (e) => {
      if (e.key === 'Escape' && closable) { onClose(); return; }
      if (e.key !== 'Tab' || !contentRef.current) return;
      const focusable = [...contentRef.current.querySelectorAll(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, closable]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

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
      className="fixed inset-0 z-[1000] flex items-end justify-center"
    >
      <div
        onClick={closable ? onClose : undefined}
        className="absolute inset-0 bg-black/60 backdrop-blur-[4px] animate-[fadeInFast_0.15s_ease]"
      />

      <div
        ref={contentRef}
        style={{ maxWidth }}
        className="modal-content-responsive relative w-full max-h-[90dvh] bg-gypi-bg rounded-t-[20px] border border-gypi-border border-b-0 flex flex-col overflow-hidden animate-[slideInUp_0.2s_ease]"
      >
        {(title || closable) && (
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gypi-border shrink-0 relative">
            <div className="show-mobile-only absolute top-2 left-1/2 -translate-x-1/2 w-9 h-1 rounded-sm bg-gypi-mute" />

            <h2 className="m-0 text-[17px] font-bold text-gypi-text font-heading">{title || ''}</h2>

            {closable && (
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="w-8 h-8 rounded-lg bg-gypi-surface border-none text-gypi-dim cursor-pointer flex items-center justify-center"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}
