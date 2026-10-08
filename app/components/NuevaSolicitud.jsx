"use client";
// NuevaSolicitud — Formulario directo para pedir un permiso, vacaciones o
// justificar una falta (F4-12): tipo de la empresa, uno o varios días y motivo.
// Antes solo se podía pedir por el chat y siempre de a un día (F1-21).
import { useState } from "react";
import { tiposDeEmpresa, diasEntre, MAX_DIAS_SOLICITUD } from "../lib/tiposSolicitud";
import { pedirSolicitud } from "../lib/pedidosOperario";
import { hoyArg } from "../lib/dates";

export default function NuevaSolicitud({ usuario, empresa, onEnviada, onCerrar, demo = false }) {
  const tipos = tiposDeEmpresa(empresa?.tipos_solicitud);
  const [clave, setClave] = useState(tipos[0]?.clave || "");
  const [desde, setDesde] = useState(() => hoyArg());
  const [hasta, setHasta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const tipo = tipos.find((t) => t.clave === clave) || tipos[0];
  const dias = tipo?.multiDia && hasta ? diasEntre(desde, hasta) : 1;

  const enviar = async () => {
    setError("");
    if (!desde) return setError("Elegí la fecha");
    if (tipo.multiDia && hasta) {
      if (dias < 1) return setError("La fecha de fin no puede ser anterior a la de inicio");
      if (dias > MAX_DIAS_SOLICITUD) return setError(`Podés pedir hasta ${MAX_DIAS_SOLICITUD} días por solicitud`);
    }
    setEnviando(true);
    try {
      if (!demo) await pedirSolicitud(usuario, { tipo, desde, hasta: tipo.multiDia ? hasta || desde : desde, motivo });
      onEnviada?.();
    } catch (e) {
      setError(e.message || "No se pudo enviar. Intentá de nuevo.");
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Nuevo pedido">
      <div onClick={onCerrar} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[90vh] overflow-y-auto border border-gypi-border">
        <h3 className="m-0 mb-4 font-heading text-lg font-bold text-gypi-text">Nuevo pedido</h3>

        <label className="g-label block mb-1.5" htmlFor="ns-tipo">¿Qué necesitás?</label>
        <select id="ns-tipo" value={clave} onChange={(e) => setClave(e.target.value)} className="g-input mb-3 text-[15px]">
          {tipos.map((t) => <option key={t.clave} value={t.clave}>{t.nombre}</option>)}
        </select>

        <div className={tipo?.multiDia ? "grid grid-cols-2 gap-2.5 mb-3" : "mb-3"}>
          <div>
            <label className="g-label block mb-1.5" htmlFor="ns-desde">{tipo?.multiDia ? "Desde" : "Fecha"}</label>
            <input id="ns-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="g-input" />
          </div>
          {tipo?.multiDia && (
            <div>
              <label className="g-label block mb-1.5" htmlFor="ns-hasta">Hasta (opcional)</label>
              <input id="ns-hasta" type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className="g-input" />
            </div>
          )}
        </div>
        {tipo?.multiDia && hasta && dias > 0 && <div className="text-xs text-gypi-dim -mt-1 mb-3">{dias} {dias === 1 ? "día" : "días"}</div>}

        <label className="g-label block mb-1.5" htmlFor="ns-motivo">Motivo o detalle (opcional)</label>
        <textarea id="ns-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 500))} rows={3} className="g-input mb-3 resize-none" />

        {error && <div role="alert" className="text-xs text-gypi-red font-semibold mb-3">{error}</div>}

        <div className="flex gap-2">
          <button onClick={onCerrar} className="flex-1 min-h-[48px] rounded-xl border border-gypi-border bg-transparent text-gypi-dim text-sm font-bold cursor-pointer">Cancelar</button>
          <button onClick={enviar} disabled={enviando} className="flex-[2] min-h-[48px] rounded-xl border-none bg-gypi-amber text-gypi-on-amber text-sm font-bold cursor-pointer disabled:opacity-60">
            {enviando ? "Enviando..." : "Enviar solicitud"}
          </button>
        </div>
      </div>
    </div>
  );
}
