"use client";
// Aviso de lo que quedó guardado sin conexión (ítem 21).
import { horaDeOp } from "../lib/colaOffline";

function describir(op) {
  const b = op.body || {};
  if (op.tipo === "fichar") return b.accion === "egreso" ? "Salida" : "Entrada";
  if (b.accion === "finalizar") return "Fin de tarea";
  return b.etapa === 0 ? "Espera" : `Tarea${b.codigo_proyecto ? ` OT ${b.codigo_proyecto}` : ""}`;
}

export default function EstadoConexion({ cola }) {
  if (!cola) return null;
  const { pendientes = [], fallidas = [], sincronizando, enLinea, enviarAhora, descartarFallida } = cola;
  if (pendientes.length === 0 && fallidas.length === 0 && enLinea) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {(pendientes.length > 0 || !enLinea) && (
        <div role="status" className="p-3 rounded-xl border border-gypi-border bg-gypi-surface text-xs text-gypi-text">
          <div className="font-bold">
            {!enLinea ? "📴 Sin conexión" : sincronizando ? "🔄 Enviando…" : "⏳ Esperando señal"}
            {pendientes.length > 0 && ` · ${pendientes.length} sin enviar`}
          </div>
          {pendientes.length > 0 && (
            <div className="text-gypi-dim mt-1">
              {pendientes.map((op) => `${describir(op)} ${horaDeOp(op)}`).join(" · ")}. Se mandan solas cuando vuelva la señal, con la hora en que las hiciste.
            </div>
          )}
          {pendientes.length > 0 && enLinea && !sincronizando && (
            <button onClick={enviarAhora} className="mt-2 min-h-[36px] px-3 rounded-lg border border-gypi-border bg-transparent text-gypi-text text-xs font-bold cursor-pointer">Reintentar ahora</button>
          )}
        </div>
      )}
      {fallidas.map((op) => (
        <div key={op.op_id} role="alert" className="p-3 rounded-xl bg-gypi-red/10 text-xs text-gypi-text">
          <div className="font-bold text-gypi-red">No se pudo registrar: {describir(op)} de las {horaDeOp(op)}</div>
          <div className="mt-1">{op.error}</div>
          <button onClick={() => descartarFallida(op.op_id)} className="mt-2 min-h-[36px] px-3 rounded-lg border-none bg-transparent text-gypi-dim text-xs font-bold cursor-pointer">Entendido</button>
        </div>
      ))}
    </div>
  );
}
