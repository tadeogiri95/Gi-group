'use client';
import { useState, useCallback, useRef } from 'react';
import Modal from './Modal';

export function useConfirm() {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message, { title = "Confirmar", confirmLabel = "Confirmar", destructive = false } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ message, title, confirmLabel, destructive });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    setState(null);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    setState(null);
  }, []);

  const ConfirmDialog = state ? (
    <Modal open onClose={handleCancel} title={state.title} maxWidth={400}>
      <p className="text-sm text-gypi-text leading-relaxed m-0 mb-5">{state.message}</p>
      <div className="flex gap-2.5">
        <button
          onClick={handleCancel}
          className="flex-1 py-3 px-4 rounded-xl border border-gypi-border bg-gypi-surface text-gypi-text text-sm font-semibold font-body cursor-pointer min-h-[44px]"
        >
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          className={`flex-1 py-3 px-4 rounded-xl border-none text-sm font-bold font-body cursor-pointer min-h-[44px] ${
            state.destructive ? "bg-gypi-red text-white" : "bg-gypi-amber text-white"
          }`}
        >
          {state.confirmLabel}
        </button>
      </div>
    </Modal>
  ) : null;

  return [confirm, ConfirmDialog];
}
