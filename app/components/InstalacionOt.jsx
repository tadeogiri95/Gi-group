"use client";
// 🔧 Instalación en el Detalle de la OT (parte 42; app/lib/instalacionPlan.js):
// cuántos días de obra lleva instalarla y con cuántos instaladores. Sale de
// los gabinetes y de ⚙ Parámetros → 🔧 Instalación; gestión lo corrige a mano
// (migración 153). Vacío = vuelve al cálculo automático.
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { CLAVE_PLANIFICACION, normalizarParametros } from "../lib/planificacion";
import { AVISO_MIGRACION_153, cuerpoCorreccion, diasInstalacion, textoDias } from "../lib/instalacionPlan";
import { nombreTipo } from "../lib/tipoProyecto";

const conComa = (n) => (n == null ? "" : String(n).replace(".", ","));
const fmt = (n) => conComa(Math.round(n * 10) / 10);
const ORIGEN = { modulos: "módulos de la planilla", etiquetas: "etiquetas de módulo", placas: "calculados con las placas" };

export function textoCalculo(r) {
  if (r.manual) return `Corregido a mano: ${textoDias(r.dias)} con ${r.personas} ${r.personas === 1 ? "instalador" : "instaladores"}.`;
  if (r.sinDato) return `${r.sinDato}.`;
  return `${fmt(r.gabinetes)} gabinetes (${ORIGEN[r.origenGabinetes]}) ÷ ${fmt(r.gabPorDia)} por persona por día`
    + `${r.tipo ? ` (${nombreTipo(r.tipo)})` : ""} = ${fmt(r.diasPersona)} días de una persona ÷ ${r.personas} ${r.personas === 1 ? "instalador" : "instaladores"}.`;
}

export default function InstalacionOt({ proyecto, puedeEditar = false, onGuardado }) {
  const [cfg, setCfg] = useState(null);
  const [editando, setEditando] = useState(false);
  const [textos, setTextos] = useState({ dias: "", personas: "" });
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [propio, setPropio] = useState(null); // lo guardado acá, sin volver a abrir el detalle

  useEffect(() => {
    let vivo = true;
    sb.get(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`)
      .then((rows) => { if (vivo) setCfg(normalizarParametros(rows?.[0]?.valor)); })
      .catch(() => { if (vivo) setCfg(normalizarParametros(null)); });
    return () => { vivo = false; };
  }, []);

  if (!proyecto || !cfg) return null;
  const p = { ...proyecto, ...propio };
  const r = diasInstalacion(p, cfg, cfg.instalacion);

  const abrir = () => {
    setTextos({ dias: conComa(p.dias_instalacion), personas: conComa(p.personas_instalacion) });
    setAviso(null);
    setEditando(true);
  };
  const { errores, cuerpo } = cuerpoCorreccion(textos);
  const guardar = async (valor) => {
    if (!valor) return;
    setGuardando(true);
    setAviso(null);
    try {
      await sb.patch(`proyectos?id=eq.${proyecto.id}`, valor);
      setPropio(valor);
      onGuardado?.({ id: proyecto.id, ...valor });
      setEditando(false);
    } catch (e) {
      setAviso(/dias_instalacion|personas_instalacion/.test(String(e.message)) ? AVISO_MIGRACION_153 : `No se pudo guardar: ${e.message}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="mb-4" aria-label="Instalación">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="g-label flex-1">🔧 Instalación</div>
        <div className="font-heading text-lg font-bold text-gypi-amber-ink">{r.dias == null ? "Sin dato" : textoDias(r.dias)}</div>
      </div>
      <div className="text-xs text-gypi-dim mb-1.5">{textoCalculo(r)}</div>
      {puedeEditar && !editando && (
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="g-btn g-btn-secondary" onClick={abrir}>✏ Corregir a mano</button>
          {(r.manual || r.personasManual) && (
            <button type="button" className="g-btn g-btn-secondary" disabled={guardando}
              onClick={() => guardar({ dias_instalacion: null, personas_instalacion: null })}>↺ Volver a automático</button>
          )}
        </div>
      )}
      {editando && (
        <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`inst-dias-${proyecto.id}`} className="text-xs text-gypi-dim block mb-1">Días de obra</label>
              <input id={`inst-dias-${proyecto.id}`} className="g-input w-full" inputMode="decimal" placeholder="Automático"
                value={textos.dias} onChange={(e) => setTextos({ ...textos, dias: e.target.value })} />
              {errores.dias && <div className="text-xs text-gypi-red mt-1">{errores.dias}</div>}
            </div>
            <div>
              <label htmlFor={`inst-personas-${proyecto.id}`} className="text-xs text-gypi-dim block mb-1">Instaladores</label>
              <input id={`inst-personas-${proyecto.id}`} className="g-input w-full" inputMode="numeric" placeholder={String(cfg.instalacion.personas_por_ot)}
                value={textos.personas} onChange={(e) => setTextos({ ...textos, personas: e.target.value })} />
              {errores.personas && <div className="text-xs text-gypi-red mt-1">{errores.personas}</div>}
            </div>
          </div>
          <div className="text-xs text-gypi-dim mt-1.5">De a medio día. Vacío = lo calcula Gypi con los gabinetes.</div>
          <div className="flex gap-2 mt-2">
            <button type="button" className="g-btn g-btn-primary flex-1" disabled={guardando || !cuerpo} onClick={() => guardar(cuerpo)}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {aviso && <div role="alert" className="text-xs text-gypi-red mt-1.5">{aviso}</div>}
    </section>
  );
}
