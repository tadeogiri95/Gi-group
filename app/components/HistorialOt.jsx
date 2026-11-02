"use client";
// app/components/HistorialOt.jsx — 🕓 Historial de cambios, en el Detalle de
// la OT (Tadeo, 02/11): quién cargó avance, demoras, retrabajos, editó,
// cerró, cambió prioridad o semana, firmó etapas o liberó, con día y hora.
// Solo gestión. Se abre a pedido para no leer el historial en cada OT.
import { useContext, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { describirCambio } from "../lib/historialOt";
import { AuthContext } from "../context/AuthContext";

const VISIBLES = 15;

/** "02/11 08:45" en la hora de Argentina. */
export function diaHora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function HistorialOt({ ot, etapas = [] }) {
  const auth = useContext(AuthContext);
  const puede = ["gerencial", "administrativo"].includes(auth?.usuario?.rol);
  const [abierto, setAbierto] = useState(false);
  const [cambios, setCambios] = useState(null);
  const [todos, setTodos] = useState(false);
  useEffect(() => {
    if (!abierto || !ot) return;
    let vivo = true;
    setCambios(null);
    apiFetch(`/api/historial-ot?ot=${encodeURIComponent(ot)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setCambios(j?.cambios || []); })
      .catch(() => { if (vivo) setCambios([]); });
    return () => { vivo = false; };
  }, [abierto, ot]);
  if (!puede || !ot) return null;
  const nombreEtapa = (c) => etapas.find((e) => String(e.codigo) === String(c))?.nombre || `etapa ${c}`;
  const lista = cambios ? (todos ? cambios : cambios.slice(0, VISIBLES)) : [];
  return (
    <section aria-label="Historial de cambios" className="mt-4">
      <button type="button" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}
        className="g-label mb-1.5 bg-transparent border-none cursor-pointer p-0 min-h-[44px] text-left">
        🕓 Historial de cambios {abierto ? "▾" : "▸"}
      </button>
      {abierto && (cambios === null ? (
        <p className="text-[13px] text-gypi-dim m-0">Cargando…</p>
      ) : cambios.length === 0 ? (
        <p className="text-[13px] text-gypi-dim m-0">Todavía no hay cambios registrados en esta OT.</p>
      ) : (
        <>
          <ol className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Cambios de la OT">
            {lista.map((c, i) => (
              <li key={`${c.at}-${i}`} className="bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                <div className="text-[13px] text-gypi-text">{describirCambio(c, nombreEtapa)}</div>
                <div className="text-xs text-gypi-dim">{c.nombre} · {diaHora(c.at)}</div>
              </li>
            ))}
          </ol>
          {cambios.length > VISIBLES && (
            <button type="button" className="mt-1 min-h-[44px] bg-transparent border-none cursor-pointer text-gypi-cyan text-[13px] font-semibold p-0" onClick={() => setTodos((x) => !x)}>
              {todos ? "Ver menos" : `Ver los ${cambios.length} cambios`}
            </button>
          )}
        </>
      ))}
    </section>
  );
}
