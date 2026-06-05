"use client";
// Extraído de [slug]/page.js líneas 751-768
import { useState } from "react";
import { C, fB } from "../../lib/theme";
import ReportesScreen from "../../reportes_screen";
import GrillaHorarioScreen from "../../grilla_horario_screen";
import ProyectosScreen from "../../proyectos_screen.jsx";
import GeolocalizacionScreen from "../../geolocalizacion_screen";
import CalendarioScreen from "../../calendario_screen";
import ReglasScreen from "./ReglasScreen";
import AdminEmpresaScreen from "../../admin_empresa_screen";

export default function ConfigScreen({ goto, ctx, reload, usuario, empresa, onUpdateEmpresa }) {
  const [tab, setTab] = useState("reportes");
  const tabs = [["reportes", "📊 Asistencia"], ["horarios", "📅 Horarios"], ["proyectos", "📋 Proyectos"], ["ubicaciones", "📍 Ubicaciones"], ["calendario", "🗓️ Calendario"], ["reglas", "⚙️ Reglas Bot"], ["admin", "🏢 Empresa"]];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "0 18px 10px", display: "flex", gap: 6, overflowX: "auto", flexShrink: 0 }}>
        {tabs.map(([id, lbl]) => <button key={id} onClick={() => setTab(id)} style={{ padding: "8px 14px", borderRadius: 20, border: "none", cursor: "pointer", background: tab === id ? `${C.amber}22` : C.surface, color: tab === id ? C.amber : C.dim, fontSize: 12, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap" }}>{lbl}</button>)}
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "reportes" && <ReportesScreen />}
        {tab === "horarios" && <GrillaHorarioScreen empresaId={usuario?.empresa_id || empresa?.id} />}
        {tab === "proyectos" && <ProyectosScreen empresaId={usuario?.empresa_id || empresa?.id} />}
        {tab === "ubicaciones" && <GeolocalizacionScreen empresaId={usuario?.empresa_id || empresa?.id} />}
        {tab === "calendario" && <CalendarioScreen empresaId={usuario?.empresa_id || empresa?.id} />}
        {tab === "reglas" && <ReglasScreen ctx={ctx} reload={reload} usuario={usuario} />}
        {tab === "admin" && <AdminEmpresaScreen empresa={empresa} empresaId={usuario?.empresa_id} onUpdate={onUpdateEmpresa} />}
      </div>
    </div>
  );
}
