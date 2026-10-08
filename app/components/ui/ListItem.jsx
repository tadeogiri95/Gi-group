'use client';
// Renglón de lista (R4): ícono, título, detalle y algo a la derecha (un estado,
// una flecha). Mide 56 px o más; si tiene onClick es un botón entero.
export default function ListItem({ icon, title, detail, right, onClick, label }) {
  const contenido = (
    <>
      {icon && <span aria-hidden="true" className="w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-gypi-surf-hi shrink-0">{icon}</span>}
      <span className="flex-1 min-w-0 text-left">
        <span className="block text-[15px] font-semibold text-gypi-text truncate">{title}</span>
        {detail && <span className="block text-[13px] text-gypi-dim mt-0.5 truncate">{detail}</span>}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </>
  );
  const clases = 'w-full min-h-[56px] flex items-center gap-3 px-3.5 py-2.5 bg-gypi-surface border border-gypi-border rounded-xl';
  return onClick
    ? <button onClick={onClick} aria-label={label} className={`${clases} cursor-pointer font-body`}>{contenido}</button>
    : <div className={clases}>{contenido}</div>;
}
