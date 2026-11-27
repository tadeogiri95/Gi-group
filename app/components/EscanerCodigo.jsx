"use client";
// EscanerCodigo — Lee códigos QR o de barras con la cámara (BarcodeDetector,
// Chrome en Android). Lo usan el kiosco (tarjeta QR del operario) y el inicio
// de tareas (código de la OT, D8). Si el navegador no lo soporta no muestra
// nada (o el aviso), y quien lo usa ofrece escribir el dato a mano.
// Por defecto lee QR y código de barras (06/11: las etiquetas de piezas de la
// máquina vienen con código de barras, "M7819-GB2P-11").
// Cada código nuevo suena con un "bip" (y vibra).
// mira (27/11, Tadeo: se anotó el canto de otra OT que estaba cerca): muestra
// un recuadro en el medio y solo toma el código que está adentro; si adentro
// hay más de uno, no toma ninguno y avisa con onVarios.
import { useState, useEffect, useRef } from "react";
import { bip, debeSonar } from "../lib/bip";

export const FORMATOS = ["qr_code", "code_128", "code_39"];

// El recuadro del medio: el centro del código tiene que caer adentro
const MIRA = { ancho: 0.6, alto: 0.6 };

/**
 * Los códigos con el centro adentro de la mira. Sin el tamaño del cuadro o sin
 * la ubicación del código (algunos navegadores no la dan) cuenta como adentro.
 */
export function codigosEnMira(codigos, ancho, alto) {
  if (!ancho || !alto) return codigos;
  const x0 = ancho * (1 - MIRA.ancho) / 2, x1 = ancho - x0;
  const y0 = alto * (1 - MIRA.alto) / 2, y1 = alto - y0;
  return codigos.filter((c) => {
    const b = c.boundingBox;
    if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return true;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
  });
}

export function escanerDisponible() {
  return typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * @param {{ onCodigo: (texto: string) => void, formatos?: string[], camara?: "user"|"environment", ayuda?: string, mira?: boolean, onVarios?: () => void }} props
 *   onCodigo recibe el texto de cada código leído; quien lo usa decide si sirve.
 *   mira: solo el código del recuadro del medio, y de a uno (onVarios si hay más).
 */
export default function EscanerCodigo({ onCodigo, formatos = FORMATOS, camara = "environment", ayuda, mira = false, onVarios }) {
  const videoRef = useRef(null);
  const onCodigoRef = useRef(onCodigo);
  const onVariosRef = useRef(onVarios);
  const [error, setError] = useState("");
  const formatosClave = formatos.join(",");

  useEffect(() => {
    onCodigoRef.current = onCodigo;
    onVariosRef.current = onVarios;
  }, [onCodigo, onVarios]);

  useEffect(() => {
    if (!escanerDisponible()) return;
    let stream = null;
    let timer = null;
    let cancelado = false;
    let ultimoBip = null;
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
            let codigos = (await detector.detect(videoRef.current)).filter((c) => c.rawValue);
            if (mira) {
              const v = videoRef.current;
              codigos = codigosEnMira(codigos, v?.videoWidth, v?.videoHeight);
              // Dos etiquetas en la mira: no se sabe cuál quiso, no se toma ninguna
              if (new Set(codigos.map((c) => c.rawValue)).size > 1) {
                onVariosRef.current?.();
                return;
              }
              codigos = codigos.slice(0, 1);
            }
            for (const c of codigos) {
              if (!c.rawValue) continue;
              if (debeSonar(ultimoBip, c.rawValue)) {
                ultimoBip = { codigo: c.rawValue, t: Date.now() };
                bip();
              }
              onCodigoRef.current?.(c.rawValue);
            }
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
  }, [camara, formatosClave, mira]);

  if (!escanerDisponible()) return null;
  if (error) return <div role="alert" className="text-sm text-gypi-dim text-center mb-3">{error}</div>;
  return (
    <div className="w-full max-w-[340px] mx-auto mb-4">
      <div className="relative overflow-hidden rounded-2xl">
        <video ref={videoRef} muted playsInline className="w-full aspect-[4/3] object-cover rounded-2xl bg-black" aria-label="Cámara para escanear" />
        {mira && (
          <div aria-hidden="true" data-mira
            className="absolute left-[20%] top-[20%] w-[60%] h-[60%] rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] pointer-events-none" />
        )}
      </div>
      {ayuda && <div className="text-sm text-gypi-dim text-center mt-2">{ayuda}</div>}
    </div>
  );
}
