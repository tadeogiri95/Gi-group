"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { sb } from "../lib/supabase";

/*
 * useActividad — hook para el módulo de registro de actividades
 * 
 * Usa sb.get/post/patch directo contra Supabase REST (mismo patrón que el resto de la app).
 * 
 * Recibe: empleado = { id, legajo, division } (o null si no hay sesión)
 * Devuelve: { tareaActiva, elapsed, historial, loading, horasHoy, etapas,
 *             iniciarTarea, finalizarTarea, cambiarTarea, recargar }
 */
export function useActividad(empleado) {
  const [tareaActiva, setTareaActiva] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [historial, setHistorial] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const hoy = new Date().toISOString().slice(0, 10);

  // ── Cargar catálogo de etapas por división ──
  useEffect(() => {
    if (!empleado?.division) return;
    sb.get(`catalogo_etapas?division=eq.${empleado.division}&activo=eq.true&order=orden.asc`)
      .then(setEtapas)
      .catch(e => console.error("Error cargando etapas:", e));
  }, [empleado?.division]);

  // ── Cargar tarea activa + historial del día ──
  const cargarDatos = useCallback(async () => {
    if (!empleado?.id) return;
    setLoading(true);
    try {
      const [activas, registros] = await Promise.all([
        // Tarea abierta (hora_fin IS NULL)
        sb.get(`registro_actividades?empleado_id=eq.${empleado.id}&hora_fin=is.null&select=*&limit=1`),
        // Historial del día (cerradas)
        sb.get(`registro_actividades?empleado_id=eq.${empleado.id}&fecha=eq.${hoy}&hora_fin=not.is.null&order=hora_inicio.desc&select=*`),
      ]);

      if (activas && activas.length > 0) {
        setTareaActiva(activas[0]);
        const inicio = new Date(activas[0].hora_inicio).getTime();
        setElapsed(Math.floor((Date.now() - inicio) / 1000));
      } else {
        setTareaActiva(null);
        setElapsed(0);
      }

      setHistorial(registros || []);
    } catch (err) {
      console.error("Error cargando actividades:", err);
    } finally {
      setLoading(false);
    }
  }, [empleado?.id, hoy]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  // ── Timer en vivo ──
  useEffect(() => {
    clearInterval(timerRef.current);
    if (tareaActiva && !tareaActiva.hora_fin) {
      const inicio = new Date(tareaActiva.hora_inicio).getTime();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - inicio) / 1000));
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [tareaActiva]);

  // ── Iniciar tarea ──
  const iniciarTarea = useCallback(async ({ etapa, codigo_proyecto, tipo, causa }) => {
    if (!empleado?.id) return;
    const ahora = new Date().toISOString();
    try {
      // El trigger trg_cerrar_tarea_previa en Supabase cierra la anterior automáticamente
      const res = await sb.post("registro_actividades", {
        empleado_id: empleado.id,
        legajo: String(empleado.legajo),
        fecha: ahora.slice(0, 10),
        hora_inicio: ahora,
        codigo_proyecto: etapa === 0 ? null : (codigo_proyecto ? parseInt(codigo_proyecto) : null),
        etapa,
        tipo: tipo || "N",
        causa: etapa === 0 ? causa : null,
        division: empleado.division,
      });
      await cargarDatos();
      return res;
    } catch (err) {
      console.error("Error iniciando tarea:", err);
      throw err;
    }
  }, [empleado, cargarDatos]);

  // ── Finalizar tarea activa ──
  const finalizarTarea = useCallback(async (observaciones = null) => {
    if (!tareaActiva?.id) return;
    const ahora = new Date().toISOString();
    try {
      await sb.patch(`registro_actividades?id=eq.${tareaActiva.id}`, {
        hora_fin: ahora,
        // duracion_min se calcula automáticamente via trigger trg_calcular_duracion
        ...(observaciones ? { observaciones } : {}),
      });
      await cargarDatos();
    } catch (err) {
      console.error("Error finalizando tarea:", err);
      throw err;
    }
  }, [tareaActiva, cargarDatos]);

  // ── Cambiar tarea (trigger cierra la anterior al insertar la nueva) ──
  const cambiarTarea = useCallback(async (nuevaTarea) => {
    return iniciarTarea(nuevaTarea);
  }, [iniciarTarea]);

  // ── Horas totales hoy (historial cerrado + tarea activa en curso) ──
  const horasHoy = historial.reduce((acc, r) => acc + (r.duracion_min || 0) * 60, 0) + elapsed;

  return {
    tareaActiva,
    elapsed,
    historial,
    etapas,
    loading,
    horasHoy,
    iniciarTarea,
    finalizarTarea,
    cambiarTarea,
    recargar: cargarDatos,
  };
}
