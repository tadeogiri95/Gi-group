"use client";
// app/components/AvisoFacturaRepetida.jsx — Una factura, una sola vez
// (auditoría 12/11, parte 1; reglas en app/lib/facturaUnica.js). Cuando el
// número ya está cargado en otro lado, avisa dónde y deja elegir: revisar el
// número o cargarla igual (por ejemplo, otra factura del mismo número de
// otro punto de venta que Gypi no puede distinguir).

// Desde la parte 2 lo usa también la recepción de una OC (una entrega, una
// sola vez): titulo y textos de los botones se pueden cambiar.
export default function AvisoFacturaRepetida({
  mensaje, onCargarIgual, onRevisar, enviando = false,
  titulo = "⚠ Esta factura ya parece cargada", textoIgual = "Es otra: cargarla igual", textoRevisar = "Revisar el número",
}) {
  if (!mensaje) return null;
  return (
    <div role="alert" className="mt-2 p-3 rounded-[10px] border border-gypi-amber bg-gypi-amber/10 text-[14px]">
      <div className="font-semibold text-gypi-amber-ink mb-1">{titulo}</div>
      <div className="text-gypi-text mb-2">{mensaje}</div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={onRevisar} disabled={enviando} className="g-btn g-btn-secondary flex-1 min-h-[44px]">{textoRevisar}</button>
        <button type="button" onClick={onCargarIgual} disabled={enviando} className="g-btn g-btn-primary flex-1 min-h-[44px]">{enviando ? "Guardando…" : textoIgual}</button>
      </div>
    </div>
  );
}
