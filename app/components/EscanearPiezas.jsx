'use client';
// app/components/EscanearPiezas.jsx — El operario escanea las piezas en su
// etapa (Órdenes de Producción, parte 18). Elige la etapa (las de la empresa
// elegidas en Configuración → Etapas como Corte, Canto, CNC o Corte especial;
// si tiene una tarea en curso de esa etapa, ya viene elegida) y escanea una pieza tras otra sin tocar la pantalla:
//   verde    → la pieza pasó por la etapa
//   amarillo → ya estaba escaneada, se salteó una etapa anterior o no le toca
//   rojo     → no es una etiqueta de pieza, o la pieza ya no está en la OT
// Sin señal, el escaneo se guarda y se manda solo cuando vuelve la conexión.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { enviarOEncolar } from "../lib/colaOffline";
import Modal from "./ui/Modal";
import EscanerCodigo, { escanerDisponible } from "./EscanerCodigo";
import { botonesEtapasPieza, nombresEtapasPieza, tipoDeEtapaEn, mensajeEscaneo } from "../lib/piezas";

const CLAVE_ETAPA = "gypi_etapa_piezas";
const REPETIDO_MS = 5000;
const MAX_RESULTADOS = 30;

const TONOS = {
  verde: "bg-gypi-green/10 text-gypi-green",
  amarillo: "bg-gypi-amber/10 text-gypi-amber-ink",
  rojo: "bg-gypi-red/10 text-gypi-red",
  pendiente: "bg-gypi-surf-hi text-gypi-dim",
};

function etapaInicial(etapas, botones, tareaActiva) {
  const enCurso = tareaActiva?.etapa ? etapas.find((e) => e.codigo === tareaActiva.etapa || e.id === tareaActiva.etapa) : null;
  const tipo = tipoDeEtapaEn(etapas, enCurso);
  if (tipo && botones.some((b) => b.id === tipo)) return tipo;
  try {
    const guardada = localStorage.getItem(CLAVE_ETAPA);
    return botones.some((e) => e.id === guardada) ? guardada : null;
  } catch { return null; }
}

export default function EscanearPiezas({ usuario, etapas = [], tareaActiva = null, onClose }) {
  const botones = botonesEtapasPieza(etapas);
  const nombres = nombresEtapasPieza(etapas);
  const [etapa, setEtapa] = useState(() => etapaInicial(etapas, botones, tareaActiva));
  const [resultados, setResultados] = useState([]);
  const [numero, setNumero] = useState("");
  const vistos = useRef(new Map());
  const contador = useRef(0);

  useEffect(() => {
    if (!etapa) return;
    try { localStorage.setItem(CLAVE_ETAPA, etapa); } catch { /* sin almacenamiento */ }
  }, [etapa]);

  const agregar = (r) => setResultados((prev) => [{ ...r, key: ++contador.current }, ...prev].slice(0, MAX_RESULTADOS));

  const anotar = async (codigo) => {
    const texto = String(codigo || "").trim();
    if (!texto || !etapa) return;
    // La cámara lee el mismo QR varias veces por segundo: uno cada 5 s
    const ahora = Date.now();
    const clave = `${etapa}|${texto}`;
    if (ahora - (vistos.current.get(clave) || 0) < REPETIDO_MS) return;
    vistos.current.set(clave, ahora);
    try {
      const r = await enviarOEncolar({
        empleadoId: usuario?.id, tipo: "paso_pieza", url: "/api/piezas/paso",
        body: { accion: "escanear", codigo: texto, etapa },
      });
      if (r.encolado) {
        agregar({ tono: "pendiente", texto: "Sin señal: la pieza quedó guardada y se manda sola cuando vuelva la conexión.", detalle: null });
        return;
      }
      const data = r.data || {};
      const m = mensajeEscaneo({ ...data, ok: r.status === 200 && data.ok }, nombres);
      const deshacible = m.tono !== "rojo" && !data.ya && data.pieza?.id;
      agregar({ ...m, deshacer: deshacible ? { pieza_id: data.pieza.id, etapa: data.etapa } : null });
    } catch (e) {
      agregar({ tono: "rojo", texto: e?.message || "No se pudo anotar la pieza.", detalle: null });
    }
  };

  const deshacer = async (item) => {
    try {
      const r = await apiFetch("/api/piezas/paso", { method: "POST", body: JSON.stringify({ accion: "deshacer", ...item.deshacer }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo deshacer");
      vistos.current.clear();
      setResultados((prev) => prev.map((x) => (x.key === item.key ? { tono: "pendiente", texto: `Deshecho: ${x.texto}`, detalle: null, key: x.key } : x)));
    } catch (e) {
      agregar({ tono: "rojo", texto: e.message, detalle: null });
    }
  };

  const escribir = (e) => {
    e.preventDefault();
    const n = numero.replace(/\D/g, "");
    if (!n) return;
    vistos.current.delete(`${etapa}|${n}`);
    anotar(n);
    setNumero("");
  };

  const nombreEtapa = nombres[etapa];

  return (
    <Modal open onClose={onClose} title="Escanear piezas">
      <div className="p-4 overflow-y-auto text-gypi-text">
        <div className="text-[13px] font-bold text-gypi-dim mb-1.5" id="etapa-piezas">¿En qué etapa estás?</div>
        <div className="grid grid-cols-2 gap-1.5 mb-3" role="group" aria-labelledby="etapa-piezas">
          {botones.map((e) => (
            <button key={e.id} onClick={() => setEtapa(e.id)} aria-pressed={etapa === e.id}
              className={`min-h-[48px] rounded-lg border text-[14px] font-bold cursor-pointer ${etapa === e.id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-surface border-gypi-border text-gypi-dim"}`}>
              {e.icon ? `${e.icon} ` : ""}{e.nombre}
            </button>
          ))}
        </div>

        {!etapa ? (
          <div className="text-[14px] text-gypi-dim">Elegí la etapa y escaneá las etiquetas de las piezas.</div>
        ) : (
          <>
            {escanerDisponible() ? (
              <div className="mb-2">
                <EscanerCodigo onCodigo={anotar} ayuda={`Apuntá a la etiqueta de cada pieza que pasa por ${nombreEtapa}`} />
              </div>
            ) : (
              <div className="text-[13px] text-gypi-dim mb-2">Para escanear con la cámara usá Chrome en un celular Android. Mientras tanto, escribí el número de la etiqueta (N°).</div>
            )}
            <form onSubmit={escribir} className="flex gap-2 mb-3">
              <input className="g-input flex-1" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)}
                aria-label="Número de la pieza" placeholder="O escribí el N° de la etiqueta" />
              <button type="submit" disabled={!numero.trim()} className="g-btn g-btn-secondary">Anotar</button>
            </form>
          </>
        )}

        {resultados.length > 0 && (
          <ul aria-label="Piezas escaneadas" className="list-none p-0 m-0 flex flex-col gap-1.5">
            {resultados.map((r) => (
              <li key={r.key} role="status" className={`rounded-xl p-2.5 text-[14px] ${TONOS[r.tono] || TONOS.pendiente}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{r.texto}</div>
                    {r.detalle && <div className="text-[12px] mt-0.5 opacity-90">{r.detalle}</div>}
                  </div>
                  {r.deshacer && (
                    <button onClick={() => deshacer(r)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold cursor-pointer text-current underline">Deshacer</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
