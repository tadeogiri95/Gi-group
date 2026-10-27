"use client";
// app/components/PlanificacionScreen.jsx — Proyectos → 🗓 Planificación
// (parte 38; diseño en notes/diseno-planificacion-produccion.md). Solo
// gerencia. Tres vistas: la carga de las OT elegidas contra la capacidad de
// la planta (parte 39), la prioridad de las OT de Muebles (se ordena
// arrastrando; migración 137) y los parámetros de la planta (tiempos,
// eficiencia, relaciones y máquinas; config_sistema clave "planificacion").
// "Ver el plan de las OT tildadas" (parte 40) reparte las OT tildadas día por día y
// las muestra en un Gantt de planificación. Ese plan se guarda como borrador
// o se confirma (parte 41, migración 138): confirmado, la planta lo ve en
// 📅 Plan de la semana.
// Desde el 27/10 el plan no tiene límite de semanas (migración 143): va desde
// hoy hasta que terminan las OT tildadas, según las fechas objetivo (SEMANA,
// con horas extra) o según la capacidad de la planta (fechas estimadas). La
// semana o el mes elegidos solo cambian qué parte del plan muestran las tablas.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { textoObjetivo, CLAVE_FECHA_OBJETIVO, normalizarModo } from "../lib/semanaObjetivo";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { leerAvanceYHoras } from "../lib/otEnCursoDatos";
import {
  periodo, diasDelPeriodo, diasDesde, operariosDePlanta, capacidadPlanta, horasOt, cargaPeriodo,
  preseleccion, modulosPorOt, fmtH, personalPlanta, PUESTOS_PLANTA,
} from "../lib/cargaPlanta";
import { leerOperariosPlanta } from "../lib/ganttPlan";
import { piezasConManual, normalizarAvanceManual } from "../lib/avanceManual";
import AvanceManualOt from "./AvanceManualOt";
import { puedeVerPrecios, leerPrecios, valorizarPlan, nombreMes } from "../lib/valorizacion";
import { fmtPesos } from "../lib/costo";
import { planHorizonte, trabajoDelPeriodo, ordenEficiente } from "../lib/planAutomatico";
import { inicioDeSemana } from "../lib/semanaObjetivo";
import GanttPlan from "./GanttPlan";
import { cuerpoPlan } from "../lib/planGuardado";
import { materialOt } from "../lib/ot";
import {
  CLAVE_PLANIFICACION, ETAPAS_PLAN, PARAMETROS, GRUPOS_PARAMETROS,
  leerNumero, errorParametro, normalizarParametros, divisionPlan, etapasPlanDe,
  otsPlanificables, ordenarPorPrioridad, buscarOts, tildarTodas, moverOt, quitarPrioridad, cambiosPrioridad, parametrosFaltantes,
  MODOS_MECANIZADO, RELACIONES_TIPO,
} from "../lib/planificacion";
import { TIPOS_PROYECTO, TIPO_GLOBAL, tipoDeOt, nombreTipo } from "../lib/tipoProyecto";
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
        : vista === "carga" ? <CargaPlan empresaId={empresaId} divisiones={divisiones} etapas={etapas} division={division} params={cfg} onParametros={() => setVista("parametros")} />
        : vista === "prioridad" ? <PrioridadOt empresaId={empresaId} divisiones={divisiones} division={division} />
          : <ParametrosPlan empresaId={empresaId} cfg={cfg} divisiones={divisiones} etapas={etapas} onGuardado={setCfg} />}
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

// Lo que elige gerencia en Carga queda guardado en el navegador (Tadeo, 27/10:
// al volver del Gantt no tiene que cambiar nada): las OT tildadas, el switch
// del plan y la forma de ordenar.
const clavePlan = (empresaId, divisionId, que) => `gypi_plan_${que}_${empresaId}_${divisionId || "todas"}`;
function leerLocal(clave) {
  try { return JSON.parse(localStorage.getItem(clave) || "null"); } catch { return null; }
}
function guardarLocal(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
}

