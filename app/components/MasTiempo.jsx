'use client';
// app/components/MasTiempo.jsx — "⏱ Necesita más tiempo" en Diseño, Técnica
// o Instalación (Tadeo, 05/11; migración 162; app/lib/ajustesTiempo.js).
// Igual que "⏱ Faltan X h" del Gantt de Producción: se escribe cuánto falta,
// con el motivo, y manda sobre el cálculo del plan hasta que termina (si
// después avanza, baja en la misma proporción). Queda en la OT (Detalle OT →
// ⏱ Cambios de tiempo).
import { useState } from "react";
import { sb } from "../lib/supabase";
import { validarAjuste, motivosDe, unidadDe, textoValor, NOMBRE_ETAPA, AVISO_MIGRACION_162 } from "../lib/ajustesTiempo";
import Modal from "./ui/Modal";
import { Chip } from "./ui";

const conComa = (n) => String(Math.round((Number(n) || 0) * 10) / 10).replace(".", ",");

/**
 * @param {{ opciones: { ot: string, etapa: "diseno"|"tecnica"|"instalacion", nombre: string, valor: number, pendiente: number|null }[],
 *   porNombre?: string|null, onGuardado: (fila: object) => void, onClose: () => void }} props
 *   opciones: lo que se puede anotar (Diseño y Técnica de una OT, o cada OT de una obra); valor = lo que falta ahora
 */
export default function MasTiempo({ opciones = [], porNombre = null, onGuardado, onClose }) {
  const [i, setI] = useState(0);
  const op = opciones[i] || opciones[0];
  const [texto, setTexto] = useState(op ? conComa(op.valor) : "");
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  if (!op) return null;
  const enDias = unidadDe(op.etapa) === "dias";
  const titulo = `⏱ Más tiempo · OT ${op.ot}`;

  const elegir = (j) => {
    setI(j);
    setTexto(conComa(opciones[j].valor));
    if (motivosDe(opciones[j].etapa) !== motivosDe(op.etapa)) setMotivo("");
    setError(null);
  };

  const guardar = async () => {
    const n = Number(String(texto).replace(",", "."));
    const fila = {
      ot: String(op.ot), etapa: op.etapa, tipo: "faltan", motivo: motivo || null, detalle: detalle.trim() || null,
      horas: texto.trim() !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN,
      pendiente: op.pendiente == null ? null : Math.round(Math.max(0, Math.min(1, op.pendiente)) * 10000) / 10000,
      dias: 0,
      creado_nombre: porNombre ? String(porNombre).slice(0, 120) : null,
    };
    const err = validarAjuste(fila);
    if (err) { setError(err); return; }
    setGuardando(true);
    setError(null);
    try {
      await sb.post("ajustes_tiempo_ot", fila);
      onGuardado?.({ ...fila, created_at: new Date().toISOString() });
    } catch (e) {
      setError(/ajustes_tiempo_ot/.test(String(e?.message)) ? AVISO_MIGRACION_162 : `No se pudo guardar: ${e?.message || e}`);
      setGuardando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={titulo}>
      <div className="p-4 overflow-y-auto text-gypi-text">
        <div className="text-[18px] font-bold mb-1">{titulo}</div>
        {opciones.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Qué necesita más tiempo">
            {opciones.map((o, j) => (
              <Chip key={`${o.ot}|${o.etapa}`} active={j === i} onClick={() => elegir(j)}>{o.nombre}</Chip>
            ))}
          </div>
        )}
        <div className="text-[14px] text-gypi-dim mb-3">{op.nombre}: según el plan le faltan {textoValor(op.valor, op.etapa)}.</div>
        <label className="g-label" htmlFor="mas-tiempo-valor">{enDias ? "Faltan (días hábiles)" : "Faltan (horas)"}</label>
        <input id="mas-tiempo-valor" className="g-input w-full mb-1" inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <div className="text-[13px] text-gypi-dim mb-3">
          Manda sobre el cálculo hasta que termine{op.etapa === "instalacion" ? " (con la misma gente de la OT)" : ""}. Si después avanza, baja en la misma proporción. {enDias ? "De a medio día." : "De a media hora."}
        </div>
        <div className="g-label">Motivo</div>
        <div className="flex flex-wrap gap-1.5 mb-2" role="radiogroup" aria-label="Motivo">
          {motivosDe(op.etapa).map((m) => (
            <Chip key={m.id} role="radio" aria-checked={motivo === m.id} active={motivo === m.id} onClick={() => setMotivo(m.id)}>{m.label}</Chip>
          ))}
        </div>
        {motivo === "otros" && (
          <>
            <label className="g-label" htmlFor="mas-tiempo-detalle">¿Cuál?</label>
            <input id="mas-tiempo-detalle" className="g-input w-full mb-2" maxLength={300} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
          </>
        )}
        {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
        <button type="button" onClick={guardar} disabled={guardando} className="g-btn g-btn-primary w-full mt-1">{guardando ? "Guardando…" : "Guardar"}</button>
      </div>
    </Modal>
  );
}

/** Nombre corto para los chips: "Diseño", "Técnica", "Instalación de la OT 7858". */
export const nombreOpcion = (etapa, ot = null) => (etapa === "instalacion" && ot ? `Instalación de la OT ${ot}` : NOMBRE_ETAPA[etapa]);
