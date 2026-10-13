'use client';
// app/components/RutasEditor.jsx — Ruta de etapas de cada división
// (Órdenes de Producción, parte 2; ítem 39). El dueño elige qué etapas usa
// cada división y en qué orden. Sin ruta, la división ve todas las etapas.
import { useState, useEffect } from "react";
import { apiFetch } from "../lib/supabase";
import { rutaDe } from "../lib/rutas";

const BOTON = "min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-gypi-surface text-gypi-text text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default";

export default function RutasEditor({ divisiones = [], etapas = [], onGuardado, onEtapaCreada, avisar = () => {} }) {
  const [divId, setDivId] = useState(divisiones[0]?.id ?? null);
  const division = divisiones.find((d) => d.id === divId) || null;
  const [borrador, setBorrador] = useState(() => rutaDe(division));
  const [guardando, setGuardando] = useState(false);
  const [nuevaEtapa, setNuevaEtapa] = useState("");
  const [creando, setCreando] = useState(false);

  // Al cambiar de división (o al recargar las divisiones) se parte de lo guardado
  const rutaGuardada = JSON.stringify(rutaDe(division));
  useEffect(() => { setBorrador(rutaDe(division)); }, [divId, rutaGuardada]); // eslint-disable-line react-hooks/exhaustive-deps

  const productivas = etapas.filter((e) => e.codigo > 0);
  const porCodigo = new Map(productivas.map((e) => [e.codigo, e]));
  const enRuta = borrador.filter((c) => porCodigo.has(c));
  const disponibles = productivas.filter((e) => !enRuta.includes(e.codigo));
  const cambiado = JSON.stringify(enRuta) !== JSON.stringify(rutaDe(division).filter((c) => porCodigo.has(c)));

  const mover = (i, delta) => {
    const nueva = [...enRuta];
    [nueva[i], nueva[i + delta]] = [nueva[i + delta], nueva[i]];
    setBorrador(nueva);
  };

  const guardar = async (ruta) => {
    if (!division) return;
    setGuardando(true);
    try {
      const r = await apiFetch("/api/config-empresa", {
        method: "PATCH",
        body: JSON.stringify({ action: "update_division", id: division.id, ruta_etapas: ruta }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar la ruta");
      setBorrador(ruta);
      onGuardado?.({ ...division, ...(data.division || {}), ruta_etapas: ruta.length ? ruta : null });
      avisar(ruta.length ? `Ruta de ${division.label} guardada` : `${division.label} ahora usa todas las etapas`);
    } catch (err) {
      avisar(err.message, "error");
    } finally {
      setGuardando(false);
    }
  };

  // Etapa nueva con solo el nombre: el servidor le pone el siguiente número
  // libre. Se suma al final de la ruta (falta tocar "Guardar ruta").
  const crearEtapa = async () => {
    const nombre = nuevaEtapa.trim();
    if (!nombre || creando) return;
    setCreando(true);
    try {
      const r = await apiFetch("/api/config-empresa", {
        method: "POST",
        body: JSON.stringify({ action: "add_etapa", nombre, icon: "🔨" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.etapa) throw new Error(data.error || "No se pudo crear la etapa");
      onEtapaCreada?.(data.etapa);
      setBorrador([...enRuta, data.etapa.codigo]);
      setNuevaEtapa("");
      avisar(`Etapa ${data.etapa.nombre} creada. Tocá "Guardar ruta" para guardarla en ${division?.label}.`);
    } catch (err) {
      avisar(err.message, "error");
    } finally {
      setCreando(false);
    }
  };

  if (!divisiones.length) {
    return <div className="g-card mb-3.5 text-[13px] text-gypi-dim">Primero cargá las divisiones de tu empresa en la pestaña Divisiones.</div>;
  }

  return (
    <div className="g-card mb-3.5">
      <div className="text-[13px] text-gypi-dim mb-3 leading-normal">
        Elegí qué etapas usa cada división y en qué orden. El operario de esa división va a ver solo esas etapas, y al elegir una, solo las OT que pasan por ella. Una división sin ruta sigue viendo todas.
      </div>
      <div role="tablist" aria-label="División" className="flex flex-wrap gap-1.5 mb-3.5">
        {divisiones.map((d) => (
          <button key={d.id} role="tab" aria-selected={d.id === divId} onClick={() => setDivId(d.id)}
            className={`min-h-[44px] px-3.5 rounded-full text-xs font-bold cursor-pointer border ${d.id === divId ? "bg-gypi-amber text-gypi-on-amber border-gypi-amber" : "bg-gypi-surface text-gypi-dim border-gypi-border"}`}>
            {d.icon} {d.label}{rutaDe(d).length ? "" : " · sin ruta"}
          </button>
        ))}
      </div>

      <div className="g-label mb-1.5">Ruta de {division?.label}</div>
      {enRuta.length === 0 ? (
        <div className="text-[13px] text-gypi-dim mb-3">Sin ruta: esta división ve todas las etapas. Agregá las etapas en orden.</div>
      ) : (
        <ol aria-label={`Ruta de ${division?.label}`} className="list-none p-0 m-0 mb-3">
          {enRuta.map((c, i) => {
            const e = porCodigo.get(c);
            return (
              <li key={c} className="flex items-center gap-2 p-2 rounded-xl border border-gypi-border bg-gypi-surf-lo mb-1.5">
                <span className="w-6 text-center text-xs font-bold text-gypi-dim">{i + 1}</span>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-lg bg-gypi-surface">{e.icon}</span>
                <span className="flex-1 min-w-0 text-[13px] font-bold truncate">{e.nombre}</span>
                <button className={BOTON} aria-label={`Subir ${e.nombre}`} disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
                <button className={BOTON} aria-label={`Bajar ${e.nombre}`} disabled={i === enRuta.length - 1} onClick={() => mover(i, 1)}>↓</button>
                <button className={`${BOTON} text-gypi-red`} aria-label={`Quitar ${e.nombre}`} onClick={() => setBorrador(enRuta.filter((x) => x !== c))}>✕</button>
              </li>
            );
          })}
        </ol>
      )}

      {disponibles.length > 0 && <>
        <div className="g-label mb-1.5">Agregar etapa</div>
        <div className="flex flex-wrap gap-1.5 mb-3.5">
          {disponibles.map((e) => (
            <button key={e.codigo} onClick={() => setBorrador([...enRuta, e.codigo])}
              className="min-h-[44px] px-3 rounded-[10px] border border-gypi-border bg-gypi-surface text-xs font-bold cursor-pointer text-gypi-text">
              + {e.icon} {e.nombre}
            </button>
          ))}
        </div>
      </>}

      <div className="g-label mb-1.5">Crear etapa nueva</div>
      <div className="flex gap-2 mb-3.5">
        <input className="g-input flex-1" value={nuevaEtapa} maxLength={60} aria-label="Nombre de la etapa nueva"
          onChange={(e) => setNuevaEtapa(e.target.value)} onKeyDown={(e) => e.key === "Enter" && crearEtapa()}
          placeholder="Ej: Corte de perfiles" />
        <button onClick={crearEtapa} disabled={creando || !nuevaEtapa.trim()} className="g-btn g-btn-secondary">
          {creando ? "Creando…" : "Crear"}
        </button>
      </div>

      <div className="flex gap-2.5">
        <button onClick={() => guardar(enRuta)} disabled={guardando || !cambiado} className="g-btn g-btn-primary flex-1">
          {guardando ? "Guardando…" : "Guardar ruta"}
        </button>
        {rutaDe(division).length > 0 && (
          <button onClick={() => guardar([])} disabled={guardando} className="g-btn g-btn-secondary">Usar todas</button>
        )}
      </div>
    </div>
  );
}
