"use client";
import { useState, useEffect } from "react";
import { Tag } from "../ui";
import { nombreSolicitud, rangoTexto } from "../../lib/tiposSolicitud";

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";

/** Inicial del nombre para el avatar (o "#" si no hay nombre). */
export function inicialNombre(nombre) {
  const limpio = String(nombre || "").trim();
  return limpio ? limpio[0].toUpperCase() : "#";
}

// Cuenta regresiva del "Deshacer"
function Segundos({ hasta }) {
  const calc = () => Math.max(0, Math.ceil((hasta - Date.now()) / 1000));
  const [s, setS] = useState(calc);
  useEffect(() => {
    const t = setInterval(() => setS(Math.max(0, Math.ceil((hasta - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [hasta]);
  return <>{s}</>;
}

/**
 * Tarjeta de una solicitud. Con `showActions` (bandeja de gerencia), Aprobar y
 * Rechazar piden confirmación con un comentario opcional (F4-07); `enEspera`
 * ({ estado, hasta }) muestra el aviso con "Deshacer" mientras no se envió.
 */
export default function SolCard({ s, showActions, onResolve, enEspera, onDeshacer }) {
  const [accion, setAccion] = useState(null); // "aprobado" | "rechazado" mientras se confirma
  const [nota, setNota] = useState("");
  const ec = { pendiente: AMBER, aprobado: GREEN, rechazado: RED, registrado: CYAN };
  // Permisos de ingreso y de salida anticipada: urgentes, el empleado está esperando
  const esPermisoIngreso = s.motivo?.includes("🔓") || s.motivo?.toLowerCase().includes("permiso de ingreso") || s.motivo?.toLowerCase().includes("ingreso por bloqueo") || s.tipo === "salida_anticipada";
  const nombre = s.nombre_empleado || `Legajo ${s.legajo}`;
  const primerNombre = s.nombre_empleado ? s.nombre_empleado.trim().split(/\s+/)[0] : `legajo ${s.legajo}`;

  const confirmar = () => {
    onResolve?.(s.id, accion, nota.trim());
    setAccion(null);
    setNota("");
  };

  return (
    <article
      aria-label={`Solicitud de ${nombre}: ${s.motivo || s.tipo} - ${s.estado}`}
      className="g-card !p-3.5 relative overflow-hidden"
      style={{
        background: esPermisoIngreso && s.estado === "pendiente" ? `${RED}08` : undefined,
        borderColor: esPermisoIngreso && s.estado === "pendiente" ? RED + "40" : s.estado === "pendiente" ? `color-mix(in srgb, ${AMBER} 19%, transparent)` : undefined,
      }}
    >
      <div className="flex justify-between items-start gap-2">
        {showActions && (
          <div aria-hidden="true" className="w-9 h-9 rounded-full bg-gypi-surface border border-gypi-border flex items-center justify-center text-sm font-bold text-gypi-text shrink-0">
            {inicialNombre(s.nombre_empleado)}
          </div>
        )}
        <div className="flex-1">
          {showActions && <div className="text-[13px] font-bold text-gypi-text">{nombre}</div>}
          <div className={showActions ? "text-[13px] text-gypi-text mt-0.5" : "text-[13px] font-semibold text-gypi-text"}>{s.motivo || s.tipo}</div>
          <div className="text-xs text-gypi-dim mt-1">
            {showActions ? `Legajo ${s.legajo} · ` : ""}{nombreSolicitud(s)} · {s.fecha ? rangoTexto(s) : new Date(s.created_at).toLocaleDateString("es-AR")}
          </div>
          {s.detalle && <div className="text-xs text-gypi-dim mt-1.5 font-mono">{s.detalle}</div>}
          {s.notas_gerencia && s.estado !== "pendiente" && (
            <div className="text-xs text-gypi-dim mt-1.5">Comentario{s.aprobador ? ` de ${s.aprobador}` : ""}: “{s.notas_gerencia}”</div>
          )}
        </div>
        <Tag color={ec[s.estado] || "var(--color-text-muted)"}>{s.estado?.toUpperCase()}</Tag>
      </div>

      {showActions && s.estado === "pendiente" && enEspera && (
        <div role="status" className="flex items-center justify-between gap-2 mt-2.5 p-2.5 rounded-lg bg-gypi-surface border border-gypi-border">
          <span className="text-xs font-semibold" style={{ color: enEspera.estado === "aprobado" ? GREEN : RED }}>
            {enEspera.estado === "aprobado" ? "Aprobada" : "Rechazada"} · se envía en <Segundos hasta={enEspera.hasta} /> s
          </span>
          <button onClick={() => onDeshacer?.(s.id)} className="min-h-[40px] px-4 rounded-lg border border-gypi-border bg-transparent text-gypi-text text-xs font-bold cursor-pointer">Deshacer</button>
        </div>
      )}

      {showActions && s.estado === "pendiente" && !enEspera && accion && (
        <div className="mt-2.5 flex flex-col gap-2">
          <div className="text-xs font-semibold text-gypi-text">
            {accion === "aprobado" ? `¿Aprobar el pedido de ${primerNombre}?` : `¿Rechazar el pedido de ${primerNombre}?`}
          </div>
          <label className="text-xs text-gypi-dim">
            {accion === "aprobado" ? "Comentario (opcional)" : "Motivo del rechazo (opcional)"}
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value.slice(0, 300))}
              rows={2}
              className="mt-1 w-full p-2 rounded-lg bg-gypi-surface border border-gypi-border text-gypi-text text-[13px] font-body resize-none"
            />
          </label>
          <div className="flex gap-2">
            <button onClick={() => { setAccion(null); setNota(""); }} className="flex-1 min-h-[44px] rounded-lg border border-gypi-border bg-transparent text-gypi-dim text-xs font-bold cursor-pointer">Cancelar</button>
            <button
              onClick={confirmar}
              className={`flex-1 min-h-[44px] rounded-lg border-none text-white text-xs font-bold cursor-pointer ${accion === "aprobado" ? "bg-gypi-green" : "bg-gypi-red"}`}
            >
              {accion === "aprobado" ? "Sí, aprobar" : "Sí, rechazar"}
            </button>
          </div>
        </div>
      )}

      {showActions && s.estado === "pendiente" && !enEspera && !accion && (
        <div className="flex gap-3 mt-2.5">
          <button onClick={() => setAccion("aprobado")} aria-label={`Aprobar solicitud de ${nombre}`} className="flex-1 min-h-[44px] rounded-lg border-none bg-gypi-green/10 text-gypi-green text-xs font-bold cursor-pointer">Aprobar</button>
          <button onClick={() => setAccion("rechazado")} aria-label={`Rechazar solicitud de ${nombre}`} className="flex-1 min-h-[44px] rounded-lg border-none bg-gypi-red/10 text-gypi-red text-xs font-bold cursor-pointer">Rechazar</button>
        </div>
      )}
    </article>
  );
}
