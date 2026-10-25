'use client';
// app/components/RegistrarTarea.jsx — Hacer una tarea del plan de una máquina
// (Mantenimiento, parte 33; migración 132). Primero el aviso de seguridad (hay
// que confirmarlo), después cada punto Bien, Revisar, Mal o No aplica (nota
// si no está bien, foto opcional), las horas del horómetro si la máquina tiene,
// observaciones y firma. Al guardar, la tarea queda al día desde esa fecha.
import { useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { subirImagen } from "../lib/foto";
import { hoyArg } from "../lib/dates";
import { ESTADOS_PUNTO, contarEstados, resumenChecklist } from "../lib/checklistVehiculo";
import { faltantesRegistro, itemsRegistro } from "../lib/maquinaria";
import Modal from "./ui/Modal";
import { Chip } from "./ui";
import FirmaDedo from "./FirmaDedo";
import BotonFoto from "./BotonFoto";

const COLOR_ESTADO = { bien: "var(--color-green)", revisar: "var(--color-empresa-primary)", mal: "var(--color-red)", na: "var(--color-text-muted)" };

export default function RegistrarTarea({ maquina, tarea, onClose, onHecho }) {
  const [fecha, setFecha] = useState(hoyArg());
  const [horas, setHoras] = useState("");
  const [seguridadOk, setSeguridadOk] = useState(false);
  const [respuestas, setRespuestas] = useState({});
  const [observaciones, setObservaciones] = useState("");
  const [fotos, setFotos] = useState([]);
  const [conFirma, setConFirma] = useState(false);
  const [faltan, setFaltan] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const firmaRef = useRef(null);
  const responder = (id, cambios) => setRespuestas((r) => ({ ...r, [id]: { ...r[id], ...cambios } }));
  const todoBien = () => setRespuestas((r) => {
    const n = { ...r };
    for (const p of tarea.checklist || []) if (!n[p.id]?.estado) n[p.id] = { ...n[p.id], estado: "bien" };
    return n;
  });

  const guardar = async () => {
    const horasNum = horas === "" ? null : Number(String(horas).replace(/\./g, ""));
    const lista = faltantesRegistro({ tarea, maquina, respuestas, seguridadOk, horas: horasNum });
    setFaltan(lista);
    if (lista.length) return;
    setEnviando(true);
    setError(null);
    try {
      const firma_url = conFirma ? await subirImagen({ base64: firmaRef.current.png(), tipo: "image/png" }) : null;
      const items = itemsRegistro(tarea, respuestas);
      const res = await apiFetch("/api/maquinaria", {
        method: "POST",
        body: JSON.stringify({
          accion: "registro_crear", tarea_id: tarea.id, fecha, horas: maquina.con_horometro ? horasNum : null,
          seguridad_ok: seguridadOk, items, observaciones: observaciones.trim() || null, fotos, firma_url,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
      setHecho(data.registro || contarEstados(items));
      onHecho?.();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const titulo = `${tarea.nombre} · ${maquina.codigo}`;

  if (hecho) {
    return (
      <Modal open onClose={onClose} title={titulo}>
        <div className="p-4 text-gypi-text">
          <div className="text-[18px] font-bold mb-1" role="status">Tarea registrada</div>
          <div className="text-[15px] mb-4">{resumenChecklist(hecho)}</div>
          <button onClick={onClose} className="g-btn g-btn-primary w-full">Listo</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={titulo}>
      <div className="p-4 overflow-y-auto text-gypi-text">
        {tarea.seguridad && (
          <label className="flex items-start gap-2 p-3 mb-3 rounded-[10px] border-2 border-gypi-red bg-gypi-surface text-[14px] font-semibold min-h-[44px]">
            <input type="checkbox" className="mt-1" checked={seguridadOk} onChange={(e) => setSeguridadOk(e.target.checked)} />
            <span>⚠️ {tarea.seguridad}. <span className="font-normal">Lo hice.</span></span>
          </label>
        )}
        {tarea.insumos && <div className="text-[13px] text-gypi-dim mb-2">🧴 Insumos: {tarea.insumos}</div>}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <label className="g-label" htmlFor="reg-fecha">Fecha</label>
            <input id="reg-fecha" type="date" className="g-input w-full" max={hoyArg()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          {maquina.con_horometro && (
            <div className="flex-1 min-w-0">
              <label className="g-label" htmlFor="reg-horas">Horas del horómetro</label>
              <input id="reg-horas" className="g-input w-full" inputMode="numeric" value={horas} onChange={(e) => setHoras(e.target.value)}
                placeholder={maquina.horas != null ? `Antes: ${maquina.horas.toLocaleString("es-AR")}` : ""} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mb-1.5">
          <h3 className="flex-1 m-0 text-[16px] font-bold">Qué revisar</h3>
          <button onClick={todoBien} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-green cursor-pointer">✅ Todo bien</button>
        </div>
        <ul aria-label="Puntos de la tarea" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
          {(tarea.checklist || []).map((p) => {
            const r = respuestas[p.id] || {};
            const conProblema = r.estado === "revisar" || r.estado === "mal";
            return (
              <li key={p.id} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface">
                <div className="text-[14px] font-semibold mb-1.5">{p.nombre}</div>
                {p.valor && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <input className="g-input w-[110px]" inputMode="decimal" aria-label={`${p.nombre} (${p.valor})`} value={r.valor ?? ""}
                      onChange={(e) => responder(p.id, { valor: e.target.value })} />
                    <span className="text-[13px] text-gypi-dim">{p.valor}</span>
                  </div>
                )}
                <div className="flex gap-1 flex-wrap" role="group" aria-label={`Estado de ${p.nombre}`}>
                  {ESTADOS_PUNTO.map((e) => (
                    <Chip key={e.id} active={r.estado === e.id} color={COLOR_ESTADO[e.id]} aria-pressed={r.estado === e.id}
                      onClick={() => responder(p.id, { estado: e.id })}>{e.emoji} {e.nombre}</Chip>
                  ))}
                </div>
                {conProblema && (
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    <input className="g-input w-full" maxLength={300} aria-label={`Nota de ${p.nombre}`} value={r.nota ?? ""}
                      onChange={(e) => responder(p.id, { nota: e.target.value })} placeholder="Qué tiene" />
                    <div className="flex items-center gap-2">
                      <BotonFoto label={r.foto ? "📷 Cambiar foto" : "📷 Foto"} disabled={enviando} onFoto={(url) => responder(p.id, { foto: url })} />
                      {r.foto && <img src={r.foto} alt={`Foto de ${p.nombre}`} className="h-10 w-14 object-cover rounded-[6px]" />}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <label className="g-label" htmlFor="reg-obs">Observaciones</label>
        <textarea id="reg-obs" className="g-input w-full mb-2 min-h-[70px]" maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        <div className="flex gap-2 items-center flex-wrap mb-3">
          {fotos.length < 4 && <BotonFoto label="📷 Agregar foto" disabled={enviando} onFoto={(url) => setFotos((f) => [...f, url].slice(0, 4))} />}
          {fotos.map((url, i) => (
            <button key={url} onClick={() => setFotos((f) => f.filter((u) => u !== url))} aria-label={`Sacar la foto ${i + 1}`} className="p-0 border-none bg-transparent cursor-pointer">
              <img src={url} alt={`Foto ${i + 1}`} className="h-12 w-16 object-cover rounded-[6px]" />
            </button>
          ))}
        </div>
        <div className="g-label mb-1">Firma</div>
        <FirmaDedo ref={firmaRef} quien="quien hizo la tarea" onCambio={setConFirma} disabled={enviando} />

        {faltan.length > 0 && (
          <div role="alert" className="text-[13px] text-gypi-red my-2">
            Falta completar: {faltan.slice(0, 4).join(" · ")}{faltan.length > 4 ? ` y ${faltan.length - 4} más` : ""}
          </div>
        )}
        {error && <div role="alert" className="text-[13px] text-gypi-red my-2">{error}</div>}
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary w-full mt-2">{enviando ? "Guardando…" : "Guardar tarea hecha"}</button>
      </div>
    </Modal>
  );
}
