'use client';
import { fB } from '../../lib/theme';

const V = {
  amber: "var(--color-empresa-primary, #F97316)",
  dim: "var(--color-text-dim)",
  surface: "var(--color-surface)",
};

// ═══════════════════════════════════════════════════════
// TabBar — Tabs con iconos SVG para ConfigScreen
// Ubicación: app/components/nav/TabBar.jsx
// ═══════════════════════════════════════════════════════

const TabIcons = {
  reportes: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  horarios: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  proyectos: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  ubicaciones: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  calendario: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg>,
  reglas: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  admin: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
};

export const GESTION_TABS = [
  { id: 'reportes',    label: 'Asistencia',   icon: TabIcons.reportes },
  { id: 'horarios',    label: 'Horarios',     icon: TabIcons.horarios },
  { id: 'proyectos',   label: 'Proyectos',    icon: TabIcons.proyectos },
  { id: 'ubicaciones', label: 'Ubicaciones',  icon: TabIcons.ubicaciones },
  { id: 'calendario',  label: 'Calendario',   icon: TabIcons.calendario },
  { id: 'reglas',      label: 'Reglas Bot',   icon: TabIcons.reglas },
  { id: 'admin',       label: 'Empresa',      icon: TabIcons.admin },
];

export default function TabBar({ tabs = GESTION_TABS, active, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Secciones de gestión"
      style={{
        padding: '0 18px 10px', display: 'flex', gap: 6,
        overflowX: 'auto', flexShrink: 0,
        scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }}
    >
      {tabs.map(tab => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              background: isActive ? `${V.amber}22` : V.surface,
              color: isActive ? V.amber : V.dim,
              fontSize: 12, fontWeight: 700, fontFamily: fB, whiteSpace: 'nowrap',
              scrollSnapAlign: 'start', transition: 'all 0.15s',
            }}
          >
            <span style={{ display: 'flex', opacity: isActive ? 1 : 0.7 }} aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
