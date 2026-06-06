'use client';
import { useSyncExternalStore } from 'react';

// ═══════════════════════════════════════════════════════
// useBreakpoint — Hook responsivo para Gypi
// Ubicación: app/hooks/useBreakpoint.js
// ═══════════════════════════════════════════════════════
//
// Breakpoints alineados con globals.css:
//   mobile:  < 768px   (default, PWA phone)
//   tablet:  768–1023  (iPad, landscape phone)
//   desktop: ≥ 1024    (notebook, monitor)
//
// Uso:
//   const { isMobile, isTablet, isDesktop, breakpoint } = useBreakpoint();

const BP = { TABLET: 768, DESKTOP: 1024 };

function getBreakpoint(w) {
  if (w >= BP.DESKTOP) return 'desktop';
  if (w >= BP.TABLET) return 'tablet';
  return 'mobile';
}

// Snapshot para SSR — asumimos mobile (PWA mobile-first)
const serverSnapshot = () => 'mobile';

// Store global con matchMedia (más eficiente que resize listener)
let listeners = [];
let currentBreakpoint = typeof window !== 'undefined'
  ? getBreakpoint(window.innerWidth)
  : 'mobile';

if (typeof window !== 'undefined') {
  const mqTablet = window.matchMedia(`(min-width: ${BP.TABLET}px)`);
  const mqDesktop = window.matchMedia(`(min-width: ${BP.DESKTOP}px)`);

  const update = () => {
    const next = getBreakpoint(window.innerWidth);
    if (next !== currentBreakpoint) {
      currentBreakpoint = next;
      listeners.forEach(fn => fn());
    }
  };

  mqTablet.addEventListener('change', update);
  mqDesktop.addEventListener('change', update);
}

function subscribe(callback) {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(fn => fn !== callback);
  };
}

function getSnapshot() {
  return currentBreakpoint;
}

export function useBreakpoint() {
  const breakpoint = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);

  return {
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    isTabletUp: breakpoint !== 'mobile',
    isDesktopUp: breakpoint === 'desktop',
  };
}

export default useBreakpoint;
