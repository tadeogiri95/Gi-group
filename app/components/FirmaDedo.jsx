'use client';
// app/components/FirmaDedo.jsx — Recuadro para firmar con el dedo en el
// celular (acta de instalación, Órdenes de Producción parte 11). Avisa con
// onCambio(true|false) si hay trazo, y expone png() para sacar la imagen.
import { forwardRef, useImperativeHandle, useRef } from "react";

const FirmaDedo = forwardRef(function FirmaDedo({ onCambio, disabled = false, quien = "el cliente" }, ref) {
  const canvas = useRef(null);
  const dibujando = useRef(false);
  const conTrazo = useRef(false);

  const punto = (ev) => {
    const c = canvas.current;
    const r = c.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) * c.width) / r.width, y: ((ev.clientY - r.top) * c.height) / r.height };
  };

  const empezar = (ev) => {
    if (disabled) return;
    ev.preventDefault();
    canvas.current.setPointerCapture?.(ev.pointerId);
    const ctx = canvas.current.getContext("2d");
    const { x, y } = punto(ev);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    ctx.beginPath();
    ctx.moveTo(x, y);
    dibujando.current = true;
  };
  const mover = (ev) => {
    if (!dibujando.current) return;
    ev.preventDefault();
    const ctx = canvas.current.getContext("2d");
    const { x, y } = punto(ev);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!conTrazo.current) { conTrazo.current = true; onCambio?.(true); }
  };
  const terminar = () => { dibujando.current = false; };

  const borrar = () => {
    const c = canvas.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    conTrazo.current = false;
    onCambio?.(false);
  };

  useImperativeHandle(ref, () => ({
    borrar,
    /** La firma como PNG en base64 (sin prefijo), sobre fondo blanco. */
    png: () => {
      const c = canvas.current;
      const copia = document.createElement("canvas");
      copia.width = c.width;
      copia.height = c.height;
      const ctx = copia.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, copia.width, copia.height);
      ctx.drawImage(c, 0, 0);
      return copia.toDataURL("image/png").split(",")[1];
    },
  }));

  return (
    <div>
      <canvas ref={canvas} width={600} height={250} aria-label={`Recuadro para la firma de ${quien}`} role="img"
        onPointerDown={empezar} onPointerMove={mover} onPointerUp={terminar} onPointerLeave={terminar} onPointerCancel={terminar}
        className="w-full h-[170px] bg-white rounded-xl border border-gypi-border touch-none" />
      <div className="flex items-center mt-1">
        <div className="flex-1 text-[11px] text-gypi-dim">Firma {quien} con el dedo en el recuadro blanco.</div>
        <button onClick={borrar} disabled={disabled} className="min-h-[44px] px-3 bg-transparent border-none text-gypi-red text-xs cursor-pointer">Borrar</button>
      </div>
    </div>
  );
});

export default FirmaDedo;
