'use client';

// BottomNav -- Barra de navegacion al pie de la app
// Ubicacion: app/components/nav/BottomNav.jsx
import { conBoton } from '../../lib/menuGestion';

const Icons = {
  home: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  gear: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  hammer: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"/><path d="M17.64 15L22 10.64"/><path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/></svg>,
  menu: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>,
  user: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  clipboard: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>,
  box: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  wrench: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  history: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
};

// Pestañas del operario según los módulos de la empresa (ítem 36). Sin la
// lista de módulos (demo, versión vieja en caché) se muestran todas.
const tiene = (modulos, ...ids) => !Array.isArray(modulos) || ids.some((m) => modulos.includes(m));

export function getItems(role, pend, modulos, { instalador = false } = {}) {
  // Gestión (menú nuevo, parte 32): Inicio · Proyectos · Inventario ·
  // Mantenimiento · Más. Cada botón del medio aparece si la empresa tiene
  // alguno de sus módulos. Permisos y Equipo pasaron a "Más", que lleva el
  // número de permisos pendientes.
  if (role === 'gerencial' || role === 'administrativo') {
    const empresa = { modulos };
    return [
      { id: 'home',          label: 'Inicio',        icon: Icons.home },
      conBoton('proyectos', empresa) && { id: 'proyectos', label: 'Proyectos', icon: Icons.clipboard },
      conBoton('inventario', empresa) && { id: 'inventario', label: 'Inventario', icon: Icons.box },
      conBoton('mantenimiento', empresa) && { id: 'mantenimiento', label: 'Mantenimiento', icon: Icons.wrench },
      { id: 'config',        label: 'Más',           icon: Icons.menu, badge: pend },
    ].filter(Boolean);
  }
  // Operario: Inicio · Permisos · Mi cuenta. "Tareas" (Iniciar Tarea) y
  // "Asistente" salieron de la barra: el avance se mide escaneando piezas
  // (pedido de la empresa, 2026-10). "Mi cuenta" dejó de ser un renglón al
  // final del Inicio (revisión de la interfaz). El instalador (migración 116)
  // suma "Instalaciones" para el reporte del día.
  return [
    { id: 'home',       label: 'Inicio',      icon: Icons.home },
    instalador && { id: 'instalaciones', label: 'Instalaciones', icon: Icons.hammer },
    { id: 'mis-sols',   label: 'Permisos', icon: Icons.history },
    { id: 'cuenta',     label: 'Mi cuenta', icon: Icons.user },
  ].filter(Boolean);
}

export default function BottomNav({ active, onChange, role, pend, modulos, instalador = false }) {
  const items = getItems(role, pend, modulos, { instalador });
  // El operario tiene pocas pestañas: botones y letra más grandes, fáciles de
  // tocar en la planta (revisión de la interfaz, 2026-10)
  const grande = role !== 'gerencial' && role !== 'administrativo';
  return (
    // La barra ocupa su propio lugar al pie del shell (no flota encima): así
    // ninguna pantalla queda tapada abajo, sobre todo en la computadora, donde
    // la ventana es más baja y lo último de Compras o Más no se podía tocar.
    <nav
      role="navigation"
      aria-label="Navegación principal"
      className="safe-bottom shrink-0 relative w-full backdrop-blur-[20px] border-t border-gypi-border z-50 flex justify-around px-2 pt-1.5 pb-[22px]"
      style={{
        background: 'var(--color-nav-bg)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {items.map(item => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={`flex-1 ${grande ? 'min-h-[60px] text-[14px] gap-1' : 'min-h-[52px] text-xs gap-0.5'} bg-transparent border-none py-1 px-0 flex flex-col items-center cursor-pointer font-body transition-colors duration-150 ${
              isActive ? 'text-gypi-text font-bold' : 'text-gypi-dim font-medium'
            }`}
          >
            <div
              className={`flex items-center justify-center relative ${grande ? 'h-8 rounded-2xl' : 'h-7 rounded-[14px]'} transition-all duration-200 ease-out`}
              style={{
                width: isActive ? (grande ? 64 : 56) : (grande ? 44 : 36),
                background: isActive ? 'var(--color-empresa-primary-subtle)' : 'transparent',
              }}
            >
              <span
                className="flex transition-transform duration-150"
                style={{ transform: `scale(${(grande ? 1.2 : 1) * (isActive ? 1.05 : 1)})` }}
              >
                {item.icon}
              </span>
              {item.badge > 0 && (
                <span
                  className="absolute -top-0.5 flex items-center justify-center min-w-[20px] h-[20px] px-[5px] rounded-full bg-gypi-red text-white text-xs font-extrabold font-mono"
                  style={{
                    right: isActive ? 2 : -2,
                    border: '2px solid var(--color-bg)',
                    animation: 'fadeIn 0.3s ease',
                  }}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </div>
            <span className="leading-none tracking-[0.01em]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
