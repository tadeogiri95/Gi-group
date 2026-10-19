"use client";
// Pestaña "Instalaciones" del instalador (seguimiento de OT por escaneo, parte
// 24b; migración 117). Arriba el botón para dejar el reporte del día y debajo
// el historial de reportes. El reporte: elegir la OT, tildar los módulos
// colocados, anotar lo que quedó pendiente (resta del % de su módulo),
// comentario y fotos. Los pendientes son los mismos del acta de instalación.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/supabase";
import { avanceInstalacion, PORCENTAJE_PENDIENTE } from "../../lib/instalacion";
import { fotoBase64, subirImagen } from "../../lib/foto";
import { fechaCorta } from "../../lib/ot";
import ElegirOtCarga from "../ElegirOtCarga";
import Modal from "../ui/Modal";
import EmptyState from "../ui/EmptyState";
import { Button } from "../ui";

const MAX_FOTOS = 4;
const fmtPct = (n) => (n === null || n === undefined ? "—" : `${String(n).replace(".", ",")}%`);
const nombrePieza = (p) => `${p.nombre}${p.de > 1 ? ` (${p.unidad} de ${p.de})` : ""}`;

async function leer(url, opts) {
  const r = await apiFetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

/** Formulario del reporte de una OT. */
export function ReporteInstalacion({ ot, onClose, onEnviado }) {
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [colocados, setColocados] = useState([]);
  const [pendientes, setPendientes] = useState([]);
  const [nuevo, setNuevo] = useState({ descripcion: "", modulo: "", piezas: [], porcentaje: String(PORCENTAJE_PENDIENTE) });
  const [comentario, setComentario] = useState("");
  const [fotos, setFotos] = useState([]);
  const [subiendo, setSubiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    leer(`/api/instalacion?ot=${encodeURIComponent(ot)}`)
      .then((d) => { if (vivo) setEstado(d); })
      .catch((e) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, [ot]);

  const piezas = useMemo(() => (estado?.modulos || []).flatMap((m) => m.piezas), [estado]);
  const yaColocados = useMemo(() => (estado?.modulos || []).filter((m) => m.instalado).map((m) => m.modulo), [estado]);
  const moduloElegido = (estado?.modulos || []).find((m) => m.modulo === nuevo.modulo);

  // Cómo queda la OT si se manda el reporte así
  const vista = useMemo(() => avanceInstalacion({
    piezas,
    instalados: [...yaColocados, ...colocados],
    pendientes: [...(estado?.pendientes || []), ...pendientes],
  }), [piezas, yaColocados, colocados, estado, pendientes]);

  const tildar = (m) => setColocados((c) => (c.includes(m) ? c.filter((x) => x !== m) : [...c, m]));
  const tildarPieza = (id) => setNuevo((n) => ({ ...n, piezas: n.piezas.includes(id) ? n.piezas.filter((x) => x !== id) : [...n.piezas, id] }));

  const agregarPendiente = () => {
    if (!nuevo.descripcion.trim()) return;
    const pct = Number(String(nuevo.porcentaje).replace(",", "."));
    setPendientes((p) => [...p, {
      descripcion: nuevo.descripcion.trim(),
      modulo: nuevo.modulo || null,
      piezas: nuevo.modulo && nuevo.piezas.length ? nuevo.piezas : null,
      porcentaje: nuevo.modulo && !nuevo.piezas.length ? (Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : PORCENTAJE_PENDIENTE) : null,
    }]);
    setNuevo({ descripcion: "", modulo: nuevo.modulo, piezas: [], porcentaje: String(PORCENTAJE_PENDIENTE) });
  };

  const sumarFoto = async (file) => {
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      const url = await subirImagen(await fotoBase64(file));
      setFotos((f) => [...f, url].slice(0, MAX_FOTOS));
    } catch (e) {
      setError(e.message);
    } finally {
      setSubiendo(false);
    }
  };

  const enviar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const d = await leer("/api/instalacion", {
        method: "POST",
        body: JSON.stringify({ ot, modulos: colocados, pendientes, comentario: comentario.trim() || null, fotos }),
      });
      onEnviado?.(d);
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  const vacio = !colocados.length && !pendientes.length && !comentario.trim();

  return (
    <Modal open onClose={onClose} title={`Reporte de la OT ${ot}`}>
      <div className="p-4 overflow-y-auto flex flex-col gap-4">
        {estado === null && !error && (
          <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
        )}
        {estado && (
          <>
            <div className="rounded-[14px] bg-gypi-surface border border-gypi-border px-4 py-3" role="status" aria-label="Avance de la instalación">
              <div className="text-[13px] text-gypi-dim">Instalación de la OT</div>
              <div className="text-[26px] font-extrabold text-gypi-text leading-tight">{fmtPct(vista.porcentaje)}</div>
              <div className="text-[12px] text-gypi-dim">
                {vista.total ? `${vista.colocados} de ${vista.total} módulos colocados${vista.porArea ? " · pesa la superficie de cada módulo" : ""}` : "Sin piezas cargadas"}
              </div>
            </div>

            {vista.total === 0 ? (
              <div className="text-[13px] text-gypi-amber-ink">Esta OT no tiene las piezas cargadas (🧩 Piezas en la lista de OT), así que no se puede calcular el %. Igual podés dejar pendientes, comentario y fotos.</div>
            ) : (
              <fieldset className="border-none p-0 m-0">
                <legend className="text-[14px] font-bold text-gypi-text mb-2">¿Qué módulos colocaron hoy?</legend>
                <div className="flex flex-col gap-1.5">
                  {estado.modulos.map((m) => (
                    <label key={m.modulo} className={`flex items-center gap-3 min-h-[48px] px-3 rounded-xl border border-gypi-border ${m.instalado ? "opacity-60" : "cursor-pointer"}`}>
                      <input type="checkbox" className="w-5 h-5" checked={m.instalado || colocados.includes(m.modulo)} disabled={m.instalado} onChange={() => tildar(m.modulo)} />
                      <span className="flex-1 text-[14px] text-gypi-text">{m.modulo}</span>
                      <span className="text-[12px] text-gypi-dim">{m.instalado ? "ya colocado" : `${m.piezas.length} piezas`}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <section aria-label="Pendientes" className="flex flex-col gap-2">
              <h3 className="m-0 text-[14px] font-bold text-gypi-text">Pendientes</h3>
              {(estado.pendientes || []).length > 0 && (
                <ul className="list-none p-0 m-0 flex flex-col gap-1">
                  {estado.pendientes.map((p) => (
                    <li key={p.id} className="text-[13px] text-gypi-dim">⏳ {p.descripcion}{p.modulo ? ` · ${p.modulo}` : ""} (de antes)</li>
                  ))}
                </ul>
              )}
              {pendientes.length > 0 && (
                <ul className="list-none p-0 m-0 flex flex-col gap-1">
                  {pendientes.map((p, i) => (
                    <li key={i} className="flex items-center gap-2 text-[13px] text-gypi-text">
                      <span className="flex-1">⏳ {p.descripcion}{p.modulo ? ` · ${p.modulo}` : ""}{p.piezas ? ` · ${p.piezas.length} piezas` : p.porcentaje !== null ? ` · resta ${fmtPct(p.porcentaje)}` : ""}</span>
                      <button onClick={() => setPendientes((l) => l.filter((_, j) => j !== i))} aria-label={`Quitar pendiente ${p.descripcion}`} className="min-h-11 px-2 bg-transparent border-none text-gypi-red cursor-pointer">✕</button>
                    </li>
                  ))}
                </ul>
              )}
              <input className="g-input w-full" value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })}
                maxLength={300} aria-label="Qué quedó pendiente" placeholder="Ej: faltan las tiras de ajuste" />
              {vista.total > 0 && (
                <select className="g-input w-full" value={nuevo.modulo} onChange={(e) => setNuevo({ ...nuevo, modulo: e.target.value, piezas: [] })} aria-label="Módulo del pendiente">
                  <option value="">De la obra en general (no resta)</option>
                  {estado.modulos.map((m) => <option key={m.modulo} value={m.modulo}>{m.modulo}</option>)}
                </select>
              )}
              {moduloElegido && (
                <details className="text-[13px]">
                  <summary className="cursor-pointer text-gypi-dim min-h-11 flex items-center">¿Qué piezas faltan? (opcional: restan por su superficie)</summary>
                  <div className="flex flex-col gap-1 mt-1">
                    {moduloElegido.piezas.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 min-h-[40px] cursor-pointer">
                        <input type="checkbox" checked={nuevo.piezas.includes(p.id)} onChange={() => tildarPieza(p.id)} />
                        <span className="text-gypi-text">{nombrePieza(p)}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              {moduloElegido && nuevo.piezas.length === 0 && (
                <label className="flex items-center gap-2 text-[13px] text-gypi-dim">
                  Resta de la OT
                  <input className="g-input w-[80px]" inputMode="decimal" value={nuevo.porcentaje} onChange={(e) => setNuevo({ ...nuevo, porcentaje: e.target.value })} aria-label="Cuánto resta de la OT (%)" />
                  %
                </label>
              )}
              <Button variant="secondary" onClick={agregarPendiente} disabled={!nuevo.descripcion.trim()}>+ Agregar pendiente</Button>
            </section>

            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] font-bold text-gypi-text">Comentario</span>
              <textarea className="g-input w-full min-h-[80px]" value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={1000} placeholder="Cómo fue el día, qué hace falta" />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[14px] font-bold text-gypi-text">Fotos ({fotos.length} de {MAX_FOTOS})</span>
              {fotos.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {fotos.map((f, i) => (
                    <button key={f} onClick={() => setFotos((l) => l.filter((_, j) => j !== i))} aria-label={`Quitar foto ${i + 1}`} className="text-[12px] px-2 py-1 rounded-lg border border-gypi-border bg-transparent text-gypi-text cursor-pointer">📷 {i + 1} ✕</button>
                  ))}
                </div>
              )}
              {fotos.length < MAX_FOTOS && (
                <label className="g-btn g-btn-secondary w-full text-center cursor-pointer">
                  {subiendo ? "Subiendo…" : "📷 Sumar una foto"}
                  <input type="file" accept="image/*" capture="environment" className="hidden" disabled={subiendo} onChange={(e) => { sumarFoto(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              )}
            </div>
          </>
        )}
        {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
        {estado && (
          <Button size="planta" className="w-full" onClick={enviar} disabled={enviando || subiendo || vacio}>
            {enviando ? "Enviando…" : "Enviar reporte"}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function TarjetaReporte({ r }) {
  return (
    <article className="bg-gypi-surface rounded-[14px] border border-gypi-border px-4 py-3" aria-label={`Reporte de la OT ${r.ot} del ${fechaCorta(r.fecha)}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-bold text-gypi-text flex-1">OT {r.ot}</span>
        <span className="text-[15px] font-extrabold text-gypi-text">{fmtPct(r.avance)}</span>
      </div>
      <div className="text-[12px] text-gypi-dim">{fechaCorta(r.fecha)}{r.empleado ? ` · ${r.empleado}` : ""}</div>
      {r.modulos?.length > 0 && <div className="text-[13px] text-gypi-text mt-1.5">✅ Colocados: {r.modulos.join(", ")}</div>}
      {r.pendientes?.length > 0 && (
        <ul className="list-none p-0 m-0 mt-1 flex flex-col gap-0.5">
          {r.pendientes.map((p) => <li key={p.id} className="text-[13px] text-gypi-text">{p.resuelto ? "✔️" : "⏳"} {p.descripcion}{p.modulo ? ` · ${p.modulo}` : ""}</li>)}
        </ul>
      )}
      {r.comentario && <p className="text-[13px] text-gypi-dim mt-1.5 mb-0 whitespace-pre-line">{r.comentario}</p>}
      {r.fotos?.length > 0 && (
        <div className="flex gap-2 mt-1.5">
          {r.fotos.map((f, i) => <a key={f} href={f} target="_blank" rel="noreferrer" className="text-[13px] text-gypi-cyan">📷 Foto {i + 1}</a>)}
        </div>
      )}
    </article>
  );
}

export default function InstalacionesScreen({ empresaId }) {
  const [reportes, setReportes] = useState(null);
  const [error, setError] = useState(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [ot, setOt] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    leer("/api/instalacion")
      .then((d) => { setReportes(d.reportes || []); setError(null); })
      .catch((e) => { setReportes([]); setError(e.message); });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <section aria-label="Instalaciones" className="px-[18px] pb-[110px] overflow-y-auto flex-1 flex flex-col gap-3">
      <Button size="planta" className="w-full" onClick={() => { setAviso(null); setEligiendo(true); }}>📝 Generar reporte</Button>
      {aviso && <div role="status" className="text-[14px] font-bold text-gypi-green-ink">{aviso}</div>}
      {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}

      <h2 className="m-0 mt-2 text-[15px] font-bold text-gypi-dim">Historial de reportes</h2>
      {reportes === null ? (
        <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      ) : reportes.length === 0 ? (
        <div className="bg-gypi-surface rounded-[14px] border border-gypi-border">
          <EmptyState icon="inbox" title="Todavía no hay reportes" description="Al terminar el día, tocá Generar reporte y anotá qué se colocó y qué quedó pendiente." color="var(--color-empresa-secondary)" />
        </div>
      ) : (
        reportes.map((r) => <TarjetaReporte key={r.id} r={r} />)
      )}

      {eligiendo && (
        <ElegirOtCarga empresaId={empresaId} titulo="¿De qué OT es el reporte?" verbo="Reportar"
          onClose={() => setEligiendo(false)} onElegir={(o) => { setEligiendo(false); setOt(o); }} />
      )}
      {ot && (
        <ReporteInstalacion ot={ot} onClose={() => setOt(null)}
          onEnviado={(d) => { setOt(null); setAviso(d.porcentaje !== null && d.porcentaje !== undefined ? `Listo. La OT ${ot} quedó en ${fmtPct(d.porcentaje)}.` : `Listo, se guardó el reporte de la OT ${ot}.`); cargar(); }} />
      )}
    </section>
  );
}
