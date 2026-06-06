'use client';
import { C, fB, fH } from '../../lib/theme';

// ═══════════════════════════════════════════════════════
// Breadcrumb — Navegación contextual para tablet/desktop
// Ubicación: app/components/nav/Breadcrumb.jsx
// ═══════════════════════════════════════════════════════

const ChevRight = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

export default function Breadcrumb({ items = [] }) {
  if (items.length <= 1) return null;
  return (
    <nav className="hide-mobile" aria-label="Breadcrumb" style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 24px 4px', fontSize: 12, fontFamily: fB, flexShrink: 0,
    }}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: C.mute, display: 'flex' }}>{ChevRight}</span>}
            {isLast ? (
              <span style={{ color: C.text, fontWeight: 600 }}>{item.label}</span>
            ) : (
              <button
                onClick={item.onClick}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: C.dim, fontFamily: fB, fontSize: 12,
                  padding: '2px 4px', borderRadius: 4, transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = C.amber}
                onMouseLeave={e => e.currentTarget.style.color = C.dim}
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
