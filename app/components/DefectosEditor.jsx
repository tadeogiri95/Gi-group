'use client';
// app/components/DefectosEditor.jsx — Defectos de las no conformidades
// (Órdenes de Producción, parte 6; ítem 39). El dueño arma la lista con sus
// códigos (por ejemplo C1, K1, P1) y la etapa donde suele originarse cada
// uno. Sin lista propia, los operarios ven 4 defectos generales.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { DEFECTOS_DEFECTO, DEFECTOS_FABRICA, MAX_DEFECTOS, RE_CODIGO_DEFECTO, defectosFabricaPara, normalizarDefectos } from "../lib/calidad";

const BOTON = "min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-gypi-surface text-gypi-text text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default";

export default function DefectosEditor({ defectos = [], etapas = [], onGuardados, avisar = () => {} }) {
  const propios = normalizarDefectos(defectos);
  const productivas = etapas.filter((e) => e.codigo > 0);
  const nombreEtapa = (c) => productivas.find((e) => e.codigo === c)?.nombre || "";
  const [borrador, setBorrador] = useState(propios);
  const [cod, setCod] = useState("");
  const [nombre, setNombre] = useState("");
  const [origen, setOrigen] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cambiado = JSON.stringify(borrador) !== JSON.stringify(propios);
  const codLimpio = cod.trim().toUpperCase();
  const codValido = RE_CODIGO_DEFECTO.test(codLimpio) && !borrador.some((d) => d.cod === codLimpio);

  const agregar = () => {
    if (!codValido || !nombre.trim() || borrador.length >= MAX_DEFECTOS) return;
    setBorrador([...borrador, { cod: codLimpio, nombre: nombre.trim(), origen: origen ? Number(origen) : null }]);
    setCod("");
    setNombre("");
    setOrigen("");
  };

  const guardar = async (lista) => {
    setGuardando(true);
    try {
      const r = await apiFetch("/api/config-empresa", {
        method: "PATCH",
        body: JSON.stringify({ action: "update_defectos", defectos: lista }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudieron guardar los defectos");
      const guardados = data.defectos || [];
      setBorrador(guardados);
      onGuardados?.(guardados);
      avisar(guardados.length ? "Defectos guardados" : "Se usan otra vez los defectos generales");
    } catch (err) {
      avisar(err.message, "error");
    } finally {
      setGuardando(false);
    }
  };

  const visibles = borrador.length ? borrador : DEFECTOS_DEFECTO;
  return (
    <div className="g-card mb-3.5">
      <div className="text-[13px] text-gypi-dim mb-3 leading-normal">
        Los defectos que elige el operario cuando toca «Pieza con defecto» (el sticker rojo). Cada uno tiene un código corto y, si querés, la etapa donde suele originarse.
      </div>

      <div className="g-label mb-1.5">{borrador.length ? "Defectos de tu empresa" : "Defectos generales (todavía no armaste los tuyos)"}</div>
      <ul aria-label="Defectos" className="list-none p-0 m-0 mb-3">
        {visibles.map((d) => (
          <li key={d.cod} className="flex items-center gap-2 p-2 rounded-xl border border-gypi-border bg-gypi-surf-lo mb-1.5">
            <span className="w-12 text-center text-xs font-bold font-mono text-gypi-red">{d.cod}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-bold truncate">{d.nombre}</span>
              {d.origen && nombreEtapa(d.origen) && <span className="block text-[11px] text-gypi-dim">Origen habitual: {nombreEtapa(d.origen)}</span>}
            </span>
            {borrador.length > 0 && (
              <button className={`${BOTON} text-gypi-red`} aria-label={`Quitar ${d.nombre}`} onClick={() => setBorrador(borrador.filter((x) => x.cod !== d.cod))}>✕</button>
            )}
          </li>
        ))}
      </ul>

      {borrador.length === 0 && (
        <button onClick={() => setBorrador(defectosFabricaPara(etapas))} className="g-btn g-btn-secondary w-full mb-3.5">
          Usar los códigos de fábrica ({DEFECTOS_FABRICA.map((d) => d.cod).join(", ")})
        </button>
      )}

      <div className="g-label mb-1.5">Agregar defecto</div>
      <div className="flex gap-2 mb-2">
        <input className="g-input w-[84px] font-mono uppercase" value={cod} maxLength={4} aria-label="Código del defecto"
          onChange={(e) => setCod(e.target.value)} placeholder="K1" />
        <input className="g-input flex-1 min-w-0" value={nombre} maxLength={60} aria-label="Nombre del defecto"
          onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder="Ej: Canto despegado" />
      </div>
      <div className="flex gap-2 mb-3.5">
        <select className="g-input flex-1 min-w-0 cursor-pointer" value={origen} onChange={(e) => setOrigen(e.target.value)} aria-label="Etapa de origen habitual">
          <option value="">Origen: cualquiera</option>
          {productivas.map((e) => <option key={e.codigo} value={e.codigo}>Origen: {e.nombre}</option>)}
        </select>
        <button onClick={agregar} disabled={!codValido || !nombre.trim() || borrador.length >= MAX_DEFECTOS} className="g-btn g-btn-secondary">Agregar</button>
      </div>
      {cod.trim() !== "" && !codValido && (
        <div className="text-[11px] text-gypi-red -mt-2.5 mb-3">El código va con hasta 4 letras o números, sin repetir.</div>
      )}

      <div className="flex gap-2.5">
        <button onClick={() => guardar(borrador)} disabled={guardando || !cambiado} className="g-btn g-btn-primary flex-1">
          {guardando ? "Guardando…" : "Guardar defectos"}
        </button>
        {propios.length > 0 && (
          <button onClick={() => guardar([])} disabled={guardando} className="g-btn g-btn-secondary">Volver a los generales</button>
        )}
      </div>
    </div>
  );
}
