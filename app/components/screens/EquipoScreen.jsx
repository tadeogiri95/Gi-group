"use client";
// Pestaña "Equipo" de gestión: todo lo del personal en un solo lugar
// (revisión de la interfaz, 2026-10). Antes Horarios, Calendario, Reportes y
// Documentación estaban en "Más", mezclados con los ajustes. Los reportes de
// acá son los del personal (Asistencia, Descargar, Liquidación); los de
// producción están en Planta. Cada pestaña se baja recién al abrirla.
import { useState } from "react";
import dynamic from "next/dynamic";
import { MODULO_SECCION_GESTION, seccionBloqueada } from "../../lib/modulos";
import ModuloBloqueado from "../ModuloBloqueado";
import Pestanas from "../ui/Pestanas";
import { Spinner } from "../ui";

const cargando = () => <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
const perezosa = (importar) => dynamic(importar, { ssr: false, loading: cargando });
const GestionPersonalScreen = perezosa(() => import("../../gestion_personal_screen"));
const GrillaHorarioScreen = perezosa(() => import("../../grilla_horario_screen"));
const CalendarioScreen = perezosa(() => import("../../calendario_screen"));
const ReportesScreen = perezosa(() => import("../../reportes_screen"));
const DocumentosEmpleadoScreen = perezosa(() => import("../../documentos_empleado_screen"));

export const OPCIONES_EQUIPO = [
  { id: "personas", label: "Personas" },
  { id: "horarios", label: "Horarios" },
  { id: "calendario", label: "Calendario" },
  { id: "reportes", label: "Reportes" },
  { id: "documentacion", label: "Documentos" },
];

export default function EquipoScreen({ empresa, usuario, onVerPlanes, seccion = null }) {
  // seccion: la pestaña con la que abre (los primeros pasos mandan "horarios")
  const [opcion, setOpcion] = useState(OPCIONES_EQUIPO.some((o) => o.id === seccion) ? seccion : "personas");
  const actual = OPCIONES_EQUIPO.find((o) => o.id === opcion);
  const bloqueado = seccionBloqueada(actual.id, empresa);
  const empresaId = usuario?.empresa_id || empresa?.id;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Pestanas label="Equipo" opciones={OPCIONES_EQUIPO} actual={actual.id} onElegir={setOpcion} bloqueada={(o) => seccionBloqueada(o.id, empresa)} />
      <div role="tabpanel" aria-label={actual.label} className="flex-1 overflow-hidden flex flex-col">
        {bloqueado && <ModuloBloqueado modulo={MODULO_SECCION_GESTION[actual.id]} empresa={empresa} rol={usuario?.rol} onVerPlanes={onVerPlanes} />}
        {!bloqueado && actual.id === "personas" && <GestionPersonalScreen empresaId={empresaId} />}
        {!bloqueado && actual.id === "horarios" && <GrillaHorarioScreen empresaId={empresaId} />}
        {!bloqueado && actual.id === "calendario" && <CalendarioScreen empresaId={empresaId} />}
        {!bloqueado && actual.id === "reportes" && <ReportesScreen grupo="personal" />}
        {!bloqueado && actual.id === "documentacion" && <DocumentosEmpleadoScreen empresaId={empresaId} />}
      </div>
    </div>
  );
}
