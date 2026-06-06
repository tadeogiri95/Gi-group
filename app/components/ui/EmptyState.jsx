'use client';
import { C, fH, fB } from '../../lib/theme';

// ═══════════════════════════════════════════════════════
// EmptyState — Estados vacíos con icono + mensaje + CTA
// Ubicación: app/components/ui/EmptyState.jsx
// ═══════════════════════════════════════════════════════
//
// Reemplaza los divs inline "Sin fichadas", "No tenés solicitudes", etc.
//
// Uso:
//   <EmptyState
//     icon="inbox"          // preset o JSX custom
//     title="Sin solicitudes"
//     description="Cuando envíes permisos o avisos, aparecerán acá."
//     action={{ label: "Ir al chat", onClick: () => goto('chat') }}
//   />

const presetIcons = {
  inbox: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  clock: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  users: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>,
  chart: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  calendar: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  folder: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  search: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  mapPin: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
};

export default function EmptyState({
  icon = 'inbox',
  title = 'Sin datos',
  description,
  action,
  color = C.dim,
  style = {},
}) {
  const iconEl = typeof icon === 'string' ? presetIcons[icon] : icon;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center',
      padding: '40px 24px', ...style,
    }}>
      {/* Icon circle */}
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: `${color}12`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color, marginBottom: 16,
      }}>
        {iconEl}
      </div>

      <h3 style={{
        margin: 0, fontSize: 16, fontWeight: 700,
        color: C.text, fontFamily: fH,
      }}>{title}</h3>

      {description && (
        <p style={{
          margin: '8px 0 0', fontSize: 13, color: C.dim,
          lineHeight: 1.5, maxWidth: 280,
        }}>{description}</p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 18, padding: '10px 20px', borderRadius: 10,
            background: C.amber, color: '#000', border: 'none',
            fontSize: 13, fontWeight: 700, fontFamily: fB,
            cursor: 'pointer',
          }}
        >{action.label}</button>
      )}
    </div>
  );
}
