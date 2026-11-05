"use client";
// app/components/MinutasDeOt.jsx — 📝 En las minutas, en el Detalle de la OT
// (Minuta, parte M3). Lo que se dijo de la OT en las reuniones de Buenos
// Días: foco, contingencias, pendientes, feedback y compras, con la fecha y
// si se resolvió. Solo Dueño / Gerencia con el módulo Minutas.
import { useContext, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { tieneModulo } from "../lib/modulos";
import { comoDueno } from "../lib/menuGestion";
import { seccion, SEMAFOROS } from "../lib/minutas";
import { AuthContext } from "../context/AuthContext";

const fechaCorta = (f) => (f ? String(f).slice(0, 10).split("-").reverse().join("/") : "");

export default function MinutasDeOt({ ot }) {
  const auth = useContext(AuthContext);
  const puede = comoDueno(auth?.usuario) && tieneModulo(auth?.empresa, "minutas");
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!puede || !ot) return;
    let vivo = true;
    apiFetch(`/api/minutas?ot=${encodeURIComponent(ot)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setItems(j?.items || []); })
      .catch(() => { if (vivo) setItems([]); });
    return () => { vivo = false; };
  }, [puede, ot]);
  if (!puede || !items?.length) return null;
  return (
    <section aria-label="En las minutas" className="mt-4">
      <div className="g-label mb-1.5">📝 En las minutas</div>
      <div className="flex flex-col gap-1.5">
        {items.map((it) => {
          const s = seccion(it.seccion);
          const punto = SEMAFOROS.find((x) => x.id === it.semaforo)?.punto;
          return (
            <div key={it.id} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
              <div className="flex items-center gap-2 text-[12px] text-gypi-dim">
                <span className="font-semibold">{fechaCorta(it.fecha)}</span>
                <span className="flex-1">{s?.titulo || it.seccion}</span>
                {it.resuelto_at && <span className="text-gypi-green-ink font-semibold">✓ Resuelto</span>}
              </div>
              <div className="text-[13px]">
                {punto ? `${punto} ` : ""}{[it.tipo && it.seccion === "feedback" ? it.tipo : "", it.texto].filter(Boolean).join(" · ") || "Sin detalle"}
              </div>
              {(it.responsable || it.fecha_objetivo) && (
                <div className="text-xs text-gypi-dim">{[it.responsable, it.fecha_objetivo ? `para el ${fechaCorta(it.fecha_objetivo)}` : ""].filter(Boolean).join(" · ")}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
