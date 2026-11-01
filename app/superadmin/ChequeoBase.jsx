"use client";
// app/superadmin/ChequeoBase.jsx — Chequeo de la base en superadmin
// (auditoría 01/11, PR 7): qué migraciones faltan correr en Supabase.
import { useCallback, useEffect, useState } from "react";
import { textoFaltantes } from "../lib/esquemaMigraciones";

export default function ChequeoBase() {
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const revisar = useCallback(async (forzar = false) => {
    setCargando(true);
    try {
      const r = await fetch(`/api/superadmin/esquema${forzar ? "?forzar=1" : ""}`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      setEstado(r.ok ? d : { error: d.error || "No se pudo revisar la base" });
    } catch {
      setEstado({ error: "No se pudo revisar la base" });
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { revisar(); }, [revisar]);

  const faltan = estado?.faltan || [];
  const color = estado?.error ? "#9B8F85" : faltan.length ? "#F59E0B" : "#22C55E";
  return (
    <section aria-label="Chequeo de la base" style={{ background: "#1A1714", border: `1px solid ${color}55`, borderRadius: 12, padding: "14px 18px", marginBottom: 24, display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ flex: 1, fontSize: 14 }}>
        <div style={{ fontWeight: 700, color, marginBottom: 4 }}>
          {!estado ? "Revisando la base…" : estado.error ? `⚠ ${estado.error}` : faltan.length ? `⚠ Faltan correr ${faltan.length} migraciones` : "✓ Base al día"}
        </div>
        {faltan.length > 0 && (
          <div style={{ color: "#F5F0E8" }}>
            {textoFaltantes(faltan)}
            <div style={{ color: "#9B8F85", fontSize: 12, marginTop: 4 }}>{faltan.map((m) => m.archivo).join(" · ")}</div>
          </div>
        )}
        {estado && !estado.error && (
          <div style={{ color: "#6B6560", fontSize: 12, marginTop: 4 }}>
            {estado.total} migraciones revisadas ({estado.metodo === "indice" ? "índice de la API" : "tabla por tabla"}) · {new Date(estado.revisado_at).toLocaleString("es-AR")}
          </div>
        )}
      </div>
      <button type="button" onClick={() => revisar(true)} disabled={cargando}
        style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,240,220,0.1)", background: "transparent", color: "#9B8F85", fontSize: 13, cursor: "pointer" }}>
        {cargando ? "Revisando…" : "↻ Revisar"}
      </button>
    </section>
  );
}
