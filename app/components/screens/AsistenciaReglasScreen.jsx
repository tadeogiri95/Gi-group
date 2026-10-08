"use client";
// Reglas de asistencia (tolerancia, bloqueos) y tipos de pedido (R5, U-03).
// Antes estaban dentro de la sección del asistente y quedaban con candado si la empresa no
// tenía el Asistente: sin chat no se podían configurar las tardanzas.
import ReglasAsistencia from "../ReglasAsistencia";
import TiposSolicitudConfig from "../TiposSolicitudConfig";

export default function AsistenciaReglasScreen() {
  return (
    <div className="px-[18px] pb-[110px] overflow-y-auto flex-1">
      <ReglasAsistencia />
      <TiposSolicitudConfig />
    </div>
  );
}
