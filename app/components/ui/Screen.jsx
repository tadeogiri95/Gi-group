'use client';
// Pantalla base (R4): encabezado con "← Volver" y título, contenido con scroll
// y, si hace falta, la acción principal fija abajo, al alcance del pulgar.
// Toda pantalla nueva (y los módulos Producción, Stock, etc.) arranca de acá.
export default function Screen({ title, subtitle, onBack, backLabel = 'Volver', action, children, label }) {
  return (
    <section aria-label={label || title} className="flex-1 flex flex-col min-h-0 font-body">
      {(title || onBack) && (
        <header className="px-[18px] pt-3 pb-2 shrink-0">
          {onBack && (
            <button onClick={onBack} className="min-h-[44px] -ml-1 px-1 bg-transparent border-none cursor-pointer text-[15px] font-semibold text-gypi-text">
              ← {backLabel}
            </button>
          )}
          {subtitle && <div className="g-overline text-gypi-dim">{subtitle}</div>}
          {title && <h1 className="m-0 text-[22px] font-bold text-gypi-text font-heading tracking-tight">{title}</h1>}
        </header>
      )}
      <div className={`flex-1 overflow-y-auto px-[18px] ${action ? 'pb-[180px]' : 'pb-[110px]'}`}>{children}</div>
      {action && (
        <div className="fixed left-0 right-0 bottom-[78px] max-w-[480px] mx-auto px-[18px] pb-2 pt-2 bg-gradient-to-t from-[var(--color-bg)] to-transparent z-40">
          {action}
        </div>
      )}
    </section>
  );
}
