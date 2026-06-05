// ═══════════════════════════════════════════════════════════
// Icons — SVG icons como componentes React
//
// ENTREGA 2B: Extrae el objeto Ic de [slug]/page.js a un
// módulo compartido. Cada ícono acepta size y className.
//
// Uso:
//   import { Ic } from "../components/Icons";
//   <Ic.bot size={20} />
//   <Ic.check size={14} className="text-gypi-green" />
//
// También exporta el objeto Ic completo para compatibilidad
// con el código existente que usa {Ic.check} inline.
// ═══════════════════════════════════════════════════════════

function icon(paths, defaultSize = 20, strokeWidth = 2) {
  return function IconComponent({ size, className = "", ...props }) {
    const s = size || defaultSize;
    return (
      <svg
        width={s}
        height={s}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

function filledIcon(paths, defaultSize = 16) {
  return function IconComponent({ size, className = "", ...props }) {
    const s = size || defaultSize;
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" className={className} {...props}>
        {paths}
      </svg>
    );
  };
}

export const Ic = {
  bot:     icon(<><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></>, 20),
  send:    icon(<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="none"/></>, 18, 2.5),
  check:   icon(<><polyline points="20 6 9 17 4 12"/></>, 14, 3),
  x:       icon(<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>, 16, 3),
  bell:    icon(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>),
  clock:   icon(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, 12),
  enter:   icon(<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></>, 14, 2.5),
  exit:    icon(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>, 14, 2.5),
  home:    icon(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>, 22),
  chat:    icon(<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>, 22),
  users:   icon(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>, 22),
  inbox:   icon(<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>, 22),
  history: icon(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, 22),
  chevL:   icon(<><polyline points="15 18 9 12 15 6"/></>, 20),
  chevR:   icon(<><polyline points="9 18 15 12 9 6"/></>, 14),
  alert:   icon(<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></>, 14, 2.5),
  sparkle: filledIcon(<><path d="M12 0L14.59 8.41L23 12L14.59 15.59L12 24L9.41 15.59L1 12L9.41 8.41Z"/></>),
  gear:    icon(<><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/></>),
  plus:    icon(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>, 16, 2.5),
  trash:   icon(<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>, 14),
  logout:  icon(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>, 16),
  refresh: icon(<><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>, 16),
  hammer:  icon(<><path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"/><path d="M17.64 15L22 10.64"/><path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/></>, 22),
  search:  icon(<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>, 16),
  filter:  icon(<><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" fill="none"/></>, 16),
  sortAsc: icon(<><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>, 14),
  sortDesc:icon(<><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>, 14),
  eye:     icon(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>, 16),
  edit:    icon(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>, 14),
  download:icon(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>, 16),
  calendar:icon(<><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>, 16),
  map:     icon(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>, 16),
};
