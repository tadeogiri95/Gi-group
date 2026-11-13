'use client';
// app/components/FinanzasAvisoRepetidos.jsx — Finanzas (13/11, parte 1 del
// plan de Tesorería): el aviso cuando el servidor encuentra en la misma caja
// o banco otro movimiento por el mismo importe y con fecha cerca (409 con
// "repetidos"; reglas en app/lib/finanzasRepetidos.js).
//
// 🔴 el mismo día / 🟡 hasta 3 días. Se muestra lo que ya está y dos salidas:
// no cargarlo (Cancelar) o "Es otro distinto, cargarlo igual". Con onUsar (un
// cheque que se debitó), también "Es este" para unirlo a ese movimiento.
import { plata } from "../lib/finanzasOperaciones";
import { DIAS_REPETIDO, origenTexto } from "../lib/finanzasRepetidos";

const fechaDma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

/** Lee la respuesta del servidor: los repetidos si es el aviso, o null. */
export function repetidosDe(status, datos) {
  return status === 409 && Array.isArray(datos?.repetidos) && datos.repetidos.length ? datos.repetidos : null;
}

/**
 * @param {{ repetidos: object[], ocupado?: boolean, onCargarIgual: () => void, onCancelar: () => void,
 *   onUsar?: (id: number) => void, textoUsar?: string, textoIgual?: string }} props
 */
export default function AvisoRepetidos({ repetidos, ocupado = false, onCargarIgual, onCancelar, onUsar = null, textoUsar = "Es este", textoIgual = "Es otro distinto, cargarlo igual" }) {
  if (!repetidos?.length) return null;
  const rojo = repetidos.some((r) => r.nivel === "rojo");
  const parecidas = repetidos.flatMap((r) => r.parecidas || []);
  return (
    <section role="alert" aria-label="Posible movimiento repetido"
      className={`rounded-lg p-3 flex flex-col gap-2 text-[13px] text-gypi-text border ${rojo ? "border-gypi-red/50 bg-gypi-red/10" : "border-gypi-amber/50 bg-gypi-amber/10"}`}>
      <p className="m-0 font-semibold">
        {rojo
          ? "🔴 Muy sospechoso: en esa caja ya hay un movimiento por el mismo importe el mismo día."
          : `🟡 Posible repetido: en esa caja ya hay un movimiento por el mismo importe con ${DIAS_REPETIDO} días o menos de diferencia.`}
      </p>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
        {parecidas.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-gypi-surface border border-gypi-border px-2 py-1.5">
            <span className="font-mono">{fechaDma(p.fecha)}</span>
            <b className={`font-mono ${p.importe < 0 ? "text-gypi-red" : "text-gypi-green"}`}>{plata(p.importe, "ARS")}</b>
            <span className="flex-1 min-w-[160px] break-words">{[p.tipo, p.entidad || p.descripcion].filter(Boolean).join(" · ")} <span className="text-gypi-dim">({origenTexto(p.origen)})</span></span>
            {onUsar && <button type="button" className="g-btn g-btn-primary !py-1 !px-2 text-[12px]" disabled={ocupado} onClick={() => onUsar(p.id)}>{textoUsar}</button>}
          </li>
        ))}
      </ul>
      <p className="m-0 text-[12px] text-gypi-dim">Si es el mismo, no lo cargues de nuevo. Si de verdad es otro, cargalo igual: después se puede corregir o anular.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={onCancelar}>No cargarlo</button>
        <button type="button" className="g-btn g-btn-primary" disabled={ocupado} onClick={onCargarIgual}>{ocupado ? "Guardando…" : textoIgual}</button>
      </div>
    </section>
  );
}
