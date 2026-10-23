'use client';
// app/components/CausasEditor.jsx — Causas de parada de la empresa
// (Órdenes de Producción, parte 4; ítem 39). El dueño arma la lista con sus
// códigos (por ejemplo SP, SM, MA). Sin lista propia, los operarios ven las
// 4 de siempre.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { CAUSAS_DEFECTO, CAUSAS_FABRICA, MAX_CAUSAS, RE_CODIGO_CAUSA, normalizarCausas } from "../lib/causas";

const BOTON = "min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-gypi-surface text-gypi-text text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default";

export default function CausasEditor({ causas = [], onGuardadas, avisar = () => {} }) {
  const propias = normalizarCausas(causas);
  const [borrador, setBorrador] = useState(() => (propias.length ? propias : []));
  const [cod, setCod] = useState("");
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cambiado = JSON.stringify(borrador) !== JSON.stringify(propias);
  const codLimpio = cod.trim().toUpperCase();
  const codValido = RE_CODIGO_CAUSA.test(codLimpio) && !borrador.some((c) => c.cod === codLimpio);

  const agregar = () => {
    if (!codValido || !nombre.trim() || borrador.length >= MAX_CAUSAS) return;
    setBorrador([...borrador, { cod: codLimpio, nombre: nombre.trim(), icon: "⏸" }]);
    setCod("");
    setNombre("");
  };

  const guardar = async (lista) => {
    setGuardando(true);
    try {
      const r = await apiFetch("/api/config-empresa", {
        method: "PATCH",
        body: JSON.stringify({ action: "update_causas", causas: lista }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudieron guardar las causas");
      const guardadas = data.causas_parada || [];
      setBorrador(guardadas);
      onGuardadas?.(guardadas);
      avisar(guardadas.length ? "Causas de parada guardadas" : "Se usan otra vez las causas de siempre");
    } catch (err) {
      avisar(err.message, "error");
    } finally {
      setGuardando(false);
    }
  };

  const visibles = borrador.length ? borrador : CAUSAS_DEFECTO;
  return (
    <div className="g-card mb-3.5">
      <div className="text-[13px] text-gypi-dim mb-3 leading-normal">
        Las causas que elige el operario cuando toca «Estoy parado». Cada una tiene un código corto (hasta 4 letras o números) para anotar rápido y siempre igual.
      </div>

      <div className="g-label mb-1.5">{borrador.length ? "Causas de tu empresa" : "Causas de siempre (todavía no armaste las tuyas)"}</div>
      <ul aria-label="Causas de parada" className="list-none p-0 m-0 mb-3">
        {visibles.map((c) => (
          <li key={c.cod} className="flex items-center gap-2 p-2 rounded-xl border border-gypi-border bg-gypi-surf-lo mb-1.5">
            <span className="w-12 text-center text-xs font-bold font-mono text-gypi-amber-ink">{c.cod}</span>
            <span className="flex-1 min-w-0 text-[13px] font-bold truncate">{c.nombre}</span>
            {borrador.length > 0 && (
              <button className={`${BOTON} text-gypi-red`} aria-label={`Quitar ${c.nombre}`} onClick={() => setBorrador(borrador.filter((x) => x.cod !== c.cod))}>✕</button>
            )}
          </li>
        ))}
      </ul>

      {borrador.length === 0 && (
        <button onClick={() => setBorrador(CAUSAS_FABRICA)} className="g-btn g-btn-secondary w-full mb-3.5">
          Usar los códigos de fábrica ({CAUSAS_FABRICA.map((c) => c.cod).join(", ")})
        </button>
      )}

      <div className="g-label mb-1.5">Agregar causa</div>
      <div className="flex gap-2 mb-3.5">
        <input className="g-input w-[84px] font-mono uppercase" value={cod} maxLength={4} aria-label="Código de la causa"
          onChange={(e) => setCod(e.target.value)} placeholder="SM" />
        <input className="g-input flex-1 min-w-0" value={nombre} maxLength={60} aria-label="Nombre de la causa"
          onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder="Ej: Sin material" />
        <button onClick={agregar} disabled={!codValido || !nombre.trim() || borrador.length >= MAX_CAUSAS} className="g-btn g-btn-secondary">Agregar</button>
      </div>
      {cod.trim() !== "" && !codValido && (
        <div className="text-xs text-gypi-red -mt-2.5 mb-3">El código va con hasta 4 letras o números, sin repetir.</div>
      )}

      <div className="flex gap-2.5">
        <button onClick={() => guardar(borrador)} disabled={guardando || !cambiado} className="g-btn g-btn-primary flex-1">
          {guardando ? "Guardando…" : "Guardar causas"}
        </button>
        {propias.length > 0 && (
          <button onClick={() => guardar([])} disabled={guardando} className="g-btn g-btn-secondary">Volver a las de siempre</button>
        )}
      </div>
    </div>
  );
}
