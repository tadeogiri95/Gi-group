'use client';
// app/components/VerPdfOt.jsx — 📄 Ver PDF de una OT escaneando un QR (04/11,
// PR 2; app/lib/pdfOt.js). Sirve cualquier QR que tenga la OT: el de la OT,
// el de una pieza, un bulto, un suelto o un módulo. También se puede escribir
// el número. El PDF se abre en Drive con un toque (el navegador no deja
// abrir otra pestaña sola desde la cámara).
import { useMemo, useRef, useState } from "react";
import Modal from "./ui/Modal";
import EscanerCodigo, { escanerDisponible } from "./EscanerCodigo";
import { indicePdfs, otDeQr, pdfsDeOt, numeroDeOt } from "../lib/pdfOt";
import { usePdfsOt } from "../hooks/usePdfsOt";
import { useOts } from "../hooks/useOts";
import { otCompleta, textoOt } from "../lib/nombreOt";

export default function VerPdfOt({ onClose }) {
  const archivos = usePdfsOt();
  const indice = useMemo(() => indicePdfs(archivos), [archivos]);
  const porOt = useOts();
  const [lectura, setLectura] = useState(null);
  const [numero, setNumero] = useState("");
  const ultimo = useRef("");

  const leer = (texto) => {
    const s = String(texto ?? "").trim();
    if (!s || s === ultimo.current) return;
    ultimo.current = s;
    const ot = otDeQr(s);
    setLectura(ot ? { ot } : { error: "Ese código no tiene una OT. Escaneá la etiqueta de la OT, de una pieza, de un bulto o de un módulo." });
  };

  const escribir = (e) => {
    e.preventDefault();
    const n = numero.trim().toUpperCase();
    if (!n) return;
    ultimo.current = "";
    leer(n);
    setNumero("");
  };

  const resultado = lectura?.ot ? pdfsDeOt(lectura.ot, indice) : null;
  const nombre = lectura?.ot ? textoOt(otCompleta(lectura.ot, porOt)) || `OT ${lectura.ot}` : "";

  return (
    <Modal open onClose={onClose} title="Ver PDF de una OT">
      <div className="p-4 overflow-y-auto text-gypi-text flex flex-col gap-3">
        {escanerDisponible() ? (
          <EscanerCodigo onCodigo={leer} formatos={["qr_code", "code_128", "code_39"]}
            ayuda="Apuntá al QR de la OT, de una pieza, de un bulto o de un módulo" />
        ) : (
          <div className="text-[13px] text-gypi-dim">Para escanear con la cámara usá Chrome en un celular Android. Mientras tanto, escribí el número de la OT.</div>
        )}
        <form onSubmit={escribir} className="flex gap-2">
          <input className="g-input flex-1" value={numero} onChange={(e) => setNumero(e.target.value)}
            aria-label="Número de la OT" placeholder="O escribí la OT (ej. M-7495)" />
          <button type="submit" disabled={!numero.trim()} className="g-btn g-btn-secondary">Buscar</button>
        </form>

        {archivos === null && (
          <div className="text-[13px] text-gypi-dim">Buscando los PDF de la carpeta…</div>
        )}
        {lectura?.error && <div role="alert" className="rounded-xl p-3 text-[14px] font-semibold bg-gypi-red/10 text-gypi-red">{lectura.error}</div>}
        {resultado && (
          <div role="status" className="flex flex-col gap-2">
            <div className="text-[15px] font-bold">{nombre}</div>
            {resultado.pdfs.length ? (
              <>
                <a href={resultado.pdfs[0].url} target="_blank" rel="noopener noreferrer"
                  className="g-btn g-btn-primary w-full min-h-[56px] flex items-center justify-center gap-2 no-underline text-[17px] font-bold">
                  📄 Abrir el PDF
                </a>
                <div className="text-xs text-gypi-dim">
                  {resultado.deLaMadre ? `De la OT ${numeroDeOt(lectura.ot).split("-")[0]} (esta sub-OT no tiene PDF propio) · ` : ""}{resultado.pdfs[0].nombre}
                </div>
                {resultado.pdfs.slice(1).map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-gypi-amber-ink">📄 {p.nombre}</a>
                ))}
              </>
            ) : archivos !== null ? (
              <div className="rounded-xl p-3 text-[14px] bg-gypi-amber/10 text-gypi-amber-ink">
                No hay PDF de esta OT en la carpeta de Drive. Avisale a la oficina.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}
