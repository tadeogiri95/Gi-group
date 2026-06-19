"use client";
import { useState } from "react";
import { sb } from "../../lib/supabase";
import { Ic } from "../Icons";

export default function ReglasScreen({ ctx, reload, usuario }) {
  const [nr, setNr] = useState("");
  const add = async () => { if (!nr.trim()) return; await sb.post("reglas_bot", { regla: nr.trim(), creada_por: usuario.apodo }); setNr(""); reload(); };
  const del = async (id) => { await sb.del(`reglas_bot?id=eq.${id}`); reload(); };
  const hasText = nr.trim().length > 0;

  return (
    <div className="px-[18px] pb-[110px] overflow-y-auto flex-1">
      {/* Header card */}
      <div className="rounded-card p-4 border border-gypi-border mb-3.5 bg-gradient-to-br from-gypi-violet/[0.07] to-gypi-surface">
        <div className="g-overline text-gypi-violet">REGLAS DEL BOT</div>
        <div className="text-[13px] text-gypi-text mt-1.5 leading-relaxed">Cambios aplican inmediatamente al bot.</div>
      </div>

      {/* Rules list */}
      <div className="flex flex-col gap-2 mb-[18px]">
        {(ctx.reglasRaw || []).length === 0 ? (
          <div className="bg-gypi-surface rounded-card py-7 px-5 text-center border border-gypi-border">
            <div className="text-[28px] mb-2">🤖</div>
            <div className="text-[13px] font-bold text-gypi-text mb-1">Sin reglas configuradas</div>
            <div className="text-xs text-gypi-dim leading-relaxed">Agregá instrucciones para personalizar cómo responde el bot a tu equipo.</div>
          </div>
        ) : (ctx.reglasRaw || []).map((r, i) => (
          <div key={r.id} className="bg-gypi-surface rounded-xl p-3.5 border border-gypi-border flex gap-2.5">
            <div className="w-6 h-6 rounded-[7px] bg-gypi-amber/10 text-gypi-amber flex items-center justify-center font-mono text-[11px] font-bold shrink-0">{i + 1}</div>
            <div className="flex-1 text-[13px] text-gypi-text leading-snug">{r.regla}</div>
            <button onClick={() => del(r.id)} className="bg-transparent border-none text-gypi-red cursor-pointer p-1 flex shrink-0 opacity-60 hover:opacity-100"><Ic.trash /></button>
          </div>
        ))}
      </div>

      {/* Add rule */}
      <h3 className="m-0 text-sm font-bold text-gypi-text font-heading mb-3">Agregar regla</h3>
      <div className="flex gap-2">
        <input
          value={nr}
          onChange={e => setNr(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder='Ej: "Si piden permiso un viernes..."'
          className="g-input flex-1"
        />
        <button
          onClick={add}
          disabled={!hasText}
          className={`w-11 h-11 rounded-xl border-none flex items-center justify-center ${
            hasText ? "bg-gypi-amber text-white cursor-pointer" : "bg-gypi-surface text-gypi-mute cursor-default"
          }`}
        >
          <Ic.plus />
        </button>
      </div>
    </div>
  );
}
