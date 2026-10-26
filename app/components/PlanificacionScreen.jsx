"use client";
// app/components/PlanificacionScreen.jsx — Proyectos → 🗓 Planificación
// (parte 38; diseño en notes/diseno-planificacion-produccion.md). Solo
// gerencia. Dos vistas: la prioridad de las OT de Muebles (se ordena
// arrastrando; migración 137) y los parámetros de la planta (tiempos,
// eficiencia, relaciones y máquinas; config_sistema clave "planificacion").
// La carga contra la capacidad y el Gantt vienen en las partes 39 y 40.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb, sbGetAll } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { textoObjetivo } from "../lib/semanaObjetivo";
import { materialOt } from "../lib/ot";
import {
  CLAVE_PLANIFICACION, ETAPAS_PLAN, PARAMETROS, GRUPOS_PARAMETROS,
  leerNumero, errorParametro, normalizarParametros, divisionPlan, etapasPlanDe,
  otsPlanificables, ordenarPorPrioridad, moverOt, quitarPrioridad, cambiosPrioridad,
} from "../lib/planificacion";
import { Chip } from "./ui";

const VISTAS = [
  { id: "prioridad", label: "📌 Prioridad" },
  { id: "parametros", label: "⚙ Parámetros" },
];

const conComa = (n) => (n == null ? "" : String(n).replace(".", ","));

function Cargando() {
  return <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;
}

