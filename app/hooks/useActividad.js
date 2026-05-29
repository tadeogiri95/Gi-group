"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { sb } from "../lib/supabase";

/*
 * useActividad — hook para el módulo de registro de actividades
 * 
 * Usa sb.get/post/patch directo contra Supabase REST.
 * Lee proyectos en vivo desde Google Sheets (CSV público).
 */

const SHEETS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQaOMR5-0Gx416zErqhNl5LlQk-2PC0fQM92ye-aABky0Ey5BvdKiAYSiSBaqZ_Eveiv_OSSnA4YqJZ/pub?gid=2081284053&single=true&output=csv";

// Parser CSV robusto para la hoja de proyectos del MRP.
// Columnas fijas: A=(nro fila), B=CODIGO, C=DIVISION, D=OT, E=CLIENTE, F=OBRA, G=PROYECTO, H=CANTIDAD
// Indices:         0              1         2           3     4          5       6           7
// Recorre las 6800+ filas, saltea pulmones, headers repetidos, y filas sin OT.
function parseCSV(text) {
  const allLines = text.split(/\r?\n/);
  if (allLines.length < 2) return [];

  const parseRow = (line) => {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    fields.push(current.trim());
    return fields;
  };

  // Posiciones fijas de columna
  const COL_CODIGO = 1;
  const COL_DIVISION = 2;
  const COL_OT = 3;
  const COL_CLIENTE = 4;
  const COL_OBRA = 5;
  const COL_PROYECTO = 6;
  const COL_CANTIDAD = 7;

  const results = [];
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (!line.trim()) continue;

    const fields = parseRow(line);
    const ot = (fields[COL_OT] || "").replace(/^\uFEFF/, "").trim();

    // Solo aceptar filas donde OT empiece con dígitos (acepta 7408, 7408-10, etc.)
    // Descarta headers (OT, CODIGO), filas vacías, y basura
    if (!ot || !/^\d/.test(ot)) continue;

    const division = (fields[COL_DIVISION] || "").trim();
    if (!division) continue;

    results.push({
      CODIGO: (fields[COL_CODIGO] || "").trim(),
      DIVISION: division,
      OT: ot,
      CLIENTE: (fields[COL_CLIENTE] || "").trim(),
      OBRA: (fields[COL_OBRA] || "").trim(),
      PROYECTO: (fields[COL_PROYECTO] || "").trim(),
      CANTIDAD: (fields[COL_CANTIDAD] || "").trim(),
    });
  }

  return results;
}

// Mapeo de división Sheets → Supabase
const DIV_MAP = {
  "MUEBLES": "muebles",
  "HERRERÍA": "herreria",
  "HERRERIA": "herreria",
  "ALUMINIO": "aberturas",
};

export function useActividad(empleado) {
  const [tareaActiva, setTareaActiva] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [historial, setHistorial] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [proyectosLoading, setProyectosLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const hoy = new Date().toISOString().slice(0, 10);

  // ── Cargar catálogo de etapas por división ──
  useEffect(() => {
    if (!empleado?.division) return;
    sb.get(`etapas?empresa_id=eq.${empleado.empresa_id}&activa=eq.true&order=orden.asc`)
      .then(setEtapas)
      .catch(e => console.error("Error cargando etapas:", e));
  }, [empleado?.empresa_id]);

  // ── Cargar proyectos desde Google Sheets ──
  const cargarProyectos = useCallback(async () => {
    if (!empleado?.id) return;
    setProyectosLoading(true);
    try {
      const res = await fetch(SHEETS_CSV_URL);
      const text = await res.text();
      const rows = parseCSV(text);
      
      // Mapear todos los proyectos (sin filtrar por división)
      const todos = rows
        .map(r => {
          const divRaw = (r["DIVISION"] || "").trim().toUpperCase();
          return {
            ot: r["OT"]?.trim(),
            codigo: r["CODIGO"]?.trim(),
            division: DIV_MAP[divRaw] || "",
            cliente: r["CLIENTE"]?.trim(),
            obra: r["OBRA"]?.trim(),
            proyecto: r["PROYECTO"]?.trim(),
            cantidad: r["CANTIDAD"]?.trim(),
          };
        })
        .filter(p => p.ot);

      // Deduplicar por OT (puede haber repetidos en el sheet)
      const vistos = new Set();
      const unicos = todos.filter(p => {
        if (vistos.has(p.ot)) return false;
        vistos.add(p.ot);
        return true;
      });

      setProyectos(unicos);
    } catch (err) {
      console.error("Error cargando proyectos desde Sheets:", err);
    } finally {
      setProyectosLoading(false);
    }
  }, [empleado?.id]);

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
      // FIX: legajo como número (integer), no como string
      const res = await sb.post("registro_actividades", {
        empleado_id: empleado.id,
        legajo: Number(empleado.legajo),
        fecha: ahora.slice(0, 10),
        hora_inicio: ahora,
        codigo_proyecto: etapa === 0 ? null : (codigo_proyecto || null),
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

  // ── Cambiar tarea ──
  const cambiarTarea = useCallback(async (nuevaTarea) => {
    return iniciarTarea(nuevaTarea);
  }, [iniciarTarea]);

  // ── Horas totales hoy ──
  const horasHoy = historial.reduce((acc, r) => acc + (r.duracion_min || 0) * 60, 0) + elapsed;

  return {
    tareaActiva,
    elapsed,
    historial,
    etapas,
    proyectos,
    proyectosLoading,
    loading,
    horasHoy,
    iniciarTarea,
    finalizarTarea,
    cambiarTarea,
    recargar: cargarDatos,
    recargarProyectos: cargarProyectos,
  };
}
