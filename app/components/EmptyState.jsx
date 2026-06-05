// ═══════════════════════════════════════════════════════════
// EmptyState — Estado vacío con ícono y mensaje
//
// ENTREGA 2B: Reemplaza los <div> con "Sin datos" hardcodeados
// en múltiples pantallas. Consistente, con ícono y acción opcional.
//
// Uso:
//   <EmptyState
//     icon={<Ic.inbox size={32} />}
//     title="Sin solicitudes"
//     description="Las solicitudes de tu equipo aparecerán acá"
//     action={{ label: "Recargar", onClick: loadData }}
//   />
// ═══════════════════════════════════════════════════════════

export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      {icon && (
        <div className="text-gypi-mute mb-4 opacity-50">{icon}</div>
      )}
      {title && (
        <p className="text-sm font-semibold text-gypi-dim m-0 mb-1">{title}</p>
      )}
      {description && (
        <p className="text-xs text-gypi-mute m-0 max-w-[250px]">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 rounded-btn bg-gypi-amber/15 text-gypi-amber text-xs font-bold border-none cursor-pointer hover:bg-gypi-amber/25"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
