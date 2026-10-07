"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { sb } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { duracionMinutos } from "../lib/calc";
import { enviarOEncolar } from "../lib/colaOffline";
import { guardarInstantanea, leerInstantanea } from "../lib/instantanea";

// Minutos (1 decimal) entre un timestamp de inicio y un ISO de cierre.
const minutosHasta = (horaInicio, isoFin) =>
  Math.max(0, Math.round(((new Date(isoFin) - new Date(horaInicio)) / 60000) * 10) / 10);

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
    const clave = `etapas_${empleado.empresa_id}`;
    sb.get(`etapas?empresa_id=eq.${empleado.empresa_id}&activa=eq.true&order=orden.asc`)
      .then((d) => { setEtapas(d); guardarInstantanea(clave, d); })
      .catch(e => {
        // Sin conexión: las del último uso (ítem 21)
        const previas = leerInstantanea(clave);
        if (previas) setEtapas(previas);
        else console.error("Error cargando etapas:", e);
      });
  }, [empleado?.empresa_id]);

  // ── Cargar proyectos activos desde Supabase ──
  const cargarProyectos = useCallback(async () => {
    if (!empleado?.empresa_id) return;
    setProyectosLoading(true);
    try {
      const data = await sb.get(`proyectos?empresa_id=eq.${empleado.empresa_id}&estado=eq.activo&order=created_at.desc&limit=1000`);
      setProyectos(data || []);
      guardarInstantanea(`proyectos_${empleado.empresa_id}`, (data || []).map(({ id, ot, cliente, obra, proyecto, division }) => ({ id, ot, cliente, obra, proyecto, division })));
    } catch (err) {
      const previos = leerInstantanea(`proyectos_${empleado.empresa_id}`);
      if (!previos) console.error("Error cargando proyectos:", err);
      setProyectos(previos || []);
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
      // Sin conexión: lo último que se vio hoy en este celular (ítem 21)
      const snap = leerInstantanea(`actividad_${empleado.id}`, { fecha: hoyArg() });
      if (snap) {
        setTareaActiva(snap.tareaActiva);
        setHistorial(snap.historial || []);
        if (snap.tareaActiva) setElapsed(Math.floor((Date.now() - new Date(snap.tareaActiva.hora_inicio).getTime()) / 1000));
      } else {
        console.error("Error cargando actividades:", err);
      }
    } finally {
      setLoading(false);
    }
  }, [empleado?.id, hoy]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  // Último estado del día, para abrir la app sin conexión
  useEffect(() => {
    if (!empleado?.id || loading) return;
    guardarInstantanea(`actividad_${empleado.id}`, { fecha: hoyArg(), tareaActiva, historial });
  }, [empleado?.id, loading, tareaActiva, historial]);

  // Lo guardado sin señal se muestra igual, con la hora en que se hizo
  const tareaRef = useRef(null);
  tareaRef.current = tareaActiva;
  const aplicarLocal = useCallback((momento, nueva) => {
    const actual = tareaRef.current;
    if (actual) {
      const cerrada = { ...actual, hora_fin: momento, duracion_min: minutosHasta(actual.hora_inicio, momento), sinEnviar: true };
      setHistorial((h) => [cerrada, ...h]);
    }
    setTareaActiva(nueva);
    setElapsed(nueva ? Math.floor((Date.now() - new Date(nueva.hora_inicio).getTime()) / 1000) : 0);
  }, []);

  // Iniciar y finalizar pasan por /api/actividad: el servidor cierra lo abierto
  // y registra lo nuevo; sin señal queda en la cola del celular (ítem 21).
  const enviarActividad = useCallback(async (body) => {
    const r = await enviarOEncolar({ empleadoId: empleado.id, tipo: "actividad", url: "/api/actividad", body });
    if (r.encolado) return r;
    if (!r.data?.ok) {
      const err = new Error(r.data?.error || "No se pudo registrar la tarea. Probá de nuevo.");
      err.tipo = r.data?.tipo;
      throw err;
    }
    return r;
  }, [empleado?.id]);

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
    try {
      const r = await enviarActividad({
        accion: "iniciar",
        etapa,
        codigo_proyecto: etapa === 0 ? null : (codigo_proyecto != null ? String(codigo_proyecto) : null),
        tipo: tipo || "N",
        causa: etapa === 0 ? causa : null,
      });
      if (r.encolado) {
        aplicarLocal(r.op.creado_en, {
          id: null, hora_inicio: r.op.creado_en, etapa, codigo_proyecto: etapa === 0 ? null : codigo_proyecto,
          tipo: tipo || "N", causa: etapa === 0 ? causa : null, sinEnviar: true,
        });
        return { encolado: true };
      }
      await cargarDatos();
      return r.data?.tarea;
    } catch (err) {
      console.error("Error iniciando tarea:", err);
      throw err;
    }
  }, [empleado, cargarDatos, enviarActividad, aplicarLocal]);

  // ── Finalizar tarea activa ──
  const finalizarTarea = useCallback(async (observaciones = null) => {
    if (!tareaActiva) return;
    try {
      const r = await enviarActividad({ accion: "finalizar", ...(observaciones ? { observaciones } : {}) });
      if (r.encolado) { aplicarLocal(r.op.creado_en, null); return { encolado: true }; }
      await cargarDatos();
    } catch (err) {
      console.error("Error finalizando tarea:", err);
      throw err;
    }
  }, [tareaActiva, cargarDatos, enviarActividad, aplicarLocal]);

  const cambiarTarea = useCallback(async (nuevaTarea) => iniciarTarea(nuevaTarea), [iniciarTarea]);

  const horasHoy = historial.reduce((acc, r) => acc + duracionMinutos(r) * 60, 0) + elapsed;

  return {
    tareaActiva, elapsed, historial, etapas, proyectos, proyectosLoading,
    loading, horasHoy, iniciarTarea, finalizarTarea, cambiarTarea,
    recargar: cargarDatos, recargarProyectos: cargarProyectos,
  };
}