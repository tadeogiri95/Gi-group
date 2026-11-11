'use client';
// app/components/FinanzasInicio.jsx — Finanzas → 🏠 Inicio (parte 10 del plan
// del 11/11; /api/finanzas/inicio, reglas en app/lib/finanzasInicio.js).
//
// La primera pantalla de Finanzas: la plata en cajas y bancos, lo que entró y
// salió en el mes, "Para hacer hoy" (cada cosa lleva a su pantalla) y el resto
// de Finanzas en tarjetas por tema.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { DETALLE_FINANZAS, GRUPOS_FINANZAS } from "../lib/finanzasInicio";
import { ICONO_GESTION } from "../lib/menuGestion";
import { Spinner } from "./ui";

const TONO = {
  rojo: "border-gypi-red/40 bg-gypi-red/10 text-gypi-red-ink",
  ambar: "border-gypi-amber/40 bg-gypi-amber/10 text-gypi-amber-ink",
  normal: "border-gypi-border bg-gypi-surface text-gypi-text",
};

export default function FinanzasInicio({ opciones = [], onIr }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    apiFetch("/api/finanzas/inicio")
      .then(async (res) => {
        const x = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(x.error || "No se pudo cargar el resumen");
        setD(x);
      })
      .catch((e) => setError(e.message || "No se pudo cargar el resumen"));
  }, []);

  const label = Object.fromEntries(opciones.map((o) => [o.id, o.label]));
  const max = d ? Math.max(1, d.mes.entro, d.mes.salio) : 1;
  const barra = (v, clase) => (
    <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="w-full h-2" aria-hidden="true">
      <rect width="100" height="8" rx="4" className="fill-gypi-surf-lo" />
      <rect width={Math.max(1, Math.round((v / max) * 100))} height="8" rx="4" className={clase} />
    </svg>
  );

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 text-gypi-text">
      {error && <p role="alert" className="m-0 mb-3 text-[14px] text-gypi-red">⚠ {error}</p>}
      {!d && !error && <div className="flex justify-center py-6"><Spinner /></div>}
      {d && (
        <>
          <section aria-label="Plata" className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <button type="button" onClick={() => onIr("fin-tesoreria")} className="text-left p-3 rounded-xl border border-gypi-border bg-gypi-surface cursor-pointer">
              <span className="block text-[13px] text-gypi-dim">En cajas y bancos</span>
              <b className={`block font-mono text-[26px] leading-tight ${d.saldo.ARS < 0 ? "text-gypi-red" : ""}`}>{plata(d.saldo.ARS)}</b>
              {Math.abs(d.saldo.USD) >= 0.01 && <span className="block font-mono text-[15px] font-semibold">{plata(d.saldo.USD, "USD")}</span>}
              <span className="block text-[12px] text-gypi-dim">Con los plazos fijos. Tocá para ver cada una.</span>
            </button>
            <button type="button" onClick={() => onIr("fin-flujo")} className="text-left p-3 rounded-xl border border-gypi-border bg-gypi-surface cursor-pointer">
              <span className="block text-[13px] text-gypi-dim">Este mes (pesos)</span>
              <span className="grid grid-cols-[64px_1fr_auto] items-center gap-2 mt-1 text-[13px]">
                <span>Entró</span>{barra(d.mes.entro, "fill-gypi-green")}<b className="font-mono text-gypi-green-ink">{plata(d.mes.entro)}</b>
              </span>
              <span className="grid grid-cols-[64px_1fr_auto] items-center gap-2 mt-1 text-[13px]">
                <span>Salió</span>{barra(d.mes.salio, "fill-gypi-red")}<b className="font-mono text-gypi-red">{plata(d.mes.salio)}</b>
              </span>
              <span className="block mt-1 text-[12px] text-gypi-dim">Diferencia {plata(d.mes.entro - d.mes.salio)}. Sin los pases entre cajas propias.</span>
            </button>
          </section>

          <section aria-label="Para hacer" className="mb-4">
            <h2 className="m-0 mb-1.5 text-[15px] font-bold">Para hacer</h2>
            {d.pendientes.length ? (
              <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
                {d.pendientes.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => onIr(p.ir)} className={`w-full min-h-[48px] px-3 py-2 rounded-lg border text-left text-[14px] font-semibold cursor-pointer flex items-center gap-2 ${TONO[p.tono] || TONO.normal}`}>
                      <span className="flex-1">{p.texto}</span>
                      {p.importe > 0 && <span className="font-mono">{plata(p.importe)}</span>}
                      <span aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-[14px] text-gypi-dim">✅ Nada pendiente: está todo al día.</p>}
          </section>
        </>
      )}

      {GRUPOS_FINANZAS.map((g) => {
        const ops = g.opciones.filter((id) => label[id]);
        if (!ops.length) return null;
        return (
          <section key={g.id} aria-label={g.titulo} className="mb-4">
            <h2 className="m-0 mb-1.5 text-[14px] font-bold text-gypi-dim">{g.titulo}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {ops.map((id) => (
                <button key={id} type="button" onClick={() => onIr(id)} className="text-left min-h-[64px] p-3 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                  <span className="block text-[14px] font-bold">{ICONO_GESTION[id]} {label[id]}</span>
                  <span className="block text-[12px] text-gypi-dim">{DETALLE_FINANZAS[id]}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
