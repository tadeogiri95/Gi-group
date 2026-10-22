'use client';
// app/components/ArreglosVehiculo.jsx — Arreglos, services e historial de un
// vehículo (Planta → Flota → ficha; Mantenimiento, parte 31; migración 129).
// Los arreglos salen de los puntos en Mal del checklist o se anotan a mano;
// se resuelven cargando qué se hizo, dónde, costo y factura. Los services y
// reparaciones se cargan igual, sin checklist.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { DONDE, PRIORIDADES, TIPOS_MANTENIMIENTO, nombrePrioridad, textoCosto } from "../lib/arreglosFlota";
import { Chip } from "./ui";
import BotonFoto from "./BotonFoto";

async function postFlota(body) {
  const res = await apiFetch("/api/flota", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
  return data;
}

const fechaCorta = (f) => (f ? f.split("-").reverse().join("/") : "");
const fechaDeIso = (iso) => (iso ? new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" }) : "");

function Campo({ id, label, children }) {
  return (
    <div className="flex-1 min-w-0">
      <label className="g-label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** Los arreglos pendientes, lo que no puede circular primero. */
export function ListaArreglos({ arreglos, empleados = [], editable, puedeResolver = () => editable, onResolver, onCambio }) {
  const [descartando, setDescartando] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const nombre = (id) => empleados.find((e) => e.id === id)?.nombre;
  const lista = [...arreglos].sort((a, b) => (a.prioridad === b.prioridad ? String(a.created_at).localeCompare(String(b.created_at)) : a.prioridad === "no_circula" ? -1 : 1));

  const accion = async (body) => {
    setError(null);
    try {
      await postFlota(body);
      setDescartando(null);
      setMotivo("");
      await onCambio();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!lista.length) return <div className="text-[14px] text-gypi-dim mb-3">No hay arreglos pendientes.</div>;
  return (
    <>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <ul aria-label="Arreglos pendientes" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
        {lista.map((a) => {
          const p = nombrePrioridad(a.prioridad);
          return (
            <li key={a.id} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface">
              <div className="flex items-start gap-2">
                {a.foto && <a href={a.foto} target="_blank" rel="noopener noreferrer"><img src={a.foto} alt={`Foto de ${a.descripcion}`} className="h-12 w-16 object-cover rounded-[6px]" /></a>}
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold">{p.emoji} {a.descripcion}</div>
                  <div className="text-[12px] text-gypi-dim">
                    {[p.nombre, a.seccion_nombre, a.checklist_id ? `checklist del ${fechaDeIso(a.created_at)}` : `anotado el ${fechaDeIso(a.created_at)}`, nombre(a.responsable_id) ? `a cargo de ${nombre(a.responsable_id)}` : "sin responsable"].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              {(editable || puedeResolver(a)) && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {puedeResolver(a) && <button onClick={() => onResolver(a)} className="g-btn g-btn-primary">✔ Resolver</button>}
                  {editable && (
                    <>
                      <button onClick={() => accion({ accion: "arreglo_editar", id: a.id, prioridad: a.prioridad === "no_circula" ? "pronto" : "no_circula", responsable_id: a.responsable_id || null })}
                        className="g-btn g-btn-secondary">{a.prioridad === "no_circula" ? "🟡 Puede circular" : "🔴 No puede circular"}</button>
                      <select aria-label={`Responsable de ${a.descripcion}`} className="g-input flex-1 min-w-[140px]" value={a.responsable_id || ""}
                        onChange={(e) => accion({ accion: "arreglo_editar", id: a.id, prioridad: a.prioridad, responsable_id: e.target.value || null })}>
                        <option value="">Sin responsable</option>
                        {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                      </select>
                      <button onClick={() => { setDescartando(a.id); setMotivo(""); }} className="min-h-[44px] bg-transparent border-none text-[12px] font-semibold text-gypi-dim cursor-pointer">Descartar</button>
                    </>
                  )}
                </div>
              )}
              {descartando === a.id && (
                <div className="flex gap-1.5 mt-2">
                  <input className="g-input flex-1 min-w-0" aria-label="Por qué se descarta" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se descarta" />
                  <button onClick={() => accion({ accion: "arreglo_descartar", id: a.id, motivo: motivo.trim() })} disabled={!motivo.trim()} className="g-btn g-btn-secondary">Descartar</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Anotar un arreglo a mano o desde un punto ⚠️ Revisar de un checklist. */
export function FormArreglo({ vehiculo, empleados = [], inicial = {}, onCancelar, onGuardado }) {
  const [descripcion, setDescripcion] = useState(inicial.descripcion || "");
  const [prioridad, setPrioridad] = useState(inicial.prioridad || "pronto");
  const [responsable, setResponsable] = useState(vehiculo.responsable_id || "");
  const [foto, setFoto] = useState(inicial.foto || null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const guardar = async () => {
    if (!descripcion.trim()) { setError("Escribí qué hay que arreglar"); return; }
    setEnviando(true);
    setError(null);
    try {
      await postFlota({
        accion: "arreglo_crear", vehiculo_id: vehiculo.id, checklist_id: inicial.checklist_id || null,
        seccion_nombre: inicial.seccion_nombre || null, punto_nombre: inicial.punto_nombre || null,
        descripcion: descripcion.trim(), foto, prioridad, responsable_id: responsable || null,
      });
      await onGuardado();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div>
      <div className="text-[18px] font-bold mb-3">🔧 Anotar arreglo · {vehiculo.patente}</div>
      <div className="flex flex-col gap-2.5 mb-3">
        <Campo id="arr-desc" label="Qué hay que arreglar">
          <input id="arr-desc" className="g-input w-full" maxLength={300} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </Campo>
        <div>
          <div className="g-label">Prioridad</div>
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Prioridad">
            {PRIORIDADES.map((p) => <Chip key={p.id} active={prioridad === p.id} onClick={() => setPrioridad(p.id)}>{p.emoji} {p.nombre}</Chip>)}
          </div>
        </div>
        <Campo id="arr-resp" label="Quién se encarga">
          <select id="arr-resp" className="g-input w-full" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
            <option value="">Sin responsable</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </Campo>
        <div className="flex items-center gap-2">
          <BotonFoto label={foto ? "📷 Cambiar foto" : "📷 Foto"} disabled={enviando} onFoto={setFoto} />
          {foto && <img src={foto} alt="Foto del arreglo" className="h-10 w-14 object-cover rounded-[6px]" />}
        </div>
      </div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

const pesosANumero = (v) => {
  const t = String(v ?? "").trim().replace(/\$/g, "").replace(/\s/g, "");
  if (!t) return null;
  // 12.500,50 → 12500.50
  return Number(t.replace(/\./g, "").replace(",", "."));
};

/** Cargar un service o reparación, o resolver un arreglo (arreglo). */
export function FormMantenimiento({ vehiculo, arreglo = null, tipoInicial = "service", onCancelar, onGuardado }) {
  const [tipo, setTipo] = useState(arreglo ? "arreglo" : tipoInicial);
  const [fecha, setFecha] = useState(hoyArg());
  const [km, setKm] = useState(vehiculo.km != null ? String(vehiculo.km) : "");
  const [donde, setDonde] = useState("taller");
  const [taller, setTaller] = useState("");
  const [detalle, setDetalle] = useState(arreglo ? arreglo.descripcion : "");
  const [repuestos, setRepuestos] = useState("");
  const [costo, setCosto] = useState("");
  const [factura, setFactura] = useState(null);
  const [fotos, setFotos] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const guardar = async () => {
    if (!detalle.trim()) { setError("Escribí qué se hizo"); return; }
    const kmNum = String(km).trim() === "" ? null : Number(String(km).replace(/\./g, ""));
    if (kmNum !== null && !(Number.isInteger(kmNum) && kmNum >= 0)) { setError("Los kilómetros van en números enteros"); return; }
    const costoNum = pesosANumero(costo);
    if (costoNum !== null && !(Number.isFinite(costoNum) && costoNum >= 0)) { setError("El costo va en números, por ejemplo 85.000"); return; }
    setEnviando(true);
    setError(null);
    try {
      await postFlota({
        accion: "mantenimiento_crear", vehiculo_id: vehiculo.id, arreglo_id: arreglo?.id ?? null, tipo, fecha, km: kmNum,
        donde, taller: donde === "taller" ? taller.trim() || null : null, detalle: detalle.trim(), repuestos: repuestos.trim() || null,
        costo: costoNum, factura_url: factura, fotos,
      });
      await onGuardado();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div>
      <div className="text-[18px] font-bold mb-1">{arreglo ? "✔ Resolver arreglo" : "🔧 Cargar service o reparación"} · {vehiculo.patente}</div>
      {arreglo && <div className="text-[13px] text-gypi-dim mb-3">{nombrePrioridad(arreglo.prioridad).emoji} {arreglo.descripcion}</div>}
      {!arreglo && (
        <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Qué se hizo">
          {TIPOS_MANTENIMIENTO.filter((t) => t.id !== "arreglo").map((t) => <Chip key={t.id} active={tipo === t.id} onClick={() => setTipo(t.id)}>{t.emoji} {t.nombre}</Chip>)}
        </div>
      )}
      {tipo === "service" && <div className="text-[13px] text-gypi-dim mb-2">El service pone al día la alerta de service del vehículo.</div>}
      <div className="flex flex-col gap-2.5 mb-3">
        <div className="flex gap-2">
          <Campo id="man-fecha" label="Fecha"><input id="man-fecha" type="date" className="g-input w-full" value={fecha} max={hoyArg()} onChange={(e) => setFecha(e.target.value)} /></Campo>
          <Campo id="man-km" label="Kilómetros"><input id="man-km" className="g-input w-full" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></Campo>
        </div>
        <div>
          <div className="g-label">Dónde</div>
          <div className="flex gap-1.5" role="group" aria-label="Dónde">
            {DONDE.map((d) => <Chip key={d.id} active={donde === d.id} onClick={() => setDonde(d.id)}>{d.nombre}</Chip>)}
          </div>
        </div>
        {donde === "taller" && (
          <Campo id="man-taller" label="Taller"><input id="man-taller" className="g-input w-full" maxLength={120} value={taller} onChange={(e) => setTaller(e.target.value)} /></Campo>
        )}
        <Campo id="man-detalle" label="Qué se hizo">
          <textarea id="man-detalle" className="g-input w-full" rows={3} maxLength={1000} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
        </Campo>
        <Campo id="man-rep" label="Repuestos (opcional)">
          <input id="man-rep" className="g-input w-full" maxLength={1000} value={repuestos} onChange={(e) => setRepuestos(e.target.value)} placeholder={tipo === "service" ? "Aceite, filtro de aceite, de aire…" : ""} />
        </Campo>
        <Campo id="man-costo" label="Costo total ($)">
          <input id="man-costo" className="g-input w-full" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} />
        </Campo>
        <div className="flex items-center gap-2 flex-wrap">
          <BotonFoto label={factura ? "🧾 Cambiar factura" : "🧾 Foto de la factura"} disabled={enviando} onFoto={setFactura} />
          {factura && <img src={factura} alt="Factura" className="h-10 w-14 object-cover rounded-[6px]" />}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {fotos.length < 4 && <BotonFoto label="📷 Agregar foto" disabled={enviando} onFoto={(url) => setFotos((f) => [...f, url].slice(0, 4))} />}
          {fotos.map((url, i) => (
            <button key={url} onClick={() => setFotos((f) => f.filter((u) => u !== url))} aria-label={`Sacar la foto ${i + 1}`} className="p-0 border-none bg-transparent cursor-pointer">
              <img src={url} alt={`Foto ${i + 1}`} className="h-10 w-14 object-cover rounded-[6px]" />
            </button>
          ))}
        </div>
      </div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

/** El historial del vehículo, lo último primero; de a 20. */
export function Historial({ eventos, editable, onVerChecklist, onCambio }) {
  const [cuantos, setCuantos] = useState(20);
  const [error, setError] = useState(null);
  const borrar = async (m) => {
    setError(null);
    try {
      await postFlota({ accion: "mantenimiento_borrar", id: m.id });
      await onCambio();
    } catch (e) {
      setError(e.message);
    }
  };
  if (!eventos.length) return <div className="text-[14px] text-gypi-dim mb-3">Todavía no hay nada en el historial.</div>;
  return (
    <>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <ul aria-label="Historial" className="list-none m-0 p-0 flex flex-col gap-1 mb-2">
        {eventos.slice(0, cuantos).map((ev) => (
          <li key={ev.clave} className="flex items-start gap-2 text-[13px] py-1 border-b border-gypi-border last:border-b-0">
            <span className="text-gypi-dim whitespace-nowrap w-[44px] shrink-0">{fechaCorta(ev.fecha).slice(0, 5)}</span>
            <span aria-hidden="true">{ev.emoji}</span>
            <span className="flex-1 min-w-0">
              {ev.checklist ? <button onClick={() => onVerChecklist(ev.checklist)} className="p-0 bg-transparent border-none text-left text-[13px] font-semibold text-gypi-text cursor-pointer font-body underline">{ev.texto}</button> : <span className="font-semibold">{ev.texto}</span>}
              {ev.detalle && <span className="text-gypi-dim"> · {ev.detalle}</span>}
              {ev.mantenimiento?.factura_url && <a href={ev.mantenimiento.factura_url} target="_blank" rel="noopener noreferrer" className="ml-1">🧾</a>}
              {(ev.mantenimiento?.fotos || []).map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="ml-1">📷</a>)}
            </span>
            {editable && ev.mantenimiento && (
              <button onClick={() => borrar(ev.mantenimiento)} aria-label={`Borrar ${ev.texto}`} className="min-h-[32px] bg-transparent border-none text-[12px] text-gypi-dim cursor-pointer">Borrar</button>
            )}
          </li>
        ))}
      </ul>
      {eventos.length > cuantos && <button onClick={() => setCuantos(cuantos + 20)} className="min-h-[44px] bg-transparent border-none p-0 text-[13px] font-semibold text-gypi-dim cursor-pointer font-body mb-3">Ver más ({eventos.length - cuantos})</button>}
    </>
  );
}
