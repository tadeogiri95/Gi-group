"use client";
// Pestaña "Planta" de gestión (reforma UX R5): lo que pasa hoy en la planta
// (quién trabaja en qué, quién está parado) y las OT, en un solo lugar.
// Producción, Stock y Mantenimiento se suman acá como otra opción. Stock
// (ítem 40) y Compras (ítem 41) van con las OT hasta que sean módulos que se
// vendan aparte.
import { useState } from "react";
import { tieneModulo } from "../../lib/modulos";
import ModuloBloqueado from "../ModuloBloqueado";
import GerenciaActividadScreen from "../../gerencia_actividad_screen";
import ProyectosScreen from "../../proyectos_screen.jsx";
import StockScreen from "../StockScreen";
import ComprasScreen from "../ComprasScreen";

const OPCIONES = [
  { id: "vivo", label: "En vivo", modulo: "actividad" },
  { id: "ot", label: "OT", modulo: "proyectos" },
  { id: "stock", label: "Stock", modulo: "proyectos" },
  { id: "compras", label: "Compras", modulo: "proyectos" },
];

export default function PlantaScreen({ empresa, usuario, onVerPlanes }) {
  const primera = OPCIONES.find((o) => tieneModulo(empresa, o.modulo)) || OPCIONES[0];
  const [opcion, setOpcion] = useState(primera.id);
  const actual = OPCIONES.find((o) => o.id === opcion) || primera;
  const bloqueado = !tieneModulo(empresa, actual.modulo);
  const empresaId = usuario?.empresa_id || empresa?.id;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div role="tablist" aria-label="Planta" className="mx-[18px] mb-2 flex bg-gypi-surf-hi rounded-[var(--radius-md)] p-[3px] shrink-0">
        {OPCIONES.map((o) => {
          const activa = o.id === actual.id;
          return (
            <button key={o.id} role="tab" aria-selected={activa} onClick={() => setOpcion(o.id)}
              className={`flex-1 min-h-[44px] rounded-[calc(var(--radius-md)-2px)] border-none cursor-pointer text-[14px] font-bold font-body ${activa ? "bg-gypi-surface text-gypi-text shadow-sm" : "bg-transparent text-gypi-dim"}`}>
              {o.label}{!tieneModulo(empresa, o.modulo) && " 🔒"}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={actual.label} className="flex-1 overflow-hidden flex flex-col">
        {bloqueado && <ModuloBloqueado modulo={actual.modulo} empresa={empresa} rol={usuario?.rol} onVerPlanes={onVerPlanes} />}
        {!bloqueado && actual.id === "vivo" && <GerenciaActividadScreen empresaId={empresaId} />}
        {!bloqueado && actual.id === "ot" && <ProyectosScreen empresaId={empresaId} />}
        {!bloqueado && actual.id === "stock" && <StockScreen empresa={empresa} empresaId={empresaId} usuario={usuario} />}
        {!bloqueado && actual.id === "compras" && <ComprasScreen empresaId={empresaId} usuario={usuario} />}
      </div>
    </div>
  );
}
