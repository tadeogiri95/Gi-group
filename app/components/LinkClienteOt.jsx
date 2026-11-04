'use client';
// app/components/LinkClienteOt.jsx — 🔗 Para el cliente (04/11): el QR y el
// link de la página de la OT para el cliente (/ot/<código>), para copiar,
// mandar por WhatsApp o imprimir. Solo gestión (la ruta lo controla).
import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import { apiFetch } from "../lib/supabase";
import { textoOt } from "../lib/nombreOt";
import { imagenQr, imprimirQrCliente, mensajeCliente } from "../lib/qrClienteOt";

export default function LinkClienteOt({ proyecto, empresaNombre = "", onClose }) {
  const [url, setUrl] = useState(null);
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const ot = proyecto?.ot;
  const nombre = textoOt(proyecto) || `OT ${ot}`;

  useEffect(() => {
    if (!ot) return;
    let vivo = true;
    (async () => {
      try {
        const r = await apiFetch("/api/proyectos/link-cliente", { method: "POST", body: JSON.stringify({ ot: String(ot) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.url) throw new Error(j.error || "No se pudo armar el link");
        const img = await imagenQr(j.url);
        if (vivo) { setUrl(j.url); setQr(img); }
      } catch (e) {
        if (vivo) setError(e.message);
      }
    })();
    return () => { vivo = false; };
  }, [ot]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
    } catch {
      setError("No se pudo copiar: mantené apretado el link y copialo a mano.");
    }
  };

  const imprimir = async () => {
    try { await imprimirQrCliente({ empresa: empresaNombre, textoOt: nombre, url }); } catch (e) { setError(e.message); }
  };

  return (
    <Modal open onClose={onClose} title="Para el cliente">
      <div className="p-4 overflow-y-auto text-gypi-text flex flex-col gap-3">
        <p className="m-0 text-[14px] text-gypi-dim leading-relaxed">
          El cliente escanea este QR con la cámara del celular y ve su OT, cómo va la fabricación y la instalación, la entrega y el PDF. No ve precios ni datos internos, y no necesita usuario.
        </p>
        <div className="text-[15px] font-bold">{nombre}</div>
        {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
        {!url && !error && <div className="text-[13px] text-gypi-dim">Armando el link…</div>}
        {url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- QR generado en el momento (data URL) */}
            {qr && <img src={qr} alt={`QR del seguimiento de la ${nombre}`} className="w-[240px] h-[240px] mx-auto bg-white rounded-xl p-2" />}
            <div className="text-[12px] font-mono break-all text-gypi-dim">{url}</div>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={copiar} className="g-btn g-btn-secondary min-h-[48px]">{copiado ? "✅ Copiado" : "📋 Copiar"}</button>
              <a href={`https://wa.me/?text=${encodeURIComponent(mensajeCliente({ empresa: empresaNombre, textoOt: nombre, url }))}`} target="_blank" rel="noopener noreferrer"
                className="g-btn g-btn-secondary min-h-[48px] flex items-center justify-center no-underline">💬 WhatsApp</a>
              <button type="button" onClick={imprimir} className="g-btn g-btn-secondary min-h-[48px]">🖨 Imprimir</button>
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-gypi-amber-ink text-center">Ver la página como la ve el cliente</a>
          </>
        )}
      </div>
    </Modal>
  );
}
