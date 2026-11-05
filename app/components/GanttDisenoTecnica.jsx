'use client';
// app/components/GanttDisenoTecnica.jsx — 📐 Gantt de Diseño y Técnica (parte
// 48; diseño en notes/diseno-gantt-diseno-tecnica.md; cálculo en
// app/lib/planDisenoTecnica.js).
//
// Plan vivo, calculado cada vez desde hoy: un renglón por OT de la división
// que se planifica, con una barra de Diseño (días hábiles fijos, varias OT a
// la vez) y una de Técnica (horas de una arquitecta, una planilla por vez).
// Salen las OT que ya tienen Diseño y Técnica terminados en el Plan de trabajo.
// Parte 50 (migración 161): el Dueño o un supervisor cambia el orden de las
// planillas (arrastrando desde ⠿ o con ▲▼) y elige la arquitecta de cada una;
// ve la vista previa y con "✅ Confirmar plan" queda guardado en cada OT (y
// cada arquitecta lo ve en 📐 Mis planillas). Después avisa cuánto se corrió.
// 05/11 (Tadeo): ⛶ Pantalla completa, y las OT se arrastran desde ⠿ en el
// mismo Gantt. No deja mover ni asignar si alguna OT queda más tarde contra
// su fecha límite de Técnica (la que hace llegar a la entrega programada).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb, sbGetAll } from "../lib/supabase";
import { mover } from "../lib/reordenarPlan";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { otsEnPausa } from "../lib/pausaOt";
import { CLAVE_PLANIFICACION } from "../lib/planificacion";
import { esDiaHabil } from "../lib/planInstalacion";
import { finDelPlan, barrasSeguidas, limiteTecnica, planDeEmpresa, conCambio, cuerposConfirmar, hayConfirmado, entregasComprometidas } from "../lib/planDisenoTecnica";
import { pedirPantallaCompleta, salirPantallaCompleta } from "../lib/pantallaCompleta";
import { useEscape } from "../hooks/useEscape";
import { textoDiasHabiles, textoHoras } from "../lib/disenoTecnicaPlan";
import { nombreTipo } from "../lib/tipoProyecto";
import { partesOt, textoOt } from "../lib/nombreOt";
import NombreOt from "./NombreOt";

const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ETIQUETAS = 250;
const FILA = 58;
const CAB = 40;
const PX = 40;
const SIN_LISTA = [];

/** Texto de un renglón para lectores de pantalla. */
export function textoRenglon(r, limite = null) {
  const partes = [`OT ${r.ot}`, `clase ${r.clase}`];
  if (r.diseno) partes.push(`Diseño del ${fechaCorta(r.diseno.inicio)} al ${fechaCorta(r.diseno.fin)} (${textoDiasHabiles(r.diseno.dias)}${r.arquitectaDiseno ? `, ${r.arquitectaDiseno}` : ""})`);
  partes.push(notaTecnica(r, true));
  if (limite) partes.push(textoLimite(limite));
  if (r.corrido > 0) partes.push(`se corrió ${textoDiasHabiles(r.corrido)} desde el plan confirmado`);
  return partes.filter(Boolean).join(", ");
}

/** "fecha límite de Técnica 20/11" con cómo viene. */
export function textoLimite(l) {
  const base = `fecha límite de Técnica ${fechaCorta(l.limite)}`;
  if (l.estado === "rojo") return `${base}, ⚠ ${l.diasTarde} ${l.diasTarde === 1 ? "día hábil" : "días hábiles"} tarde`;
  if (l.estado === "amarillo") return `${base}, poco margen`;
  return base;
}

export const AVISO_MIGRACION_161 = "Para confirmar el plan de Diseño y Técnica falta correr la migración 161 en Supabase.";

