"use client";
// app/components/AvisoFacturaRepetida.jsx — Una factura, una sola vez
// (auditoría 12/11, parte 1; reglas en app/lib/facturaUnica.js). Cuando el
// número ya está cargado en otro lado, avisa dónde y deja elegir: revisar el
// número o cargarla igual (por ejemplo, otra factura del mismo número de
// otro punto de venta que Gypi no puede distinguir).

export default function AvisoFacturaRepetida({ mensaje, onCargarIgual, onRevisar, enviando = false }) {
  if (!mensaje) return null;
  return (
    <div role="alert" className="mt-2 p-3 rounded-[10px] border border-gypi-amber bg-gypi-amber/10 text-[14px]">
      <div className="font-semibold text-gypi-amber-ink mb-1">⚠ Esta factura ya parece cargada</div>
      <div className="text-gypi-text mb-2">{mensaje}</div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={onRevisar} disabled={enviando} className="g-btn g-btn-secondary flex-1 min-h-[44px]">Revisar el número</button>
        <button type="button" onClick={onCargarIgual} disabled={enviando} className="g-btn g-btn-primary flex-1 min-h-[44px]">{enviando ? "Guardando…" : "Es otra: cargarla igual"}</button>
      </div>
    </div>
  );
}
