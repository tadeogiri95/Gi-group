'use client';
// app/components/BotonPoliza.jsx — Adjuntar la póliza del seguro en PDF
// (Tadeo, 03/11; migración 156). La sube por /api/flota/poliza, que guarda el
// PDF y lee sus datos sin IA; onLeida recibe { archivo, datos, sin_texto }.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";

export async function descargarPdfPapel(papelId) {
  // La ventana se abre antes de pedir el link: si no, el celular la bloquea
  const ventana = typeof window !== "undefined" ? window.open("", "_blank") : null;
  try {
    const res = await apiFetch("/api/flota", { method: "POST", body: JSON.stringify({ accion: "papel_archivo", id: papelId }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || "No se pudo abrir el PDF");
    if (ventana) ventana.location.href = data.url;
    else window.location.href = data.url;
  } catch (e) {
    ventana?.close();
    throw e;
  }
}

export default function BotonPoliza({ label = "📄 Cargar desde la póliza (PDF)", disabled, onLeida }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);
  const elegir = async (file) => {
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch("/api/flota/poliza", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo subir la póliza");
      onLeida(data);
    } catch (e) {
      setError(e.message);
    }
    setSubiendo(false);
  };
  return (
    <div className="mb-2">
      <label className="g-btn g-btn-secondary w-full text-center cursor-pointer">
        {subiendo ? "Leyendo la póliza…" : label}
        <input type="file" accept="application/pdf,.pdf" className="hidden" aria-label={label} disabled={disabled || subiendo}
          onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {error && <div role="alert" className="text-[12px] text-gypi-red mt-1">{error}</div>}
    </div>
  );
}

/** El aviso que sigue a leer la póliza: cuántos datos completó o que no tenía texto. */
export function AvisoPoliza({ resultado }) {
  if (!resultado) return null;
  const n = resultado.datos?.encontrados?.length || 0;
  const texto = resultado.sin_texto
    ? "Este PDF es una imagen (escaneado o sacado con foto) y Gypi no puede leer sus datos. Cargalos a mano: la póliza queda guardada igual."
    : n
      ? `Gypi completó ${n === 1 ? "1 dato" : `${n} datos`} de la póliza (marcados en amarillo). Revisalos antes de guardar.`
      : "Gypi no encontró datos en esta póliza. Cargalos a mano: la póliza queda guardada igual.";
  return (
    <div role="status" className="p-2.5 mb-2 rounded-[10px] bg-gypi-amber/10 text-[13px] text-gypi-amber-ink">
      📄 {resultado.archivo?.nombre} · {texto}
    </div>
  );
}
