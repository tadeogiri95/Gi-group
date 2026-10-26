"use client";
// app/components/PlanificacionScreen.jsx — Proyectos → 🗓 Planificación
// (parte 38; diseño en notes/diseno-planificacion-produccion.md). Solo
// gerencia. Tres vistas: la carga de las OT elegidas contra la capacidad de
// la planta (parte 39), la prioridad de las OT de Muebles (se ordena
// arrastrando; migración 137) y los parámetros de la planta (tiempos,
// eficiencia, relaciones y máquinas; config_sistema clave "planificacion").
// "Ordenar automáticamente" (parte 40) reparte las OT elegidas día por día y
// las muestra en un Gantt de planificación.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb, sbGetAll } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { textoObjetivo, CLAVE_FECHA_OBJETIVO, normalizarModo } from "../lib/semanaObjetivo";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { leerAvanceYHoras } from "../lib/otEnCursoDatos";
import {
  periodo, diasDelPeriodo, operariosDePlanta, capacidadPlanta, horasOt, cargaPeriodo,
  preseleccion, modulosPorOt, fmtH,
} from "../lib/cargaPlanta";
import { planAutomatico, pendientesPorOt } from "../lib/planAutomatico";
import GanttPlan from "./GanttPlan";
import { materialOt } from "../lib/ot";
import {
  CLAVE_PLANIFICACION, ETAPAS_PLAN, PARAMETROS, GRUPOS_PARAMETROS,
  leerNumero, errorParametro, normalizarParametros, divisionPlan, etapasPlanDe,
  otsPlanificables, ordenarPorPrioridad, moverOt, quitarPrioridad, cambiosPrioridad, parametrosFaltantes,
} from "../lib/planificacion";
import { Chip } from "./ui";

const VISTAS = [
  { id: "carga", label: "📊 Carga" },
  { id: "prioridad", label: "📌 Prioridad" },
  { id: "parametros", label: "⚙ Parámetros" },
];

const conComa = (n) => (n == null ? "" : String(n).replace(".", ","));

function Cargando() {
  return <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;
}

export default function PlanificacionScreen({ empresaId }) {
  const { divisiones = [], etapas = [] } = useAuth();
  const [vista, setVista] = useState("carga");
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
        : vista === "carga" ? <CargaPlan empresaId={empresaId} divisiones={divisiones} division={division} params={cfg} onParametros={() => setVista("parametros")} />
        : vista === "prioridad" ? <PrioridadOt empresaId={empresaId} divisiones={divisiones} division={division} />
          : <ParametrosPlan cfg={cfg} divisiones={divisiones} etapas={etapas} onGuardado={setCfg} />}
    </div>
  );
}

// ─── Carga ──────────────────────────────────────────────────────────────────

const TIPOS = [
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
];

