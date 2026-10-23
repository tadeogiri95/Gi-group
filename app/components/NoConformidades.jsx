'use client';
// app/components/NoConformidades.jsx — Piezas no conformes de todas las OT
// (Órdenes de Producción, parte 6; ítem 39). El encargado decide qué se hace
// con cada una (reprocesar, rehacer, usar igual o descartar) y anota los
// minutos de retrabajo. Arriba, los defectos que más se repiten: es la
// revisión mensual del mapa de procesos.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { DECISIONES, defectosDe, nombreDefecto } from "../lib/calidad";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";

const DIAS = 90;

/** Defectos más repetidos: [{ cod, nombre, piezas }] de mayor a menor. */
export function defectosRepetidos(filas, defectos) {
  const m = new Map();
  for (const f of filas) m.set(f.defecto, (m.get(f.defecto) || 0) + (Number(f.cantidad) || 1));
  return [...m.entries()]
    .map(([cod, piezas]) => ({ cod, nombre: nombreDefecto(defectos, cod), piezas }))
    .sort((a, b) => b.piezas - a.piezas || a.cod.localeCompare(b.cod));
}

function Tarjeta({ nc, etapas, defectos, proyecto, onGuardar, onBorrar, guardando }) {
  const [minutos, setMinutos] = useState(nc.minutos_retrabajo != null ? String(nc.minutos_retrabajo) : "");
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const nombreEtapa = (c) => etapas.find((e) => e.codigo === c)?.nombre;
  const min = minutos.trim() === "" ? null : Number(minutos);
  const minValido = min === null || (Number.isInteger(min) && min >= 0 && min <= 99999);
  const detalle = [
    nc.etapa_detecta && nombreEtapa(nc.etapa_detecta) && `Detectada en ${nombreEtapa(nc.etapa_detecta)}`,
    nc.etapa_origen && nombreEtapa(nc.etapa_origen) && `origen ${nombreEtapa(nc.etapa_origen)}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] font-bold text-gypi-red">{nc.defecto}</span>
        <span className="flex-1 min-w-0 text-[13px] font-bold truncate">{nombreDefecto(defectos, nc.defecto)}</span>
        <span className="text-xs text-gypi-dim">{fechaCorta(String(nc.created_at).slice(0, 10))}</span>
      </div>
      <div className="text-[12px] text-gypi-dim mt-0.5">
        OT {nc.ot}{proyecto?.cliente ? ` · ${proyecto.cliente}` : ""} · {nc.cantidad > 1 ? `${nc.cantidad} piezas` : "1 pieza"}{nc.pieza ? ` · ${nc.pieza}` : ""}
      </div>
      {detalle && <div className="text-[12px] text-gypi-dim">{detalle}</div>}
      {nc.nota && <div className="text-[12px] mt-1">{nc.nota}</div>}

      <div className="flex flex-wrap gap-1.5 mt-2.5" role="group" aria-label={`Decisión sobre ${nc.defecto} de la OT ${nc.ot}`}>
        {DECISIONES.map((d) => (
          <button key={d.cod} aria-pressed={nc.decision === d.cod} title={d.ayuda} disabled={guardando || !minValido}
            onClick={() => onGuardar(nc, { decision: nc.decision === d.cod ? null : d.cod, minutos_retrabajo: min })}
            className={`min-h-[44px] px-2.5 rounded-lg border text-[12px] font-bold cursor-pointer ${nc.decision === d.cod ? "bg-gypi-green/15 border-gypi-green text-gypi-green" : "bg-transparent border-gypi-border text-gypi-text"}`}>
            {d.icon} {d.nombre}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-[12px] text-gypi-dim" htmlFor={`nc-min-${nc.id}`}>Minutos de retrabajo</label>
        <input id={`nc-min-${nc.id}`} className="g-input w-[90px] !py-1.5" inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} />
        {nc.decision && min !== nc.minutos_retrabajo && minValido && (
          <button onClick={() => onGuardar(nc, { decision: nc.decision, minutos_retrabajo: min })} disabled={guardando} className="g-btn g-btn-secondary !py-1.5 text-xs">Guardar</button>
        )}
        <span className="flex-1" />
        {confirmarBorrar ? (
          <button onClick={() => onBorrar(nc)} disabled={guardando} className="min-h-[44px] px-3 rounded-lg border border-gypi-red bg-gypi-red/10 text-gypi-red text-xs font-bold cursor-pointer">Sí, borrar</button>
        ) : (
          <button onClick={() => setConfirmarBorrar(true)} disabled={guardando} aria-label={`Borrar ${nc.defecto} de la OT ${nc.ot}`}
            className="min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-transparent text-gypi-red text-sm cursor-pointer">🗑</button>
        )}
      </div>
      {!minValido && <div className="text-xs text-gypi-red mt-1">Los minutos van en número entero.</div>}
    </div>
  );
}

export default function NoConformidades({ empresaId, proyectos = [], etapas = [], defectos = [] }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [soloSinDecidir, setSoloSinDecidir] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    setCargando(true);
    const desde = hoyArg(new Date(Date.now() - DIAS * 86400000));
    const r = await sbGetAll(`no_conformidades?empresa_id=eq.${empresaId}&created_at=gte.${desde}&order=created_at.desc&select=*`, { maxFilas: 5000 }).catch(() => null);
    setAviso(r ? null : "No se pudieron leer las no conformidades (¿falta correr la migración 101?).");
    setFilas(r?.data || []);
    setCargando(false);
  }, [empresaId]);

  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect

  const porOt = useMemo(() => new Map(proyectos.map((p) => [String(p.ot), p])), [proyectos]);
  const sinDecidir = filas.filter((f) => !f.decision);
  const visibles = soloSinDecidir ? sinDecidir : filas;
  const repetidos = defectosRepetidos(filas, defectosDe(defectos)).slice(0, 5);
  const minutos = filas.reduce((s, f) => s + (Number(f.minutos_retrabajo) || 0), 0);

  const enviar = async (body) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/no-conformidades", { method: "POST", body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar");
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setGuardando(false);
    }
  };

  const guardar = async (nc, { decision, minutos_retrabajo }) => {
    const data = await enviar({ accion: "decidir", id: nc.id, decision, minutos_retrabajo });
    if (!data) return;
    setFilas((prev) => prev.map((f) => (f.id === nc.id ? { ...f, decision, minutos_retrabajo, ...(data.no_conformidad || {}) } : f)));
  };

  const borrar = async (nc) => {
    if (!(await enviar({ accion: "borrar", id: nc.id }))) return;
    setFilas((prev) => prev.filter((f) => f.id !== nc.id));
  };

  if (cargando) return <div className="gypi-dots py-6"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;

  return (
    <div>
      {aviso && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{aviso}</div>}
      <div className="text-[12px] text-gypi-dim mb-2">
        Últimos {DIAS} días: {filas.length === 1 ? "1 registro" : `${filas.length} registros`} · {sinDecidir.length} sin decidir{minutos ? ` · ${minutos} min de retrabajo` : ""}
      </div>
      {repetidos.length > 0 && (
        <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border mb-2.5">
          <div className="g-label mb-1">Los que más se repiten</div>
          {repetidos.map((r) => (
            <div key={r.cod} className="flex gap-2 text-[12px]">
              <span className="w-10 font-mono font-bold text-gypi-red">{r.cod}</span>
              <span className="flex-1 truncate">{r.nombre}</span>
              <span className="font-bold">{r.piezas}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5 mb-2.5">
        <button onClick={() => setSoloSinDecidir(true)} aria-pressed={soloSinDecidir}
          className={`min-h-[44px] px-3 rounded-full text-xs font-bold cursor-pointer border ${soloSinDecidir ? "bg-gypi-amber text-gypi-on-amber border-gypi-amber" : "bg-gypi-surface text-gypi-dim border-gypi-border"}`}>Sin decidir</button>
        <button onClick={() => setSoloSinDecidir(false)} aria-pressed={!soloSinDecidir}
          className={`min-h-[44px] px-3 rounded-full text-xs font-bold cursor-pointer border ${!soloSinDecidir ? "bg-gypi-amber text-gypi-on-amber border-gypi-amber" : "bg-gypi-surface text-gypi-dim border-gypi-border"}`}>Todas</button>
      </div>
      {error && <div role="alert" className="text-[12px] text-gypi-red mb-2">{error}</div>}
      {visibles.length === 0 ? (
        <div className="text-sm text-gypi-dim py-4">{soloSinDecidir ? "No hay piezas esperando decisión." : "No hay no conformidades en estos días."}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {visibles.map((nc) => (
            <Tarjeta key={`${nc.id}-${nc.decision}`} nc={nc} etapas={etapas} defectos={defectos} proyecto={porOt.get(String(nc.ot))}
              onGuardar={guardar} onBorrar={borrar} guardando={guardando} />
          ))}
        </div>
      )}
    </div>
  );
}