export default function PlanificacionScreen({ empresaId }) {
  const { divisiones = [], etapas = [] } = useAuth();
  const [vista, setVista] = useState("prioridad");
  const [cfg, setCfg] = useState(undefined);

  const cargarCfg = useCallback(async () => {
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`);
      setCfg(normalizarParametros(rows?.[0]?.valor));
    } catch {
      setCfg(normalizarParametros(null));
    }
  }, []);
  useEffect(() => { cargarCfg(); }, [cargarCfg]);

  const division = divisionPlan(divisiones, cfg?.division_id);

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-24">
      <div className="flex gap-2 mb-3 flex-wrap" role="group" aria-label="Vista de la planificación">
        {VISTAS.map((v) => <Chip key={v.id} active={vista === v.id} onClick={() => setVista(v.id)}>{v.label}</Chip>)}
      </div>
      {cfg === undefined ? <Cargando />
        : vista === "prioridad" ? <PrioridadOt empresaId={empresaId} divisiones={divisiones} division={division} />
          : <ParametrosPlan cfg={cfg} divisiones={divisiones} etapas={etapas} onGuardado={setCfg} />}
    </div>
  );
}

// ─── Prioridad ──────────────────────────────────────────────────────────────

function PrioridadOt({ empresaId, divisiones, division }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [arrastre, setArrastre] = useState(null);
  const guardando = useRef(false);

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    sbGetAll(`proyectos?empresa_id=eq.${empresaId}&estado=neq.cerrado&order=id.asc`, { maxFilas: 20000 })
      .then(({ data }) => { if (vivo) setLista(data || []); })
      .catch((e) => { if (vivo) setError(e.message || "No se pudieron leer las OT."); });
    return () => { vivo = false; };
  }, [empresaId]);

  const ots = useMemo(() => ordenarPorPrioridad(otsPlanificables(lista || [], divisiones, division)), [lista, divisiones, division]);
  const faltaMigracion = !!lista?.length && !lista.some((p) => "prioridad" in p);

  const aplicar = async (nueva) => {
    if (guardando.current) return;
    const cambios = cambiosPrioridad(ots, nueva);
    if (!cambios.length) return;
    const anterior = lista;
    const porId = new Map(cambios.map((c) => [c.id, c.prioridad]));
    setLista((l) => l.map((p) => (porId.has(p.id) ? { ...p, prioridad: porId.get(p.id) } : p)));
    guardando.current = true;
    setAviso(null);
    try {
      await Promise.all(cambios.map((c) => sb.patch(`proyectos?id=eq.${c.id}`, { prioridad: c.prioridad })));
      setAviso("✅ Prioridad guardada");
    } catch (e) {
      setLista(anterior);
      setAviso(`No se pudo guardar: ${e.message}`);
    } finally {
      guardando.current = false;
    }
  };

  // Arrastrar con el dedo o el mouse desde la manija ⠿
  const empezar = (e, i) => {
    if (faltaMigracion) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setArrastre({ desde: i, sobre: i });
  };
  const mover = (e) => {
    if (!arrastre || typeof document === "undefined" || !document.elementFromPoint) return;
    const fila = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-fila]");
    const i = fila ? Number(fila.getAttribute("data-fila")) : null;
    if (i != null && i !== arrastre.sobre) setArrastre({ ...arrastre, sobre: i });
  };
  const soltar = () => {
    if (!arrastre) return;
    const { desde, sobre } = arrastre;
    setArrastre(null);
    if (desde !== sobre) aplicar(moverOt(ots, desde, sobre));
  };

  if (error) return <div role="alert" className="text-sm text-gypi-red">{error}</div>;
  if (!lista) return <Cargando />;

  const conNumero = ots.filter((p) => p.prioridad > 0).length;
  return (
    <section aria-label="Prioridad de las OT">
      <div className="text-[13px] text-gypi-dim mb-3 leading-normal">
        Arrastrá las OT desde ⠿ para ordenarlas: la de arriba es la más urgente. Las que no ordenes van después, por semana de entrega.
        {division ? ` Son las OT abiertas de ${division.label}.` : ""}
      </div>
      {faltaMigracion && <div role="alert" className="text-[13px] text-gypi-red mb-3">Para ordenar las OT falta correr la migración 137 en Supabase.</div>}
      {aviso && <div role="status" className="text-[13px] text-gypi-dim mb-2">{aviso}</div>}
      {!ots.length ? (
        <div className="text-sm text-gypi-dim py-6 text-center">No hay OT abiertas para planificar.</div>
      ) : (
        <ol className="list-none m-0 p-0 flex flex-col gap-1.5">
          {ots.map((p, i) => {
            const destino = arrastre && arrastre.sobre === i && arrastre.desde !== i;
            const material = materialOt(p).map((m) => `${m.label} ${m.valor}`).join(" · ");
            return (
              <li key={p.id} data-fila={i} aria-label={`OT ${p.ot}`}
                className={`flex items-center gap-2 bg-gypi-surface rounded-xl p-2.5 border ${destino ? "border-gypi-amber" : "border-gypi-border"} ${arrastre?.desde === i ? "opacity-60" : ""}`}>
                <button type="button" aria-label={`Arrastrar OT ${p.ot}`} disabled={faltaMigracion}
                  onPointerDown={(e) => empezar(e, i)} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => setArrastre(null)}
                  className="touch-none select-none min-w-[36px] min-h-[44px] bg-transparent border-none text-xl text-gypi-dim cursor-grab">⠿</button>
                <span className={`min-w-[28px] text-center text-[13px] font-bold ${p.prioridad ? "text-gypi-amber-ink" : "text-gypi-dim"}`}>{p.prioridad || "—"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold truncate">{p.ot} · {p.cliente || p.proyecto || "—"}</div>
                  <div className="text-xs text-gypi-dim truncate">{[p.obra, textoObjetivo(p) || "sin semana", material].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex flex-col">
                  <button type="button" aria-label={`Subir OT ${p.ot}`} disabled={faltaMigracion || i === 0} onClick={() => aplicar(moverOt(ots, i, i - 1))}
                    className="min-w-[36px] min-h-[22px] bg-transparent border-none text-gypi-dim cursor-pointer disabled:opacity-30">▲</button>
                  <button type="button" aria-label={`Bajar OT ${p.ot}`} disabled={faltaMigracion || i === ots.length - 1} onClick={() => aplicar(moverOt(ots, i, i + 1))}
                    className="min-w-[36px] min-h-[22px] bg-transparent border-none text-gypi-dim cursor-pointer disabled:opacity-30">▼</button>
                </div>
                {p.prioridad > 0 && (
                  <button type="button" aria-label={`Quitar prioridad de la OT ${p.ot}`} onClick={() => aplicar(quitarPrioridad(ots, p.id))}
                    className="min-w-[36px] min-h-[44px] bg-transparent border-none text-gypi-dim cursor-pointer">✕</button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {conNumero > 0 && <div className="text-xs text-gypi-dim mt-2">{conNumero === 1 ? "1 OT ordenada a mano" : `${conNumero} OT ordenadas a mano`}.</div>}
    </section>
  );
}

// ─── Parámetros ─────────────────────────────────────────────────────────────

function ParametrosPlan({ cfg, divisiones, etapas, onGuardado }) {
  const [textos, setTextos] = useState(() => Object.fromEntries(PARAMETROS.map((p) => [p.id, conComa(cfg[p.id])])));
  const [divisionId, setDivisionId] = useState(cfg.division_id || divisionPlan(divisiones, null)?.id || "");
  const division = divisionPlan(divisiones, divisionId);
  const [elegidas, setElegidas] = useState(() => etapasPlanDe(etapas, division, cfg.etapas));
  const [estado, setEstado] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const valores = Object.fromEntries(PARAMETROS.map((p) => [p.id, leerNumero(textos[p.id])]));
  const errores = Object.fromEntries(PARAMETROS.map((p) => [p.id,
    textos[p.id].trim() && valores[p.id] == null ? "Escribí solo el número" : errorParametro(p, valores[p.id])]));
  const hayError = Object.values(errores).some(Boolean);
  const productivas = (etapas || []).filter((e) => e.codigo > 0);

  const guardar = async () => {
    if (hayError) return;
    setGuardando(true);
    setEstado(null);
    const valor = { ...valores, division_id: division?.id || null, etapas: elegidas };
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}&select=clave&limit=1`);
      if (rows?.length) await sb.patch(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}`, { valor });
      else await sb.post("config_sistema", { clave: CLAVE_PLANIFICACION, valor });
      onGuardado(normalizarParametros(valor));
      setEstado("✅ Parámetros guardados");
    } catch (e) {
      setEstado(`No se pudo guardar: ${e.message}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section aria-label="Parámetros de la planificación">
      <div className="text-[13px] text-gypi-dim mb-3 leading-normal">
        Con estos datos Gypi calcula cuántas horas lleva cada OT y cuántas horas tiene la planta por semana.
      </div>

      <div className="g-card mb-3.5">
        <div className="g-label mb-2">🪵 División y etapas</div>
        <label htmlFor="plan-division" className="text-xs text-gypi-dim block mb-1">División que se planifica</label>
        <select id="plan-division" className="g-input w-full mb-3" value={division?.id || ""} onChange={(e) => setDivisionId(e.target.value)}>
          <option value="">Elegí la división</option>
          {(divisiones || []).filter((d) => d.id).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        {ETAPAS_PLAN.map((ep) => (
          <div key={ep.id} className="mb-2">
            <label htmlFor={`plan-etapa-${ep.id}`} className="text-xs text-gypi-dim block mb-1">{ep.nombre} es la etapa…</label>
            <select id={`plan-etapa-${ep.id}`} className="g-input w-full" value={elegidas[ep.id] ?? ""}
              onChange={(e) => setElegidas({ ...elegidas, [ep.id]: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Ninguna</option>
              {productivas.map((e) => <option key={e.codigo} value={e.codigo}>{e.icon ? `${e.icon} ` : ""}{e.nombre}</option>)}
            </select>
          </div>
        ))}
      </div>

      {GRUPOS_PARAMETROS.map((g) => (
        <div key={g.id} className="g-card mb-3.5">
          <div className="g-label mb-2">{g.titulo}</div>
          {PARAMETROS.filter((p) => p.grupo === g.id).map((p) => (
            <div key={p.id} className="mb-3">
              <label htmlFor={`plan-${p.id}`} className="text-[13px] font-bold block mb-1">{p.label} <span className="font-normal text-gypi-dim">({p.unidad})</span></label>
              <input id={`plan-${p.id}`} className="g-input w-full" inputMode="decimal" value={textos[p.id]}
                onChange={(e) => setTextos({ ...textos, [p.id]: e.target.value })} placeholder="Sin cargar" />
              {errores[p.id] ? <div className="text-xs text-gypi-red mt-1">{errores[p.id]}</div>
                : p.ayuda && <div className="text-xs text-gypi-dim mt-1">{p.ayuda}</div>}
            </div>
          ))}
        </div>
      ))}

      {estado && <div role="status" className="text-[13px] text-gypi-dim mb-2">{estado}</div>}
      <button type="button" onClick={guardar} disabled={guardando || hayError} className="g-btn g-btn-primary w-full">
        {guardando ? "Guardando…" : "Guardar parámetros"}
      </button>
    </section>
  );
}
