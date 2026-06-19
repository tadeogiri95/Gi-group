'use client';

const ChevRight = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

export default function Breadcrumb({ items = [] }) {
  if (items.length <= 1) return null;
  return (
    <nav className="hide-mobile flex items-center gap-1.5 px-6 pt-2 pb-1 text-xs font-body shrink-0" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gypi-mute flex">{ChevRight}</span>}
            {isLast ? (
              <span aria-current="page" className="text-gypi-text font-semibold">{item.label}</span>
            ) : (
              <button
                onClick={item.onClick}
                className="bg-transparent border-none cursor-pointer text-gypi-dim font-body text-xs py-0.5 px-1 rounded transition-colors duration-150 hover:text-gypi-amber"
              >{item.label}</button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function buildBreadcrumbs(screen, isGer, empresa, setScreen) {
  const home = { label: empresa?.nombre_corto || 'Inicio', onClick: () => setScreen('home') };
  if (screen === 'home') return [];
  const screenLabels = {
    'solicitudes': 'Inbox', 'equipo': 'Personal', 'config': 'Gestión',
    'ger-actividad': 'Taller', 'chat': 'Asistente IA', 'actividad': 'Mi Jornada',
    'mis-sols': 'Solicitudes', 'historial-fichajes': 'Fichajes',
  };
  if (screen === 'historial-fichajes' && isGer) {
    return [home, { label: 'Gestión', onClick: () => setScreen('config') }, { label: 'Fichajes' }];
  }
  if (screen === 'ger-actividad') return [home, { label: 'Taller' }];
  return [home, { label: screenLabels[screen] || screen }];
}
