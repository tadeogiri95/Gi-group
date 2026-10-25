"use client";
// Pantalla de un botón de la barra de gestión (menú nuevo, parte 32):
// Proyectos (OT y Reportes), Inventario (Stock y Compras) y Mantenimiento
// (Flota vehicular). Reemplaza a la pestaña "Planta". Stock (ítem 40), Compras
// (ítem 41) y Flota (Mantenimiento, ítem 43) son módulos propios que vienen con
// las OT (131). Lo que la empresa apagó en Más → Módulos no aparece; lo que no
// contrató se ve con 🔒. "Reportes" son los de producción (Del día,
// Indicadores, Lead time, Obra); los del personal están en Equipo (revisión de
// la interfaz, 2026-10).
import { useState } from "react";
import dynamic from "next/dynamic";
import { tieneModulo } from "../../lib/modulos";
import { BOTONES_GESTION, opcionesBoton } from "../../lib/menuGestion";
import ModuloBloqueado from "../ModuloBloqueado";
import Pestanas from "../ui/Pestanas";
import { Spinner } from "../ui";
import GerenciaActividadScreen from "../../gerencia_actividad_screen";
import ProyectosScreen from "../../proyectos_screen.jsx";
import StockScreen from "../StockScreen";
import ComprasScreen from "../ComprasScreen";
import FlotaScreen from "../FlotaScreen";

const ReportesScreen = dynamic(() => import("../../reportes_screen"), { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div> });

export default function BotonGestionScreen({ boton, empresa, usuario, onVerPlanes, seccion = null }) {
  const OPCIONES = opcionesBoton(boton, empresa);
  const primera = OPCIONES.find((o) => tieneModulo(empresa, o.modulo)) || OPCIONES[0];
  // seccion: la opción con la que abre (el Panel de control manda "ot", "compras"
  // o "flota", que abre en 🔔 Alertas)
  const [opcion, setOpcion] = useState(OPCIONES.some((o) => o.id === seccion) ? seccion : primera?.id);
  // Con todo apagado el botón no aparece en la barra; por las dudas, nada
  if (!primera) return null;
  const actual = OPCIONES.find((o) => o.id === opcion) || primera;
  const bloqueado = !tieneModulo(empresa, actual.modulo);
  const empresaId = usuario?.empresa_id || empresa?.id;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Pestanas label={BOTONES_GESTION[boton].label} opciones={OPCIONES} actual={actual.id} onElegir={setOpcion} bloqueada={(o) => !tieneModulo(empresa, o.modulo)} />
      <div role="tabpanel" aria-label={actual.label} className="flex-1 overflow-hidden flex flex-col">
        {bloqueado && <ModuloBloqueado modulo={actual.modulo} empresa={empresa} rol={usuario?.rol} onVerPlanes={onVerPlanes} />}
        {!bloqueado && actual.id === "vivo" && <GerenciaActividadScreen empresaId={empresaId} />}
        {!bloqueado && actual.id === "ot" && <ProyectosScreen empresaId={empresaId} />}
        {!bloqueado && actual.id === "stock" && <StockScreen empresa={empresa} empresaId={empresaId} usuario={usuario} />}
        {!bloqueado && actual.id === "compras" && <ComprasScreen empresaId={empresaId} empresa={empresa} usuario={usuario} />}
        {!bloqueado && actual.id === "flota" && <FlotaScreen empresaId={empresaId} empresa={empresa} usuario={usuario} vistaInicial={seccion === "flota" ? "alertas" : "vehiculos"} />}
        {!bloqueado && actual.id === "reportes" && <ReportesScreen grupo="produccion" />}
      </div>
    </div>
  );
}
