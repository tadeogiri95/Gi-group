'use client';
// app/components/PiezasOt.jsx — Piezas de una OT con etiqueta QR (Órdenes de
// Producción, parte 17). Técnica pega la planilla técnica (hoja PLANILLA o
// CUT RITE) y se imprime una etiqueta por pieza física. Cada renglón muestra
// las etapas que le tocan (las de la empresa que se escanean por pieza,
// Configuración → Etapas), que se pueden corregir a mano. El escaneo en cada
// etapa es la parte 18.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { TAMANOS_ETIQUETA } from "../lib/carga";
import {
  reglasPieza, nombresEtapas, leerPiezas, expandirPiezas, agruparRenglones, cambiosAlReemplazar, medidas, imprimirEtiquetasPiezas,
  avancePiezas, textoAvancePiezas,
} from "../lib/piezas";

const CLAVE_TAMANO = "gypi_tamano_etiqueta";
const SIN_MODULO = "\u0000sin";

function leerTamano() {
  try { return localStorage.getItem(CLAVE_TAMANO) || TAMANOS_ETIQUETA[0].id; } catch { return TAMANOS_ETIQUETA[0].id; }
}

const piezasTexto = (n) => (n === 1 ? "1 pieza" : `${n.toLocaleString("es-AR")} piezas`);

