'use client';
// app/components/AjusteTiempo.jsx — "⏱ Faltan X h" de un proceso, o por qué
// se corrió (Tadeo, 29/10; migración 145; app/lib/ajustesTiempo.js).
// Siempre con el motivo; queda registrado en la OT.
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { MOTIVOS_TIEMPO, validarAjuste, textoMotivo, AVISO_MIGRACION_145 } from "../lib/ajustesTiempo";
import { fmtH } from "../lib/cargaPlanta";
import Modal from "./ui/Modal";
import { Chip } from "./ui";

const dias = (n) => `${n} ${n === 1 ? "día" : "días"}`;

/**
 * @param {{ ot: string, etapa: string, nombre: string, horas: number, pendiente: number|null, diasCorrido: number,
 *   soloMotivo?: boolean, diasCon?: (horas: number) => number, porNombre?: string|null,
 *   onGuardado: (fila: object) => void, onClose: () => void }} props
 *   soloMotivo: viene de "Atrasos sin motivo" (se anota por qué se corrió, sin cambiar horas)
 *   diasCon: cuántos días queda corrido del plan confirmado con esas horas
 */
export default function AjusteTiempo({ ot, etapa, nombre, horas, pendiente = null, diasCorrido = 0, soloMotivo = false, diasCon, porNombre = null, onGuardado, onClose }) {
  const [tipo, setTipo] = useState(soloMotivo ? "corrimiento" : "faltan");
  const [texto, setTexto] = useState(soloMotivo ? "" : String(Math.round((horas || 0) * 10) / 10).replace(".", ","));
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const titulo = `⏱ ${nombre} de la OT ${ot}`;

  const guardar = async () => {
    const h = tipo === "faltan" ? Number(String(texto).replace(",", ".")) : null;
    const fila = {
      ot, etapa, tipo, motivo: motivo || null, detalle: detalle.trim() || null,
      horas: tipo === "faltan" && texto.trim() !== "" && Number.isFinite(h) ? Math.round(h * 100) / 100 : tipo === "faltan" ? NaN : null,
      pendiente: pendiente == null ? null : Math.round(Math.max(0, Math.min(1, pendiente)) * 10000) / 10000,
      dias: Math.max(0, diasCorrido || 0),
      creado_nombre: porNombre ? String(porNombre).slice(0, 120) : null,
    };
    const err = validarAjuste(fila);
    if (err) { setError(err); return; }
    // Con las horas nuevas: cuántos días queda corrido (si después se corre más, vuelve a pedir el motivo)
    if (tipo === "faltan" && diasCon) fila.dias = Math.max(0, Math.round(diasCon(fila.horas)) || 0);
    setGuardando(true);
    setError(null);
    try {
      await sb.post("ajustes_tiempo_ot", fila);
      onGuardado({ ...fila, created_at: new Date().toISOString() });
    } catch (e) {
      setError(/ajustes_tiempo_ot/.test(String(e?.message)) ? AVISO_MIGRACION_145 : `No se pudo guardar: ${e?.message || e}`);
      setGuardando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={titulo}>
      <div className="p-4 overflow-y-auto text-gypi-text">
        <div className="text-[18px] font-bold mb-1">{titulo}</div>
        <div className="text-[14px] text-gypi-dim mb-3">
          Ahora le faltan {fmtH(horas || 0)}{diasCorrido > 0 ? ` y se corrió ${dias(diasCorrido)} del plan confirmado` : ""}.
        </div>
        {!soloMotivo && (
          <div className="flex gap-1.5 mb-3" role="group" aria-label="Qué querés anotar">
            <Chip active={tipo === "faltan"} onClick={() => setTipo("faltan")}>⏱ Cuánto le falta</Chip>
            {diasCorrido > 0 && <Chip active={tipo === "corrimiento"} onClick={() => setTipo("corrimiento")}>↪ Por qué se corrió</Chip>}
          </div>
        )}
        {tipo === "faltan" && (
          <>
            <label className="g-label" htmlFor="ajuste-horas">Faltan (horas)</label>
            <input id="ajuste-horas" className="g-input w-full mb-1" inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <div className="text-[13px] text-gypi-dim mb-3">Manda sobre el cálculo hasta que el proceso termine. Si se escanean piezas, baja en la misma proporción.</div>
          </>
        )}
        <div className="g-label">Motivo</div>
        <div className="flex flex-wrap gap-1.5 mb-2" role="radiogroup" aria-label="Motivo">
          {MOTIVOS_TIEMPO.map((m) => (
            <Chip key={m.id} role="radio" aria-checked={motivo === m.id} active={motivo === m.id} onClick={() => setMotivo(m.id)}>{m.label}</Chip>
          ))}
        </div>
        {motivo === "otros" && (
          <>
            <label className="g-label" htmlFor="ajuste-detalle">¿Cuál?</label>
            <input id="ajuste-detalle" className="g-input w-full mb-2" maxLength={300} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
          </>
        )}
        {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
        <button type="button" onClick={guardar} disabled={guardando} className="g-btn g-btn-primary w-full mt-1">{guardando ? "Guardando…" : "Guardar"}</button>
      </div>
    </Modal>
  );
}

const ETIQUETA_ETAPA = { corte: "Corte", canteado: "Canteado", mecanizado: "Mecanizado", armado: "Armado" };

/**
 * Detalle OT → ⏱ Cambios de tiempo: todo lo que se anotó de la OT, el más
 * nuevo primero (para analizar después por qué se atrasan las OT).
 */
export function CambiosTiempoOt({ ot }) {
  const [filas, setFilas] = useState(null);
  useEffect(() => {
    if (!ot) return;
    let vivo = true;
    sb.get(`ajustes_tiempo_ot?ot=eq.${encodeURIComponent(ot)}&select=id,etapa,tipo,horas,dias,motivo,detalle,creado_nombre,created_at&order=created_at.desc&limit=200`)
      .then((r) => { if (vivo) setFilas(r || []); })
      .catch(() => { if (vivo) setFilas([]); }); // sin la migración 145, nada que mostrar
    return () => { vivo = false; };
  }, [ot]);
  if (!filas?.length) return null;
  return (
    <section className="mb-4" aria-label="Cambios de tiempo">
      <div className="g-label mb-1.5">⏱ Cambios de tiempo</div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
        {filas.map((a) => (
          <li key={a.id ?? a.created_at} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border text-[13px]">
            <div className="font-bold">
              {ETIQUETA_ETAPA[a.etapa] || a.etapa} · {a.tipo === "faltan" ? `⏱ faltan ${fmtH(Number(a.horas) || 0)}` : `↪ se corrió ${dias(Number(a.dias) || 0)}`}
            </div>
            <div>{textoMotivo(a)}</div>
            <div className="text-xs text-gypi-dim">{fechaHora(a.created_at)}{a.creado_nombre ? ` · ${a.creado_nombre}` : ""}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const fechaHora = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
