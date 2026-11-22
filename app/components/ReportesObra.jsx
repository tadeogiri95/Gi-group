"use client";
// app/components/ReportesObra.jsx — Reportes escritos de los instaladores
// (reportes_obra), día por día. Estaban en Reportes → Obra; desde el 22/11
// (pedido de Tadeo) van en Producción → Instalaciones → 🏗️ Reportes de obra.
import { useState, useEffect } from "react";
import Image from "next/image";
import { sb } from "../lib/supabase";
import { Tag } from "./ui";
import FotoViewer from "./FotoViewer";
import { hoyArg } from "../lib/dates";

const Puntos = () => <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;

export default function ReportesObra({ empresaId }) {
  const [reportesObra, setReportesObra] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedReport, setExpandedReport] = useState(null);
  const [fotoViewer, setFotoViewer] = useState(null);
  const [fechaFiltro, setFechaFiltro] = useState(() => hoyArg());

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { const data = await sb.get(`reportes_obra?empresa_id=eq.${empresaId}&fecha=eq.${fechaFiltro}&order=created_at.desc`); setReportesObra(data || []); }
      catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [fechaFiltro, empresaId]);

  const cambiarFecha = (dir) => { const d = new Date(fechaFiltro + "T12:00:00"); d.setDate(d.getDate() + dir); setFechaFiltro(d.toISOString().slice(0, 10)); };

  return (
    <>
      <div className="flex items-center justify-between mb-3.5 bg-gypi-surface rounded-[14px] py-2.5 px-4 border border-gypi-border">
        <button onClick={() => cambiarFecha(-1)} aria-label="Día anterior" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">←</button>
        <span className="font-heading text-sm font-bold text-gypi-text">
          {new Date(fechaFiltro + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
        </span>
        <button onClick={() => cambiarFecha(1)} aria-label="Día siguiente" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">→</button>
      </div>

      {loading ? (
        <Puntos />
      ) : reportesObra.length === 0 ? (
        <div className="bg-gypi-surface rounded-2xl p-8 text-center border border-gypi-border">
          <div className="text-[32px] mb-2">🏗️</div>
          <div className="text-sm font-bold text-gypi-text">Sin reportes en esta fecha</div>
          <div className="text-xs text-gypi-dim mt-1.5">Los reportes de trabajo en campo aparecerán acá.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="self-start mb-1"><Tag color="var(--color-cyan)">{reportesObra.length} reportes</Tag></div>
          {reportesObra.map(r => {
            const isExpanded = expandedReport === r.id;
            const tieneFotos = r.fotos_urls && r.fotos_urls.length > 0;
            return (
              <div key={r.id} className={`bg-gypi-surface rounded-xl overflow-hidden transition-all border ${isExpanded ? "border-gypi-cyan/25" : "border-gypi-border"}`}>
                <button onClick={() => setExpandedReport(isExpanded ? null : r.id)} aria-expanded={isExpanded} className="w-full flex items-center gap-2.5 p-3 cursor-pointer bg-transparent border-none text-left font-body">
                  <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0 bg-gypi-cyan/10" aria-hidden="true">🏗️</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-gypi-text">{r.nombre}</span>
                      {tieneFotos && <Tag color="var(--color-cyan)">📷 {r.fotos_urls.length}</Tag>}
                      {r.faltantes?.length > 0 && <Tag color="var(--color-red)">⚠ {r.faltantes.length}</Tag>}
                    </div>
                    <div className="text-xs text-gypi-dim mt-0.5 truncate">{r.progreso?.slice(0, 60)}{r.progreso?.length > 60 ? "..." : ""}</div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-xs text-gypi-dim">{new Date(r.created_at).toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' })}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={`text-gypi-mute transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3.5 border-t border-gypi-border">
                    <div className="py-3 pb-2">
                      <div className="text-xs font-bold text-gypi-green-ink uppercase tracking-[0.06em] mb-1.5">✅ Progreso</div>
                      <div className="text-[13px] text-gypi-text leading-relaxed">{r.progreso || "—"}</div>
                    </div>
                    {r.faltantes?.length > 0 && (
                      <div className="py-2 px-2.5 rounded-[10px] mb-2 bg-gypi-red/[0.06] border border-gypi-red/10">
                        <div className="text-xs font-bold uppercase tracking-[0.06em] mb-1.5 text-gypi-red-ink">🚫 Faltantes</div>
                        <div className="flex flex-wrap gap-1">
                          {r.faltantes.map((f, i) => <span key={i} className="py-1 px-2.5 rounded-lg text-xs font-semibold bg-gypi-red/10 text-gypi-red-ink">{f}</span>)}
                        </div>
                      </div>
                    )}
                    {r.desvios?.length > 0 && (
                      <div className="py-2 px-2.5 rounded-[10px] mb-2 bg-gypi-amber/[0.06] border border-gypi-amber/10">
                        <div className="text-xs font-bold uppercase tracking-[0.06em] mb-1.5 text-gypi-amber-ink">⚠️ Desvíos</div>
                        <div className="flex flex-wrap gap-1">
                          {r.desvios.map((d, i) => <span key={i} className="py-1 px-2.5 rounded-lg text-xs font-semibold bg-gypi-amber/10 text-gypi-amber-ink">{d}</span>)}
                        </div>
                      </div>
                    )}
                    {tieneFotos && (
                      <div className="py-2">
                        <div className="text-xs font-bold uppercase tracking-[0.06em] mb-2 text-gypi-cyan-ink">📷 Fotos ({r.fotos_urls.length})</div>
                        <div className={`gap-2 grid ${r.fotos_urls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                          {r.fotos_urls.map((url, i) => (
                            <button key={i} onClick={() => setFotoViewer({ fotos: r.fotos_urls, index: i })} aria-label={`Ampliar foto ${i + 1}`} className={`cursor-pointer rounded-[10px] overflow-hidden bg-gypi-surface border border-gypi-border relative p-0 ${r.fotos_urls.length === 1 ? "aspect-video" : "aspect-square"}`}>
                              <Image src={url} alt={`Foto ${i + 1}`} fill sizes="(max-width: 768px) 50vw, 300px" className="object-cover" />
                              <div className="absolute bottom-1.5 right-1.5 py-[3px] px-2 rounded-md bg-black/60 text-white text-xs font-semibold" aria-hidden="true">🔍 Ampliar</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {!tieneFotos && r.fotos > 0 && (
                      <div className="py-2 px-2.5 rounded-lg text-[12px] text-gypi-dim bg-gypi-surf-hi">
                        📷 El instalador indicó {r.fotos} foto{r.fotos > 1 ? "s" : ""} pero no se subieron correctamente
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {fotoViewer && <FotoViewer fotos={fotoViewer.fotos} index={fotoViewer.index} onClose={() => setFotoViewer(null)} onNav={(i) => setFotoViewer(prev => ({ ...prev, index: i }))} />}
    </>
  );
}
