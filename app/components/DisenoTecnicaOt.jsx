"use client";
// 📐 Diseño y Técnica en el Detalle de la OT (parte 46; app/lib/complejidad.js):
// qué etapas de Diseño y de Técnica están hechas según el Nuevo Plan de
// trabajo (y quién las hizo), y la clase de complejidad A/B/C de la OT dentro
// de su tipo de proyecto. Gestión puede elegir la clase a mano (migración 158).
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { AREAS, AVISO_MIGRACION_158, CLASES, ETAPAS_DISENO, avanceArea, cantidadesOt, claseDeOt, totalesNecesidades } from "../lib/complejidad";
import { tipoDeOt, nombreTipo } from "../lib/tipoProyecto";

const fmt = (n) => String(Math.round(n * 10) / 10).replace(".", ",");

export function textoCantidades(c) {
  if (!c) return "Todavía no tiene necesidades ni placas cargadas.";
  const partes = [
    c.componentes != null ? `${fmt(c.componentes)} componentes` : null,
    `${fmt(c.placas)} placas`,
    `${fmt(c.canto)} m de canto`,
  ].filter(Boolean);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}` : partes[0];
  return `${lista} (${c.origen === "necesidades" ? "necesidades del MRP" : "placas y cantos preliminares del Plan"}).`;
}

const COLOR_ESTADO = {
  hecho: "bg-gypi-green/15 text-gypi-green",
  na: "bg-gypi-surface text-gypi-dim line-through",
  falta: "bg-gypi-surface text-gypi-text",
};

export default function DisenoTecnicaOt({ proyecto, empresaId, puedeEditar = false, onGuardado }) {
  const [necesidades, setNecesidades] = useState(null);
  const [propio, setPropio] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const ot = proyecto?.ot;

  useEffect(() => {
    if (!ot || !empresaId) return;
    let vivo = true;
    sb.get(`necesidades_stock?empresa_id=eq.${empresaId}&ot=eq.${encodeURIComponent(ot)}&select=ot,nombre,cantidad`)
      .then((rows) => { if (vivo) setNecesidades(rows || []); })
      .catch(() => { if (vivo) setNecesidades([]); });
    return () => { vivo = false; };
  }, [ot, empresaId]);

  if (!proyecto) return null;
  const p = { ...proyecto, ...propio };
  const { clase, manual, sinDatos } = claseDeOt(p);
  const tipo = tipoDeOt(p).id;
  const cantidades = necesidades ? cantidadesOt(p, totalesNecesidades(necesidades)) : null;
  const etapas = p.etapas_diseno && typeof p.etapas_diseno === "object" ? p.etapas_diseno : null;

  const elegir = async (valor) => {
    setGuardando(true);
    setAviso(null);
    try {
      await sb.patch(`proyectos?id=eq.${proyecto.id}`, { clase_complejidad: valor });
      setPropio({ clase_complejidad: valor });
      onGuardado?.({ id: proyecto.id, clase_complejidad: valor });
    } catch (e) {
      setAviso(/clase_complejidad/.test(String(e.message)) ? AVISO_MIGRACION_158 : `No se pudo guardar: ${e.message}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="mb-4" aria-label="Diseño y Técnica">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="g-label flex-1">📐 Diseño y Técnica</div>
        <div className="font-heading text-lg font-bold text-gypi-amber-ink">Clase {clase}</div>
      </div>
      <div className="text-xs text-gypi-dim mb-1.5">
        {manual ? "Clase elegida a mano. " : sinDatos ? "Sin datos todavía: queda en B hasta que tenga necesidades o placas. " : `Clase ${clase} comparada con las demás OT de ${nombreTipo(tipo)}. `}
        {necesidades && textoCantidades(cantidades)}
      </div>

      {puedeEditar && (
        <div className="flex gap-2 flex-wrap mb-2" role="group" aria-label="Elegir la clase">
          {CLASES.map((c) => (
            <button key={c} type="button" disabled={guardando} aria-pressed={manual && clase === c}
              className={`g-btn ${manual && clase === c ? "g-btn-primary" : "g-btn-secondary"}`} onClick={() => elegir(c)}>{c}</button>
          ))}
          {manual && <button type="button" disabled={guardando} className="g-btn g-btn-secondary" onClick={() => elegir(null)}>↺ Automática</button>}
        </div>
      )}
      {aviso && <div role="alert" className="text-sm text-gypi-red mb-2">{aviso}</div>}

      {etapas ? (
        <div className="flex flex-col gap-1.5">
          {Object.entries(AREAS).map(([area, nombre]) => {
            const a = avanceArea(etapas, area);
            if (!a) return null;
            return (
              <div key={area} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-[13px] font-bold truncate">{nombre}{a.quienes.length ? ` · ${a.quienes.join(", ")}` : ""}</span>
                  <span className="text-[13px] font-bold">{a.terminada ? "✅ Terminado" : `${a.pct}%`}</span>
                </div>
                <ul className="list-none m-0 p-0 mt-1.5 flex flex-wrap gap-1.5">
                  {ETAPAS_DISENO.filter((e) => e.area === area && etapas[e.id]).map((e) => {
                    const est = etapas[e.id];
                    return (
                      <li key={e.id} className={`text-[12px] font-semibold px-2 py-1 rounded-lg ${COLOR_ESTADO[est.e] || COLOR_ESTADO.falta}`}>
                        {est.e === "hecho" ? "✓ " : ""}{e.nombre}{est.e === "na" ? " (no aplica)" : est.e === "falta" ? ": falta" : est.q ? ` · ${est.q}` : ""}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-gypi-dim">Las etapas salen de las columnas DIS a PDF del Plan de trabajo; aparecen después de Sincronizar.</div>
      )}
    </section>
  );
}