export default function PiezasOt({ proyecto, empresaId, empresa = null, esGestion = false, onClose }) {
  const [piezas, setPiezas] = useState(null);
  const [pasos, setPasos] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [faltanEn, setFaltanEn] = useState("");
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [pegando, setPegando] = useState(false);
  const [pegado, setPegado] = useState("");
  const [tamano, setTamano] = useState(leerTamano);
  const [modulo, setModulo] = useState("");
  const [confirmarVaciar, setConfirmarVaciar] = useState(false);
  const [listo, setListo] = useState(null);

  const ot = String(proyecto?.ot ?? "");
  const cargar = useCallback(async () => {
    if (!ot || !empresaId) return;
    try {
      const filtro = `empresa_id=eq.${empresaId}&ot=eq.${encodeURIComponent(ot)}`;
      const [{ data }, escaneos, deEmpresa] = await Promise.all([
        sbGetAll(`piezas_ot?${filtro}&order=renglon.asc,unidad.asc,id.asc&select=*`),
        // Sin la migración 110 todavía no hay escaneos (parte 18)
        sbGetAll(`pasos_pieza?${filtro}&order=id.asc&select=pieza_id,etapa`).then((r) => r.data || []).catch(() => []),
        // Sin la 112 ninguna etapa se escanea por pieza
        sbGetAll(`etapas?empresa_id=eq.${empresaId}&order=orden.asc&select=codigo,nombre,orden,activa,icon,color,por_pieza,columna_pieza`)
          .catch(() => sbGetAll(`etapas?empresa_id=eq.${empresaId}&order=orden.asc&select=codigo,nombre,orden,activa`))
          .then((r) => r.data || []).catch(() => []),
      ]);
      setPiezas(data || []);
      setPasos(escaneos);
      setEtapas(deEmpresa);
      setAviso(null);
    } catch {
      setPiezas([]);
      setAviso("No se pudieron leer las piezas (¿falta correr la migración 109?).");
    }
  }, [ot, empresaId]);

  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect

  const enviar = async (body) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/piezas", { method: "POST", body: JSON.stringify(body) });
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

  const reglas = useMemo(() => reglasPieza(etapas), [etapas]);
  const nombres = useMemo(() => nombresEtapas(etapas), [etapas]);
  const orden = useMemo(() => reglas.map((r) => r.codigo), [reglas]);
  const nombreDe = (c) => nombres[c] || `Etapa ${c}`;
  const vista = useMemo(() => (pegando && pegado.trim() ? leerPiezas(pegado, reglas) : null), [pegando, pegado, reglas]);
  const nuevas = useMemo(() => (vista ? expandirPiezas(vista.renglones) : []), [vista]);
  const cambios = vista && piezas?.length ? cambiosAlReemplazar(piezas, nuevas) : null;

  const guardar = async () => {
    const data = await enviar({ accion: "cargar", ot, renglones: vista.renglones });
    if (!data) return;
    setPegando(false);
    setPegado("");
    setListo(`Listo: la OT tiene ${piezasTexto(data.piezas)}.${data.salen ? ` Se sacaron ${data.salen}.` : ""}`);
    await cargar();
  };

  const vaciar = async () => {
    setConfirmarVaciar(false);
    if (await enviar({ accion: "vaciar", ot })) { setPiezas([]); setListo(null); }
  };

  const cambiarEtapa = async (renglon, etapa) => {
    const tiene = renglon.etapas.includes(etapa);
    const lista = orden.filter((e) => (e === etapa ? !tiene : renglon.etapas.includes(e)));
    const data = await enviar({ accion: "etapas", ot, nombre: renglon.nombre, etapas: lista });
    if (data) setPiezas((prev) => prev.map((p) => (p.nombre === renglon.nombre ? { ...p, etapas: data.etapas } : p)));
  };

  const renglones = useMemo(() => agruparRenglones(piezas || []), [piezas]);
  const avance = useMemo(() => avancePiezas(piezas || [], pasos, orden), [piezas, pasos, orden]);
  const hechos = useMemo(() => new Set(pasos.map((p) => `${p.pieza_id}|${p.etapa}`)), [pasos]);
  const pasaron = (r, etapa) => r.piezas.filter((p) => hechos.has(`${p.id}|${etapa}`)).length;
  const visibles = faltanEn ? renglones.filter((r) => r.etapas.includes(faltanEn) && pasaron(r, faltanEn) < r.piezas.length) : renglones;
  // Las etapas que se pueden marcar en cada renglón: las de la empresa y las que ya tenga la pieza
  const etapasRenglon = (r) => [...orden, ...r.etapas.filter((e) => !orden.includes(e))];
  const modulos = useMemo(() => {
    const m = new Map();
    for (const r of renglones) {
      const clave = r.modulo || SIN_MODULO;
      m.set(clave, (m.get(clave) || 0) + r.piezas.length);
    }
    return [...m.entries()];
  }, [renglones]);
  const paraImprimir = (piezas || []).filter((p) => !modulo || (p.modulo || SIN_MODULO) === modulo);

  const imprimir = async (lista) => {
    setError(null);
    const t = TAMANOS_ETIQUETA.find((x) => x.id === tamano) || TAMANOS_ETIQUETA[0];
    try { localStorage.setItem(CLAVE_TAMANO, t.id); } catch { /* sin almacenamiento */ }
    try {
      await imprimirEtiquetasPiezas({ empresa: empresa?.nombre_corto || "", ot, piezas: lista, tamano: t, nombres });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label={`Piezas de la OT ${ot}`}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="g-overline text-gypi-amber-ink">Orden {ot} · Piezas</div>
            <h3 className="m-0 font-heading text-lg font-bold truncate">{proyecto?.cliente || proyecto?.proyecto || "—"}</h3>
            {piezas?.length > 0 && (
              <div className="text-xs text-gypi-dim mt-0.5">
                {piezasTexto(piezas.length)} · {renglones.length === 1 ? "1 renglón" : `${renglones.length} renglones`}
                {modulos.filter(([m]) => m !== SIN_MODULO).length > 0 && ` · ${modulos.filter(([m]) => m !== SIN_MODULO).length} módulos`}
              </div>
            )}
            {pasos.length > 0 && <div className="text-xs text-gypi-dim mt-0.5">Escaneadas: {textoAvancePiezas(avance, nombres)}</div>}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>

        <div className="text-[12px] text-gypi-dim mb-3">Cada pieza de la planilla técnica lleva su etiqueta con QR. En cada etapa se escanea para saber por dónde pasó.</div>
        {aviso && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{aviso}</div>}
        {error && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{error}</div>}
        {listo && <div role="status" className="text-[12px] text-gypi-green mb-2.5">{listo}</div>}

        {esGestion && piezas && (pegando ? (
          <section aria-label="Pegar la planilla técnica" className="g-card mb-3">
            <label htmlFor="piezas-pegar" className="g-label mb-1 block">Pegar la planilla técnica</label>
            <div className="text-[11px] text-gypi-dim mb-1.5">
              En la hoja PLANILLA, copiá desde la fila de títulos (PANEL, MATERIAL, MEDIDAS…) hasta la última pieza y pegalo acá. También sirve la hoja CUT RITE, pero esa no tiene todas las columnas (por ejemplo, la de CNC).
            </div>
            <textarea id="piezas-pegar" className="g-input w-full min-h-[110px] font-mono text-[12px]" value={pegado} onChange={(e) => setPegado(e.target.value)}
              placeholder={"PANEL\tMATERIAL\tL1\tL2\tCANTIDAD …\nM.izq-11\tENCHAPADO 19MM\t402\t342\t2 …"} />
            {vista && (
              <div className="mt-2">
                {vista.faltaColumnas.length > 0 ? (
                  <div className="text-[12px] text-gypi-red">No encontré la columna {vista.faltaColumnas.join(" ni ")}. Copiá también los títulos.</div>
                ) : (
                  <>
                    <div className="text-[12px] font-bold mb-1">
                      {piezasTexto(nuevas.length)} en {vista.renglones.length === 1 ? "1 renglón" : `${vista.renglones.length} renglones`}
                    </div>
                    {cambios && (
                      <div className="text-[11px] text-gypi-dim mb-1">
                        {cambios.siguen} quedan como estaban (sus etiquetas siguen valiendo) · {cambios.nuevas} nuevas
                        {cambios.salen > 0 && <span className="text-gypi-red"> · se sacan {cambios.salen} que ya no están en la planilla</span>}
                      </div>
                    )}
                    {!reglas.length && <div className="text-[11px] text-gypi-amber-ink">Ninguna etapa se escanea por pieza todavía: las piezas quedan sin etapas. Se marcan en Configuración → Etapas.</div>}
                    {vista.sinColumna.map((r) => (
                      <div key={r.codigo} className="text-[11px] text-gypi-amber-ink">No encontré la columna {r.columnas.join(", ")} para {r.nombre}: ninguna pieza queda con {r.nombre}. La podés marcar en cada renglón.</div>
                    ))}
                    {vista.avisos.map((a) => <div key={a} className="text-[11px] text-gypi-amber-ink">{a}</div>)}
                    {vista.renglones.length > 0 && (
                      <div className="overflow-x-auto mt-1">
                        <table className="w-full text-[11px] border-collapse">
                          <thead><tr className="text-gypi-dim text-left">{["Pieza", "Cant.", "Medidas", "Etapas"].map((t) => <th key={t} className="p-1 font-bold">{t}</th>)}</tr></thead>
                          <tbody>
                            {vista.renglones.slice(0, 60).map((r) => (
                              <tr key={r.nombre} className="border-t border-gypi-border">
                                <td className="p-1">{r.nombre}</td><td className="p-1">{r.cantidad}</td><td className="p-1">{medidas(r) || "—"}</td>
                                <td className="p-1">{r.etapas.map(nombreDe).join(", ") || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {vista.renglones.length > 60 && <div className="text-[11px] text-gypi-dim mt-1">…y {vista.renglones.length - 60} renglones más.</div>}
                      </div>
                    )}
                  </>
                )}
                {vista.errores.map((e) => <div key={`${e.fila}-${e.motivo}`} className="text-[11px] text-gypi-red">Fila {e.fila}: {e.motivo}. No se agrega.</div>)}
              </div>
            )}
            <div className="flex gap-2 mt-2.5">
              <button onClick={() => { setPegando(false); setPegado(""); }} className="g-btn g-btn-secondary flex-1">Cancelar</button>
              <button onClick={guardar} disabled={guardando || !vista?.renglones.length} className="g-btn g-btn-primary flex-1">
                {guardando ? "Guardando…" : nuevas.length ? `Guardar ${piezasTexto(nuevas.length)}` : "Guardar"}
              </button>
            </div>
          </section>
        ) : (
          <button onClick={() => { setPegando(true); setListo(null); }} className="g-btn g-btn-primary w-full mb-3">
            📋 {piezas.length ? "Volver a pegar la planilla (si cambió)" : "Pegar la planilla técnica"}
          </button>
        ))}

        {!piezas ? (
          <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
        ) : piezas.length === 0 ? (
          <div className="text-sm text-gypi-dim py-3">Esta OT todavía no tiene piezas cargadas.{esGestion ? "" : " Las carga técnica o el encargado."}</div>
        ) : (
          <>
            <section aria-label="Imprimir etiquetas" className="g-card mb-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gypi-dim">Qué piezas
                  <select className="g-input w-full" value={modulo} onChange={(e) => setModulo(e.target.value)}>
                    <option value="">Todas ({piezas.length})</option>
                    {modulos.map(([m, n]) => <option key={m} value={m}>{m === SIN_MODULO ? "Sin módulo" : `Módulo ${m}`} ({n})</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-gypi-dim">Tamaño de la etiqueta
                  <select className="g-input w-full" value={tamano} onChange={(e) => setTamano(e.target.value)}>
                    {TAMANOS_ETIQUETA.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </label>
              </div>
              <button onClick={() => imprimir(paraImprimir)} disabled={!paraImprimir.length} className="g-btn g-btn-primary w-full mt-2.5">
                🖨 Imprimir {paraImprimir.length === 1 ? "1 etiqueta" : `${paraImprimir.length} etiquetas`}
              </button>
            </section>

            {pasos.length > 0 && (
              <label className="text-[11px] text-gypi-dim block mb-2">Ver
                <select className="g-input w-full" value={faltanEn} onChange={(e) => setFaltanEn(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Todas las piezas</option>
                  {avance.map((a) => (
                    <option key={a.codigo} value={a.codigo}>Las que faltan en {nombreDe(a.codigo)} ({a.total - a.pasaron})</option>
                  ))}
                </select>
              </label>
            )}
            {faltanEn && !visibles.length && <div className="text-sm text-gypi-green mb-3">✅ Pasaron todas por {nombreDe(faltanEn)}.</div>}
            <ul aria-label="Piezas de la OT" className="list-none p-0 m-0 mb-3 flex flex-col gap-1.5">
              {visibles.map((r) => (
                <li key={r.nombre} className="bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold">{r.nombre} <span className="font-normal text-gypi-dim">× {r.piezas.length}</span></div>
                      <div className="text-[11px] text-gypi-dim truncate">{[medidas(r), r.material, r.modulo && `Módulo ${r.modulo}`].filter(Boolean).join(" · ")}</div>
                    </div>
                    <button onClick={() => imprimir(r.piezas)} aria-label={`Imprimir las etiquetas de ${r.nombre}`}
                      className="min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-transparent text-sm cursor-pointer">🖨</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5" aria-label={`Etapas de ${r.nombre}`}>
                    {etapasRenglon(r).map((codigo) => {
                      const nombre = nombreDe(codigo);
                      const activa = r.etapas.includes(codigo);
                      const n = pasaron(r, codigo);
                      const cuenta = activa && pasos.length > 0 ? ` ${n}/${r.piezas.length}` : "";
                      if (!esGestion) return activa ? <span key={codigo} className="text-[11px] font-bold px-2 py-1 rounded-lg bg-gypi-green/15 text-gypi-green">{nombre}{cuenta}</span> : null;
                      return (
                        <button key={codigo} onClick={() => cambiarEtapa(r, codigo)} disabled={guardando} aria-pressed={activa} aria-label={`${nombre} en ${r.nombre}`}
                          className={`min-h-[36px] px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer ${activa ? "bg-gypi-green/15 border-gypi-green text-gypi-green" : "bg-transparent border-gypi-border text-gypi-dim"}`}>
                          {activa ? "✓ " : ""}{nombre}{cuenta}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>

            {esGestion && (confirmarVaciar ? (
              <button onClick={vaciar} disabled={guardando} className="w-full min-h-[44px] rounded-lg border border-gypi-red bg-gypi-red/10 text-gypi-red text-xs font-bold cursor-pointer">Sí, borrar todas las piezas</button>
            ) : (
              <button onClick={() => setConfirmarVaciar(true)} className="w-full min-h-[44px] rounded-lg border-none bg-transparent text-gypi-red text-xs cursor-pointer">Borrar todas las piezas (se pegó mal)</button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
