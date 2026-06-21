"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { sb } from "../lib/supabase";
import { hoyArg } from "../lib/dates";

/*
 * useActividad — hook para el módulo de registro de actividades
 *
 * Lee proyectos desde la tabla "proyectos" de Supabase (multi-tenant).
 * Antes leía de un Google Sheets hardcodeado: ya no.
 */

export function useActividad(empleado) {
  const [tareaActiva, setTareaActiva] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [historial, setHistorial] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [proyectosLoading, setProyectosLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const hoy = hoyArg();

  // ── Cargar catálogo de etapas de la empresa ──
  useEffect(() => {
    if (!empleado?.empresa_id) return;
    sb.get(`etapas?empresa_id=eq.${empleado.empresa_id}&activa=eq.true&order=orden.asc`)
      .then(setEtapas)
      .catch(e => console.error("Error cargando etapas:", e));
  }, [empleado?.empresa_id]);

  // ── Cargar proyectos activos desde Supabase ──
  const cargarProyectos = useCallback(async () => {
    if (!empleado?.empresa_id) return;
    setProyectosLoading(true);
    try {
      const data = await sb.get(`proyectos?empresa_id=eq.${empleado.empresa_id}&estado=eq.activo&order=created_at.desc&limit=1000`);
      setProyectos(data || []);
    } catch (err) {
      console.error("Error cargando proyectos:", err);
      setProyectos([]);
    } finally {
      setProyectosLoading(false);
    }
  }, [empleado?.empresa_id]);

  useEffect(() => { cargarProyectos(); }, [cargarProyectos]);

  // ── Cargar tarea activa + historial del día ──
  const cargarDatos = useCallback(async () => {
    if (!empleado?.id) return;
    setLoading(true);
    try {
      const [activas, registros] = await Promise.all([
        sb.get(`registro_actividades?empleado_id=eq.${empleado.id}&hora_fin=is.null&select=*&limit=1`),
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
    if (!empleado?.id) throw new Error("Sin empleado");
    const ahora = new Date().toISOString();
    try {
      const res = await sb.post("registro_actividades", {
        empleado_id: empleado.id,
        legajo: Number(empleado.legajo),
        fecha: ahora.slice(0, 10),
        hora_inicio: ahora,
        codigo_proyecto: etapa === 0 ? null : (codigo_proyecto ? Number(codigo_proyecto) || codigo_proyecto : null),
        etapa,
        tipo: tipo || "N",
        causa: etapa === 0 ? causa : null,
        division: empleado.division,
        empresa_id: empleado.empresa_id,
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
        ...(observaciones ? { observaciones } : {}),
      });
      await cargarDatos();
    } catch (err) {
      console.error("Error finalizando tarea:", err);
      throw err;
    }
  }, [tareaActiva, cargarDatos]);

  const cambiarTarea = useCallback(async (nuevaTarea) => iniciarTarea(nuevaTarea), [iniciarTarea]);

  const horasHoy = historial.reduce((acc, r) => acc + (r.duracion_min || 0) * 60, 0) + elapsed;

  return {
    tareaActiva, elapsed, historial, etapas, proyectos, proyectosLoading,
    loading, horasHoy, iniciarTarea, finalizarTarea, cambiarTarea,
    recargar: cargarDatos, recargarProyectos: cargarProyectos,
  };
}