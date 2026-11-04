'use client';
// app/components/QrAbierto.jsx — Un QR de Gypi leído con la cámara del
// celular (04/11, Tadeo): el link ?qr=<texto> abre esta ventana con lo que
// dice el QR (app/lib/linkQr.js).
//   OT     → la OT completa, 📄 PDF y 🚚 Carga.
//   Módulo → la OT, 📄 PDF y 🧩 Anotar en una etapa (todas sus piezas).
//   Pieza  → la OT, 📄 PDF y 🧩 Anotar en una etapa.
// Anotar abre Escanear piezas con el código ya leído: el operario elige la
// etapa y confirma (un link solo no dice en qué etapa está).
import { useMemo } from "react";
import Modal from "./ui/Modal";
import { leerQrPieza, leerQrModulo } from "../lib/piezas";
import { otDeQr } from "../lib/pdfOt";
import { textoDeQr } from "../lib/linkQr";
import { otCompleta, detalleOt } from "../lib/nombreOt";
import { useOts } from "../hooks/useOts";
import { PdfDeOt } from "./PdfOt";

/** Qué es el QR: { tipo: "pieza" | "modulo" | "ot", ot, titulo } o null. */
export function queEsQr(texto) {
  const s = textoDeQr(texto);
  const pieza = leerQrPieza(s);
  if (pieza) {
    const titulo = pieza.nombre ? `Pieza ${pieza.nombre} (${pieza.unidad} de ${pieza.de})` : `Pieza N° ${pieza.id}`;
    return { tipo: "pieza", ot: pieza.ot, titulo };
  }
  const modulo = leerQrModulo(s);
  if (modulo) return { tipo: "modulo", ot: modulo.ot, titulo: `Módulo ${modulo.modulo}` };
  const ot = otDeQr(s);
  return ot ? { tipo: "ot", ot, titulo: `OT ${ot}` } : null;
}

export default function QrAbierto({ texto, onAnotar, onCarga, onClose }) {
  const que = useMemo(() => queEsQr(texto), [texto]);
  const porOt = useOts(!!que);
  const p = que ? otCompleta(que.ot, porOt) : null;
  const ot = p?.ot || que?.ot;
  const detalle = p ? detalleOt(p) : "";

  return (
    <Modal open onClose={onClose} title={que ? que.titulo : "Código QR"}>
      <div className="p-4 text-gypi-text">
        {!que ? (
          <div className="text-[14px] text-gypi-dim">Este QR no es de una OT, un módulo ni una pieza de Gypi.</div>
        ) : (
          <>
            <div className="mb-3">
              <div className="text-[13px] font-bold text-gypi-dim">OT</div>
              <div className="text-[17px] font-bold">{ot}</div>
              {detalle && <div className="text-[14px] text-gypi-dim">{detalle}</div>}
            </div>
            {que.tipo !== "ot" && (
              <button onClick={() => onAnotar(textoDeQr(texto))} className="g-btn g-btn-primary w-full min-h-[52px] text-[15px] font-bold mb-3">
                🧩 Anotar {que.tipo === "modulo" ? "el módulo" : "la pieza"} en una etapa
              </button>
            )}
            <PdfDeOt ot={ot} />
            {que.tipo === "ot" && (
              <button onClick={() => onCarga(ot)} className="g-btn g-btn-secondary w-full min-h-[48px] text-[15px] font-bold">
                🚚 Carga de la OT
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
