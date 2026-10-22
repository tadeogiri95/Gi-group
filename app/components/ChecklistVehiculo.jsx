'use client';
// app/components/ChecklistVehiculo.jsx — Checklist de mantenimiento de un
// vehículo (Mantenimiento, parte 29; migración 127). Lo hace el chofer desde
// su Inicio (🚚 Checklist de mi vehículo) o la oficina desde la ficha del
// vehículo. Completo o solo algunas secciones; cada punto Bien, Revisar, Mal
// o No aplica, con nota y foto cuando no está bien. Al final, observaciones,
// fotos del vehículo y firma; queda un PDF para imprimir o mandar.
import { useEffect, useMemo, useRef, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { subirImagen } from "../lib/foto";
import {
  ESTADOS_PUNTO, NIVELES_COMBUSTIBLE, contarEstados, estadoSugerido, faltantesChecklist, imprimirChecklist, itemsChecklist, plantillaDe, resumenChecklist,
} from "../lib/checklistVehiculo";
import Modal from "./ui/Modal";
import { Chip } from "./ui";
import FirmaDedo from "./FirmaDedo";
import BotonFoto from "./BotonFoto";

const COLOR_ESTADO = { bien: "var(--color-green)", revisar: "var(--color-empresa-primary)", mal: "var(--color-red)", na: "var(--color-text-muted)" };

export default function ChecklistVehiculo({ vehiculos, empresaNombre = "", onClose, onHecho }) {
  const [vehiculo, setVehiculo] = useState(vehiculos.length === 1 ? vehiculos[0] : null);
  const [plantilla, setPlantilla] = useState(null);
  const [error, setError] = useState(null);
  const [km, setKm] = useState("");
  const [combustible, setCombustible] = useState(null);
  const [secciones, setSecciones] = useState([]);
  const [respuestas, setRespuestas] = useState({});
  const [observaciones, setObservaciones] = useState("");
  const [fotos, setFotos] = useState([]);
  const [conFirma, setConFirma] = useState(false);
  const [faltan, setFaltan] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const firmaRef = useRef(null);

  useEffect(() => {
    let vivo = true;
    sb.get("flota_config?select=checklist")
      .then((filas) => {
        if (!vivo) return;
        const p = plantillaDe(filas?.[0]);
        setPlantilla(p);
        setSecciones(p.map((s) => s.id));
      })
      .catch((e) => {
        if (!vivo) return;
        setPlantilla([]);
        setError(faltaTabla(e, "flota_config") ? "Para el checklist de vehículos falta correr la migración 127 en Supabase." : "No se pudo abrir el checklist");
      });
    return () => { vivo = false; };
  }, []);

  const elegidas = useMemo(() => (plantilla || []).filter((s) => secciones.includes(s.id)), [plantilla, secciones]);
  const completo = plantilla && secciones.length === plantilla.length;
  const responder = (clave, cambios) => setRespuestas((r) => ({ ...r, [clave]: { ...r[clave], ...cambios } }));
  const todoBien = (s) => setRespuestas((r) => {
    const n = { ...r };
    for (const pt of s.puntos) if (!n[`${s.id}.${pt.id}`]?.estado) n[`${s.id}.${pt.id}`] = { ...n[`${s.id}.${pt.id}`], estado: "bien" };
    return n;
  });
  const alternarSeccion = (id) => setSecciones((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const guardar = async () => {
    const kmNum = km === "" ? null : Number(String(km).replace(/\./g, ""));
    const lista = faltantesChecklist({ plantilla, secciones, respuestas, km: kmNum });
    setFaltan(lista);
    if (lista.length) return;
    setEnviando(true);
    setError(null);
    try {
      const firma_url = conFirma ? await subirImagen({ base64: firmaRef.current.png(), tipo: "image/png" }) : null;
      const items = itemsChecklist({ plantilla, secciones, respuestas });
      const res = await apiFetch("/api/flota", {
        method: "POST",
        body: JSON.stringify({
          accion: "checklist_crear", vehiculo_id: vehiculo.id, km: kmNum, combustible,
          secciones, items, observaciones: observaciones.trim() || null, fotos, firma_url,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar el checklist");
      setHecho(data.checklist || { items, km: kmNum, combustible, observaciones, fotos, firma_url, created_at: new Date().toISOString(), ...contarEstados(items) });
      onHecho?.();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const titulo = vehiculo ? `Checklist · ${vehiculo.patente}` : "Checklist de mi vehículo";

  if (hecho) {
    return (
      <Modal open onClose={onClose} title={titulo}>
        <div className="p-4 text-gypi-text">
          <div className="text-[18px] font-bold mb-1" role="status">Checklist guardado</div>
          <div className="text-[15px] mb-4">{resumenChecklist(hecho)}</div>
          {hecho.mal > 0 && <div className="text-[13px] text-gypi-dim mb-3">Lo que quedó mal pasó a arreglos pendientes; la oficina lo ve en la ficha del vehículo.</div>}
          <div className="flex gap-2">
            <button onClick={() => { try { imprimirChecklist({ empresa: empresaNombre, vehiculo, checklist: hecho }); } catch (e) { setError(e.message); } }} className="g-btn g-btn-secondary flex-1">📄 PDF</button>
            <button onClick={onClose} className="g-btn g-btn-primary flex-1">Listo</button>
          </div>
          {error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={titulo}>
      <div className="p-4 overflow-y-auto text-gypi-text">
        {!vehiculo ? (
          <>
            <div className="text-[14px] text-gypi-dim mb-2">¿Qué vehículo revisás?</div>
            <div className="flex flex-col gap-1.5">
              {vehiculos.map((v) => (
                <button key={v.id} onClick={() => setVehiculo(v)} className="g-btn g-btn-secondary text-left">{v.patente} {[v.marca, v.modelo].filter(Boolean).join(" ")}</button>
              ))}
            </div>
          </>
        ) : plantilla === null ? (
          <div className="text-[14px] text-gypi-dim" role="status">Abriendo el checklist…</div>
        ) : error && !plantilla.length ? (
          <div role="alert" className="text-[13px] text-gypi-red">{error}</div>
        ) : (
          <>
            <div className="flex gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <label className="g-label" htmlFor="chk-km">Kilómetros</label>
                <input id="chk-km" className="g-input w-full" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)}
                  placeholder={vehiculo.km != null ? `Antes: ${vehiculo.km.toLocaleString("es-AR")}` : ""} />
              </div>
            </div>
            <div className="g-label mb-1">Combustible</div>
            <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Combustible">
              {NIVELES_COMBUSTIBLE.map((n) => <Chip key={n} active={combustible === n} onClick={() => setCombustible(combustible === n ? null : n)}>{n === "reserva" ? "Reserva" : n === "lleno" ? "Lleno" : n}</Chip>)}
            </div>
            <div className="g-label mb-1">Qué revisás</div>
            <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Secciones">
              <Chip active={completo} onClick={() => setSecciones(completo ? [] : plantilla.map((s) => s.id))}>Completo</Chip>
              {plantilla.map((s) => <Chip key={s.id} active={secciones.includes(s.id)} onClick={() => alternarSeccion(s.id)}>{s.emoji} {s.nombre}</Chip>)}
            </div>

            {elegidas.map((s) => (
              <section key={s.id} aria-label={s.nombre} className="mb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="flex-1 m-0 text-[16px] font-bold">{s.emoji} {s.nombre}</h3>
                  <button onClick={() => todoBien(s)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-green cursor-pointer">✅ Todo bien</button>
                </div>
                <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
                  {s.puntos.map((pt) => {
                    const clave = `${s.id}.${pt.id}`;
                    const r = respuestas[clave] || {};
                    const conProblema = r.estado === "revisar" || r.estado === "mal";
                    return (
                      <li key={pt.id} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface">
                        <div className="text-[14px] font-semibold mb-1.5">{pt.nombre}</div>
                        {pt.valor && (
                          <div className="flex items-center gap-2 mb-1.5">
                            <input className="g-input w-[110px]" inputMode="decimal" aria-label={`${pt.nombre} (${pt.valor})`} value={r.valor ?? ""}
                              onChange={(e) => { const sug = estadoSugerido(pt, e.target.value); responder(clave, { valor: e.target.value, ...(sug ? { estado: sug } : {}) }); }} />
                            <span className="text-[13px] text-gypi-dim">{pt.valor}{pt.minimo != null ? ` · mínimo ${String(pt.minimo).replace(".", ",")}` : ""}</span>
                          </div>
                        )}
                        <div className="flex gap-1 flex-wrap" role="group" aria-label={`Estado de ${pt.nombre}`}>
                          {ESTADOS_PUNTO.map((e) => (
                            <Chip key={e.id} active={r.estado === e.id} color={COLOR_ESTADO[e.id]} aria-pressed={r.estado === e.id}
                              onClick={() => responder(clave, { estado: e.id })}>{e.emoji} {e.nombre}</Chip>
                          ))}
                        </div>
                        {conProblema && (
                          <div className="mt-1.5 flex flex-col gap-1.5">
                            <input className="g-input w-full" maxLength={300} aria-label={`Nota de ${pt.nombre}`} value={r.nota ?? ""}
                              onChange={(e) => responder(clave, { nota: e.target.value })} placeholder="Qué tiene" />
                            <div className="flex items-center gap-2">
                              <BotonFoto label={r.foto ? "📷 Cambiar foto" : "📷 Foto"} disabled={enviando} onFoto={(url) => responder(clave, { foto: url })} />
                              {r.foto && <img src={r.foto} alt={`Foto de ${pt.nombre}`} className="h-10 w-14 object-cover rounded-[6px]" />}
                            </div>
                            {r.estado === "mal" && (
                              <label className="flex items-center gap-2 text-[13px] min-h-[44px]">
                                <input type="checkbox" checked={!!r.no_circula} onChange={(e) => responder(clave, { no_circula: e.target.checked })} />
                                🔴 Así no puede circular
                              </label>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <label className="g-label" htmlFor="chk-obs">Observaciones</label>
            <textarea id="chk-obs" className="g-input w-full mb-2 min-h-[70px]" maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            <div className="g-label mb-1">Fotos del vehículo (frente, atrás y costados)</div>
            <div className="flex gap-2 items-center flex-wrap mb-3">
              {fotos.length < 4 && <BotonFoto label="📷 Agregar foto" disabled={enviando} onFoto={(url) => setFotos((f) => [...f, url].slice(0, 4))} />}
              {fotos.map((url, i) => (
                <button key={url} onClick={() => setFotos((f) => f.filter((u) => u !== url))} aria-label={`Sacar la foto ${i + 1}`} className="p-0 border-none bg-transparent cursor-pointer">
                  <img src={url} alt={`Foto ${i + 1}`} className="h-12 w-16 object-cover rounded-[6px]" />
                </button>
              ))}
            </div>
            <div className="g-label mb-1">Firma</div>
            <FirmaDedo ref={firmaRef} quien="quien hace el checklist" onCambio={setConFirma} disabled={enviando} />

            {faltan.length > 0 && (
              <div role="alert" className="text-[13px] text-gypi-red my-2">
                Falta completar: {faltan.slice(0, 4).join(" · ")}{faltan.length > 4 ? ` y ${faltan.length - 4} más` : ""}
              </div>
            )}
            {error && <div role="alert" className="text-[13px] text-gypi-red my-2">{error}</div>}
            <button onClick={guardar} disabled={enviando || !secciones.length} className="g-btn g-btn-primary w-full mt-2">{enviando ? "Guardando…" : "Guardar checklist"}</button>
          </>
        )}
      </div>
    </Modal>
  );
}
