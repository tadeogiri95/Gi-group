'use client';
// app/components/ElegirOtCarga.jsx — El operario elige la OT que va a cargar
// (Órdenes de Producción, parte 10). Sin esto, el responsable de acopio y
// carga solo llegaba a la carga escaneando el QR de un rótulo, y los rótulos
// los imprimía gestión. Con la OT elegida se abre la misma carga (CargaOt),
// donde arma los bultos e imprime los rótulos él mismo.
// También se elige escaneando el QR de la OT de la planilla (o de un rótulo).
// Retirar material (Stock, parte 14) usa la misma lista con su título y la
// opción "Sin OT".
import { useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { ordenarPorOt } from "../hooks/useActividad";
import { fechaCorta } from "../lib/ot";
import Modal from "./ui/Modal";
import EscanerCodigo, { escanerDisponible } from "./EscanerCodigo";
import { leerQr, otDelQr } from "../lib/escaneoCarga";

const MAX_VISIBLES = 50;

const normalizar = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filtrarOts(lista, texto) {
  const q = normalizar(texto).trim();
  if (!q) return lista;
  return lista.filter((p) => [p.ot, p.cliente, p.obra, p.proyecto].some((c) => normalizar(c).includes(q)));
}

export default function ElegirOtCarga({ empresaId, onElegir, onClose, titulo = "¿Qué OT vas a cargar?", verbo = "Cargar", onSinOt = null }) {
  const [ots, setOts] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    sbGetAll(`proyectos?empresa_id=eq.${empresaId}&estado=eq.activo&select=id,ot,cliente,obra,proyecto,fecha_entrega&order=id.desc`, { maxFilas: 20000 })
      .then(({ data }) => { if (vivo) setOts(ordenarPorOt(data || [])); })
      .catch(() => { if (vivo) { setOts([]); setError("No se pudieron leer las OT. Probá de nuevo."); } });
    return () => { vivo = false; };
  }, [empresaId]);

  const filtradas = useMemo(() => filtrarOts(ots || [], texto), [ots, texto]);

  const alEscanear = (codigo) => {
    if (!ots) return;
    const ot = otDelQr(codigo, ots);
    if (ot) { onElegir(ot); return; }
    const lectura = leerQr(codigo);
    setAviso(lectura ? `La OT ${lectura.ot} no está entre las activas.` : "Ese código no es de una OT.");
  };

  return (
    <Modal open onClose={onClose} title={titulo}>
      <div className="p-4 overflow-y-auto">
        <input className="g-input w-full mb-3" value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="search"
          aria-label="Buscar OT" placeholder="Número de OT, cliente u obra" />
        {escanerDisponible() && ots !== null && (
          <div className="mb-3">
            <button onClick={() => { setEscaneando(!escaneando); setAviso(null); }} aria-pressed={escaneando} className="g-btn g-btn-secondary w-full">
              {escaneando ? "Cerrar la cámara" : "📷 Escanear el QR de la OT"}
            </button>
            {escaneando && <div className="mt-2"><EscanerCodigo onCodigo={alEscanear} ayuda="Apuntá al QR de la OT en la planilla" /></div>}
            {aviso && <div role="alert" className="text-[12px] text-gypi-red">{aviso}</div>}
          </div>
        )}
        {onSinOt && (
          <button onClick={onSinOt} className="g-btn g-btn-secondary w-full mb-3">Sin OT (consumo general)</button>
        )}
        {error && <div role="alert" className="text-[12px] text-gypi-red mb-2">{error}</div>}
        {ots === null ? (
          <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
        ) : filtradas.length === 0 ? (
          <div className="text-[13px] text-gypi-dim py-4 text-center">{texto ? "No hay OT activas con ese dato." : "No hay OT activas."}</div>
        ) : (
          <ul aria-label="OT activas" className="list-none p-0 m-0 flex flex-col gap-1.5">
            {filtradas.slice(0, MAX_VISIBLES).map((p) => (
              <li key={p.id ?? p.ot}>
                <button onClick={() => onElegir(String(p.ot))} aria-label={`${verbo} la OT ${p.ot}`}
                  className="w-full min-h-[52px] text-left bg-gypi-surface rounded-xl px-3 py-2.5 border border-gypi-border cursor-pointer font-body text-gypi-text">
                  <div className="text-[14px] font-bold">OT {p.ot}{p.cliente ? ` · ${p.cliente}` : ""}</div>
                  <div className="text-[12px] text-gypi-dim truncate">
                    {[p.obra || p.proyecto, p.fecha_entrega && `Entrega ${fechaCorta(p.fecha_entrega)}`].filter(Boolean).join(" · ") || "—"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {filtradas.length > MAX_VISIBLES && (
          <div className="text-[12px] text-gypi-dim mt-2 text-center">Hay {filtradas.length} OT: escribí el número para encontrarla más rápido.</div>
        )}
      </div>
    </Modal>
  );
}
