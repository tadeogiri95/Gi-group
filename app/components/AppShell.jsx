'use client';

/**
 * GYPI — AppShell Layout
 *
 * Ubicación destino: app/components/AppShell.jsx
 *
 * Estructura responsive:
 * - Mobile: Header fijo + contenido + Bottom Navigation
 * - Desktop (≥768px): Sidebar lateral + Header + contenido
 *
 * Props:
 * - currentScreen: string (key de la pantalla activa)
 * - onNavigate: (screen) => void
 * - user: { nombre, rol, foto_url }
 * - empresa: { nombre, logo_url, color_primario }
 * - children: contenido de la pantalla
 */

import { useState } from 'react';
import Icon from './Icon';

// Definición de navegación por rol
const NAV_ITEMS = {
  operario: [
    { key: 'actividad',  icon: 'play',     label: 'Actividad' },
    { key: 'fichaje',    icon: 'clock',     label: 'Fichaje' },
    { key: 'chat',       icon: 'chat',      label: 'Chat' },
    { key: 'perfil',     icon: 'user',      label: 'Perfil' },
  ],
  gerencia: [
    { key: 'dashboard',  icon: 'chart',     label: 'Dashboard' },
    { key: 'personal',   icon: 'users',     label: 'Personal' },
    { key: 'reportes',   icon: 'clipboard', label: 'Reportes' },
    { key: 'config',     icon: 'settings',  label: 'Config' },
  ],
  admin: [
    { key: 'dashboard',  icon: 'chart',     label: 'Dashboard' },
    { key: 'personal',   icon: 'users',     label: 'Personal' },
    { key: 'actividad',  icon: 'play',      label: 'Actividad' },
    { key: 'reportes',   icon: 'clipboard', label: 'Reportes' },
    { key: 'config',     icon: 'settings',  label: 'Config' },
  ],
};

export default function AppShell({
  currentScreen,
  onNavigate,
  user = {},
  empresa = {},
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const rol = user.rol || 'operario';
  const items = NAV_ITEMS[rol] || NAV_ITEMS.operario;

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row bg-[var(--color-bg)]">

      {/* ===== SIDEBAR (Desktop) ===== */}
      <aside className="hidden md:flex flex-col w-60 border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
        {/* Logo empresa */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-[var(--color-border)]">
          {empresa.logo_url ? (
            <img src={empresa.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
              <Icon name="building" size={16} className="text-white" />
            </div>
          )}
          <span className="font-display font-semibold text-sm text-[var(--color-text)] truncate">
            {empresa.nombre || 'Gypi'}
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
          {items.map(item => (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                text-sm font-medium transition-all duration-150
                ${currentScreen === item.key
                  ? 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400'
                  : 'text-[var(--color-text-secondary)] hover:bg-surface-100 dark:hover:bg-surface-700'
                }
              `.trim().replace(/\s+/g, ' ')}
            >
              <Icon name={item.icon} size={18} strokeWidth={currentScreen === item.key ? 2 : 1.5} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold dark:bg-brand-900 dark:text-brand-300">
              {user.nombre ? user.nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-text)] truncate">{user.nombre || 'Usuario'}</p>
              <p className="text-2xs text-[var(--color-text-muted)] capitalize">{rol}</p>
            </div>
            <button
              onClick={() => onNavigate('logout')}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-danger-500 hover:bg-danger-50 transition-colors"
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ===== MAIN AREA ===== */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] shrink-0">
          {/* Mobile: menu + title */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-2 -ml-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-surface-100"
            >
              <Icon name="menu" size={20} />
            </button>
            <h1 className="text-base font-semibold text-[var(--color-text)] font-display">
              {items.find(i => i.key === currentScreen)?.label || 'Gypi'}
            </h1>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <button className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-surface-100 dark:hover:bg-surface-700 relative">
              <Icon name="bell" size={20} />
              {/* Dot de notificación */}
              {/* <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-danger-500" /> */}
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* ===== BOTTOM NAV (Mobile) ===== */}
      <nav className="md:hidden flex items-center justify-around h-16 border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] pb-[env(safe-area-inset-bottom)] shrink-0">
        {items.slice(0, 5).map(item => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            className={`
              flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-xl
              transition-colors duration-150
              ${currentScreen === item.key
                ? 'text-brand-500'
                : 'text-[var(--color-text-muted)]'
              }
            `.trim().replace(/\s+/g, ' ')}
          >
            <Icon
              name={item.icon}
              size={20}
              strokeWidth={currentScreen === item.key ? 2 : 1.5}
            />
            <span className="text-2xs font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* ===== MOBILE SIDEBAR OVERLAY ===== */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-72 bg-[var(--color-bg)] border-r border-[var(--color-border)] flex flex-col animate-slide-up">
            <div className="h-14 flex items-center justify-between px-4 border-b border-[var(--color-border)]">
              <span className="font-display font-semibold text-sm">{empresa.nombre || 'Gypi'}</span>
              <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg hover:bg-surface-100">
                <Icon name="x" size={18} />
              </button>
            </div>
            <nav className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
              {items.map(item => (
                <button
                  key={item.key}
                  onClick={() => { onNavigate(item.key); setSidebarOpen(false); }}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                    text-sm font-medium transition-colors
                    ${currentScreen === item.key
                      ? 'bg-brand-50 text-brand-600'
                      : 'text-[var(--color-text-secondary)] hover:bg-surface-100'
                    }
                  `.trim().replace(/\s+/g, ' ')}
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}
