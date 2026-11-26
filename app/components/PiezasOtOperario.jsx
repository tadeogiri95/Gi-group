'use client';
// app/components/PiezasOtOperario.jsx — El operario mira las piezas y los
// módulos de una OT y cuántas lleva escaneadas (pedido de Tadeo, 26/11).
// Solo para mirar: no imprime, no pega la planilla ni borra (eso queda en
// Producción → 🧩 Piezas, PiezasOt.jsx). Se elige la etapa (viene la última
// en la que escaneó) y se ve, por módulo, "8 de 12" y cada pieza con su
// cuenta. En la etapa de canto por lados (209) la pieza a medio pegar dice
// "2 de 3 lados". Se abre desde el Inicio del operario (🧩 Piezas de una OT)
// y desde cada pieza escaneada en Escanear piezas.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import Modal from "./ui/Modal";
import { TituloOt } from "./NombreOt";
import { reglasPieza, nombresEtapas, agruparRenglones, avancePiezas, medidas, escaneosPorPieza } from "../lib/piezas";

export const CLAVE_ETAPA_PIEZAS = "gypi_etapa_piezas";
const SIN_MODULO = "\u0000sin";
const LECTURA = { maxFilas: 20000 };

function etapaGuardada() {
  try { return Number(localStorage.getItem(CLAVE_ETAPA_PIEZAS)) || null; } catch { return null; }
}

/**
 * Avance de una etapa por módulo. Cada renglón (pieza de la planilla) trae
 * cuántas unidades pasaron y, si la etapa cuenta por lados, cuántos lados van
 * pegados entre todas sus unidades (las completas cuentan todos sus lados).
 */
export function avancePorModulo({ piezas = [], pasos = [], lados = [], etapa, porLados = false }) {
  const e = Number(etapa);
  const hechas = new Set(pasos.filter((p) => Number(p.etapa) === e).map((p) => p.pieza_id));
  const ladosHechos = new Map();
  for (const l of lados) if (Number(l.etapa) === e) ladosHechos.set(l.pieza_id, (ladosHechos.get(l.pieza_id) || 0) + 1);
  const modulos = new Map();
  for (const r of agruparRenglones(piezas)) {
    const llevan = r.piezas.filter((p) => (p.etapas || []).map(Number).includes(e));
    if (!llevan.length) continue;
    const pasaron = llevan.filter((p) => hechas.has(p.id)).length;
    const renglon = { ...r, total: llevan.length, pasaron };
    const porPieza = escaneosPorPieza(r, porLados);
    if (porPieza > 1) {
      renglon.ladosTotal = llevan.length * porPieza;
      renglon.ladosHechos = llevan.reduce((s, p) => s + (hechas.has(p.id) ? porPieza : Math.min(ladosHechos.get(p.id) || 0, porPieza)), 0);
    }
    const clave = r.modulo || SIN_MODULO;
    if (!modulos.has(clave)) modulos.set(clave, { modulo: r.modulo || null, total: 0, pasaron: 0, renglones: [] });
    const m = modulos.get(clave);
    m.total += renglon.total;
    m.pasaron += renglon.pasaron;
    m.renglones.push(renglon);
  }
  // Las piezas sin módulo van al final
  return [...modulos.values()].sort((a, b) => (a.modulo ? 0 : 1) - (b.modulo ? 0 : 1));
}

const deTexto = (a, b) => `${a.toLocaleString("es-AR")} de ${b.toLocaleString("es-AR")}`;

function Barra({ pasaron, total }) {
  const color = pasaron >= total ? "[&::-webkit-progress-value]:bg-gypi-green [&::-moz-progress-bar]:bg-gypi-green" : "[&::-webkit-progress-value]:bg-gypi-amber [&::-moz-progress-bar]:bg-gypi-amber";
  return (
    <progress value={Math.min(pasaron, total)} max={total || 1} aria-hidden="true"
      className={`block w-full h-1.5 mt-1 appearance-none rounded-full overflow-hidden bg-gypi-surf-hi [&::-webkit-progress-bar]:bg-gypi-surf-hi ${color}`} />
  );
}