function CargaPlan({ empresaId, divisiones, etapas, division, params, onParametros }) {
  const [tipo, setTipo] = useState("semana");
  const [paso, setPaso] = useState(0);
  const [modo, setModo] = useState("semana_domingo");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [elegidas, setElegidas] = useState(null);
  const [ordenado, setOrdenado] = useState(false);
  // Switch del plan: según la capacidad (por defecto) o según las fechas objetivo (SEMANA, con horas extra)
  const [base, setBaseEstado] = useState(() => (leerLocal(clavePlan(empresaId, division?.id, "base")) === "objetivo" ? "objetivo" : "capacidad"));
  const setBase = (b) => { setBaseEstado(b); guardarLocal(clavePlan(empresaId, division?.id, "base"), b); };
  // Forma de ordenar: solo las tildadas en el orden de prioridad, o el orden más eficiente
  const [forma, setFormaEstado] = useState(() => (leerLocal(clavePlan(empresaId, division?.id, "forma")) === "eficiente" ? "eficiente" : "prioridad"));
  const setForma = (f) => { setFormaEstado(f); guardarLocal(clavePlan(empresaId, division?.id, "forma"), f); };
  // Último plan sin límite de semanas guardado: undefined = leyendo, null = no hay
  const [guardado, setGuardado] = useState(undefined);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [avisoTipo, setAvisoTipo] = useState(null);
  const [busca, setBusca] = useState("");
  // Precio de cada OT (142): solo Dueño y Administración
  const { usuario } = useAuth();
  const verPrecios = puedeVerPrecios(usuario);
  const [precios, setPrecios] = useState(() => new Map());
  useEffect(() => {
    if (!verPrecios) return;
    let vivo = true;
    leerPrecios().then((m) => { if (vivo) setPrecios(m); });
    return () => { vivo = false; };
  }, [verPrecios, empresaId]);
  const [manualAbierto, setManualAbierto] = useState(null);

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    (async () => {
      try {
        const [proy, emp, av, pz, cfgModo] = await Promise.all([
          sbGetAll(`proyectos?empresa_id=eq.${empresaId}&estado=neq.cerrado&order=id.asc`, { maxFilas: 20000 }),
          leerOperariosPlanta(`empresa_id=eq.${empresaId}&`, "id,nombre,rol,division,diagrama,activo"),
          leerAvanceYHoras(empresaId).catch(() => ({ avance: [], piezas: [] })),
          sbGetAll(`piezas_ot?empresa_id=eq.${empresaId}&modulo=not.is.null&select=ot,modulo`, { maxFilas: 50000 }).catch(() => ({ data: [] })),
          sb.get(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}&select=valor&limit=1`).catch(() => null),
        ]);
        if (!vivo) return;
        // Igual que el Gantt: la semana arranca el domingo, salvo que la empresa cuente de lunes
        setModo(normalizarModo(cfgModo?.[0]?.valor?.modo) === "semana_domingo" ? "semana_domingo" : "semana_lunes");
        setDatos({ proyectos: proy.data || [], empleados: emp.data || [], avance: av.avance || [], piezasEscaneo: av.piezasEscaneo || av.piezas || [], modulos: modulosPorOt(pz.data) });
      } catch (e) {
        if (vivo) setError(e.message || "No se pudieron leer los datos.");
      }
    })();
    return () => { vivo = false; };
  }, [empresaId]);

  const hoy = hoyArg();
  const per = useMemo(() => periodo(tipo, hoy, paso, modo), [tipo, hoy, paso, modo]);
  useEffect(() => {
    let vivo = true;
    apiFetch("/api/planificacion?horizonte=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!vivo) return; setGuardado(d?.plan || null); setFaltaMigracion(!!d?.falta_migracion); })
      .catch(() => { if (vivo) setGuardado(null); });
    return () => { vivo = false; };
  }, []);
  const ots = useMemo(() => ordenarPorPrioridad(otsPlanificables(datos?.proyectos || [], divisiones, division)), [datos, divisiones, division]);
  // Lo tildado se recuerda: primero lo último que tildó en este navegador,
  // si no las OT del plan guardado, y si no hay nada, las que tienen semana.
  // Cambiar de período no toca lo tildado; cambiar de división sí.
  const preseleccionDe = useRef(null);
  useEffect(() => {
    const clave = division?.id || "";
    if (!datos || guardado === undefined || preseleccionDe.current === clave) return;
    preseleccionDe.current = clave;
    const existen = new Set(ots.map((p) => p.id));
    const local = leerLocal(clavePlan(empresaId, division?.id, "ots"));
    if (Array.isArray(local)) { setElegidas(new Set(local.filter((id) => existen.has(id)))); return; }
    const delPlan = new Set([...(guardado?.items || []), ...(guardado?.pendientes || [])].map((i) => String(i.ot)));
    if (delPlan.size) { setElegidas(new Set(ots.filter((p) => delPlan.has(String(p.ot))).map((p) => p.id))); return; }
    setElegidas(preseleccion(ots));
  }, [datos, ots, division, guardado, empresaId]);
  const cambiarElegidas = (f) => setElegidas((s) => {
    const n = f(s);
    guardarLocal(clavePlan(empresaId, division?.id, "ots"), [...n]);
    return n;
  });

  // Escaneo de piezas, con el checkeo manual de cada OT en los procesos sin escaneo (141)
  const piezas = useMemo(() => piezasConManual(datos?.piezasEscaneo || [], datos?.proyectos || []), [datos]);
  const horas = useMemo(() => new Map(ots.map((p) => [p.id, horasOt(p, params, {
    modulosEtiquetas: datos?.modulos.get(String(p.ot)) || null, avance: datos?.avance, piezas,
  })])), [ots, params, datos, piezas]);
  const operarios = useMemo(() => operariosDePlanta(datos?.empleados, divisiones, division), [datos, divisiones, division]);
  // Plan día por día de las OT elegidas, en el orden de prioridad, desde hoy
  // hasta que terminan (se calcula un año de grilla)
  const capacidadAnio = useMemo(() => capacidadPlanta(operarios, diasDesde(hoy, 366)), [operarios, hoy]);
  // Solo las OT tildadas: en el orden de prioridad, o en el más eficiente
  const trabajos = useMemo(() => {
    const t = ots.filter((p) => elegidas?.has(p.id)).map((p) => ({ ...horas.get(p.id), id: p.id, objetivo: p.fecha_objetivo || null }));
    return forma === "eficiente" ? ordenEficiente({ trabajos: t, dias: capacidadAnio.porDia, params }) : t;
  }, [ots, elegidas, horas, forma, capacidadAnio, params]);
  const otsPlan = useMemo(() => {
    const porId = new Map(ots.map((p) => [p.id, p]));
    return trabajos.map((t) => porId.get(t.id));
  }, [ots, trabajos]);
  const plan = useMemo(() => (trabajos.length ? planHorizonte({ trabajos, dias: capacidadAnio.porDia, params, base, modo }) : null),
    [trabajos, capacidadAnio, params, base, modo]);
  // Las tablas muestran lo que el plan pone en el período elegido (de hoy en adelante)
  const desdeVisible = per.desde > hoy ? per.desde : hoy;
  const yaPaso = per.hasta < hoy;
  const capacidad = useMemo(() => capacidadPlanta(operarios, yaPaso ? [] : diasDelPeriodo(desdeVisible, per.hasta)), [operarios, yaPaso, desdeVisible, per.hasta]);
  const carga = useMemo(() => ({
    ...cargaPeriodo({ ots: plan ? [trabajoDelPeriodo(plan.segmentos, desdeVisible, per.hasta, params.eficiencia)] : [], params, capacidad }),
    ots: ots.filter((p) => elegidas?.has(p.id)).map((p) => horas.get(p.id)),
  }), [plan, desdeVisible, per.hasta, params, capacidad, ots, elegidas, horas]);
  const valor = useMemo(() => (verPrecios ? valorizarPlan({
    ots: ots.filter((p) => elegidas?.has(p.id)).map((p) => ({ id: p.id, ot: p.ot, completo: horas.get(p.id).completo })),
    segmentos: plan?.segmentos, pendientes: plan?.pendientes, precios, eficiencia: params.eficiencia, modo,
  }) : null), [verPrecios, ots, elegidas, horas, plan, precios, params.eficiencia, modo]);

  if (error) return <div role="alert" className="text-sm text-gypi-red">{error}</div>;
  if (!datos || !elegidas) return <Cargando />;

  const faltan = parametrosFaltantes(params);
  // Tipo de proyecto a mano (139); vacío = vuelve al que sale de la descripción
  const cambiarTipo = async (p, valor) => {
    setAvisoTipo(null);
    try {
      await sb.patch(`proyectos?id=eq.${p.id}`, { tipo_proyecto: valor || null });
      setDatos((d) => ({ ...d, proyectos: d.proyectos.map((x) => (x.id === p.id ? { ...x, tipo_proyecto: valor || null } : x)) }));
    } catch (e) {
      setAvisoTipo(/tipo_proyecto/.test(String(e.message)) ? "Para cambiar el tipo a mano falta correr la migración 139 en Supabase." : `No se pudo cambiar el tipo: ${e.message}`);
    }
  };
  const tildar = (id) => cambiarElegidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const visibles = buscarOts(ots, busca);
  const todasTildadas = visibles.length > 0 && visibles.every((p) => elegidas.has(p.id));
  // Avisos (Tadeo, 27/10): OT tildadas sin precio y sin placas, fondos ni canto
  const tildadas = ots.filter((p) => elegidas.has(p.id));
  const sinPrecio = verPrecios ? tildadas.filter((p) => !precios.has(String(p.ot))) : [];
  const sinTiempos = tildadas.filter((p) => !(horas.get(p.id).completo > 0));

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

      <AvisosOt sinTiempos={sinTiempos} sinPrecio={sinPrecio} />

      {faltan.length > 0 && (
        <div role="alert" className="g-card mb-3 text-[13px]">
          <div className="text-gypi-red font-bold mb-1">Faltan parámetros</div>
          <div className="text-gypi-dim mb-2">Sin estos datos las horas salen en cero: {faltan.join(", ")}.</div>
          <button type="button" onClick={onParametros} className="g-btn g-btn-secondary">Cargar parámetros</button>
        </div>
      )}

      <div className="g-card mb-3" aria-label="Resultado">
        <div className={`font-heading text-lg font-bold mb-1 ${carga.viable && !yaPaso ? "text-gypi-green" : "text-gypi-red"}`}>
          {!carga.ots.length ? "Elegí las OT que querés planificar" : yaPaso ? "Ese período ya pasó" : carga.viable ? "✅ Entra en el período" : "❌ No entra con el horario normal"}
        </div>
        {!yaPaso && carga.ots.length > 0 && (
          <div className="text-xs text-gypi-dim mb-1">Lo que el plan pone del {fechaCorta(desdeVisible)} al {fechaCorta(per.hasta)}. El plan sigue hasta que terminan todas las OT; la semana o el mes de arriba solo eligen qué parte se ve acá.</div>
        )}
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
      </div>

      <div className="g-card mb-3" aria-label="Horas de máquina">
        <div className="g-label mb-1">🏭 Máquinas</div>
        <div className="text-xs text-gypi-dim mb-2">
          Cada máquina puede trabajar las horas en que la planta está abierta ({fmtH(capacidad.maquina)} en el período, del primero que entra al último que sale) × la cantidad de máquinas.
        </div>
        <table className="w-full text-[13px]">
          <thead><tr className="text-gypi-dim text-left"><th className="font-normal">Máquina</th><th className="font-normal text-right">Necesita</th><th className="font-normal text-right">Disponible</th><th className="font-normal text-right">Resultado</th></tr></thead>
          <tbody>
            {carga.maquinas.map((m) => {
              const dif = m.disponibles - m.necesarias;
              return (
                <tr key={m.id} className="border-t border-gypi-border">
                  <td className="py-1.5">{m.nombre}{m.cantidad > 1 ? ` (${m.cantidad})` : ""}</td>
                  <td className="text-right">{fmtH(m.necesarias)}</td>
                  <td className="text-right">{fmtH(m.disponibles)}</td>
                  <td className={`text-right font-bold ${dif < -0.05 ? "text-gypi-red" : "text-gypi-green"}`}>{dif < -0.05 ? `Faltan ${fmtH(-dif)}` : `Sobran ${fmtH(dif)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="g-card mb-3" aria-label="Horas de gente">
        <div className="g-label mb-1">👷 Gente</div>
        <div className="text-xs text-gypi-dim mb-2">
          Los operarios de producción se reparten entre etapas (el que no tiene trabajo en su máquina pasa a Armado; los de Otra línea no cuentan), así que se suma todo y se compara con las horas de los turnos de {capacidad.personas === 1 ? "1 operario" : `${capacidad.personas} operarios`}. En la canteadora con 2 personas cuenta el doble de horas que la máquina.
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {Object.values(carga.porEtapa).map((e) => (
              <tr key={e.id} className="border-t border-gypi-border first:border-t-0">
                <td className="py-1.5">{e.nombre}</td>
                <td className="text-right">{fmtH(e.gente)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gypi-border font-bold">
              <td className="py-1.5">Necesita</td>
              <td className="text-right">{fmtH(carga.necesarias)}</td>
            </tr>
            <tr>
              <td className="py-1.5">Disponible</td>
              <td className="text-right">{fmtH(carga.disponibles)}</td>
            </tr>
            <tr className={`font-bold ${carga.extra > 0 ? "text-gypi-red" : "text-gypi-green"}`}>
              <td className="py-1.5">Resultado</td>
              <td className="text-right">{carga.extra > 0 ? `Faltan ${fmtH(carga.extra)}` : `Sobran ${fmtH(carga.disponibles - carga.necesarias)}`}</td>
            </tr>
          </tbody>
        </table>
        <div className="text-xs text-gypi-dim mt-2">Horas de reloj, con la eficiencia ya aplicada.</div>
      </div>

      <div className="g-card mb-3" aria-label="Plan automático">
        <div className="flex items-center gap-2 mb-2">
          <div className="g-label flex-1">⚡ Plan día por día</div>
          {ordenado && <button type="button" onClick={() => setOrdenado(false)} className="g-btn g-btn-secondary">Ocultar</button>}
        </div>
        <EstadoGuardado guardado={guardado} faltaMigracion={faltaMigracion} empleados={datos.empleados} />
        <div className="text-[13px] text-gypi-dim mb-2">Gypi reparte solo las OT tildadas, desde hoy hasta que terminan, respetando Corte → Canteado → Mecanizado → Armado y las máquinas.</div>
        <div className="flex gap-2 flex-wrap mb-1" role="group" aria-label="Orden de las OT">
          <Chip active={forma === "prioridad"} onClick={() => setForma("prioridad")}>📌 Las tildadas, en mi orden de prioridad</Chip>
          <Chip active={forma === "eficiente"} onClick={() => setForma("eficiente")}>⚡ La forma más eficiente</Chip>
        </div>
        <div className="text-xs text-gypi-dim mb-2">
          {forma === "prioridad"
            ? "Las OT van en el orden de la pestaña Prioridad (y después por semana)."
            : `Gypi elige el orden para que lleguen a su semana la mayor cantidad posible y terminen antes: ${otsPlan.map((p) => p.ot).join(", ") || "—"}.`}
        </div>
        <div className="flex gap-2 flex-wrap mb-1" role="group" aria-label="Armar el plan según">
          <Chip active={base === "capacidad"} onClick={() => setBase("capacidad")}>🏭 Según capacidad de la planta</Chip>
          <Chip active={base === "objetivo"} onClick={() => setBase("objetivo")}>📅 Según fechas objetivo (SEMANA)</Chip>
        </div>
        <div className="text-xs text-gypi-dim mb-2">
          {base === "objetivo"
            ? "Cada OT tiene que terminar en su semana: si no llega, Gypi suma horas extra antes (primero sábados, después domingos) y te dice cuántas hacen falta por semana."
            : "Solo el horario normal: cada OT sale con la fecha en que terminaría, y se marcan las que terminan después de su semana."}
        </div>
        {plan && plan.desde && <ResumenHorizonte plan={plan} base={base} modo={modo} />}
        {!ordenado ? (
          <button type="button" onClick={() => setOrdenado(true)} disabled={!carga.ots.length} className="g-btn g-btn-primary w-full">Ver el plan de las OT tildadas</button>
        ) : plan && (
          <>
            <GanttPlan plan={plan} ots={otsPlan} hoy={hoy} marcarObjetivo={base === "objetivo"} />
            <FinDeCadaOt plan={plan} ots={otsPlan} />
            {!faltaMigracion && plan.segmentos.length > 0 && (
              <GuardarPlan cuerpo={(estado) => cuerpoPlan({ per: { tipo: "horizonte", desde: plan.desde, hasta: plan.hasta }, plan, division, ots: otsPlan, estado })}
                confirmado={guardado?.estado === "confirmado"} onGuardado={setGuardado} onFaltaMigracion={() => setFaltaMigracion(true)} />
            )}
          </>
        )}
      </div>

      {valor && <Valorizacion valor={valor} conPlan={!!plan} per={per} />}

      <div className="g-label mb-1.5">OT para planificar ({ots.length})</div>
      <div className="text-xs text-gypi-dim mb-2">Vienen tildadas las que tienen semana (también las atrasadas). Destildá o sumá las que quieras. El tipo de proyecto sale de la descripción; si no es el correcto, cambialo.</div>
      {avisoTipo && <div role="alert" className="text-[13px] text-gypi-red mb-2">{avisoTipo}</div>}
      <div className="flex gap-2 mb-2 items-center">
        <input type="search" className="g-input flex-1 min-w-0" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar OT, cliente o proyecto" aria-label="Buscar OT" />
        <button type="button" className="g-btn g-btn-secondary whitespace-nowrap" disabled={!visibles.length}
          onClick={() => cambiarElegidas((s) => tildarTodas(s, visibles))}>
          {todasTildadas ? "Destildar todas" : "Tildar todas"}
        </button>
      </div>
      <div className="text-xs text-gypi-dim mb-2" role="status">
        {elegidas.size === 1 ? "1 OT tildada" : `${elegidas.size} OT tildadas`} de {ots.length}
        {busca.trim() ? ` · ${visibles.length === 1 ? "1 coincide" : `${visibles.length} coinciden`} con la búsqueda${visibles.length ? " (el botón tilda o destilda solo esas)" : ""}` : ""}
      </div>
      {busca.trim() && !visibles.length && <div className="text-[13px] text-gypi-dim mb-2">Ninguna OT coincide con “{busca.trim()}”.</div>}
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="OT para planificar">
        {visibles.map((p) => {
          const h = horas.get(p.id);
          return (
            <li key={p.id} className="bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="mt-1 w-5 h-5" checked={elegidas.has(p.id)} onChange={() => tildar(p.id)} aria-label={`Planificar OT ${p.ot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold truncate">{p.prioridad ? `${p.prioridad}. ` : ""}{p.ot} · {p.cliente || p.proyecto || "—"}</div>
                  <div className="text-xs text-gypi-dim truncate">
                    {[textoObjetivo(p) || "sin semana", h.sinDatos ? "sin datos de la planilla" : `${(Math.round(h.placas * 10) / 10).toLocaleString("es-AR")} placas · ${(Math.round(h.mecanizados * 10) / 10).toLocaleString("es-AR")} mec. · ${(Math.round(h.gabinetes * 10) / 10).toLocaleString("es-AR")} gab.`].join(" · ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-bold whitespace-nowrap">{fmtH(h.total / ((params.eficiencia || 100) / 100))}</div>
                  {verPrecios && (precios.has(String(p.ot))
                    ? <div className="text-xs text-gypi-dim whitespace-nowrap">{fmtPesos(precios.get(String(p.ot)))}</div>
                    : <div className="text-xs text-gypi-amber-ink font-bold whitespace-nowrap">sin precio</div>)}
                </div>
              </label>
              <TipoOt proyecto={p} onCambiar={(v) => cambiarTipo(p, v)} />
              <div className="pl-[30px] mt-1.5">
                <button type="button" className="bg-transparent border-none p-0 text-xs font-bold text-gypi-amber-ink cursor-pointer min-h-[32px]"
                  aria-expanded={manualAbierto === p.id} onClick={() => setManualAbierto(manualAbierto === p.id ? null : p.id)}>
                  ✍ Checkeo manual{normalizarAvanceManual(p.avance_manual).activo ? " (activo)" : ""} {manualAbierto === p.id ? "▲" : "▼"}
                </button>
                {manualAbierto === p.id && (
                  <div className="mt-1.5">
                    <AvanceManualOt proyecto={p} etapas={etapas} divisiones={divisiones} piezas={datos.piezasEscaneo}
                      onGuardado={(v) => setDatos((d) => ({ ...d, proyectos: d.proyectos.map((x) => (x.id === p.id ? { ...x, avance_manual: v } : x)) }))} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// 💲 Valorización (142): precio de las OT tildadas y lo que el plan fabrica,
// por semana o por mes según cómo se ve la planificación (Tadeo, 27/10): el
// valor del período que se está viendo, el de cada semana o mes, y el total.
function Valorizacion({ valor, conPlan, per }) {
  const fila = (key, label, v, { fuerte = false, actual = false } = {}) => (
    <tr key={key} aria-current={actual ? "true" : undefined}
      className={`border-t border-gypi-border first:border-t-0 ${actual ? "bg-gypi-amber/15" : ""}`}>
      <td className={`py-1 pr-2 ${fuerte || actual ? "font-bold" : ""}`}>{label}</td>
      <td className={`py-1 pl-2 text-right whitespace-nowrap ${fuerte || actual ? "font-bold" : ""}`}>{fmtPesos(v)}</td>
    </tr>
  );
  const porMes = per.tipo === "mes";
  const filas = porMes
    ? valor.porMes.map((m) => ({ key: m.mes, label: nombreMes(m.mes), valor: m.valor, actual: m.mes === per.desde.slice(0, 7) }))
    : valor.porSemana.map((s) => ({ key: s.desde, label: `Semana del ${fechaCorta(s.desde)}`, valor: s.valor, actual: s.desde === per.desde }));
  const delPeriodo = filas.find((f) => f.actual)?.valor || 0;
  return (
    <div className="g-card mb-3" aria-label="Valorización">
      <div className="g-label mb-1">💲 Valorización</div>
      <div className="flex items-baseline gap-2 mb-1">
        <div className="text-[13px] flex-1">OT tildadas con precio: {valor.conPrecio}</div>
        <div className="font-heading text-lg font-bold">{fmtPesos(valor.total)}</div>
      </div>
      {valor.sinPrecio > 0 && <div className="text-xs text-gypi-dim mb-1">{valor.sinPrecio === 1 ? "1 OT tildada no tiene" : `${valor.sinPrecio} OT tildadas no tienen`} PRECIO en el Plan de trabajo.</div>}
      {!conPlan ? (
        <div className="text-xs text-gypi-dim">Tildá OT para ver cuánto se fabrica cada {porMes ? "mes" : "semana"}.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 my-2">
            <div className="bg-gypi-surf-hi rounded-xl p-2.5" aria-label="Valor del período">
              <div className="text-xs text-gypi-dim">{textoPeriodo(per)}</div>
              <div className="text-base font-bold">{fmtPesos(delPeriodo)}</div>
            </div>
            <div className="bg-gypi-surf-hi rounded-xl p-2.5" aria-label="Total del plan">
              <div className="text-xs text-gypi-dim">Total del plan</div>
              <div className="text-base font-bold">{fmtPesos(valor.enPlan)}</div>
            </div>
          </div>
          <div className="text-xs text-gypi-dim mb-1">Cada OT reparte su precio según las horas que el plan pone en cada {porMes ? "mes" : "semana"}. Con ◀ ▶ arriba cambiás {porMes ? "el mes" : "la semana"} que se ve.</div>
          <table className="w-full text-[13px] mb-2" aria-label={porMes ? "Valorización por mes" : "Valorización por semana"}>
            <tbody>
              {filas.map((f) => fila(f.key, f.label, f.valor, { actual: f.actual }))}
              {fila("total", "Total del plan", valor.enPlan, { fuerte: true })}
            </tbody>
          </table>
          {(valor.pasa > 0.5 || valor.hecho > 0.5 || valor.sinHoras > 0.5) && (
            <table className="w-full text-[13px]">
              <tbody>
                {valor.pasa > 0.5 && fila("pasa", "No entra en el próximo año", valor.pasa)}
                {valor.hecho > 0.5 && fila("hecho", "Ya fabricado antes", valor.hecho)}
                {valor.sinHoras > 0.5 && fila("sin", "Sin horas para repartir (faltan datos de la planilla)", valor.sinHoras)}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

// ⚠ Avisos de la planificación: cuántas OT tildadas no tienen PRECIO (solo
// para quien ve precios) y cuántas no tienen placas, fondos ni canto en la
// planilla (sin eso no se calculan sus tiempos). Cada aviso abre la lista.
function AvisosOt({ sinTiempos, sinPrecio }) {
  const [abierto, setAbierto] = useState(null);
  const avisos = [
    { id: "tiempos", lista: sinTiempos, texto: (n) => `${n === 1 ? "1 OT tildada no tiene" : `${n} OT tildadas no tienen`} placas, fondos ni canto: sin eso no se calculan sus tiempos y no entran en el plan.` },
    { id: "precio", lista: sinPrecio, texto: (n) => `${n === 1 ? "1 OT tildada no tiene" : `${n} OT tildadas no tienen`} PRECIO en el Plan de trabajo: no suman a la valorización.` },
  ].filter((a) => a.lista.length);
  if (!avisos.length) return null;
  return (
    <div role="alert" aria-label="Avisos de la planificación" className="g-card mb-3 border-gypi-amber/60 bg-gypi-amber/10">
      {avisos.map((a) => (
        <div key={a.id} className="text-[13px] mb-1.5 last:mb-0" data-aviso={a.id}>
          <div className="flex items-start gap-2">
            <span aria-hidden="true">⚠️</span>
            <div className="flex-1"><b>{a.texto(a.lista.length)}</b></div>
            <button type="button" className="bg-transparent border-none p-0 text-xs font-bold text-gypi-amber-ink cursor-pointer min-h-[32px] whitespace-nowrap"
              aria-expanded={abierto === a.id} onClick={() => setAbierto(abierto === a.id ? null : a.id)}>
              {abierto === a.id ? "Ocultar ▲" : "Ver cuáles ▼"}
            </button>
          </div>
          {abierto === a.id && (
            <ul className="list-none m-0 mt-1 pl-6 p-0 text-xs">
              {a.lista.map((p) => <li key={p.id}>{p.ot} · {p.cliente || p.proyecto || "—"}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function TipoOt({ proyecto, onCambiar }) {
  const { id, manual } = tipoDeOt(proyecto);
  const automatico = manual ? tipoDeOt({ descripcion: proyecto.descripcion }).id : id;
  return (
    <div className="flex items-center gap-2 mt-1.5 pl-[30px]">
      <label htmlFor={`tipo-${proyecto.id}`} className="text-xs text-gypi-dim whitespace-nowrap">Tipo</label>
      <select id={`tipo-${proyecto.id}`} aria-label={`Tipo de proyecto de la OT ${proyecto.ot}`} className="g-input flex-1 min-w-0"
        value={manual ? id : ""} onChange={(e) => onCambiar(e.target.value)}>
        <option value="">{automatico ? `${nombreTipo(automatico)} (automático)` : "Sin tipo (sin descripción)"}</option>
        {TIPOS_PROYECTO.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
      </select>
    </div>
  );
}

const nombreDia = (f) => new Date(`${f}T00:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", timeZone: "UTC" });

function textoTarde(t) {
  const semana = t.objetivo ? `su semana terminó el ${fechaCorta(t.objetivo)}` : "";
  if (t.motivo === "sin_capacidad") return "no entra en el próximo año con la gente cargada";
  if (t.motivo === "atrasada") return `${semana}${t.fin ? `; termina el ${fechaCorta(t.fin)}` : ""}`;
  const hasta = `semana hasta el ${fechaCorta(t.objetivo)}`;
  if (t.motivo === "no_llega") return `${hasta}; ni con sábados y domingos llega: termina el ${fechaCorta(t.fin)}`;
  return `${hasta}; termina el ${fechaCorta(t.fin)}`;
}

// Resumen de todo el plan: hasta cuándo va, horas extra por semana (según
// fechas objetivo) y las OT que no llegan a su semana.
function ResumenHorizonte({ plan, base, modo }) {
  const horasExtra = plan.diasExtra.reduce((t, d) => t + d.horas, 0);
  const dias = (Date.parse(`${plan.hasta}T00:00:00Z`) - Date.parse(`${plan.desde}T00:00:00Z`)) / 86400000 + 1;
  const semanas = Math.ceil(dias / 7);
  return (
    <div className="mb-2 text-[13px]" aria-label="Resumen del plan">
      {plan.segmentos.length > 0 && (
        <div className="mb-2">🗓 El plan va del <b>{fechaCorta(plan.desde)}</b> al <b>{fechaCorta(plan.hasta)}</b> ({semanas === 1 ? "1 semana" : `${semanas} semanas`}).</div>
      )}
      {base === "objetivo" && plan.diasExtra.length > 0 && (
        <div className="mb-2" aria-label="Horas extra por semana">
          <div className="font-bold text-gypi-red mb-1">⏱ Horas extra para llegar a las semanas: {fmtH(horasExtra)}</div>
          <ul className="list-none m-0 p-0">
            {plan.extraPorSemana.map((s) => (
              <li key={s.desde}>
                Semana del {fechaCorta(s.desde)}: <b>{fmtH(s.horas)}</b>
                <span className="text-gypi-dim"> ({plan.diasExtra.filter((d) => inicioDeSemana(d.fecha, modo) === s.desde).map((d) => `${nombreDia(d.fecha)} ${fechaCorta(d.fecha)}`).join(", ")})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!plan.tarde.length && plan.segmentos.length > 0 && (
        <div className="font-bold text-gypi-green mb-2">
          {base === "capacidad" ? "✅ Con el horario normal todas las OT llegan a su semana." : plan.diasExtra.length ? "✅ Con esas horas extra todas las OT llegan a su semana." : "✅ Todas las OT llegan a su semana sin horas extra."}
        </div>
      )}
      {plan.tarde.length > 0 && (
        <div className="mb-2" aria-label="OT que no llegan a su semana">
          <div className="font-bold text-gypi-red mb-1">{base === "capacidad" ? "🔴 Terminan después de su semana" : "🔴 No llegan a su semana"}</div>
          <ul className="list-none m-0 p-0">
            {plan.tarde.map((t) => <li key={t.id} className="text-gypi-red-ink">{t.ot}: {textoTarde(t)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function FinDeCadaOt({ plan, ots }) {
  const fin = (id) => plan.finPorOt.get(id);
  const pendiente = new Set(plan.pendientes.map((p) => p.id));
  return (
    <ul className="list-none m-0 p-0 mt-2 text-xs text-gypi-dim" aria-label="Fin de cada OT">
      {ots.filter((p) => fin(p.id)).map((p) => (
        pendiente.has(p.id)
          ? <li key={p.id}>{p.ot} avanza hasta el {fechaCorta(fin(p.id))} y no termina en el próximo año</li>
          : <li key={p.id}>{p.ot} termina el {fechaCorta(fin(p.id))}{p.fecha_objetivo && fin(p.id) > p.fecha_objetivo ? ` · después de su semana (${fechaCorta(p.fecha_objetivo)})` : ""}</li>
      ))}
    </ul>
  );
}

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

function EstadoGuardado({ guardado, faltaMigracion, empleados }) {
  if (faltaMigracion) return <div role="alert" className="text-[13px] text-gypi-red mb-2">Para guardar el plan falta correr la migración 138 en Supabase.</div>;
  if (!guardado) return null;
  const nombre = (id) => (empleados || []).find((e) => e.id === id)?.nombre;
  if (guardado.estado === "confirmado") {
    const quien = nombre(guardado.confirmado_por);
    return (
      <div role="status" className="text-[13px] font-bold text-gypi-green mb-2">
        ✅ Plan confirmado{guardado.confirmado_at ? ` el ${fechaHora(guardado.confirmado_at)}` : ""}{quien ? ` por ${quien}` : ""}. La planta lo ve en 📅 Plan de la semana.
      </div>
    );
  }
  return <div role="status" className="text-[13px] text-gypi-amber-ink font-bold mb-2">📝 Hay un borrador guardado{guardado.updated_at ? ` (${fechaHora(guardado.updated_at)})` : ""}. La planta todavía no lo ve.</div>;
}

function GuardarPlan({ cuerpo, confirmado, onGuardado, onFaltaMigracion }) {
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const guardar = async (estado) => {
    setEnviando(estado); setError(null);
    try {
      const r = await apiFetch("/api/planificacion", { method: "POST", body: JSON.stringify(cuerpo(estado)) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) onFaltaMigracion();
      if (!r.ok) throw new Error(d.error || "No se pudo guardar el plan.");
      onGuardado(d.plan);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(null);
    }
  };
  return (
    <div className="mt-3">
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => guardar("borrador")} disabled={!!enviando} className="g-btn g-btn-secondary">
          {enviando === "borrador" ? "Guardando…" : confirmado ? "Volver a borrador" : "Guardar borrador"}
        </button>
        <button type="button" onClick={() => guardar("confirmado")} disabled={!!enviando} className="g-btn g-btn-primary">
          {enviando === "confirmado" ? "Confirmando…" : confirmado ? "Confirmar de nuevo" : "Confirmar plan"}
        </button>
      </div>
      <div className="text-xs text-gypi-dim mt-1">El borrador lo ve solo gerencia. Al confirmar, la planta ve qué OT y qué etapa toca cada día. Confirmar reemplaza, desde hoy, el plan confirmado anterior.</div>
    </div>
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

const TIPOS_TABLA = [...TIPOS_PROYECTO, TIPO_GLOBAL];

function RelacionesPorTipo({ textos, errores, onChange }) {
  const cambiar = (tipo, rel, valor) => onChange((t) => ({ ...t, [tipo]: { ...t[tipo], [rel]: valor } }));
  return (
    <div aria-label="Relaciones por tipo de proyecto">
      <div className="text-[13px] font-bold mb-1">Por tipo de proyecto</div>
      <div className="text-xs text-gypi-dim mb-2">Vienen cargados con el estudio de la planta (mecanizados de las OT con mecanizado). Gabinetes por placa se usa cuando la OT no tiene módulos ni etiquetas de módulo. &quot;Sin tipo&quot; es para las OT sin descripción.</div>
      <table className="w-full text-[13px]">
        <thead><tr className="text-gypi-dim text-left"><th className="font-normal">Tipo</th>{RELACIONES_TIPO.map((r) => <th key={r.id} className="font-normal">{r.label}</th>)}</tr></thead>
        <tbody>
          {TIPOS_TABLA.map((t) => (
            <tr key={t.id} className="border-t border-gypi-border align-top">
              <td className="py-1.5 pr-2">
                {t.nombre}
                {errores[t.id] && <div className="text-xs text-gypi-red">{errores[t.id]}</div>}
              </td>
              {RELACIONES_TIPO.map((r) => (
                <td key={r.id} className="py-1 pr-1">
                  <input className="g-input w-full" inputMode="decimal" aria-label={`${r.label} de ${t.nombre}`}
                    value={textos[t.id][r.id]} onChange={(e) => cambiar(t.id, r.id, e.target.value)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParametrosPlan({ empresaId, cfg, divisiones, etapas, onGuardado }) {
  const [textos, setTextos] = useState(() => Object.fromEntries(PARAMETROS.map((p) => [p.id, conComa(cfg[p.id])])));
  const [divisionId, setDivisionId] = useState(cfg.division_id || divisionPlan(divisiones, null)?.id || "");
  const division = divisionPlan(divisiones, divisionId);
  const [elegidas, setElegidas] = useState(() => etapasPlanDe(etapas, division, cfg.etapas));
  const [modoMec, setModoMec] = useState(cfg.modo_mecanizado || "tipo");
  const [textosTipo, setTextosTipo] = useState(() => Object.fromEntries(TIPOS_TABLA.map((t) => [t.id,
    Object.fromEntries(RELACIONES_TIPO.map((r) => [r.id, conComa(cfg.por_tipo?.[t.id]?.[r.id])]))])));
  const [estado, setEstado] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const valores = Object.fromEntries(PARAMETROS.map((p) => [p.id, leerNumero(textos[p.id])]));
  const errores = Object.fromEntries(PARAMETROS.map((p) => [p.id,
    textos[p.id].trim() && valores[p.id] == null ? "Escribí solo el número" : errorParametro(p, valores[p.id])]));
  const valoresTipo = Object.fromEntries(TIPOS_TABLA.map((t) => [t.id,
    Object.fromEntries(RELACIONES_TIPO.map((r) => [r.id, leerNumero(textosTipo[t.id][r.id])]))]));
  const erroresTipo = Object.fromEntries(TIPOS_TABLA.map((t) => [t.id, RELACIONES_TIPO.map((r) => {
    const txt = textosTipo[t.id][r.id].trim(), v = valoresTipo[t.id][r.id];
    if (!txt) return `${r.label}: falta el número`;
    return v == null ? `${r.label}: escribí solo el número` : (errorParametro(r, v) ? `${r.label}: ${errorParametro(r, v)}` : null);
  }).filter(Boolean).join(" · ")]));
  const hayError = Object.values(errores).some(Boolean) || Object.values(erroresTipo).some(Boolean);
  const productivas = (etapas || []).filter((e) => e.codigo > 0);

  const guardar = async () => {
    if (hayError) return;
    setGuardando(true);
    setEstado(null);
    const valor = { ...valores, modo_mecanizado: modoMec, por_tipo: valoresTipo, division_id: division?.id || null, etapas: elegidas };
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
          {g.id === "relaciones" && (
            <div className="mb-3">
              <div className="text-[13px] font-bold mb-1">Cómo se calculan los mecanizados</div>
              <div className="flex gap-2 flex-wrap" role="group" aria-label="Cálculo de los mecanizados">
                {MODOS_MECANIZADO.map((m) => <Chip key={m.id} active={modoMec === m.id} onClick={() => setModoMec(m.id)}>{m.label}</Chip>)}
              </div>
              <div className="text-xs text-gypi-dim mt-1">{MODOS_MECANIZADO.find((m) => m.id === modoMec)?.ayuda} Si la planilla trae MECANIZADOS, se usa ese número.</div>
            </div>
          )}
          {PARAMETROS.filter((p) => p.grupo === g.id && (p.id !== "pct_mecanizado" || modoMec === "porcentaje")).map((p) => (
            <div key={p.id} className="mb-3">
              <label htmlFor={`plan-${p.id}`} className="text-[13px] font-bold block mb-1">{p.label} <span className="font-normal text-gypi-dim">({p.unidad})</span></label>
              <input id={`plan-${p.id}`} className="g-input w-full" inputMode="decimal" value={textos[p.id]}
                onChange={(e) => setTextos({ ...textos, [p.id]: e.target.value })} placeholder="Sin cargar" />
              {errores[p.id] ? <div className="text-xs text-gypi-red mt-1">{errores[p.id]}</div>
                : p.ayuda && <div className="text-xs text-gypi-dim mt-1">{p.ayuda}</div>}
            </div>
          ))}
          {g.id === "relaciones" && <RelacionesPorTipo textos={textosTipo} errores={erroresTipo} onChange={setTextosTipo} />}
          {g.id === "personal" && <PersonalPorPuesto empresaId={empresaId} divisiones={divisiones} division={division} valores={valores} />}
        </div>
      ))}

      {estado && <div role="status" className="text-[13px] text-gypi-dim mb-2">{estado}</div>}
      <button type="button" onClick={guardar} disabled={guardando || hayError} className="g-btn g-btn-primary w-full">
        {guardando ? "Guardando…" : "Guardar parámetros"}
      </button>
    </section>
  );
}

// Operarios de la grilla por puesto (ficha de cada uno) contra lo que piden
// las máquinas. Los de "Otra línea" no cuentan para la planificación.
function PersonalPorPuesto({ empresaId, divisiones, division, valores }) {
  const [empleados, setEmpleados] = useState(null);
  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    leerOperariosPlanta(`empresa_id=eq.${empresaId}&`).then((r) => { if (vivo) setEmpleados(r.data || []); }).catch(() => { if (vivo) setEmpleados([]); });
    return () => { vivo = false; };
  }, [empresaId]);
  if (empleados === null) return <Cargando />;
  const otraLinea = operariosDePlanta(empleados.filter((e) => e.puesto_planta === "otra_linea")
    .map((e) => ({ ...e, puesto_planta: null })), divisiones, division).length;
  const p = personalPlanta(operariosDePlanta(empleados, divisiones, division), valores);
  const sinMigracion = empleados.length > 0 && empleados.every((e) => e.puesto_planta === undefined);
  const fila = (nombre, hay, hacen) => (
    <tr key={nombre} className="border-t border-gypi-border">
      <td className="py-1 pr-2">{nombre}</td>
      <td className="py-1 px-2 text-right font-bold">{hay}</td>
      <td className="py-1 pl-2 text-right text-gypi-dim">{hacen ?? "—"}</td>
    </tr>
  );
  return (
    <div className="mt-1" aria-label="Operarios por puesto">
      <div className="text-[13px] font-bold mb-1">Operarios de la grilla de horarios ({p.total})</div>
      {sinMigracion ? (
        <div className="text-xs text-gypi-dim mb-2">Falta correr la migración 140 para cargar el puesto de cada operario.</div>
      ) : (
        <div className="text-xs text-gypi-dim mb-2">El puesto se elige en la ficha de cada operario (Personal → editar). Los de Otra línea, como Puertas, no se planifican.</div>
      )}
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-xs text-gypi-dim text-left">
            <th className="font-normal pr-2">Puesto</th>
            <th className="font-normal px-2 text-right">Hay</th>
            <th className="font-normal pl-2 text-right">Hacen falta</th>
          </tr>
        </thead>
        <tbody>
          {PUESTOS_PLANTA.filter((x) => x.id !== "otra_linea" && x.id !== "armado").map((x) => fila(x.nombre, p.categorizados ? p.porPuesto[x.id] : "—", p.necesarios[x.id]))}
          {fila("Armado", p.armadores, null)}
          {p.categorizados && p.sinPuesto > 0 && fila("Sin puesto (arman)", p.sinPuesto, null)}
          {otraLinea > 0 && fila("Otra línea (no se planifica)", otraLinea, null)}
        </tbody>
      </table>
      {!p.categorizados && p.total > 0 && (
        <div className="text-xs text-gypi-dim mt-2">Nadie tiene puesto todavía: arman los que sobran de las máquinas.</div>
      )}
      {p.avisos.map((a) => <div key={a} role="alert" className="text-xs text-gypi-red mt-1">⚠ {a}</div>)}
    </div>
  );
}
