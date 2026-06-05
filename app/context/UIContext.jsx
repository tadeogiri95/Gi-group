"use client";
// ═══════════════════════════════════════════════════════════
// UIContext — Pantalla activa via URL searchParams
//
// ENTREGA 2F: screen ahora está sincronizado con la URL.
//   /mi-empresa?screen=solicitudes → abre inbox
//   /mi-empresa → abre home
//   Browser back/forward navega entre pantallas.
//
// useSearchParams() de Next.js lee el ?screen= param.
// router.push() con shallow navigation actualiza sin reload.
// ═══════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

const UIContext = createContext(null);

// Pantallas válidas (whitelist para prevenir inyección via URL)
const VALID_SCREENS = new Set([
  "home", "chat", "solicitudes", "mis-sols", "actividad",
  "historial-fichajes", "equipo", "config", "ger-actividad", "reglas",
]);

export function UIProvider({ children }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Leer screen inicial de la URL, fallback a "home"
  const screenFromUrl = searchParams.get("screen") || "home";
  const initialScreen = VALID_SCREENS.has(screenFromUrl) ? screenFromUrl : "home";

  const [screen, setScreenState] = useState(initialScreen);
  const [time, setTime] = useState(new Date());
  const [historialLegajo, setHistorialLegajo] = useState(null);

  // Sincronizar screen con URL cuando cambian los searchParams
  useEffect(() => {
    const urlScreen = searchParams.get("screen") || "home";
    if (VALID_SCREENS.has(urlScreen) && urlScreen !== screen) {
      setScreenState(urlScreen);
    }
  }, [searchParams]);

  // Reloj cada 30s
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // ─── Navegar a una pantalla (actualiza URL + state) ───
  const setScreen = useCallback((pantalla) => {
    if (!VALID_SCREENS.has(pantalla)) pantalla = "home";
    setScreenState(pantalla);

    // Actualizar URL sin full page reload
    if (pantalla === "home") {
      // Home = sin ?screen= (URL limpia)
      router.push(pathname, { scroll: false });
    } else {
      router.push(`${pathname}?screen=${pantalla}`, { scroll: false });
    }
  }, [router, pathname]);

  // Navegar con legajo para drill-down (ej: dashboard → fichajes de empleado)
  const goto = useCallback((pantalla, legajo = null) => {
    if (legajo) setHistorialLegajo(legajo);
    setScreen(pantalla);
  }, [setScreen]);

  const goHome = useCallback(() => {
    setHistorialLegajo(null);
    setScreen("home");
  }, [setScreen]);

  // Derivados
  const isChat = screen === "chat";
  const showBack = screen === "reglas" || screen === "historial-fichajes" || screen === "ger-actividad";

  return (
    <UIContext.Provider value={{
      screen,
      setScreen,
      goto,
      goHome,
      time,
      historialLegajo,
      setHistorialLegajo,
      isChat,
      showBack,
    }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI debe usarse dentro de <UIProvider>");
  return ctx;
}
