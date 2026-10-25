'use client';
// app/components/FallasMaquina.jsx — Fallas de las máquinas y su arreglo
// (Mantenimiento, parte 35; migración 134). Lista de las pendientes (las que
// dejaron la máquina 🔴 parada primero) y el formulario para cargar el
// arreglo: qué se hizo, interno o servicio externo, repuestos (como texto: no
// descuentan del Stock), costo, factura y fotos. Lo usan Mantenimiento →
// Maquinaria, la ficha de cada máquina y "🔧 Mi mantenimiento".
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fallasPendientes, textoHoras } from "../lib/fallasMaquinaria";
import { Chip } from "./ui";
import BotonFoto from "./BotonFoto";

async function postFalla(body) {
  const res = await apiFetch("/api/maquinaria", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
  return data;
}

const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const pesosANumero = (v) => {
  const t = String(v ?? "").trim().replace(/\$/g, "").replace(/\s/g, "");
  if (!t) return null;
  // 12.500,50 → 12500.50
  return Number(t.replace(/\./g, "").replace(",", "."));
};
const horasDesde = (iso, ahora = Date.now()) => Math.max(0, (ahora - Date.parse(iso)) / 3600000);

/**
 * Las fallas pendientes. puedeArreglar(f) dice si el que mira puede cargar el
 * arreglo; editable = la oficina (responsable, parada, descartar).
 */
export function ListaFallas({ fallas = [], maquinas = [], empleados = [], editable = false, puedeArreglar = () => editable, conMaquina = true, onCambio }) {
  const [arreglando, setArreglando] = useState(null);
  const [descartando, setDescartando] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const porId = new Map(maquinas.map((m) => [m.id, m]));
  const nombre = (id) => empleados.find((e) => e.id === id)?.nombre || null;
  const lista = fallasPendientes(fallas);

  const accion = async (body) => {
    setError(null);
    try { await postFalla(body); setDescartando(null); setMotivo(""); await onCambio?.(); } catch (e) { setError(e.message); }
  };

  if (arreglando) {
    return <FormArreglo falla={arreglando} maquina={porId.get(arreglando.maquina_id)} onCancelar={() => setArreglando(null)} onGuardado={async () => { setArreglando(null); await onCambio?.(); }} />;
  }
  if (!lista.length) return <div className="text-[14px] text-gypi-dim mb-3">✅ No hay fallas pendientes.</div>;

  return (
    <>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <ul aria-label="Fallas pendientes" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
        {lista.map((f) => {
          const m = porId.get(f.maquina_id);
          return (
            <li key={f.id} className={`p-2.5 rounded-[10px] border bg-gypi-surface ${f.parada ? "border-gypi-red" : "border-gypi-border"}`}>
              <div className="flex items-start gap-2">
                <span className="text-[18px]" aria-hidden="true">{f.parada ? "🔴" : "⚠️"}</span>
                <div className="flex-1 min-w-0">
                  {conMaquina && m && <div className="text-[13px] font-bold">{m.codigo} · {m.nombre}</div>}
                  <div className="text-[14px] font-semibold">{f.descripcion}</div>
                  <div className="text-[12px] text-gypi-dim">
                    {[f.parada ? `Parada hace ${textoHoras(horasDesde(f.parada_desde || f.created_at))}` : null,
                      f.origen === "tarea" ? "de una tarea del plan" : f.creado_nombre ? `avisó ${f.creado_nombre}` : null,
                      fechaHora(f.created_at), nombre(f.responsable_id) ? `a cargo de ${nombre(f.responsable_id)}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {f.foto && <img src={f.foto} alt={`Foto de ${f.descripcion}`} className="h-12 w-16 object-cover rounded-[6px]" />}
              </div>
              {descartando === f.id ? (
                <div className="flex gap-1.5 mt-2">
                  <input aria-label="Motivo" className="g-input flex-1 min-w-0" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se descarta" />
                  <button onClick={() => accion({ accion: "falla_descartar", id: f.id, motivo: motivo.trim() })} disabled={!motivo.trim()} className="g-btn g-btn-secondary">Descartar</button>
                  <button onClick={() => setDescartando(null)} className="g-btn g-btn-secondary">✕</button>
                </div>
              ) : (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {puedeArreglar(f, m) && <button onClick={() => setArreglando(f)} className="g-btn g-btn-primary flex-1">🔧 Cargar arreglo</button>}
                  {editable && !f.parada && <button onClick={() => accion({ accion: "falla_editar", id: f.id, responsable_id: f.responsable_id || null, parada: true })} className="g-btn g-btn-secondary">🔴 Quedó parada</button>}
                  {editable && <button onClick={() => { setDescartando(f.id); setMotivo(""); }} className="g-btn g-btn-secondary">Descartar</button>}
                  {editable && (
                    <select aria-label={`Responsable de ${f.descripcion}`} className="g-input flex-1 min-w-[140px]" value={f.responsable_id || ""}
                      onChange={(e) => accion({ accion: "falla_editar", id: f.id, responsable_id: e.target.value || null })}>
                      <option value="">Sin responsable</option>
                      {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    </select>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Cargar el arreglo de una falla. */
export function FormArreglo({ falla, maquina, onCancelar, onGuardado }) {
  const [detalle, setDetalle] = useState("");
  const [donde, setDonde] = useState("interno");
  const [repuestos, setRepuestos] = useState("");
  const [costo, setCosto] = useState("");
  const [factura, setFactura] = useState(null);
  const [fotos, setFotos] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const guardar = async () => {
    if (!detalle.trim()) { setError("Escribí qué se hizo"); return; }
    const costoNum = pesosANumero(costo);
    if (costoNum !== null && !(Number.isFinite(costoNum) && costoNum >= 0)) { setError("El costo va en números, por ejemplo 85.000"); return; }
    setEnviando(true);
    setError(null);
    try {
      await postFalla({ accion: "falla_resolver", id: falla.id, detalle: detalle.trim(), donde, repuestos: repuestos.trim() || null, costo: costoNum, factura_url: factura, fotos });
      await onGuardado();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[16px] font-bold mb-1">🔧 Arreglo{maquina ? ` · ${maquina.codigo}` : ""}</div>
      <div className="text-[13px] text-gypi-dim mb-2">{falla.parada ? "🔴 " : "⚠️ "}{falla.descripcion}</div>
      <label className="g-label" htmlFor="fa-detalle">Qué se hizo</label>
      <textarea id="fa-detalle" className="g-input w-full mb-2 min-h-[70px]" maxLength={1000} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
      <div className="g-label">Quién lo hizo</div>
      <div className="flex gap-1.5 mb-2" role="group" aria-label="Quién lo hizo">
        <Chip active={donde === "interno"} onClick={() => setDonde("interno")}>🔧 Nosotros</Chip>
        <Chip active={donde === "externo"} onClick={() => setDonde("externo")}>🏭 Servicio externo</Chip>
      </div>
      <label className="g-label" htmlFor="fa-repuestos">Repuestos o insumos</label>
      <input id="fa-repuestos" className="g-input w-full mb-2" maxLength={1000} value={repuestos} onChange={(e) => setRepuestos(e.target.value)} placeholder="Ej: correa A-42, 1 L de aceite" />
      <label className="g-label" htmlFor="fa-costo">Costo ($)</label>
      <input id="fa-costo" className="g-input w-full mb-2" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} />
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <BotonFoto label={factura ? "🧾 Cambiar factura" : "🧾 Foto de la factura"} disabled={enviando} onFoto={setFactura} />
        {factura && <img src={factura} alt="Factura" className="h-10 w-14 object-cover rounded-[6px]" />}
        {fotos.length < 4 && <BotonFoto label="📷 Foto del arreglo" disabled={enviando} onFoto={(url) => setFotos((f) => [...f, url].slice(0, 4))} />}
        {fotos.map((url, i) => <img key={url} src={url} alt={`Foto ${i + 1}`} className="h-10 w-14 object-cover rounded-[6px]" />)}
      </div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar arreglo"}</button>
      </div>
    </div>
  );
}

/** Las fallas ya cerradas de una máquina, para el historial. */
export function HistorialFallas({ fallas = [] }) {
  const cerradas = fallas.filter((f) => f.estado !== "pendiente").sort((a, b) => String(b.cerrado_at).localeCompare(String(a.cerrado_at)));
  if (!cerradas.length) return null;
  return (
    <ul aria-label="Fallas arregladas" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
      {cerradas.map((f) => (
        <li key={f.id} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface text-[13px]">
          <div className="font-semibold">{f.estado === "resuelta" ? "🔧" : "✕"} {fechaHora(f.cerrado_at)} · {f.descripcion}</div>
          {f.estado === "resuelta" ? (
            <div className="text-gypi-dim">
              {[f.detalle, f.donde === "externo" ? "servicio externo" : null, f.repuestos, f.costo != null ? `$ ${Number(f.costo).toLocaleString("es-AR")}` : null,
                f.parada && f.parada_desde ? `parada ${textoHoras((Date.parse(f.cerrado_at) - Date.parse(f.parada_desde)) / 3600000)}` : null, f.cerrado_nombre].filter(Boolean).join(" · ")}
            </div>
          ) : (
            <div className="text-gypi-dim">Descartada: {f.motivo}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
