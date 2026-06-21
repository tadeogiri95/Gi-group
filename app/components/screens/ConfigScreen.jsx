"use client";
import { useState } from "react";
import ReportesScreen from "../../reportes_screen";
import GrillaHorarioScreen from "../../grilla_horario_screen";
import ProyectosScreen from "../../proyectos_screen.jsx";
import GeolocalizacionScreen from "../../geolocalizacion_screen";
import CalendarioScreen from "../../calendario_screen";
import ReglasScreen from "./ReglasScreen";
import AdminEmpresaScreen from "../../admin_empresa_screen";
import GestionPersonalScreen from "../../gestion_personal_screen";
import DocumentosEmpleadoScreen from "../../documentos_empleado_screen";

const SECTIONS = [
  { id: "parametros", label: "Parámetros" },
  { id: "reportes", label: "Reportes" },
  { id: "config", label: "Configuración" },
];

const SUBTABS = {
  parametros: [
    {
      id: "horarios", label: "Horarios",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    },
    {
      id: "proyectos", label: "Proyectos",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>,
    },
    {
      id: "ubicaciones", label: "Ubicaciones",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    },
    {
      id: "calendario", label: "Calendario",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    },
    {
      id: "personal", label: "Personal",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    },
    {
      id: "documentacion", label: "Documentación",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>,
    },
  ],
  reportes: [
    {
      id: "asistencia", label: "Asistencia",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    },
  ],
  config: [
    {
      id: "reglas", label: "Reglas IA",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/></svg>,
    },
    {
      id: "admin", label: "Empresa",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    },
  ],
};

export default function ConfigScreen({ goto, ctx, reload, usuario, empresa, onUpdateEmpresa, divisiones = [], etapas = [] }) {
  const [section, setSection] = useState("parametros");
  const [subtab, setSubtab] = useState("horarios");
  const empresaId = usuario?.empresa_id || empresa?.id;

  const handleSectionChange = (s) => {
    setSection(s);
    setSubtab(SUBTABS[s][0].id);
  };

  const currentSubtabs = SUBTABS[section] || [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Section segmented control */}
      <div className="px-4 pb-2 shrink-0">
        <div role="tablist" aria-label="Secciones de gestión" className="flex bg-gypi-surf-hi rounded-[var(--radius-md)] p-[3px]">
          {SECTIONS.map(({ id, label }) => {
            const isActive = section === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={isActive}
                onClick={() => handleSectionChange(id)}
                className={`flex-1 py-2.5 px-1 rounded-[calc(var(--radius-md)-2px)] border-none cursor-pointer text-xs font-bold font-body transition-all ${isActive ? "bg-gypi-surface text-gypi-text shadow-sm" : "bg-transparent text-gypi-dim"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subtab pills */}
      {currentSubtabs.length > 1 && (
        <div role="tablist" aria-label="Opciones de la sección" className="px-4 py-2 flex gap-1 overflow-x-auto shrink-0 scrollbar-none">
          {currentSubtabs.map(({ id, label, icon }) => {
            const isActive = subtab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setSubtab(id)}
                className={`flex items-center gap-[5px] py-2 px-3 rounded-full border-none cursor-pointer whitespace-nowrap shrink-0 text-xs font-body transition-all ${isActive ? "bg-gypi-amber/10 text-gypi-amber font-bold" : "bg-transparent text-gypi-dim font-medium"}`}
              >
                <span className={`flex ${isActive ? "opacity-100" : "opacity-60"}`}>{icon}</span>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div role="tabpanel" aria-label={`Contenido de ${(currentSubtabs.find(t => t.id === subtab) || {}).label || subtab}`} className="flex-1 overflow-hidden flex flex-col">
        {subtab === "asistencia"  && <ReportesScreen />}
        {subtab === "horarios"    && <GrillaHorarioScreen empresaId={empresaId} />}
        {subtab === "proyectos"   && <ProyectosScreen empresaId={empresaId} />}
        {subtab === "ubicaciones" && <GeolocalizacionScreen empresaId={empresaId} />}
        {subtab === "calendario"  && <CalendarioScreen empresaId={empresaId} />}
        {subtab === "personal"   && <GestionPersonalScreen empresaId={empresaId} />}
        {subtab === "documentacion" && <DocumentosEmpleadoScreen empresaId={empresaId} />}
        {subtab === "reglas"      && <ReglasScreen ctx={ctx} reload={reload} usuario={usuario} />}
        {subtab === "admin"       && <AdminEmpresaScreen empresa={empresa} empresaId={usuario?.empresa_id} onUpdate={onUpdateEmpresa} divisiones={divisiones} etapas={etapas} />}
      </div>
    </div>
  );
}