function textoPeriodo(p) {
  if (p.tipo === "mes") {
    const [a, m] = p.desde.split("-").map(Number);
    const nombre = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });
    return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${a}`;
  }
  return `Semana del ${fechaCorta(p.desde)} al ${fechaCorta(p.hasta)}`;
}

function CargaPlan({ empresaId, divisiones, division, params, onParametros }) {
  const [tipo, setTipo] = useState("semana");
  const [paso, setPaso] = useState(0);
  const [modo, setModo] = useState("semana_domingo");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [elegidas, setElegidas] = useState(null);
  const [ordenado, setOrdenado] = useState(false);

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    (async () => {
      try {
        const [proy, emp, av, pz, cfgModo] = await Promise.all([
          sbGetAll(`proyectos?empresa_id=eq.${empresaId}&estado=neq.cerrado&order=id.asc`, { maxFilas: 20000 }),
          // Sin la migración 116 no hay es_instalador: se leen todos los operarios
          sbGetAll(`empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=id,nombre,rol,division,diagrama,activo,es_instalador`)
            .catch(() => sbGetAll(`empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=id,nombre,rol,division,diagrama,activo`)),
          leerAvanceYHoras(empresaId).catch(() => ({ avance: [], piezas: [] })),
          sbGetAll(`piezas_ot?empresa_id=eq.${empresaId}&modulo=not.is.null&select=ot,modulo`, { maxFilas: 50000 }).catch(() => ({ data: [] })),
          sb.get(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}&select=valor&limit=1`).catch(() => null),
        ]);
        if (!vivo) return;
        // Igual que el Gantt: la semana arranca el domingo, salvo que la empresa cuente de lunes
        setModo(normalizarModo(cfgModo?.[0]?.valor?.modo) === "semana_domingo" ? "semana_domingo" : "semana_lunes");
        setDatos({ proyectos: proy.data || [], empleados: emp.data || [], avance: av.avance || [], piezas: av.piezas || [], modulos: modulosPorOt(pz.data) });
      } catch (e) {
        if (vivo) setError(e.message || "No se pudieron leer los datos.");
      }
    })();
    return () => { vivo = false; };
  }, [empresaId]);

  const per = useMemo(() => periodo(tipo, hoyArg(), paso, modo), [tipo, paso, modo]);
  const ots = useMemo(() => ordenarPorPrioridad(otsPlanificables(datos?.proyectos || [], divisiones, division)), [datos, divisiones, division]);
  // Al cambiar de período vuelven a venir tildadas las OT de ese período
  useEffect(() => { if (datos) setElegidas(preseleccion(ots, per.hasta)); }, [datos, ots, per.hasta]);

  const horas = useMemo(() => new Map(ots.map((p) => [p.id, horasOt(p, params, {
    modulosEtiquetas: datos?.modulos.get(String(p.ot)) || null, avance: datos?.avance, piezas: datos?.piezas,
  })])), [ots, params, datos]);
  const operarios = useMemo(() => operariosDePlanta(datos?.empleados, divisiones, division), [datos, divisiones, division]);
  const capacidad = useMemo(() => capacidadPlanta(operarios, diasDelPeriodo(per.desde, per.hasta)), [operarios, per]);
  const carga = useMemo(() => cargaPeriodo({
    ots: ots.filter((p) => elegidas?.has(p.id)).map((p) => horas.get(p.id)), params, capacidad,
  }), [ots, elegidas, horas, params, capacidad]);
  // Plan día por día de las OT elegidas, en el orden de prioridad
  const plan = useMemo(() => (ordenado ? planAutomatico({
    trabajos: ots.filter((p) => elegidas?.has(p.id)).map((p) => ({ ...horas.get(p.id), id: p.id })), capacidad, params,
  }) : null), [ordenado, ots, elegidas, horas, capacidad, params]);

  if (error) return <div role="alert" className="text-sm text-gypi-red">{error}</div>;
  if (!datos || !elegidas) return <Cargando />;

  const faltan = parametrosFaltantes(params);
  const tildar = (id) => setElegidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sinDatos = carga.ots.filter((o) => o.sinDatos).length;

  return (
    <section aria-label="Carga de la planta">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {TIPOS.map((t) => <Chip key={t.id} active={tipo === t.id} onClick={() => { setTipo(t.id); setPaso(0); }}>{t.label}</Chip>)}
      </div>
      <div className="flex items-center gap-2 mb-3">
        <button type="button" aria-label="Período anterior" onClick={() => setPaso(paso - 1)} className="min-w-[44px] min-h-[44px] bg-gypi-surface border border-gypi-border rounded-xl cursor-pointer text-gypi-text">◀</button>
        <div className="flex-1 text-center font-heading font-bold">{textoPeriodo(per)}</div>
        <button type="button" aria-label="Período siguiente" onClick={() => setPaso(paso + 1)} className="min-w-[44px] min-h-[44px] bg-gypi-surface border border-gypi-border rounded-xl cursor-pointer text-gypi-text">▶</button>
      </div>

      {faltan.length > 0 && (
        <div role="alert" className="g-card mb-3 text-[13px]">
          <div className="text-gypi-red font-bold mb-1">Faltan parámetros</div>
          <div className="text-gypi-dim mb-2">Sin estos datos las horas salen en cero: {faltan.join(", ")}.</div>
          <button type="button" onClick={onParametros} className="g-btn g-btn-secondary">Cargar parámetros</button>
        </div>
      )}

      <div className="g-card mb-3" aria-label="Resultado">
        <div className={`font-heading text-lg font-bold mb-1 ${carga.viable ? "text-gypi-green" : "text-gypi-red"}`}>
          {!carga.ots.length ? "Elegí las OT que querés planificar" : carga.viable ? "✅ Entra en el período" : "❌ No entra con el horario normal"}
        </div>
        <div className="text-[13px] text-gypi-dim mb-2">
          {carga.ots.length === 1 ? "1 OT elegida" : `${carga.ots.length} OT elegidas`} · {capacidad.personas === 1 ? "1 operario" : `${capacidad.personas} operarios`} de {division?.label || "la planta"} · eficiencia {params.eficiencia ?? "—"} %
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <Dato label="Horas que hacen falta" valor={fmtH(carga.necesarias)} />
          <Dato label="Horas de la planta" valor={fmtH(carga.disponibles)} />
        </div>
        {carga.extra > 0 && <div className="text-[14px] font-bold text-gypi-red mb-1">⏱ Horas extra: {fmtH(carga.extra)}</div>}
        {carga.cuello && carga.ots.length > 0 && (
          <div className="text-[13px] mb-1">
            🔻 Cuello de botella: <b>{carga.cuello.nombre}</b> ({Number.isFinite(carga.cuello.uso) ? `${Math.round(carga.cuello.uso * 100)} % ocupado` : "sin horas disponibles"})
          </div>
        )}
        {carga.maquinas.filter((m) => m.extra > 0).map((m) => (
          <div key={m.id} className="text-[13px] text-gypi-red">🏭 {m.nombre}: faltan {fmtH(m.extra)} de máquina. Desfasá turnos o hacé horas extra.</div>
        ))}
        {sinDatos > 0 && <div className="text-xs text-gypi-dim mt-1">{sinDatos === 1 ? "1 OT elegida no tiene" : `${sinDatos} OT elegidas no tienen`} placas ni cantos en la planilla: no suman horas.</div>}
      </div>

      <div className="g-card mb-3" aria-label="Horas por etapa">
        <div className="g-label mb-2">Horas por etapa</div>
        <table className="w-full text-[13px]">
          <thead><tr className="text-gypi-dim text-left"><th className="font-normal">Etapa</th><th className="font-normal text-right">Gente</th><th className="font-normal text-right">Máquina</th><th className="font-normal text-right">Tiene</th></tr></thead>
          <tbody>
            {Object.values(carga.porEtapa).map((e) => {
              const m = carga.maquinas.find((x) => x.id === e.id);
              return (
                <tr key={e.id} className="border-t border-gypi-border">
                  <td className="py-1.5">{e.nombre}</td>
                  <td className="text-right">{fmtH(e.gente)}</td>
                  <td className="text-right">{m ? fmtH(e.maquina) : "—"}</td>
                  <td className={`text-right ${m?.extra > 0 ? "text-gypi-red font-bold" : ""}`}>{m ? `${fmtH(m.disponibles)}${m.cantidad > 1 ? ` (${m.cantidad})` : ""}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="text-xs text-gypi-dim mt-2">Horas de reloj, con la eficiencia ya aplicada. &quot;Tiene&quot; = horas en que la planta está abierta × cantidad de máquinas.</div>
      </div>

      <div className="g-card mb-3" aria-label="Plan automático">
        <div className="flex items-center gap-2 mb-2">
          <div className="g-label flex-1">⚡ Plan día por día</div>
          {ordenado && <button type="button" onClick={() => setOrdenado(false)} className="g-btn g-btn-secondary">Ocultar</button>}
        </div>
        {!ordenado ? (
          <>
            <div className="text-[13px] text-gypi-dim mb-2">Gypi reparte las OT elegidas en los días del período, en el orden de prioridad, respetando Corte → Canteado → Mecanizado → Armado y las máquinas. Si no entra, propone días de horas extra.</div>
            <button type="button" onClick={() => setOrdenado(true)} disabled={!carga.ots.length} className="g-btn g-btn-primary w-full">Ordenar automáticamente</button>
          </>
        ) : (
          <PlanDelPeriodo plan={plan} ots={ots} />
        )}
      </div>

      <div className="g-label mb-1.5">OT del período ({ots.length})</div>
      <div className="text-xs text-gypi-dim mb-2">Vienen tildadas las que tienen semana hasta el fin del período (también las atrasadas). Destildá o sumá las que quieras.</div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="OT para planificar">
        {ots.map((p) => {
          const h = horas.get(p.id);
          return (
            <li key={p.id} className="bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="mt-1 w-5 h-5" checked={elegidas.has(p.id)} onChange={() => tildar(p.id)} aria-label={`Planificar OT ${p.ot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold truncate">{p.prioridad ? `${p.prioridad}. ` : ""}{p.ot} · {p.cliente || p.proyecto || "—"}</div>
                  <div className="text-xs text-gypi-dim truncate">
                    {[textoObjetivo(p) || "sin semana", h.sinDatos ? "sin datos de la planilla" : `${(Math.round(h.placas * 10) / 10).toLocaleString("es-AR")} placas · ${Math.round(h.gabinetes * 10) / 10} gab.`].join(" · ")}
                  </div>
                </div>
                <div className="text-[13px] font-bold whitespace-nowrap">{fmtH(h.total / ((params.eficiencia || 100) / 100))}</div>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlanDelPeriodo({ plan, ots }) {
  const pasan = pendientesPorOt(plan.pendientes);
  const horasExtra = plan.diasExtra.reduce((t, d) => t + d.horas, 0);
  const fin = (id) => plan.finPorOt.get(id);
  return (
    <>
      {plan.diasExtra.length > 0 ? (
        <div className="mb-2 text-[13px]">
          <div className="font-bold text-gypi-red mb-1">⏱ Horas extra propuestas: {fmtH(horasExtra)}</div>
          <ul className="list-none m-0 p-0">
            {plan.diasExtra.map((d) => (
              <li key={d.fecha}>{new Date(`${d.fecha}T00:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" })} {fechaCorta(d.fecha)}: {fmtH(d.horas)}</li>
            ))}
          </ul>
        </div>
      ) : !pasan.length && <div className="mb-2 text-[13px] font-bold text-gypi-green">✅ Entra todo en los días de trabajo, sin horas extra.</div>}
      {pasan.length > 0 && (
        <div className="mb-2 text-[13px]" aria-label="Pasa al período siguiente">
          <div className="font-bold mb-1">➡ Pasa al período siguiente</div>
          <ul className="list-none m-0 p-0">
            {pasan.map((o) => <li key={o.id}>{o.ot}: {fmtH(o.horas)}</li>)}
          </ul>
          <div className="text-xs text-gypi-dim mt-1">Ni con sábados y domingos entra todo: estas OT se parten y siguen en el período siguiente.</div>
        </div>
      )}
      <GanttPlan plan={plan} ots={ots} hoy={hoyArg()} />
      <ul className="list-none m-0 p-0 mt-2 text-xs text-gypi-dim">
        {ots.filter((p) => fin(p.id)).map((p) => (
          pasan.some((o) => o.id === p.id)
            ? <li key={p.id}>{p.ot} avanza hasta el {fechaCorta(fin(p.id))} y sigue en el período siguiente</li>
            : <li key={p.id}>{p.ot} termina el {fechaCorta(fin(p.id))}{p.fecha_objetivo && fin(p.id) > p.fecha_objetivo ? ` · después de su semana (${fechaCorta(p.fecha_objetivo)})` : ""}</li>
        ))}
      </ul>
    </>
  );
}

function Dato({ label, valor }) {
  return (
    <div className="bg-gypi-surf-hi rounded-xl p-2.5">
      <div className="text-xs text-gypi-dim">{label}</div>
      <div className="text-base font-bold">{valor}</div>
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
