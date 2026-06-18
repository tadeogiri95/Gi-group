'use client';
import { useState, useCallback, useRef } from 'react';
import Modal from './Modal';
import { C, fB } from '../../lib/theme';

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
      <p style={{ fontSize: 14, color: C.text, lineHeight: 1.5, margin: "0 0 20px" }}>{state.message}</p>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={handleCancel}
          style={{
            flex: 1, padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.border}`,
            background: C.surface, color: C.text, fontSize: 14, fontWeight: 600,
            fontFamily: fB, cursor: "pointer", minHeight: 44,
          }}
        >
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          style={{
            flex: 1, padding: "12px 16px", borderRadius: 12, border: "none",
            background: state.destructive ? C.red : C.amber, color: state.destructive ? "#fff" : C.amberText,
            fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: "pointer", minHeight: 44,
          }}
        >
          {state.confirmLabel}
        </button>
      </div>
    </Modal>
  ) : null;

  return [confirm, ConfirmDialog];
}
