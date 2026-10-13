'use client';
// app/components/ChecklistEditor.jsx — Checklist de liberación de la OT
// (Órdenes de Producción, parte 5; ítem 39). Lo que el responsable tilda
// antes de que una OT entre a producción. Sin checklist, liberar es un toque.
// Desde la parte 10 también arma el checklist de carga del camión (TEXTOS.carga).
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { CHECKLIST_FABRICA, MAX_ITEMS_CHECKLIST, normalizarChecklist } from "../lib/avance";
import { CHECKLIST_CARGA_FABRICA } from "../lib/carga";

const TEXTOS = {
  liberacion: {
    action: "update_checklist", clave: "checklist_liberacion", fabrica: CHECKLIST_FABRICA,
    ayuda: "Lo que el responsable revisa antes de liberar una OT a producción. Se tilda desde el tablero de OT. Sin checklist, se libera con un toque.",
    lista: "Checklist de liberación", ejemplo: "Ej: Planos firmados por el cliente",
    guardado: "Checklist de liberación guardado", vacio: "Las OT se liberan sin checklist",
  },
  carga: {
    action: "update_checklist_carga", clave: "checklist_carga", fabrica: CHECKLIST_CARGA_FABRICA,
    ayuda: "Lo que se revisa antes de que salga el camión. Se tilda en la carga de cada OT (botón 🚚 Carga). Sin checklist, alcanza con los bultos y los sueltos cargados.",
    lista: "Checklist de carga", ejemplo: "Ej: Foto de cada bulto antes de subirlo",
    guardado: "Checklist de carga guardado", vacio: "Las cargas se firman sin checklist",
  },
};

const BOTON = "min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-gypi-surface text-gypi-text text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default";

export default function ChecklistEditor({ items = [], onGuardado, avisar = () => {}, tipo = "liberacion" }) {
  const T = TEXTOS[tipo] || TEXTOS.liberacion;
  const guardados = normalizarChecklist(items);
  const [borrador, setBorrador] = useState(guardados);
  const [nuevo, setNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const cambiado = JSON.stringify(borrador) !== JSON.stringify(guardados);

  const agregar = () => {
    const t = nuevo.trim();
    if (!t || borrador.includes(t) || borrador.length >= MAX_ITEMS_CHECKLIST) return;
    setBorrador([...borrador, t]);
    setNuevo("");
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await apiFetch("/api/config-empresa", {
        method: "PATCH",
        body: JSON.stringify({ action: T.action, items: borrador }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar el checklist");
      const lista = data[T.clave] || [];
      setBorrador(lista);
      onGuardado?.(lista);
      avisar(lista.length ? T.guardado : T.vacio);
    } catch (err) {
      avisar(err.message, "error");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="g-card mb-3.5">
      <div className="text-[13px] text-gypi-dim mb-3 leading-normal">
        {T.ayuda}
      </div>
      {borrador.length === 0 ? (
        <>
          <div className="text-[13px] text-gypi-dim mb-3">Todavía no armaste el checklist.</div>
          <button onClick={() => setBorrador(T.fabrica)} className="g-btn g-btn-secondary w-full mb-3.5">Usar el checklist de fábrica</button>
        </>
      ) : (
        <ol aria-label={T.lista} className="list-none p-0 m-0 mb-3">
          {borrador.map((t, i) => (
            <li key={t} className="flex items-center gap-2 p-2 rounded-xl border border-gypi-border bg-gypi-surf-lo mb-1.5">
              <span className="w-6 text-center text-xs font-bold text-gypi-dim">{i + 1}</span>
              <span className="flex-1 min-w-0 text-[13px]">{t}</span>
              <button className={`${BOTON} text-gypi-red`} aria-label={`Quitar ${t}`} onClick={() => setBorrador(borrador.filter((x) => x !== t))}>✕</button>
            </li>
          ))}
        </ol>
      )}
      <div className="g-label mb-1.5">Agregar punto</div>
      <div className="flex gap-2 mb-3.5">
        <input className="g-input flex-1 min-w-0" value={nuevo} maxLength={200} aria-label="Nuevo punto del checklist"
          onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder={T.ejemplo} />
        <button onClick={agregar} disabled={!nuevo.trim()} className="g-btn g-btn-secondary">Agregar</button>
      </div>
      <button onClick={guardar} disabled={guardando || !cambiado} className="g-btn g-btn-primary w-full">
        {guardando ? "Guardando…" : "Guardar checklist"}
      </button>
    </div>
  );
}
