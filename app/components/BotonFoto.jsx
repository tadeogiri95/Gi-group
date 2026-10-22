'use client';
// app/components/BotonFoto.jsx — Botón para sacar o elegir una foto y subirla
// por /api/upload (flota y checklist de vehículos, Mantenimiento partes 28 y 29).
import { useState } from "react";
import { fotoBase64, subirImagen } from "../lib/foto";

export default function BotonFoto({ label, onFoto, disabled }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);
  const elegir = async (file) => {
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      onFoto(await subirImagen(await fotoBase64(file)));
    } catch (e) {
      setError(e.message);
    }
    setSubiendo(false);
  };
  return (
    <>
      <label className="g-btn g-btn-secondary text-center cursor-pointer">
        {subiendo ? "Subiendo…" : label}
        <input type="file" accept="image/*" capture="environment" className="hidden" aria-label={label} disabled={disabled || subiendo} onChange={(e) => elegir(e.target.files?.[0])} />
      </label>
      {error && <div role="alert" className="text-[12px] text-gypi-red">{error}</div>}
    </>
  );
}