/** Panel para ordenar las planillas, elegir arquitecta y confirmar (parte 50). */
function OrdenarPlan({ renglones, deTecnica, editando, setEditando, cambio, confirmando, confirmado, corridas, aviso, arrastre, moverA, elegir, empezarArrastre, moverArrastre, soltarArrastre, deshacer, confirmar }) {
  const boton = "bg-transparent border-none text-gypi-dim cursor-pointer min-w-8 min-h-8 disabled:opacity-30";
  return (
    <section aria-label="Ordenar y confirmar el plan de Diseño y Técnica" className={`mb-2 rounded-xl border-2 p-3 ${cambio ? "border-gypi-amber bg-gypi-amber/10" : "border-gypi-border"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0 text-[14px] text-gypi-text">
          {cambio ? <><span className="font-bold">Vista previa:</span> así quedaría el plan. Las arquitectas siguen viendo el confirmado hasta que confirmes.</>
            : confirmado ? (corridas.length ? <span className="text-gypi-red-ink font-bold">↪ {corridas.length === 1 ? "1 planilla se corrió" : `${corridas.length} planillas se corrieron`} desde el plan confirmado</span> : "Plan confirmado. Para cambiar el orden o quién hace cada planilla, tocá ✏ Ordenar y asignar.")
            : "Todavía no confirmaste un plan: el orden sale de la prioridad de Producción. Podés ordenar las planillas y elegir la arquitecta de cada una."}
        </div>
        <button type="button" onClick={() => setEditando(!editando)} aria-expanded={editando} className="g-btn g-btn-secondary">{editando ? "Cerrar" : "✏ Ordenar y asignar"}</button>
        <button type="button" onClick={confirmar} disabled={confirmando} className="g-btn g-btn-primary">{confirmando ? "Confirmando…" : "✅ Confirmar plan"}</button>
        {cambio && <button type="button" onClick={deshacer} disabled={confirmando} className="g-btn g-btn-secondary">↩ Deshacer</button>}
      </div>
      {aviso && <div role="status" className="text-[14px] font-bold mt-2">{aviso}</div>}
      {editando && (
        <>
          <div className="text-[13px] text-gypi-dim mt-2 mb-1">Arrastrá una OT desde ⠿ o usá ▲▼ para cambiar el orden de las planillas. Si en el Plan de trabajo ya figuran las iniciales de una arquitecta, sigue con ella.</div>
          <ol aria-label="Orden de las planillas" className="list-none m-0 p-0 flex flex-col gap-1" onPointerMove={moverArrastre} onPointerUp={soltarArrastre} onPointerCancel={soltarArrastre}>
            {renglones.map((r, i) => (
              <li key={r.ot} data-orden-ot={r.ot}
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1 bg-gypi-surface ${arrastre?.sobre === r.ot && arrastre.ot !== r.ot ? "border-gypi-amber" : "border-gypi-border"} ${arrastre?.ot === r.ot ? "opacity-60" : ""}`}>
                <span aria-hidden="true" onPointerDown={(e) => empezarArrastre(e, r.ot)} className="cursor-grab touch-none select-none text-[18px] text-gypi-dim px-1">⠿</span>
                <span className="text-[13px] font-bold text-gypi-dim w-6 text-right">{i + 1}</span>
                <button type="button" onClick={() => moverA(r.ot, i - 1)} disabled={i === 0} aria-label={`Subir la OT ${r.ot}`} className={boton}>▲</button>
                <button type="button" onClick={() => moverA(r.ot, i + 1)} disabled={i === renglones.length - 1} aria-label={`Bajar la OT ${r.ot}`} className={boton}>▼</button>
                <span className="flex-1 min-w-[180px] text-[14px]"><NombreOt proyecto={r.proyecto} /> · {r.clase}</span>
                <span className="text-[13px] text-gypi-dim">{r.tecnica?.inicio ? `Técnica ${fechaCorta(r.tecnica.inicio)} → ${fechaCorta(r.tecnica.fin)}` : r.diseno ? "Solo Diseño" : notaTecnica(r)}</span>
                {r.tecnica && deTecnica.length > 0 && (r.arquitectaPlan ? (
                  <span className="text-[13px]">{r.arquitecta} <span className="text-gypi-dim">(según el Plan)</span></span>
                ) : (
                  <select aria-label={`Arquitecta de la OT ${r.ot}`} className="g-input !w-auto text-[14px]"
                    value={r.proyecto.arquitecta_tecnica != null ? String(r.proyecto.arquitecta_tecnica) : ""} onChange={(e) => elegir(r.ot, e.target.value)}>
                    <option value="">Automática{r.arquitecta && r.proyecto.arquitecta_tecnica == null ? ` (${r.arquitecta})` : ""}</option>
                    {deTecnica.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                ))}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

const CONTORNO = { rojo: "stroke-gypi-red", amarillo: "stroke-proc-margen", verde: "stroke-gypi-green" };

/** Lo que se escribe al final de la barra de Técnica (o en lugar de ella). */
function notaTecnica(r, largo = false) {
  if (r.tecnica?.inicio) return largo ? `Técnica del ${fechaCorta(r.tecnica.inicio)} al ${fechaCorta(r.tecnica.fin)} (${textoHoras(r.tecnica.horas)}, ${r.arquitecta})` : `${textoHoras(r.tecnica.horas)} · ${r.arquitecta}`;
  if (r.sinArquitecta) return "⚠ Técnica sin arquitecta";
  if (r.faltanHoras) return "⚠ faltan las horas de Técnica";
  return largo ? "Técnica terminada" : "";
}

/**
 * Plan de Diseño y Técnica de las OT (lo usan este Gantt y el de Producción,
 * que espera el fin de Técnica, parte 49). null mientras carga.
 */
export function usePlanDisenoTecnica({ proyectos = SIN_LISTA, divisiones = SIN_LISTA, pausas = SIN_LISTA, empresaId = null, omitir = false }) {
  const hoy = hoyArg();
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    if (omitir) return;
    let vivo = true;
    const e = empresaId ? `empresa_id=eq.${empresaId}&` : "";
    Promise.all([
      sb.get(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`).catch(() => null),
      sbGetAll(`empleados?${e}activo=eq.true&select=id,nombre&order=nombre.asc`, { maxFilas: 2000 }).catch(() => null),
    ]).then(([cfg, emp]) => {
      if (vivo) setDatos({ cfgValor: cfg?.[0]?.valor || null, personal: emp?.data || [] });
    });
    return () => { vivo = false; };
  }, [empresaId, omitir]);
  return useMemo(() => {
    if (!datos) return null;
    const armar = (lista) => planDeEmpresa({ proyectos: lista, divisiones, cfgValor: datos.cfgValor, personal: datos.personal, hoy, pausadas: otsEnPausa(pausas) });
    // rehacer: el mismo plan con otro orden o arquitectas (vista previa, parte 50)
    return { ...armar(proyectos), rehacer: (cambio) => armar(conCambio(proyectos, cambio)) };
  }, [datos, proyectos, divisiones, pausas, hoy]);
}

/**
 * @param {object} props
 * @param {object} [props.calculo] usePlanDisenoTecnica(...) del Gantt de OT; sin él, lo arma solo
 * @param {{ renglones: object[] }|null} [props.vivo] plan vivo de Producción (para la fecha límite de Técnica)
 * @param {boolean} [props.puedeReordenar] Dueño o supervisor: cambia el orden, la arquitecta y confirma (parte 50)
 * @param {() => void} [props.onRefrescar] vuelve a leer las OT después de confirmar
 */
export default function GanttDisenoTecnica({ proyectos = SIN_LISTA, divisiones = SIN_LISTA, pausas = SIN_LISTA, empresaId = null, onVerDetalle, calculo: calculoProp = null, vivo = null, puedeReordenar = false, onRefrescar = null }) {
  const hoy = hoyArg();
  const scrollRef = useRef(null);
  const medir = useCallback((el) => { scrollRef.current = el; }, []);
  const propio = usePlanDisenoTecnica({ proyectos, divisiones, pausas, empresaId, omitir: !!calculoProp });
  const base = calculoProp || propio;
  // Orden y arquitectas que se están probando (parte 50); null = el plan guardado
  const [cambio, setCambio] = useState(null);
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [arrastre, setArrastre] = useState(null); // { ot, sobre }
  const calculo = useMemo(() => (base && cambio && base.rehacer ? base.rehacer(cambio) : base), [base, cambio]);
  const [grande, setGrande] = useState(false);
  const cerrarGrande = () => { setGrande(false); salirPantallaCompleta(); };
  useEscape(cerrarGrande, grande);
  useEffect(() => () => { salirPantallaCompleta(); }, []);
  // Fecha límite de Técnica de cada OT con lo que dura su Producción en el plan vivo (parte 49)
  const limites = useMemo(() => {
    const m = new Map();
    if (!calculo || !vivo?.renglones) return m;
    const prod = new Map(vivo.renglones.map((r) => [String(r.ot), r]));
    for (const r of calculo.renglones) {
      const l = limiteTecnica(prod.get(r.ot), r.tecnica?.fin || null, calculo.feriados);
      if (l) m.set(r.ot, l);
    }
    return m;
  }, [calculo, vivo]);

  if (!calculo) return <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;
  const { renglones, sinDato, sinEtapas, terminadas, arquitectas, feriados } = calculo;
  const sinArquitectas = !arquitectas.some((a) => a.pctTecnica > 0);
  const deTecnica = arquitectas.filter((a) => a.pctTecnica > 0);

  // ─── Ordenar, asignar y confirmar (parte 50) ───
  const ordenVisto = renglones.map((r) => r.ot);
  const elegidas = () => cambio?.arquitectas || Object.fromEntries(renglones.map((r) => [r.ot, r.proyecto.arquitecta_tecnica != null ? String(r.proyecto.arquitecta_tecnica) : null]));
  // Prueba el cambio: si alguna OT queda más tarde contra su entrega, no lo hace y avisa
  const probar = (nuevo, que) => {
    const despues = base.rehacer ? base.rehacer(nuevo) : null;
    const malas = despues ? entregasComprometidas(calculo, despues, vivo) : [];
    if (malas.length) {
      const m = malas[0];
      setAviso(`⛔ No se puede ${que}: la ${textoOt(m.proyecto || { ot: m.ot })} terminaría la Técnica ${textoDiasHabiles(m.diasTarde)} después de su fecha límite (${fechaCorta(m.limite)}) y no llegaría a la entrega programada${malas.length > 1 ? ` (y ${malas.length - 1} OT más)` : ""}.`);
      return;
    }
    setAviso(null);
    setCambio(nuevo);
  };
  const moverA = (ot, destino) => {
    const i = ordenVisto.indexOf(ot);
    if (i < 0 || destino < 0 || destino >= ordenVisto.length || destino === i) return;
    probar({ orden: mover(ordenVisto, i, destino), arquitectas: elegidas() }, `mover la OT ${ot} ahí`);
  };
  const elegir = (ot, id) => {
    probar({ orden: ordenVisto, arquitectas: { ...elegidas(), [ot]: id || null } }, "asignarla así");
  };
  const verDetalle = (p) => { if (grande) cerrarGrande(); onVerDetalle?.(p); };
  const movible = puedeReordenar && renglones.length > 1;
  const empezarArrastre = (e, ot) => { e.currentTarget.setPointerCapture?.(e.pointerId); setArrastre({ ot, sobre: ot }); };
  const moverArrastre = (e) => {
    if (!arrastre || typeof document === "undefined" || !document.elementFromPoint) return;
    const ot = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-orden-ot]")?.getAttribute("data-orden-ot");
    if (ot && ot !== arrastre.sobre) setArrastre({ ...arrastre, sobre: ot });
  };
  const soltarArrastre = () => {
    if (!arrastre) return;
    const { ot, sobre } = arrastre;
    setArrastre(null);
    if (sobre !== ot) moverA(ot, ordenVisto.indexOf(sobre));
  };
  const deshacer = () => { setCambio(null); setAviso(null); };
  const confirmar = async () => {
    setConfirmando(true);
    setAviso(null);
    try {
      const cuerpos = cuerposConfirmar(renglones);
      for (let i = 0; i < cuerpos.length; i += 10) {
        await Promise.all(cuerpos.slice(i, i + 10).map((c) => sb.patch(`proyectos?id=eq.${c.id}`, c.cuerpo)));
      }
      setAviso(`✅ Plan confirmado: ${cuerpos.length} OT. Cada arquitecta lo ve en 📐 Mis planillas.`);
      setEditando(false);
      await onRefrescar?.();
      setCambio(null);
    } catch (e) {
      setAviso(/orden_tecnica|arquitecta_tecnica|tecnica_fin_confirmado/.test(String(e?.message)) ? AVISO_MIGRACION_161 : `No se pudo confirmar: ${e?.message || "error"}`);
    } finally {
      setConfirmando(false);
    }
  };
  const confirmado = hayConfirmado(renglones);
  const corridas = renglones.filter((r) => r.corrido > 0);

  const ultimo = finDelPlan(renglones, sumarDias(hoy, 13));
  const totalDias = Math.min(400, Math.round((Date.parse(`${ultimo}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / DIA_MS) + 3);
  const fechas = Array.from({ length: totalDias }, (_, i) => sumarDias(hoy, i));
  const x = (fecha) => Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / DIA_MS) * PX;
  const ancho = totalDias * PX;
  const navegar = (paso) => { const el = scrollRef.current; if (el) el.scrollLeft = Math.max(0, el.scrollLeft + paso * 7 * PX); };
  const irAHoy = () => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; };

  // Carga de cada arquitecta: OT y hasta cuándo tiene trabajo de Técnica
  const carga = arquitectas.filter((a) => a.pctTecnica > 0).map((a) => {
    const suyas = renglones.filter((r) => r.arquitectaId === a.id && r.tecnica?.fin);
    return { ...a, ots: suyas.length, hasta: suyas.reduce((m, r) => (r.tecnica.fin > m ? r.tecnica.fin : m), "") };
  });

  const barra = (tramos, y, alto, clase, key, estado = null) => barrasSeguidas(tramos).map((b) => {
    const x0 = ETIQUETAS + x(b.desde.fecha) + b.desde.desde * PX;
    const x1 = ETIQUETAS + x(b.hasta.fecha) + b.hasta.hasta * PX;
    return <rect key={`${key}|${b.desde.fecha}|${b.desde.desde}`} data-barra={key} data-estado={estado || undefined} x={x0 + 1} y={y} width={Math.max(2, x1 - x0 - 2)} height={alto} rx={3}
      className={`${clase} ${estado ? CONTORNO[estado] : ""}`} strokeWidth={estado ? 2.5 : 0} strokeDasharray={estado === "amarillo" ? "4 2" : undefined} />;
  });
  const conLimite = [...limites.values()];
  const rojas = conLimite.filter((l) => l.estado === "rojo").length;
  const amarillas = conLimite.filter((l) => l.estado === "amarillo").length;

  return (
    <section aria-label="Gantt de Diseño y Técnica" role={grande ? "dialog" : undefined}
      className={grande ? "fixed inset-0 z-[300] bg-gypi-bg p-3 flex flex-col overflow-y-auto" : ""}>
      <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label="Moverse en el Gantt de Diseño y Técnica">
        <button type="button" onClick={() => navegar(-1)} aria-label="Una semana para atrás" className="g-btn g-btn-secondary min-w-11">◀</button>
        <button type="button" onClick={irAHoy} className="g-btn g-btn-secondary">Hoy</button>
        <button type="button" onClick={() => navegar(1)} aria-label="Una semana para adelante" className="g-btn g-btn-secondary min-w-11">▶</button>
        <button type="button" onClick={grande ? cerrarGrande : () => { setGrande(true); pedirPantallaCompleta(); }} className="g-btn g-btn-secondary ml-auto">
          {grande ? "✕ Salir" : "⛶ Pantalla completa"}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-gypi-text mb-2" aria-label="Colores del Gantt de Diseño y Técnica">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm bg-area-diseno" />Diseño</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm bg-area-tecnica" />Técnica</span>
        {vivo && <>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-gypi-green" />🟢 Llega a su fecha límite</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-dashed border-proc-margen" />🟡 Poco margen {amarillas}</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-gypi-red" /><span className={rojas ? "text-gypi-red font-bold" : ""}>🔴 Termina después de su fecha límite {rojas}</span></span>
        </>}
      </div>

      {carga.length > 0 && (
        <ul className="list-none m-0 p-0 flex flex-wrap gap-2 mb-2" aria-label="Carga de las arquitectas">
          {carga.map((a) => (
            <li key={a.id} className="g-card py-2 px-3 text-[14px]">
              <span className="font-bold">{a.nombre}</span>
              <span className="text-gypi-dim"> · {a.pctTecnica} % Técnica · {a.ots} OT{a.hasta ? ` · ocupada hasta el ${fechaCorta(a.hasta)}` : " · libre"}</span>
            </li>
          ))}
        </ul>
      )}
      {sinArquitectas && (
        <div role="status" className="text-[14px] text-gypi-amber-ink font-bold mb-2">Todavía no hay arquitectas de Técnica: elegilas en ⚙ Parámetros → 📐 Diseño y Técnica para poder repartir las planillas.</div>
      )}

      {puedeReordenar && renglones.length > 0 && (
        <OrdenarPlan {...{ renglones, deTecnica, editando, setEditando, cambio, confirmando, confirmado, corridas, aviso, arrastre, moverA, elegir, empezarArrastre, moverArrastre, soltarArrastre, deshacer, confirmar }} />
      )}
      {!puedeReordenar && aviso && <div role="status" className="text-[14px] font-bold mb-2">{aviso}</div>}

      {!renglones.length ? (
        <div className="g-card py-8 px-6 text-center">
          <div className="text-[28px] mb-2">📐</div>
          <div className="text-sm font-bold text-gypi-text mb-1">No hay OT en Diseño ni en Técnica</div>
          <div className="text-xs text-gypi-dim">Entran las OT abiertas que tienen alguna etapa de Diseño o de Técnica sin hacer en el Plan de trabajo (columnas DIS a PDF). Apretá Sincronizar en OT para traerlas.</div>
        </div>
      ) : (
        <div ref={medir} className={`overflow-auto border border-gypi-border rounded-xl bg-gypi-surface ${grande ? "flex-1 min-h-[40vh]" : ""}`}>
          <svg width={ETIQUETAS + ancho} height={CAB + renglones.length * FILA} role="img" aria-label={`Diseño y Técnica de ${renglones.length} OT`}
            onPointerMove={moverArrastre} onPointerUp={soltarArrastre} onPointerCancel={soltarArrastre}>
            {fechas.map((f) => {
              const d = new Date(`${f}T00:00:00Z`).getUTCDay();
              return (
                <g key={f}>
                  {!esDiaHabil(f, feriados) && <rect data-sin-trabajo={f} x={ETIQUETAS + x(f)} y={0} width={PX} height={CAB + renglones.length * FILA} className="fill-gypi-surf-hi" />}
                  <line x1={ETIQUETAS + x(f)} x2={ETIQUETAS + x(f)} y1={0} y2={CAB + renglones.length * FILA} className={d === 1 ? "stroke-gypi-dim" : "stroke-gypi-border"} strokeWidth={d === 1 ? 1 : 0.5} />
                  <text x={ETIQUETAS + x(f) + PX / 2} y={16} textAnchor="middle" className="fill-gypi-dim text-[12px]">{DIAS[d]}</text>
                  <text x={ETIQUETAS + x(f) + PX / 2} y={32} textAnchor="middle" className={f === hoy ? "fill-gypi-amber text-[12px] font-bold" : "fill-gypi-text text-[12px]"}>{Number(f.slice(8))}/{Number(f.slice(5, 7))}</text>
                </g>
              );
            })}
            {renglones.map((r, i) => {
              const y = CAB + i * FILA;
              const p = r.proyecto;
              const sub = [partesOt(p).cliente, partesOt(p).proyecto].filter(Boolean).join(" · ");
              const fin = r.tecnica?.fin || r.diseno?.fin;
              const finFrac = r.tecnica?.tramos?.at(-1)?.hasta ?? r.diseno?.tramos?.at(-1)?.hasta ?? 1;
              const lim = limites.get(r.ot) || null;
              const nota = [notaTecnica(r), lim && r.tecnica?.inicio ? `límite ${fechaCorta(lim.limite)}${lim.estado === "rojo" ? ` · ⚠ ${lim.diasTarde} d tarde` : ""}` : null, r.corrido > 0 ? `↪ se corrió ${r.corrido} d` : null].filter(Boolean).join(" · ");
              return (
                <g key={r.ot} role="button" tabIndex={0} aria-label={textoRenglon(r, lim)} data-orden-ot={movible ? r.ot : undefined}
                  className={`cursor-pointer ${arrastre?.ot === r.ot ? "opacity-60" : ""}`}
                  onClick={() => verDetalle(p)} onKeyDown={(e) => { if (e.key === "Enter") verDetalle(p); }}>
                  <rect x={0} y={y} width={ETIQUETAS + ancho} height={FILA} className="fill-transparent" />
                  {arrastre && arrastre.sobre === r.ot && arrastre.ot !== r.ot && (
                    <rect data-destino={r.ot} x={0} y={y} width={ETIQUETAS + ancho} height={FILA} className="fill-gypi-amber stroke-gypi-amber" fillOpacity={0.15} strokeWidth={2} />
                  )}
                  {movible && (
                    <text data-arrastrar={r.ot} x={ETIQUETAS - 22} y={y + 34} className="fill-gypi-dim text-[20px] cursor-grab select-none touch-none"
                      onPointerDown={(e) => { e.stopPropagation(); empezarArrastre(e, r.ot); }} onClick={(e) => e.stopPropagation()}>⠿</text>
                  )}
                  <line x1={0} x2={ETIQUETAS + ancho} y1={y + FILA} y2={y + FILA} className="stroke-gypi-border" strokeWidth={0.5} />
                  <text x={8} y={y + 16} className="fill-gypi-text text-[13px] font-bold font-mono">{r.ot} · {r.clase}</text>
                  <text x={8} y={y + 32} className="fill-gypi-dim text-[12px]">{(sub || nombreTipo(r.tipo)).slice(0, movible ? 32 : 38)}</text>
                  <text x={8} y={y + 48} className="fill-gypi-text text-[12px] font-semibold">{(partesOt(p).descripcion || "").slice(0, movible ? 32 : 38)}</text>
                  {r.diseno && barra(r.diseno.tramos, y + 8, 18, "fill-area-diseno", `diseno-${r.ot}`)}
                  {r.tecnica?.tramos?.length > 0 && barra(r.tecnica.tramos, y + 30, 18, "fill-area-tecnica", `tecnica-${r.ot}`, lim?.estado || null)}
                  {lim && lim.limite >= hoy && lim.limite < sumarDias(hoy, totalDias) && (
                    <line data-limite={r.ot} x1={ETIQUETAS + x(lim.limite) + PX} x2={ETIQUETAS + x(lim.limite) + PX} y1={y + 27} y2={y + 51} className="stroke-gypi-red" strokeWidth={2} />
                  )}
                  {fin && nota && (
                    <text x={ETIQUETAS + x(fin) + finFrac * PX + 4} y={y + 43} className="fill-gypi-text text-[12px]">{nota}</text>
                  )}
                  {!fin && nota && <text x={ETIQUETAS + 6} y={y + 43} className="fill-gypi-red-ink text-[12px] font-bold">{nota}</text>}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {(sinDato.length > 0 || sinEtapas > 0 || terminadas > 0) && (
        <div className="g-card mt-2 text-[14px] text-gypi-text">
          {sinDato.length > 0 && (
            <div className="mb-2">
              <div className="font-bold mb-1">Sin horas de Técnica · {sinDato.length}</div>
              <div className="text-gypi-dim text-[13px] mb-1">Cargá las horas de su tipo y clase en ⚙ Parámetros → 📐 Diseño y Técnica, o ponelas a mano en el Detalle de la OT.</div>
              <ul className="list-none m-0 p-0 flex flex-wrap gap-1.5">
                {sinDato.map((r) => (
                  <li key={r.ot}><button type="button" className="g-btn g-btn-secondary text-left" onClick={() => verDetalle(r.proyecto)}><NombreOt proyecto={r.proyecto} /> · {nombreTipo(r.tipo)} {r.clase}</button></li>
                ))}
              </ul>
            </div>
          )}
          {terminadas > 0 && <div className="text-gypi-dim text-[13px]">{terminadas === 1 ? "1 OT ya tiene" : `${terminadas} OT ya tienen`} Diseño y Técnica terminados.</div>}
          {sinEtapas > 0 && <div className="text-gypi-dim text-[13px]">{sinEtapas === 1 ? "1 OT no tiene" : `${sinEtapas} OT no tienen`} las columnas DIS a PDF en el Plan de trabajo: no entran.</div>}
        </div>
      )}
      {!grande && <p className="text-[13px] text-gypi-mute mt-2 mb-0">Plan vivo: se arma cada día desde hoy, de lunes a viernes sin feriados. Diseño (celeste) dura los días hábiles de la OT, menos lo que ya está hecho; varias OT pueden estar en Diseño a la vez porque incluye esperar la aprobación. Técnica (rosa) arranca cuando termina Diseño y son horas de una arquitecta, que hace una planilla por vez con su % de Técnica de la jornada. Si en el Plan ya figuran sus iniciales, la OT sigue con ella; si no, va a la que la termina antes. El orden es el confirmado acá (si hay) y después la prioridad de Producción y la semana de entrega. La línea roja es la fecha límite de Técnica: el último día en que puede terminar para que Producción, con lo que dura en su plan, llegue a su fecha límite. Producción no arranca una OT hasta el día hábil siguiente a que termina su Técnica, salvo que EXCEL ya esté hecho (arranca con aviso). Tocá una OT para ver su detalle.{movible ? " Para cambiar el orden, arrastrá una OT desde ⠿: no deja moverla si otra OT no llegaría a su entrega programada." : ""}</p>}
    </section>
  );
}
