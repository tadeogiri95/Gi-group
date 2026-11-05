'use client';
// app/components/TarjetaMinuta.jsx — Tarjeta "📝 Minuta de hoy" del Panel de
// control (Minuta, parte M5): si la reunión de hoy ya se empezó o se cerró,
// los pendientes que vencen hoy o ya vencieron, y un botón para ir a la
// minuta. Solo gerencia con el módulo Minutas; sin la migración 150 no aparece.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { tieneModulo } from "../lib/modulos";
import { tarjetaMinuta } from "../lib/minutasReporte";
import { useAuth } from "../context/AuthContext";
import { comoDueno } from "../lib/menuGestion";
import { Tag } from "./ui";

const ESTADO = {
  sin_empezar: { texto: "Todavía no se empezó la de hoy.", boton: "Empezar la minuta" },
  abierta: { texto: "La de hoy está empezada.", boton: "Seguir la minuta" },
  cerrada: { texto: "✅ La de hoy ya está cerrada.", boton: "Ver la minuta" },
};

export default function TarjetaMinuta({ empresa, goto }) {
  const { usuario } = useAuth();
  const con = comoDueno(usuario) && tieneModulo(empresa, "minutas");
  const [t, setT] = useState(null);

  useEffect(() => {
    if (!con) return;
    let vivo = true;
    const hoy = hoyArg();
    const leer = (q) => apiFetch(`/api/minutas?${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([leer(`fecha=${hoy}`), leer(`seguimiento=${hoy}`)]).then(([dia, seg]) => {
      if (!vivo || !dia) return;
      setT(tarjetaMinuta({ minuta: dia.minuta, items: dia.items || [], abiertos: seg?.items || [], hoy }));
    });
    return () => { vivo = false; };
  }, [con]);

  if (!con || !t) return null;
  const e = ESTADO[t.estado];
  return (
    <section aria-label="Minuta de hoy" className="card-hover g-card mb-4">
      <div className="flex justify-between items-center mb-2 gap-2">
        <h3 className="m-0 font-heading text-[15px] font-bold text-gypi-text">📝 Minuta de hoy</h3>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {t.vencidos > 0 && <Tag color="var(--color-red)">{t.vencidos} vencido{t.vencidos !== 1 ? "s" : ""}</Tag>}
          {t.venceHoy > 0 && <Tag color="var(--color-empresa-primary)">{t.venceHoy} vence{t.venceHoy !== 1 ? "n" : ""} hoy</Tag>}
        </div>
      </div>
      <p className="m-0 text-[13px] text-gypi-dim">
        {e.texto} {t.abiertos > 0 ? `${t.abiertos} pendiente${t.abiertos !== 1 ? "s" : ""} abierto${t.abiertos !== 1 ? "s" : ""}` : "Sin pendientes abiertos"}
        {t.gerencia > 0 ? ` · 🔴 ${t.gerencia} los toma Gerencia` : ""}.
      </p>
      <button type="button" onClick={() => goto?.("proyectos:minuta")}
        className="w-full mt-3 p-3 min-h-12 rounded-(--radius-md) font-body text-[14px] font-bold cursor-pointer flex items-center justify-center gap-1.5 bg-gypi-surf-hi border border-gypi-border text-gypi-text">
        {e.boton} &rarr;
      </button>
    </section>
  );
}
