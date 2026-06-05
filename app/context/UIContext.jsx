"use client";
// ═══════════════════════════════════════════════════════════
// UIContext — Pantalla activa, reloj, navegación
//
// ENTREGA 2C: Centraliza screen state y navegación.
// Preparado para migrar a searchParams en entrega 2F.
//
// Reemplaza:
//   - useState("home") para screen
//   - useState(new Date()) para time (reloj cada 30s)
//   - setHistorialLegajo para drill-down desde dashboard
//
// Uso:
//   const { screen, setScreen, goto, time } = useUI();
// ═══════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback } from "react";

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [screen, setScreenState] = useState("home");
  const [time, setTime] = useState(new Date());
  const [historialLegajo, setHistorialLegajo] = useState(null);

  // Reloj actualizado cada 30 segundos
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Navegar a una pantalla, opcionalmente con un legajo para drill-down
  const goto = useCallback((pantalla, legajo = null) => {
    if (legajo) setHistorialLegajo(legajo);
    setScreenState(pantalla);
  }, []);

  // Alias directo para compatibilidad con el Nav actual
  const setScreen = useCallback((pantalla) => {
    setScreenState(pantalla);
  }, []);

  // Volver a home
  const goHome = useCallback(() => {
    setHistorialLegajo(null);
    setScreenState("home");
  }, []);

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
