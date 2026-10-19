"use client";
// Pestañas de arriba de una pestaña de la barra (Planta, Equipo). Si no
// entran en un celular angosto, se corren de costado en vez de cortarse.
export default function Pestanas({ label, opciones, actual, onElegir, bloqueada = () => false }) {
  return (
    <div role="tablist" aria-label={label} className="mx-[18px] mb-2 flex gap-[2px] bg-gypi-surf-hi rounded-[var(--radius-md)] p-[3px] shrink-0 overflow-x-auto">
      {opciones.map((o) => {
        const activa = o.id === actual;
        return (
          <button key={o.id} role="tab" aria-selected={activa} onClick={() => onElegir(o.id)}
            className={`flex-1 shrink-0 whitespace-nowrap px-3 min-h-[44px] rounded-[calc(var(--radius-md)-2px)] border-none cursor-pointer text-[14px] font-bold font-body ${activa ? "bg-gypi-surface text-gypi-text shadow-sm" : "bg-transparent text-gypi-dim"}`}>
            {o.label}{bloqueada(o) && " 🔒"}
          </button>
        );
      })}
    </div>
  );
}
