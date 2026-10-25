'use client';
// app/components/AvisarFalla.jsx — "⚠️ Avisar una falla" (Mantenimiento,
// parte 35; migración 134). Cualquier operario elige la máquina (escaneando el
// QR pegado en ella o de la lista), cuenta qué le pasa, saca una foto y dice
// si quedó parada. Le llega al celular del responsable de mantenimiento y del
// suplente; si quedó parada, también a gerencia. El QR de la máquina abre esta
// pantalla con la máquina ya elegida (?maquina=CÓDIGO).
import { useEffect, useMemo, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { leerQrMaquina } from "../lib/fallasMaquinaria";
import { tipoMaquina } from "../lib/maquinaria";
import Modal from "./ui/Modal";
import { Chip } from "./ui";
import BotonFoto from "./BotonFoto";
import EscanerCodigo, { escanerDisponible } from "./EscanerCodigo";

export default function AvisarFalla({ codigoInicial = null, onClose }) {
  const [maquinas, setMaquinas] = useState(null);
  const [maquina, setMaquina] = useState(null);
  const [texto, setTexto] = useState("");
  const [escaneando, setEscaneando] = useState(!codigoInicial && escanerDisponible());
  const [aviso, setAviso] = useState(null);
  const [descripcion, setDescripcion] = useState("");
  const [foto, setFoto] = useState(null);
  const [parada, setParada] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);

  useEffect(() => {
    let vivo = true;
    sb.get("maquinas?activo=eq.true&select=id,codigo,nombre,tipo,estado,ubicacion&order=codigo.asc")
      .then((m) => {
        if (!vivo) return;
        setMaquinas(m || []);
        const inicial = codigoInicial ? (m || []).find((x) => x.codigo === String(codigoInicial).toUpperCase()) : null;
        if (inicial) setMaquina(inicial);
        else if (codigoInicial) setAviso(`No encontré la máquina ${codigoInicial}. Elegila de la lista.`);
      })
      .catch(() => { if (vivo) { setMaquinas([]); setError("No se pudieron leer las máquinas"); } });
    return () => { vivo = false; };
  }, [codigoInicial]);

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (maquinas || []).filter((m) => !t || [m.codigo, m.nombre, m.ubicacion].some((x) => String(x ?? "").toLowerCase().includes(t))).slice(0, 30);
  }, [maquinas, texto]);

  const alEscanear = (leido) => {
    const codigo = leerQrMaquina(leido);
    const m = codigo && (maquinas || []).find((x) => x.codigo === codigo);
    if (m) { setMaquina(m); setEscaneando(false); setAviso(null); } else setAviso("Ese QR no es de una máquina de la empresa");
  };

  const enviar = async () => {
    if (!descripcion.trim()) { setError("Contá qué le pasa"); return; }
    if (parada === null) { setError("Decí si la máquina quedó parada"); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/maquinaria", { method: "POST", body: JSON.stringify({ accion: "falla_crear", maquina_id: maquina.id, descripcion: descripcion.trim(), foto, parada }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo avisar");
      setHecho(true);
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (hecho) {
    return (
      <Modal open onClose={onClose} title="⚠️ Avisar una falla">
        <div className="p-4 text-gypi-text">
          <div className="text-[18px] font-bold mb-1" role="status">Listo, avisaste</div>
          <div className="text-[15px] mb-4">Le llegó al responsable de mantenimiento de {maquina.codigo}.{parada ? " La máquina quedó marcada como 🔴 parada." : ""}</div>
          <button onClick={onClose} className="g-btn g-btn-primary w-full">Listo</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="⚠️ Avisar una falla">
      <div className="p-4 overflow-y-auto text-gypi-text">
        {!maquina ? (
          <>
            <div className="text-[15px] font-semibold mb-2">¿Qué máquina?</div>
            {escanerDisponible() && (
              <button onClick={() => setEscaneando(!escaneando)} className="g-btn g-btn-secondary w-full mb-2">{escaneando ? "Elegir de la lista" : "📷 Escanear el QR de la máquina"}</button>
            )}
            {escaneando && <div className="mb-2"><EscanerCodigo onCodigo={alEscanear} ayuda="Apuntá a la etiqueta pegada en la máquina" /></div>}
            {aviso && <div role="alert" className="text-[13px] text-gypi-red mb-2">{aviso}</div>}
            <input className="g-input w-full mb-2" value={texto} inputMode="search" aria-label="Buscar máquina" placeholder="Buscar código o nombre" onChange={(e) => setTexto(e.target.value)} />
            {maquinas === null ? (
              <div className="text-[14px] text-gypi-dim" role="status">Cargando las máquinas…</div>
            ) : !filtradas.length ? (
              <div className="text-[14px] text-gypi-dim">{maquinas.length ? "No hay máquinas con ese nombre." : "La empresa todavía no cargó máquinas."}</div>
            ) : (
              <ul aria-label="Máquinas" className="list-none m-0 p-0 flex flex-col gap-1.5">
                {filtradas.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => { setMaquina(m); setAviso(null); }}
                      className="w-full flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
                      <span className="text-[20px]" aria-hidden="true">{tipoMaquina(m.tipo).emoji}</span>
                      <span className="flex-1 min-w-0 text-[15px] font-semibold">{m.codigo} · {m.nombre}</span>
                      {m.estado === "parada" && <span className="text-[12px]">🔴</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex-1 text-[16px] font-bold">{tipoMaquina(maquina.tipo).emoji} {maquina.codigo} · {maquina.nombre}</span>
              <button onClick={() => setMaquina(null)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-dim cursor-pointer">Cambiar</button>
            </div>
            <label className="g-label" htmlFor="falla-desc">Qué le pasa</label>
            <textarea id="falla-desc" className="g-input w-full mb-2 min-h-[80px]" maxLength={300} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: hace un ruido fuerte al arrancar" />
            <div className="flex items-center gap-2 mb-3">
              <BotonFoto label={foto ? "📷 Cambiar foto" : "📷 Sacar foto"} disabled={enviando} onFoto={setFoto} />
              {foto && <img src={foto} alt="Foto de la falla" className="h-12 w-16 object-cover rounded-[6px]" />}
            </div>
            <div className="g-label">¿Quedó parada?</div>
            <div className="flex gap-1.5 mb-3" role="group" aria-label="¿Quedó parada?">
              <Chip active={parada === true} onClick={() => setParada(true)}>🔴 Sí, no se puede usar</Chip>
              <Chip active={parada === false} onClick={() => setParada(false)}>⚠️ No, sigue andando</Chip>
            </div>
            {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
            <button onClick={enviar} disabled={enviando} className="g-btn g-btn-primary w-full">{enviando ? "Avisando…" : "Avisar"}</button>
          </>
        )}
      </div>
    </Modal>
  );
}
