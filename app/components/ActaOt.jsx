'use client';
// app/components/ActaOt.jsx — Acta de conformidad de instalación de una OT
// (Órdenes de Producción, parte 11; ítem 39). Desde el celular del
// instalador: descarga tildando los bultos, checklist de instalación,
// pendientes con foto y fecha, problemas de obra (no conformidades), y el
// cliente firma con el dedo. Después se imprime o se guarda en PDF.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, sb } from "../lib/supabase";
import { estadoActa, imprimirActa, NOMBRE_ESTADO_ACTA } from "../lib/acta";
import { normalizarChecklist } from "../lib/avance";
import { esEtapaDeInstalacion } from "../lib/costo";
import { fechaCorta } from "../lib/ot";
import { fotoBase64, subirImagen } from "../lib/foto";
import FirmaDedo from "./FirmaDedo";
import NoConformeForm from "./NoConformeForm";

const BOTON_TILDE = "min-h-[44px] px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer";

function Seccion({ titulo, children }) {
  return (
    <section aria-label={titulo} className="mb-4">
      <div className="g-label mb-1.5">{titulo}</div>
      {children}
    </section>
  );
}

function Tilde({ activo, onClick, disabled, label, texto }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={activo} aria-label={label}
      className={`${BOTON_TILDE} ${activo ? "bg-gypi-green/15 border-gypi-green text-gypi-green" : "bg-transparent border-gypi-border text-gypi-dim"}`}>
      {activo ? "✓ " : ""}{texto}
    </button>
  );
}

