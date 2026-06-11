"use client";
// Extraído de [slug]/page.js líneas 738-748
import { useState } from "react";
import { C, fH, fB, fM } from "../../lib/theme";
import { sb } from "../../lib/supabase";
import { Ic } from "../Icons";

export default function ReglasScreen({ ctx, reload, usuario }) {
  const [nr, setNr] = useState("");
  const add = async () => { if (!nr.trim()) return; await sb.post("reglas_bot", { regla: nr.trim(), creada_por: usuario.apodo }); setNr(""); reload(); };
  const del = async (id) => { await sb.del(`reglas_bot?id=eq.${id}`); reload(); };

  return (
    <div style={{ padding: "0 18px 110px", overflowY: "auto", flex: 1 }}>
      <div style={{ background: `linear-gradient(135deg,${C.violet}12,${C.surface})`, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.violet, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>REGLAS DEL BOT</div>
        <div style={{ fontSize: 13, color: C.text, marginTop: 6, lineHeight: 1.5 }}>Cambios aplican inmediatamente al bot.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {(ctx.reglasRaw || []).length === 0 ? (
          <div style={{ background: C.surface, borderRadius: 14, padding: "28px 20px", textAlign: "center", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Sin reglas configuradas</div>
            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5 }}>Agregá instrucciones para personalizar cómo responde el bot a tu equipo.</div>
          </div>
        ) : (ctx.reglasRaw || []).map((r, i) => (
          <div key={r.id} style={{ background: C.surface, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, display: "flex", gap: 10 }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: C.amberS, color: C.amber, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fM, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
            <div style={{ flex: 1, fontSize: 13, color: C.text, lineHeight: 1.4 }}>{r.regla}</div>
            <button onClick={() => del(r.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", padding: 4, display: "flex", flexShrink: 0, opacity: .6 }}><Ic.trash /></button>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 12 }}><h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text, fontFamily: fH }}>Agregar regla</h3></div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={nr} onChange={e => setNr(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder='Ej: "Si piden permiso un viernes..."' style={{ flex: 1, padding: "11px 14px", borderRadius: 10, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box" }} />
        <button onClick={add} disabled={!nr.trim()} style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: nr.trim() ? C.amber : C.surface, color: nr.trim() ? "#000" : C.mute, cursor: nr.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}><Ic.plus /></button>
      </div>
    </div>
  );
}
