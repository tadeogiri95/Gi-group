'use client';
// app/components/MinutaPestana.jsx — Producción → 📝 Minuta (23/11, Tadeo):
// la minuta del día y, al lado, el 📚 Historial (el informe de las minutas del
// día, la semana o el mes, que antes estaba en Reportes → Minutas).
import { useState } from "react";
import { Chip } from "./ui";
import MinutaScreen from "./MinutaScreen";
import MinutasReporteTab from "./MinutasReporteTab";

export default function MinutaPestana({ empresa = null }) {
  const [vista, setVista] = useState("minuta");
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 border-b border-gypi-border bg-gypi-bg">
        <div className="max-w-5xl mx-auto flex gap-1.5 px-3 py-2" role="group" aria-label="Minuta o historial">
          <Chip active={vista === "minuta"} onClick={() => setVista("minuta")}>📝 Minuta del día</Chip>
          <Chip active={vista === "historial"} onClick={() => setVista("historial")}>📚 Historial</Chip>
        </div>
      </div>
      {vista === "minuta" ? (
        <MinutaScreen empresa={empresa} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-4 pb-28">
            <MinutasReporteTab empresa={empresa} />
          </div>
        </div>
      )}
    </div>
  );
}