export default function ActaOt({ ot, empresaId, empresa = null, checklist = [], etapas = [], defectos = [], esGestion = false, onClose }) {
  const [datos, setDatos] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(null);
  const [nuevo, setNuevo] = useState({ descripcion: "", fecha: "", foto: null });
  const [observaciones, setObservaciones] = useState("");
  const [cliente, setCliente] = useState("");
  const [conFirma, setConFirma] = useState(false);
  const [problema, setProblema] = useState(false);
  const firmaRef = useRef(null);

  const cargar = useCallback(async () => {
    if (!ot || !empresaId) return;
    const q = `empresa_id=eq.${empresaId}&ot=eq.${encodeURIComponent(ot)}`;
    try {
      const [proyectos, bultos, actas, pendientes, ncs] = await Promise.all([
        sb.get(`proyectos?${q}&select=ot,cliente,proyecto,obra,fecha_entrega&limit=1`),
        sb.get(`bultos_ot?${q}&order=numero.asc&select=id,numero,contenido,descargado`).catch(() => []),
        sb.get(`actas_ot?${q}&select=*&limit=1`),
        sb.get(`pendientes_obra?${q}&order=id.asc&select=*`),
        sb.get(`no_conformidades?${q}&order=id.asc&select=id,defecto,pieza,cantidad,etapa_detecta`).catch(() => []),
      ]);
      const acta = actas?.[0] || null;
      const proyecto = proyectos?.[0] || null;
      setDatos({ proyecto, bultos: bultos || [], acta, pendientes: pendientes || [], ncs: ncs || [] });
      setObservaciones(acta?.observaciones || "");
      setCliente((c) => c || acta?.cliente_nombre || proyecto?.cliente || "");
      setAviso(null);
    } catch {
      setDatos({ proyecto: null, bultos: [], acta: null, pendientes: [], ncs: [] });
      setAviso("No se pudo leer el acta (¿falta correr la migración 105?).");
    }
  }, [ot, empresaId]);

  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect

  const accion = async (body) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/acta", { method: "POST", body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar");
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setGuardando(false);
    }
  };
  const ponerActa = (data) => data?.acta && setDatos((d) => ({ ...d, acta: data.acta }));

  if (!datos) {
    return (
      <Marco ot={ot} onClose={onClose}>
        <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      </Marco>
    );
  }

  const { proyecto, bultos, acta, pendientes, ncs } = datos;
  const lista = normalizarChecklist(checklist);
  const tildados = new Set(Array.isArray(acta?.checklist) ? acta.checklist : []);
  const estado = estadoActa({ bultos, pendientes, acta, checklist: lista });
  const cerrada = estado.firmada;
  const otStr = String(ot);
  const etapaInstalacion = etapas.find((e) => e.codigo > 0 && esEtapaDeInstalacion(e))?.codigo || null;

  const descargar = async (b) => {
    const data = await accion({ accion: "descarga", id: b.id, valor: !b.descargado });
    if (data) setDatos((d) => ({ ...d, bultos: d.bultos.map((x) => (x.id === b.id ? { ...x, descargado: !b.descargado } : x)) }));
  };
  const tildarPunto = async (t) => {
    const nuevos = tildados.has(t) ? [...tildados].filter((x) => x !== t) : [...tildados, t];
    ponerActa(await accion({ accion: "checklist", ot: otStr, items: nuevos }));
  };
  const elegirFoto = async (file) => {
    if (!file) return;
    setGuardando(true);
    setError(null);
    try {
      const url = await subirImagen(await fotoBase64(file));
      setNuevo((n) => ({ ...n, foto: url }));
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };
  const agregarPendiente = async () => {
    const data = await accion({ accion: "pendiente_agregar", ot: otStr, descripcion: nuevo.descripcion.trim(), fecha: nuevo.fecha || null, foto_url: nuevo.foto });
    if (data?.pendiente) {
      setDatos((d) => ({ ...d, pendientes: [...d.pendientes, data.pendiente] }));
      setNuevo({ descripcion: "", fecha: "", foto: null });
    }
  };
  const borrarPendiente = async (p) => {
    setConfirmar(null);
    if (await accion({ accion: "pendiente_borrar", id: p.id })) setDatos((d) => ({ ...d, pendientes: d.pendientes.filter((x) => x.id !== p.id) }));
  };
  const resolverPendiente = async (p) => {
    const data = await accion({ accion: "pendiente_resolver", id: p.id, valor: !p.resuelto });
    if (data) setDatos((d) => ({ ...d, pendientes: d.pendientes.map((x) => (x.id === p.id ? { ...x, resuelto: !p.resuelto, ...(data.pendiente || {}) } : x)) }));
  };
  const guardarObservaciones = async () => ponerActa(await accion({ accion: "observaciones", ot: otStr, texto: observaciones.trim() || null }));
  const firmar = async () => {
    setGuardando(true);
    setError(null);
    let url;
    try {
      url = await subirImagen({ base64: firmaRef.current.png(), tipo: "image/png" });
    } catch (e) {
      setError(e.message);
      setGuardando(false);
      return;
    }
    setGuardando(false);
    ponerActa(await accion({ accion: "firmar", ot: otStr, cliente_nombre: cliente.trim(), firma_url: url }));
  };
  const reabrir = async () => {
    setConfirmar(null);
    const data = await accion({ accion: "reabrir", ot: otStr });
    if (data) { ponerActa(data); setConFirma(false); }
  };
  const imprimir = () => {
    try {
      imprimirActa({ empresa: empresa?.nombre || empresa?.nombre_corto || "", proyecto: proyecto || { ot: otStr }, acta, bultos, pendientes, checklist: lista });
    } catch (e) {
      setError(e.message);
    }
  };

  const textoEstado = cerrada
    ? `${NOMBRE_ESTADO_ACTA[estado.estado]}${estado.abiertos ? `: ${estado.abiertos === 1 ? "queda 1 pendiente" : `quedan ${estado.abiertos} pendientes`}` : ""}. Acta firmada por ${acta.cliente_nombre}${acta.firmada_at ? ` el ${fechaCorta(String(acta.firmada_at).slice(0, 10))}` : ""}.`
    : `${bultos.length ? `Bultos ${estado.descargados} de ${estado.bultos} recibidos` : "Sin lista de bultos"}${lista.length ? ` · Checklist ${lista.length - estado.checklistFaltan.length} de ${lista.length}` : ""}${pendientes.length ? ` · ${pendientes.length === 1 ? "1 pendiente" : `${pendientes.length} pendientes`}` : ""}`;

  return (
    <Marco ot={ot} onClose={onClose} titulo={proyecto?.cliente || proyecto?.proyecto} detalle={proyecto?.obra}>
      <div className={`p-3 rounded-[10px] text-[13px] mb-3 border ${estado.estado === "instalada" ? "bg-gypi-green/10 border-gypi-green/30 text-gypi-green" : estado.estado === "con_pendientes" ? "bg-gypi-amber/10 border-gypi-amber/30 text-gypi-amber-ink" : "bg-gypi-surface border-gypi-border"}`} role="status">
        {textoEstado}
      </div>
      {aviso && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{aviso}</div>}
      {error && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{error}</div>}

      {cerrada && (
        <button onClick={imprimir} className="g-btn g-btn-primary w-full mb-4">🖨 Imprimir o guardar en PDF</button>
      )}

      {bultos.length > 0 && (
        <Seccion titulo="Descarga en obra">
          <ul aria-label="Bultos para descargar" className="list-none p-0 m-0 flex flex-col gap-1.5">
            {bultos.map((b) => (
              <li key={b.id} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold">Bulto {b.numero} de {bultos.length}</div>
                  {b.contenido && <div className="text-[11px] text-gypi-dim">{b.contenido}</div>}
                </div>
                <Tilde activo={b.descargado} disabled={guardando || cerrada} onClick={() => descargar(b)} label={`Recibido bulto ${b.numero}`} texto="Recibido" />
              </li>
            ))}
          </ul>
          {estado.noRecibidos.length > 0 && estado.descargados > 0 && (
            <div className="text-[11px] text-gypi-amber-ink mt-1.5">Si un bulto no llegó, queda registrado en el acta.</div>
          )}
        </Seccion>
      )}

      {lista.length > 0 && (
        <Seccion titulo="Checklist de instalación">
          <div className="flex flex-col gap-1.5">
            {lista.map((t) => (
              <label key={t} className="flex items-start gap-2.5 bg-gypi-surface rounded-xl p-2.5 border border-gypi-border text-[13px] cursor-pointer">
                <input type="checkbox" className="mt-0.5 w-5 h-5" checked={tildados.has(t)} disabled={guardando || cerrada} onChange={() => tildarPunto(t)} />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </Seccion>
      )}

      <Seccion titulo="Pendientes">
        {pendientes.length === 0 ? <div className="text-[13px] text-gypi-dim mb-2">Sin pendientes.</div> : (
          <ul aria-label="Pendientes de la obra" className="list-none p-0 m-0 mb-2 flex flex-col gap-1.5">
            {pendientes.map((p) => (
              <li key={p.id} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] ${p.resuelto ? "line-through text-gypi-dim" : ""}`}>{p.descripcion}</div>
                  <div className="text-[11px] text-gypi-dim">
                    {p.fecha ? `Se resuelve el ${fechaCorta(p.fecha)}` : "Sin fecha"}
                    {p.foto_url && <> · <a href={p.foto_url} target="_blank" rel="noreferrer" className="text-gypi-cyan">📷 foto</a></>}
                  </div>
                </div>
                {cerrada ? (
                  <Tilde activo={p.resuelto} disabled={guardando} onClick={() => resolverPendiente(p)} label={`Resuelto: ${p.descripcion}`} texto="Resuelto" />
                ) : confirmar === p.id ? (
                  <button onClick={() => borrarPendiente(p)} disabled={guardando} className={`${BOTON_TILDE} border-gypi-red bg-gypi-red/10 text-gypi-red`}>Sí, sacar</button>
                ) : (
                  <button onClick={() => setConfirmar(p.id)} aria-label={`Sacar pendiente ${p.descripcion}`} className="min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-transparent text-gypi-red text-sm cursor-pointer">🗑</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!cerrada && (
          <div className="bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
            <input className="g-input w-full mb-1.5" maxLength={300} aria-label="Pendiente nuevo" value={nuevo.descripcion}
              onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} placeholder="Qué queda por hacer (ej: falta un tirador del bajo mesada)" />
            <div className="flex gap-2 items-center">
              <label className="text-[12px] text-gypi-dim" htmlFor="pendiente-fecha">Se resuelve el</label>
              <input id="pendiente-fecha" type="date" className="g-input flex-1 min-w-0" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} />
            </div>
            <div className="flex gap-2 mt-1.5">
              <label className="g-btn g-btn-secondary flex-1 text-center cursor-pointer">
                {nuevo.foto ? "📷 Foto lista" : "📷 Foto (opcional)"}
                <input type="file" accept="image/*" capture="environment" className="hidden" aria-label="Foto del pendiente" disabled={guardando} onChange={(e) => elegirFoto(e.target.files?.[0])} />
              </label>
              <button onClick={agregarPendiente} disabled={guardando || !nuevo.descripcion.trim()} className="g-btn g-btn-secondary">＋ Pendiente</button>
            </div>
          </div>
        )}
      </Seccion>

      <Seccion titulo="Problemas de obra">
        {ncs.length > 0 && (
          <ul aria-label="Problemas registrados" className="list-none p-0 m-0 mb-2 flex flex-col gap-1">
            {ncs.filter((n) => !etapaInstalacion || n.etapa_detecta === etapaInstalacion).map((n) => (
              <li key={n.id} className="text-[12px]">🟥 <b className="font-mono">{n.defecto}</b>{n.pieza ? ` · ${n.pieza}` : ""}{n.cantidad > 1 ? ` × ${n.cantidad}` : ""}</li>
            ))}
          </ul>
        )}
        <button onClick={() => setProblema(true)} className="g-btn g-btn-secondary w-full">🟥 Registrar pieza dañada, medida mal o faltante</button>
        <div className="text-[11px] text-gypi-dim mt-1">Queda como no conformidad de la OT y entra en los indicadores del mes.</div>
      </Seccion>

      <Seccion titulo="Observaciones">
        <textarea className="g-input w-full min-h-[60px]" maxLength={1000} disabled={cerrada} aria-label="Observaciones del acta"
          value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Algo más que tenga que figurar en el acta" />
        {!cerrada && observaciones.trim() !== (acta?.observaciones || "") && (
          <button onClick={guardarObservaciones} disabled={guardando} className="g-btn g-btn-secondary mt-1.5">Guardar</button>
        )}
      </Seccion>

      {!cerrada && (
        <Seccion titulo="Firma del cliente">
          <label className="g-label" htmlFor="acta-cliente">Nombre y apellido de quien firma</label>
          <input id="acta-cliente" className="g-input w-full mb-2" maxLength={120} value={cliente} onChange={(e) => setCliente(e.target.value)} />
          <FirmaDedo ref={firmaRef} onCambio={setConFirma} disabled={guardando} />
          {!estado.puedeFirmar && (
            <div className="text-[12px] text-gypi-amber-ink my-2">
              Faltan {estado.checklistFaltan.length} puntos del checklist. Tildalos o anotá lo que queda como pendiente.
            </div>
          )}
          <button onClick={firmar} disabled={guardando || !conFirma || cliente.trim().length < 2 || !estado.puedeFirmar} className="g-btn g-btn-primary w-full mt-2">
            {guardando ? "Guardando…" : "Firmar el acta"}
          </button>
        </Seccion>
      )}

      {cerrada && acta?.firma_url && (
        <Seccion titulo="Firma del cliente">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={acta.firma_url} alt={`Firma de ${acta.cliente_nombre}`} className="w-full max-w-[320px] bg-white rounded-xl border border-gypi-border" />
          <div className="text-[11px] text-gypi-dim mt-1">{acta.cliente_nombre}{acta.instalador ? ` · Instalador: ${acta.instalador}` : ""}</div>
        </Seccion>
      )}

      {esGestion && cerrada && (confirmar === "reabrir" ? (
        <button onClick={reabrir} disabled={guardando} className="w-full min-h-[44px] rounded-lg border border-gypi-red bg-gypi-red/10 text-gypi-red text-xs font-bold cursor-pointer">Sí, reabrir el acta</button>
      ) : (
        <button onClick={() => setConfirmar("reabrir")} className="w-full min-h-[44px] rounded-lg border-none bg-transparent text-gypi-red text-xs cursor-pointer">Reabrir el acta para corregirla</button>
      ))}

      {problema && (
        <NoConformeForm ot={otStr} etapaDetecta={etapaInstalacion} etapas={etapas} defectos={defectos}
          onClose={() => setProblema(false)}
          onCreada={(nc) => { setProblema(false); if (nc) setDatos((d) => ({ ...d, ncs: [...d.ncs, nc] })); }} />
      )}
    </Marco>
  );
}

function Marco({ ot, titulo, detalle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label={`Acta de instalación de la OT ${ot}`}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="g-overline text-gypi-cyan">Orden {ot} · Acta de instalación</div>
            <h3 className="m-0 font-heading text-lg font-bold truncate">{titulo || "—"}</h3>
            {detalle && <div className="text-xs text-gypi-dim mt-0.5">{detalle}</div>}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
