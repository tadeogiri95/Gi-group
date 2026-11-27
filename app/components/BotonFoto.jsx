'use client';
// app/components/BotonFoto.jsx — Botón para sacar o elegir una foto y subirla
// por /api/upload (flota y checklist de vehículos, Mantenimiento partes 28 y 29).
// Con `recortar` (foto del artículo, 27/11) antes de subirla se abre la
// ventana para recortarla en cuadrado, como sale en el rótulo.
import { useState } from "react";
import { fotoBase64, subirImagen } from "../lib/foto";
import RecortarFoto from "./RecortarFoto";

export default function BotonFoto({ label, onFoto, disabled, recortar = false }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const subir = async (imagen) => {
    setSubiendo(true);
    setError(null);
    try {
      onFoto(await subirImagen(imagen));
    } catch (e) {
      setError(e.message);
    }
    setSubiendo(false);
  };
  const elegir = async (file) => {
    if (!file) return;
    if (recortar) { setArchivo(file); return; }
    await subir(await fotoBase64(file));
  };
  return (
    <>
      <label className="g-btn g-btn-secondary text-center cursor-pointer">
        {subiendo ? "Subiendo…" : label}
        <input type="file" accept="image/*" capture="environment" className="hidden" aria-label={label} disabled={disabled || subiendo} onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {archivo && <RecortarFoto fuente={archivo} onCancelar={() => setArchivo(null)}
        onListo={async (imagen) => { setArchivo(null); await subir(imagen); }} />}
      {error && <div role="alert" className="text-[12px] text-gypi-red">{error}</div>}
    </>
  );
}