export default function PiezasOtOperario({ empresaId, ot, onClose }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [etapa, setEtapa] = useState(etapaGuardada);
  const [soloFaltan, setSoloFaltan] = useState(false);
  const [leyendo, setLeyendo] = useState(false);

  const cargar = useCallback(async () => {
    if (!ot) return;
    setLeyendo(true);
    // /api/data ya filtra por la empresa del usuario; empresaId es por las dudas
    const deEmpresa = empresaId ? `empresa_id=eq.${empresaId}&` : "";
    const filtro = `${deEmpresa}ot=eq.${encodeURIComponent(ot)}`;
    try {
      const [proyecto, piezas, pasos, lados, etapas] = await Promise.all([
        sbGetAll(`proyectos?${filtro}&select=id,ot,cliente,obra,proyecto,descripcion&order=id.desc`, { maxFilas: 1 }).then((r) => r.data?.[0] || { ot }).catch(() => ({ ot })),
        sbGetAll(`piezas_ot?${filtro}&order=renglon.asc,unidad.asc,id.asc&select=*`, LECTURA).then((r) => r.data || []),
        sbGetAll(`pasos_pieza?${filtro}&order=id.asc&select=pieza_id,etapa`, LECTURA).then((r) => r.data || []).catch(() => []),
        // Sin la migración 209 no hay canto por lados
        sbGetAll(`lados_pieza?${filtro}&order=id.asc&select=pieza_id,etapa`, LECTURA).then((r) => r.data || []).catch(() => []),
        sbGetAll(`etapas?${deEmpresa}order=orden.asc&select=codigo,nombre,orden,activa,icon,color,por_pieza,columna_pieza`)
          .then((r) => r.data || []).catch(() => []),
      ]);
      setDatos({ proyecto, piezas, pasos, lados, etapas });
      setError(null);
    } catch {
      setError("No se pudieron leer las piezas. Probá de nuevo.");
      setDatos((d) => d || { proyecto: { ot }, piezas: [], pasos: [], lados: [], etapas: [] });
    } finally {
      setLeyendo(false);
    }
  }, [empresaId, ot]);

  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect

  const piezas = useMemo(() => datos?.piezas || [], [datos]);
  const reglas = useMemo(() => reglasPieza(datos?.etapas || []), [datos]);
  const nombres = useMemo(() => nombresEtapas(datos?.etapas || []), [datos]);
  const avance = useMemo(() => avancePiezas(piezas, datos?.pasos || [], reglas.map((r) => r.codigo)), [piezas, datos, reglas]);
  // Etapas que tiene esta OT; si la guardada no está, la primera
  const elegida = avance.some((a) => a.codigo === etapa) ? etapa : avance[0]?.codigo ?? null;
  const porLados = Boolean(reglas.find((r) => r.codigo === elegida)?.porLados);
  const modulos = useMemo(
    () => (elegida == null ? [] : avancePorModulo({ piezas, pasos: datos?.pasos || [], lados: datos?.lados || [], etapa: elegida, porLados })),
    [piezas, datos, elegida, porLados],
  );
  const visibles = soloFaltan
    ? modulos.map((m) => ({ ...m, renglones: m.renglones.filter((r) => r.pasaron < r.total) })).filter((m) => m.renglones.length)
    : modulos;
  const nombreEtapa = nombres[elegida] || `Etapa ${elegida}`;
  const total = avance.find((a) => a.codigo === elegida);

  return (
    <Modal open onClose={onClose} title={`OT ${ot} · Piezas`}>
      <div className="p-4 overflow-y-auto text-gypi-text">
        {datos && <div className="mb-3"><TituloOt proyecto={datos.proyecto} /></div>}
        {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}

        {!datos ? (
          <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
        ) : !piezas.length ? (
          <div className="text-[14px] text-gypi-dim py-3">Esta OT todavía no tiene piezas cargadas. Las carga técnica o el encargado.</div>
        ) : !avance.length ? (
          <div className="text-[14px] text-gypi-dim py-3">Las piezas de esta OT no tienen etapas para escanear.</div>
        ) : (
          <>
            <div className="text-[13px] font-bold text-gypi-dim mb-1.5" id="etapa-ver-piezas">¿Qué etapa querés ver?</div>
            <div className="grid grid-cols-2 gap-1.5 mb-3" role="group" aria-labelledby="etapa-ver-piezas">
              {avance.map((a) => (
                <button key={a.codigo} onClick={() => setEtapa(a.codigo)} aria-pressed={elegida === a.codigo}
                  className={`min-h-[52px] rounded-lg border px-2 text-left cursor-pointer ${elegida === a.codigo ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-surface border-gypi-border text-gypi-dim"}`}>
                  <div className="text-[14px] font-bold">{nombres[a.codigo] || `Etapa ${a.codigo}`}</div>
                  <div className="text-[12px]">{deTexto(a.pasaron, a.total)}</div>
                </button>
              ))}
            </div>

            {total && (
              <div className="g-card mb-3" role="status">
                <div className="text-[14px] font-bold">
                  {total.pasaron >= total.total ? `✅ Pasaron todas por ${nombreEtapa}` : `${nombreEtapa}: ${deTexto(total.pasaron, total.total)} piezas`}
                </div>
                <Barra pasaron={total.pasaron} total={total.total} />
                {porLados && <div className="text-[12px] text-gypi-dim mt-1">En {nombreEtapa} cada lado con canto es un escaneo: la pieza cuenta recién con el último lado.</div>}
              </div>
            )}

            <div className="flex gap-2 mb-3">
              <button onClick={() => setSoloFaltan(!soloFaltan)} aria-pressed={soloFaltan}
                className={`flex-1 min-h-[44px] rounded-lg border text-[13px] font-bold cursor-pointer ${soloFaltan ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-transparent border-gypi-border text-gypi-dim"}`}>
                {soloFaltan ? "✓ " : ""}Solo las que faltan
              </button>
              <button onClick={cargar} disabled={leyendo} className="g-btn g-btn-secondary">{leyendo ? "Leyendo…" : "↻ Actualizar"}</button>
            </div>

            {soloFaltan && !visibles.length && <div className="text-[14px] text-gypi-green mb-3">✅ No falta ninguna en {nombreEtapa}.</div>}
            <ul aria-label="Módulos de la OT" className="list-none p-0 m-0 flex flex-col gap-2">
              {visibles.map((m) => {
                const titulo = m.modulo ? `Módulo ${m.modulo}` : "Piezas sin módulo";
                const completo = m.pasaron >= m.total;
                return (
                  <li key={m.modulo || SIN_MODULO}>
                    <details open={visibles.length <= 3} className="bg-gypi-surface rounded-xl border border-gypi-border">
                      <summary className="cursor-pointer p-2.5 list-none" aria-label={`${titulo}: ${deTexto(m.pasaron, m.total)} piezas`}>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 min-w-0 text-[14px] font-bold truncate">{completo ? "✅ " : ""}{titulo}</span>
                          <span className={`text-[13px] font-bold ${completo ? "text-gypi-green" : "text-gypi-amber-ink"}`}>{deTexto(m.pasaron, m.total)}</span>
                        </div>
                        <Barra pasaron={m.pasaron} total={m.total} />
                      </summary>
                      <ul aria-label={`Piezas de ${titulo}`} className="list-none p-0 m-0 px-2.5 pb-2.5 flex flex-col gap-1">
                        {m.renglones.map((r) => {
                          const listo = r.pasaron >= r.total;
                          return (
                            <li key={r.nombre} className="flex items-start gap-2 border-t border-gypi-border pt-1.5">
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-semibold">{r.nombre}</div>
                                <div className="text-[12px] text-gypi-dim truncate">{[medidas(r), r.material].filter(Boolean).join(" · ")}</div>
                                {r.ladosTotal > 0 && !listo && (
                                  <div className="text-[12px] text-gypi-amber-ink">Lados con canto: {deTexto(r.ladosHechos, r.ladosTotal)}</div>
                                )}
                              </div>
                              <span className={`text-[13px] font-bold whitespace-nowrap ${listo ? "text-gypi-green" : r.pasaron ? "text-gypi-amber-ink" : "text-gypi-dim"}`}>
                                {listo ? "✓ " : ""}{deTexto(r.pasaron, r.total)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
