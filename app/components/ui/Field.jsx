'use client';
// Campo de formulario (R4): etiqueta siempre visible (no solo el texto de
// ejemplo), ayuda debajo y el error dicho en palabras. El control va como hijo
// y recibe id, aria-describedby y aria-invalid.
import { useId, cloneElement, isValidElement } from 'react';

export default function Field({ label, help, error, children }) {
  const id = useId();
  const ayudaId = help ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || id,
        'aria-describedby': [ayudaId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
      })
    : children;
  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <label htmlFor={isValidElement(children) ? (children.props.id || id) : undefined} className="text-[14px] font-semibold text-gypi-text">{label}</label>
      {control}
      {help && <p id={ayudaId} className="m-0 text-[13px] text-gypi-dim">{help}</p>}
      {error && <p id={errorId} role="alert" className="m-0 text-[13px] font-semibold text-gypi-red">{error}</p>}
    </div>
  );
}
