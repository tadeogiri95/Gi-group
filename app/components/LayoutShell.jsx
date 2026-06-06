'use client';
import { useState, useCallback } from 'react';
import { C, fH, fB } from '../lib/theme';
import { useBreakpoint } from '../hooks/useBreakpoint';

// ═══════════════════════════════════════════════════════
// LayoutShell — Responsive container para la app
// Ubicación: app/components/LayoutShell.jsx
// ═══════════════════════════════════════════════════════
//
// Mobile:  shell vertical clásico (maxWidth 480, bottom nav visible)
// Tablet+: sidebar izquierdo + contenido (bottom nav oculto via CSS)
// Desktop: sidebar + contenido + panel lateral opcional
//
// Uso en [slug]/page.js:
//   <LayoutShell
//     sidebar={<Sidebar ... />}      // null en mobile
//     panel={panelContent}           // null si no aplica
//     statusBar={<StatusBar />}      // solo se muestra en mobile
//     bottomNav={<Nav ... />}        // solo se muestra en mobile
//   >
//     {children}
//   </LayoutShell>

// ─── Iconos del sidebar ───
const SidebarIc = {
  collapse: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 19l-7-7 7-7"/><path d="M18 19l-7-7 7-7" opacity=".4"/></svg>,
  expand: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 5l7 7-7 7"/><path d="M6 5l7 7-7 7" opacity=".4"/></svg>,
  home: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  inbox: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  users: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>,
  gear: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/></svg>,
  hammer: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"/><path d="M17.64 15L22 10.64"/><path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/></svg>,
  chat: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  history: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  logout: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  refresh: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
};

// ─── Items de navegación por rol ───
function getNavItems(role, pend) {
  if (role === 'gerencial' || role === 'administrativo') {
    return [
      { id: 'home', label: 'Inicio', icon: SidebarIc.home },
      { id: 'solicitudes', label: 'Inbox', icon: SidebarIc.inbox, badge: pend },
      { id: 'equipo', label: 'Personal', icon: SidebarIc.users },
      { id: 'ger-actividad', label: 'Taller', icon: SidebarIc.hammer },
      { id: 'config', label: 'Gestión', icon: SidebarIc.gear },
      { id: 'chat', label: 'Asistente IA', icon: SidebarIc.chat },
    ];
  }
  return [
    { id: 'home', label: 'Inicio', icon: SidebarIc.home },
    { id: 'actividad', label: 'Mi Jornada', icon: SidebarIc.hammer },
    { id: 'chat', label: 'Chat', icon: SidebarIc.chat },
    { id: 'mis-sols', label: 'Solicitudes', icon: SidebarIc.history },
  ];
}

// ═══ SIDEBAR COMPONENT ═══
export function Sidebar({ active, onChange, role, pend, empresa, usuario, onLogout, onRefresh }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('gypi-sidebar-collapsed') === 'true';
  });

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('gypi-sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  const items = getNavItems(role, pend);
  const nombreEmpresa = empresa?.nombre_corto || 'Gypi';

  return (
    <div className={`app-sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* Logo / Empresa */}
      <div style={{
        padding: collapsed ? '20px 12px 16px' : '20px 16px 16px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 12,
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        {empresa?.logo_url ? (
          <img
            src={empresa.logo_url}
            alt={nombreEmpresa}
            style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'contain', flexShrink: 0 }}
          />
        ) : (
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: `linear-gradient(135deg,${C.amber},${C.violet})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#000', fontFamily: fH, fontSize: 16, fontWeight: 800,
          }}>
            {nombreEmpresa.charAt(0)}
          </div>
        )}
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: fH, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {nombreEmpresa}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
              {usuario?.apodo || 'Usuario'}
            </div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(item => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: collapsed ? '10px 0' : '10px 12px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 10, border: 'none', cursor: 'pointer',
                background: isActive ? `${C.amber}18` : 'transparent',
                color: isActive ? C.amber : C.dim,
                fontSize: 13, fontWeight: isActive ? 700 : 500,
                fontFamily: fB, transition: 'all 0.15s',
                position: 'relative', width: '100%',
              }}
            >
              <span style={{ display: 'flex', position: 'relative', flexShrink: 0 }}>
                {item.icon}
                {item.badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -4, right: -6,
                    minWidth: 16, height: 16, padding: '0 4px',
                    borderRadius: 8, background: C.red, color: '#fff',
                    fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `2px solid ${C.bg}`,
                  }}>{item.badge}</span>
                )}
              </span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div style={{
        padding: collapsed ? '12px 8px' : '12px 16px',
        borderTop: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {onRefresh && (
          <button
            onClick={onRefresh}
            title={collapsed ? 'Actualizar' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: collapsed ? '8px 0' : '8px 8px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'transparent', color: C.dim,
              fontSize: 12, fontWeight: 500, fontFamily: fB, width: '100%',
            }}
          >
            {SidebarIc.refresh}
            {!collapsed && <span>Actualizar</span>}
          </button>
        )}
        <button
          onClick={onLogout}
          title={collapsed ? 'Cerrar sesión' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: collapsed ? '8px 0' : '8px 8px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'transparent', color: C.dim,
            fontSize: 12, fontWeight: 500, fontFamily: fB, width: '100%',
          }}
        >
          {SidebarIc.logout}
          {!collapsed && <span>Cerrar sesión</span>}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '6px 0', borderRadius: 8, border: 'none',
            cursor: 'pointer', background: 'transparent',
            color: C.mute, marginTop: 4, width: '100%',
          }}
        >
          {collapsed ? SidebarIc.expand : SidebarIc.collapse}
        </button>
      </div>
    </div>
  );
}

// ═══ LAYOUT SHELL ═══
export default function LayoutShell({ children, statusBar, bottomNav, sidebar, panel }) {
  const { isMobile } = useBreakpoint();

  return (
    <div className="app-shell">
      {/* Sidebar: visible solo en tablet+ (controlado por CSS) */}
      {sidebar}

      {/* Contenido principal */}
      <div className="app-content">
        {/* Status bar falsa: solo mobile (controlado por CSS) */}
        {statusBar && <div className="app-status-bar">{statusBar}</div>}

        {children}

        {/* Bottom nav: solo mobile (controlado por CSS) */}
        {bottomNav && <div className="app-bottom-nav">{bottomNav}</div>}
      </div>

      {/* Panel lateral: solo desktop xl (controlado por CSS) */}
      {panel && <div className="app-panel">{panel}</div>}
    </div>
  );
}
