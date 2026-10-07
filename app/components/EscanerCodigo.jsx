"use client";
// EscanerCodigo — Lee códigos QR o de barras con la cámara (BarcodeDetector,
// Chrome en Android). Lo usan el kiosco (tarjeta QR del operario) y el inicio
// de tareas (código de la OT, D8). Si el navegador no lo soporta no muestra
// nada (o el aviso), y quien lo usa ofrece escribir el dato a mano.
import { useState, useEffect, useRef } from "react";

export function escanerDisponible() {
  return typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * @param {{ onCodigo: (texto: string) => void, formatos?: string[], camara?: "user"|"environment", ayuda?: string }} props
 *   onCodigo recibe el texto de cada código leído; quien lo usa decide si sirve.
 */
export default function EscanerCodigo({ onCodigo, formatos = ["qr_code"], camara = "environment", ayuda }) {
  const videoRef = useRef(null);
  const onCodigoRef = useRef(onCodigo);
  const [error, setError] = useState("");
  const formatosClave = formatos.join(",");

  useEffect(() => {
    onCodigoRef.current = onCodigo;
  }, [onCodigo]);

  useEffect(() => {
    if (!escanerDisponible()) return;
    let stream = null;
    let timer = null;
    let cancelado = false;
    (async () => {
      try {
        const soportados = (await window.BarcodeDetector.getSupportedFormats?.()) || formatosClave.split(",");
        const usar = formatosClave.split(",").filter((f) => soportados.includes(f));
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: camara }, audio: false });
        if (cancelado) return;
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { /* sin autoplay: el detector igual lee el cuadro */ }
        const detector = new window.BarcodeDetector({ formats: usar.length ? usar : ["qr_code"] });
        timer = setInterval(async () => {
          try {
            const codigos = await detector.detect(videoRef.current);
            for (const c of codigos) if (c.rawValue) onCodigoRef.current?.(c.rawValue);
          } catch { /* cuadro sin código */ }
        }, 350);
      } catch {
        setError("No se pudo usar la cámara. Revisá el permiso o escribilo a mano.");
      }
    })();
    return () => {
      cancelado = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camara, formatosClave]);

  if (!escanerDisponible()) return null;
  if (error) return <div role="alert" className="text-sm text-gypi-dim text-center mb-3">{error}</div>;
  return (
    <div className="w-full max-w-[340px] mx-auto mb-4">
      <video ref={videoRef} muted playsInline className="w-full aspect-[4/3] object-cover rounded-2xl bg-black" aria-label="Cámara para escanear" />
      {ayuda && <div className="text-sm text-gypi-dim text-center mt-2">{ayuda}</div>}
    </div>
  );
}
