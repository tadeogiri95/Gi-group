'use client';
// app/components/PdfOt.jsx — 📄 PDF de la OT (04/11; app/lib/pdfOt.js). El
// PDF está en la carpeta de Drive de las OT y se abre en Drive, en otra
// pestaña. Si la carpeta no está conectada no se muestra nada.
//   PdfDeOt     → sección del Detalle de la OT (todos los PDF de esa OT)
//   BotonPdfOt  → botón grande de la ventana de la OT en la lista
//   LinkPdfOt   → 📄 chico en la fila de la tabla de OT (computadora)
import { useMemo } from "react";
import { pdfsDeOt, numeroDeOt } from "../lib/pdfOt";
import { usePdfsOt } from "../hooks/usePdfsOt";

const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "");

/** Sección 📄 PDF de la OT en el Detalle. */
export function PdfDeOt({ ot }) {
  const archivos = usePdfsOt(!!ot);
  const { pdfs, deLaMadre } = useMemo(() => pdfsDeOt(ot, archivos), [ot, archivos]);
  if (!archivos || !ot) return null;
  const numero = numeroDeOt(ot);
  return (
    <section aria-label="PDF de la OT" className="mb-4">
      {pdfs.length ? (
        <>
          <a href={pdfs[0].url} target="_blank" rel="noopener noreferrer"
            className="g-btn g-btn-primary w-full min-h-[48px] flex items-center justify-center gap-2 no-underline text-[15px] font-bold">
            📄 Ver PDF de la OT
          </a>
          <div className="text-xs text-gypi-dim mt-1 truncate">
            {deLaMadre ? `De la OT ${numero.split("-")[0]} (esta sub-OT no tiene PDF propio) · ` : ""}{pdfs[0].nombre}
          </div>
          {pdfs.length > 1 && (
            <ul className="list-none m-0 mt-1.5 p-0 flex flex-col gap-1">
              {pdfs.slice(1).map((p) => (
                <li key={p.id} className="text-[13px]">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-gypi-amber-ink font-semibold">📄 {p.nombre}</a>
                  {p.fecha && <span className="text-gypi-dim"> · {fechaCorta(p.fecha)}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="text-[13px] text-gypi-dim bg-gypi-surface rounded-xl p-3 border border-gypi-border">
          📄 No hay PDF de esta OT en la carpeta de Drive.{numero ? ` El nombre del archivo tiene que empezar con ${numero}.` : ""}
        </div>
      )}
    </section>
  );
}

/** Botón grande 📄 PDF de la ventana de la OT (solo si la OT tiene PDF). */
export function BotonPdfOt({ ot, indice }) {
  const { pdfs } = useMemo(() => pdfsDeOt(ot, indice), [ot, indice]);
  if (!pdfs.length) return null;
  return (
    <a href={pdfs[0].url} target="_blank" rel="noopener noreferrer"
      className="min-h-[52px] px-3 rounded-xl text-[15px] font-bold flex items-center justify-center no-underline bg-gypi-amber/10 text-gypi-amber-ink">
      📄 PDF
    </a>
  );
}

/** 📄 chico en la fila de la tabla (solo si la OT tiene PDF). */
export function LinkPdfOt({ ot, indice }) {
  const { pdfs } = useMemo(() => pdfsDeOt(ot, indice), [ot, indice]);
  if (!pdfs.length) return null;
  return (
    <a href={pdfs[0].url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
      aria-label={`Ver el PDF de la OT ${ot}`} title="Ver el PDF"
      className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] mr-1 rounded-lg border border-gypi-border no-underline">
      📄
    </a>
  );
}
