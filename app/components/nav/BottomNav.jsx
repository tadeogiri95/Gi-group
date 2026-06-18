'use client';

// BottomNav -- Barra de navegacion mobile modernizada
// Ubicacion: app/components/nav/BottomNav.jsx

const Icons = {
  home: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  inbox: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  users: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  gear: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  hammer: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"/><path d="M17.64 15L22 10.64"/><path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/></svg>,
  chat: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  history: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
};

function getItems(role, pend) {
  if (role === 'gerencial' || role === 'administrativo') {
    return [
      { id: 'home',         label: 'Inicio',    icon: Icons.home },
      { id: 'solicitudes',  label: 'Inbox',     icon: Icons.inbox, badge: pend },
      { id: 'equipo',       label: 'Equipo',    icon: Icons.users },
      { id: 'config',       label: 'Gestión',   icon: Icons.gear },
    ];
  }
  return [
    { id: 'home',       label: 'Inicio',      icon: Icons.home },
    { id: 'actividad',  label: 'Actividad',   icon: Icons.hammer },
    { id: 'chat',       label: 'Chat',        icon: Icons.chat },
    { id: 'mis-sols',   label: 'Solicitudes', icon: Icons.history },
  ];
}

export default function BottomNav({ active, onChange, role, pend }) {
  const items = getItems(role, pend);
  return (
    <nav
      role="navigation"
      aria-label="Navegación principal"
      className="safe-bottom fixed bottom-0 left-0 right-0 backdrop-blur-[20px] border-t border-gypi-border z-50 flex justify-around max-w-[480px] mx-auto px-2 pt-1.5 pb-[22px]"
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
            className={`flex-1 bg-transparent border-none py-1 px-0 flex flex-col items-center gap-0.5 cursor-pointer font-body text-[10px] transition-colors duration-150 ${
              isActive ? 'text-gypi-amber font-bold' : 'text-gypi-dim font-medium'
            }`}
          >
            <div
              className="flex items-center justify-center relative h-7 rounded-[14px] transition-all duration-200 ease-out"
              style={{
                width: isActive ? 56 : 36,
                background: isActive ? 'var(--color-empresa-primary-subtle)' : 'transparent',
              }}
            >
              <span
                className="flex transition-transform duration-150"
                style={{ transform: isActive ? 'scale(1.05)' : 'scale(1)' }}
              >
                {item.icon}
              </span>
              {item.badge > 0 && (
                <span
                  className="absolute -top-0.5 flex items-center justify-center min-w-[17px] h-[17px] px-[5px] rounded-full bg-gypi-red text-white text-[9px] font-extrabold font-mono"
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
