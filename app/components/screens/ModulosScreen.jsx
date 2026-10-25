"use client";
// Más → Módulos: la empresa prende o apaga lo que contrató (migración 131).
// Lo apagado desaparece de la app (menú, pestañas, Inicio y Panel de control)
// y vuelve tal cual al prenderlo: no se borra ningún dato. Lo que no está en
// el plan se ve con 🔒 y no se puede prender desde acá.
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/supabase";
import { Spinner } from "../ui";

export default function ModulosScreen({ onUpdateEmpresa }) {
  const [lista, setLista] = useState(null);
  const [guardando, setGuardando] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/modulos")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error || "No se pudieron leer los módulos");
        setLista(d.lista || []);
      })
      .catch((e) => { if (vivo) { setError(e.message); setLista([]); } });
    return () => { vivo = false; };
  }, []);

  const cambiar = async (m) => {
    setGuardando(m.id);
    setError("");
    try {
      const r = await apiFetch("/api/modulos", { method: "PATCH", body: JSON.stringify({ modulo: m.id, prendido: !m.prendido }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo guardar");
      setLista(d.lista || []);
      // La app se arma de nuevo con lo prendido, sin recargar
      onUpdateEmpresa?.({ modulos: d.modulos, modulos_apagados: d.modulos_apagados });
    } catch (e) {
      setError(e.message);
    }
    setGuardando(null);
  };

  if (!lista) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;

  const contratados = lista.filter((m) => m.contratado);
  const otros = lista.filter((m) => !m.contratado);

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-[110px] flex flex-col gap-3">
      <p className="m-0 text-[13px] text-gypi-dim">
        Apagá lo que la empresa no usa para que no aparezca en la app. No se borra nada: si lo volvés a prender, está todo como antes.
      </p>
      {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
      {contratados.map((m) => (
        <div key={m.id} className="g-card flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-gypi-text">{m.nombre}</div>
            <div className="text-[12px] text-gypi-dim mt-0.5">{m.descripcion}</div>
          </div>
          {m.fijo ? (
            <span className="shrink-0 text-[12px] text-gypi-dim">Siempre prendido</span>
          ) : (
            <button
              role="switch"
              aria-checked={m.prendido}
              aria-label={m.nombre}
              onClick={() => cambiar(m)}
              disabled={guardando !== null}
              className={`shrink-0 min-h-[44px] min-w-[96px] px-3 rounded-lg border-none text-[13px] font-bold cursor-pointer ${m.prendido ? "bg-gypi-green/15 text-gypi-green" : "bg-gypi-surface text-gypi-dim"}`}
            >
              {guardando === m.id ? "Guardando…" : m.prendido ? "Prendido" : "Apagado"}
            </button>
          )}
        </div>
      ))}
      {otros.length > 0 && (
        <>
          <h3 className="g-overline m-0 mt-2">No están en tu plan</h3>
          {otros.map((m) => (
            <div key={m.id} className="g-card flex items-center justify-between gap-3 opacity-70">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-gypi-text">{m.nombre}</div>
                <div className="text-[12px] text-gypi-dim mt-0.5">{m.descripcion}</div>
              </div>
              <span aria-label="No está en tu plan" className="shrink-0">🔒</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
