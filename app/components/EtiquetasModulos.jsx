'use client';
// app/components/EtiquetasModulos.jsx — Etiquetas de módulo de una OT
// (Órdenes de Producción, parte 12; ítem 39). Una por módulo, "Módulo 3 de
// 12", con el nombre si se pega desde el Excel de despiece y un QR que abre
// la carga de la OT. Se imprimen todas de una vez en la impresora de
// etiquetas, del mismo tamaño de rollo que los rótulos de bulto.
import { useState } from "react";
import { imprimirRotulos, linkCarga, modulosParaEtiquetas, MAX_ETIQUETAS, TAMANOS_ETIQUETA } from "../lib/carga";

const CLAVE_TAMANO = "gypi_tamano_etiqueta";

function leerTamano() {
  try { return localStorage.getItem(CLAVE_TAMANO) || TAMANOS_ETIQUETA[0].id; } catch { return TAMANOS_ETIQUETA[0].id; }
}

export default function EtiquetasModulos({ proyecto, empresa = null, onClose }) {
  const [cantidad, setCantidad] = useState(proyecto?.total_modulos ? String(proyecto.total_modulos) : "");
  const [nombres, setNombres] = useState("");
  const [tamano, setTamano] = useState(leerTamano);
  const [error, setError] = useState(null);

  const n = Number(cantidad);
  const total = Number.isInteger(n) && n >= 0 && n <= MAX_ETIQUETAS ? n : 0;
  const modulos = modulosParaEtiquetas(total, nombres);
  const ot = String(proyecto?.ot ?? "");

  const imprimir = async () => {
    setError(null);
    const t = TAMANOS_ETIQUETA.find((x) => x.id === tamano) || TAMANOS_ETIQUETA[0];
    try { localStorage.setItem(CLAVE_TAMANO, t.id); } catch { /* sin almacenamiento */ }
    try {
      await imprimirRotulos({
        empresa: empresa?.nombre_corto || empresa?.nombre || "",
        proyecto: proyecto || { ot },
        bultos: modulos,
        link: linkCarga(window.location.origin, empresa?.slug || "", ot),
        tamano: t,
        titulo: "Módulo",
      });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label={`Etiquetas de módulo de la OT ${ot}`}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="g-overline text-gypi-amber-ink">Orden {ot} · Etiquetas de módulo</div>
            <h3 className="m-0 font-heading text-lg font-bold truncate">{proyecto?.cliente || proyecto?.proyecto || "—"}</h3>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>

        <label className="g-label" htmlFor="etiq-cantidad">¿Cuántos módulos tiene la OT?</label>
        <input id="etiq-cantidad" className="g-input w-full mb-3" inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 12" />

        <label className="g-label" htmlFor="etiq-nombres">Nombres de los módulos (opcional)</label>
        <textarea id="etiq-nombres" className="g-input w-full min-h-[90px] mb-1" value={nombres} onChange={(e) => setNombres(e.target.value)}
          placeholder={"Uno por renglón, copiados del Excel de despiece.\nEj:\nM.izq\nM.central\nBast.TV"} />
        <div className="text-[11px] text-gypi-dim mb-3">Si pegás más nombres que módulos, se imprime una etiqueta por nombre. Los nombres no se guardan.</div>

        <label className="g-label" htmlFor="etiq-tamano">Tamaño de la etiqueta</label>
        <select id="etiq-tamano" className="g-input w-full mb-3" value={tamano} onChange={(e) => setTamano(e.target.value)}>
          {TAMANOS_ETIQUETA.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>

        {modulos.length > 0 && (
          <div className="text-[12px] text-gypi-dim mb-2" role="status">
            {modulos.length === 1 ? "1 etiqueta" : `${modulos.length} etiquetas`}: {modulos.slice(0, 3).map((m) => `Módulo ${m.numero} de ${modulos.length}${m.contenido ? ` (${m.contenido})` : ""}`).join(", ")}{modulos.length > 3 ? "…" : ""}
          </div>
        )}
        {error && <div role="alert" className="text-[12px] text-gypi-red mb-2">{error}</div>}
        <button onClick={imprimir} disabled={!modulos.length} className="g-btn g-btn-primary w-full">
          {modulos.length ? "🖨 Imprimir etiquetas" : "Poné cuántos módulos tiene"}
        </button>
        <div className="text-[11px] text-gypi-dim mt-2">El QR abre la carga de la OT. La etiqueta de cada pieza la sigue imprimiendo la optimizadora.</div>
      </div>
    </div>
  );
}
