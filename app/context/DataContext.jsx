"use client";
// ═══════════════════════════════════════════════════════════
// DataContext — Datos compartidos + polling cada 60s
//
// ENTREGA 2C: Centraliza el ctx{} de page.js:
//   empleados, fichadasHoy, fichadaHoy, fichadasSemana,
//   solicitudes, misSolicitudes, reglas, reglasRaw, notificaciones
//
// Reemplaza:
//   - El Promise.all de 8 queries en loadData()
//   - El setInterval de 60s para polling
//   - El ctx{} que se pasaba como prop a todas las pantallas
//   - InboxScreen que copiaba ctx.solicitudes a estado local
//
// Uso:
//   const { empleados, fichadasHoy, solicitudes, loadData, ready } = useData();
// ═══════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { sb } from "../lib/supabase";
import { useAuth } from "./AuthContext";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { usuario, isGer } = useAuth();

  const [data, setData] = useState({
    empleados: [],
    fichadasHoy: [],
    fichadaHoy: null,
    fichadasSemana: [],
    solicitudes: [],
    misSolicitudes: [],
    reglas: [],
    reglasRaw: [],
    notificaciones: [],
  });
  const [ready, setReady] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // ─── Cargar todo ───
  const loadData = useCallback(async () => {
    if (!usuario) return;
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const mon = new Date(now);
      mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      const monStr = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;

      const [empleados, fichadasHoy, miFichada, fichadasSemana, solicitudes, misSolicitudes, reglas, notificaciones] = await Promise.all([
        sb.get("empleados?select=*&activo=eq.true&order=legajo.asc"),
        sb.get(`fichadas?select=legajo,ingreso,egreso,horas_trabajadas,llegada_tarde,minutos_tarde,empleados(nombre,division)&fecha=eq.${today}`),
        sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=eq.${today}`),
        sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=gte.${monStr}&order=fecha.asc`),
        sb.get("solicitudes?select=*&order=created_at.desc&limit=50"),
        sb.get(`solicitudes?legajo=eq.${usuario.legajo}&order=created_at.desc&limit=20`),
        sb.get("reglas_bot?activa=eq.true&order=id.asc"),
        sb.get(
          isGer
            ? "notificaciones?destinatario_rol=eq.gerencial&order=created_at.desc&limit=10"
            : `notificaciones?destinatario_rol=eq.${usuario.legajo}&order=created_at.desc&limit=10`
        ),
      ]);

      const fHoy = fichadasHoy.map(f => ({
        ...f,
        nombre: f.empleados?.nombre || "",
        division: f.empleados?.division || "",
      }));

      setData({
        empleados,
        fichadasHoy: fHoy,
        fichadaHoy: miFichada[0] || null,
        fichadasSemana,
        solicitudes,
        misSolicitudes,
        reglas: reglas.map(r => r.regla),
        reglasRaw: reglas,
        notificaciones,
      });
      setReady(true);
    } catch (e) {
      console.error("[DataContext] Error:", e);
      setReady(true);
    }
  }, [usuario, isGer]);

  // Cargar al login
  useEffect(() => {
    if (usuario) {
      setReady(false);
      loadData();
    }
  }, [usuario, loadData]);

  // Polling cada 60 segundos
  useEffect(() => {
    if (!usuario) return;
    const t = setInterval(loadData, 60000);
    return () => clearInterval(t);
  }, [usuario, loadData]);

  // Forzar recarga manual (para después de fichar, aprobar solicitud, etc.)
  const reload = useCallback(() => {
    setRefreshCounter(c => c + 1);
    return loadData();
  }, [loadData]);

  return (
    <DataContext.Provider value={{
      ...data,
      ready,
      refreshCounter,
      loadData,
      reload,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData debe usarse dentro de <DataProvider>");
  return ctx;
}
