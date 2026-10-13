'use client';
// app/components/CargaOt.jsx — Acopio y carga de una OT (Órdenes de
// Producción, parte 10; ítem 39). Bultos numerados con rótulo y QR, sueltos
// tildados al cargar, checklist de carga, faltantes con fecha, foto y las dos
// firmas. Se abre desde la lista de OT o escaneando el QR de un bulto. Con
// la carga firmada, lleva al acta de instalación (parte 11).
import { useCallback, useEffect, useState } from "react";
import { apiFetch, sb } from "../lib/supabase";
import { estadoCarga, imprimirRotulos, linkCarga, TAMANOS_ETIQUETA } from "../lib/carga";
import { nombreSuelto } from "../lib/sueltos";
import { normalizarChecklist } from "../lib/avance";
import { fechaCorta } from "../lib/ot";
import { fotoBase64, subirImagen } from "../lib/foto";

const CLAVE_TAMANO = "gypi_tamano_etiqueta";
const BOTON_TILDE = "min-h-[44px] px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer";

function leerTamano() {
  try { return localStorage.getItem(CLAVE_TAMANO) || TAMANOS_ETIQUETA[0].id; } catch { return TAMANOS_ETIQUETA[0].id; }
}

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

const horaCorta = (iso) => (iso ? `${fechaCorta(String(iso).slice(0, 10))} ${String(new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }))}` : "");

export default function CargaOt({ ot, empresaId, empresa = null, usuario = null, checklist = [], esGestion = false, onClose, onAbrirActa }) {
  const [datos, setDatos] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [contenido, setContenido] = useState("");
  const [confirmar, setConfirmar] = useState(null);
  const [faltantes, setFaltantes] = useState({ texto: "", fecha: "" });
  const [tamano, setTamano] = useState(leerTamano);

  const cargar = useCallback(async () => {
    if (!ot || !empresaId) return;
    const q = `empresa_id=eq.${empresaId}&ot=eq.${encodeURIComponent(ot)}`;
    try {
      const [proyectos, bultos, sueltos, cargas] = await Promise.all([
        sb.get(`proyectos?${q}&select=ot,cliente,proyecto,obra,fecha_entrega,total_modulos&limit=1`),
        sb.get(`bultos_ot?${q}&order=numero.asc&select=*`),
        sb.get(`sueltos_ot?${q}&order=orden.asc,id.asc&select=id,tipo,codigo,descripcion,cantidad,carga`).catch(() => []),
        sb.get(`cargas_ot?${q}&select=*&limit=1`),
      ]);
      const carga = cargas?.[0] || null;
      setDatos({ proyecto: proyectos?.[0] || null, bultos: bultos || [], sueltos: sueltos || [], carga });
      setFaltantes({ texto: carga?.faltantes || "", fecha: carga?.faltantes_fecha || "" });
      setAviso(null);
    } catch {
      setDatos({ proyecto: null, bultos: [], sueltos: [], carga: null });
      setAviso("No se pudo leer la carga (¿falta correr la migración 104?).");
    }
  }, [ot, empresaId]);

  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect

  const enviar = async (url, body) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch(url, { method: "POST", body: JSON.stringify(body) });
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
  const accion = (body) => enviar("/api/carga", { ...body });
  const ponerCarga = (data) => data?.carga && setDatos((d) => ({ ...d, carga: data.carga }));

  if (!datos) {
    return (
      <Marco ot={ot} onClose={onClose}>
        <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      </Marco>
    );
  }

  const { proyecto, bultos, sueltos, carga } = datos;
  const lista = normalizarChecklist(checklist);
  const tildados = new Set(Array.isArray(carga?.checklist) ? carga.checklist : []);
  const estado = estadoCarga({ bultos, sueltos, carga, checklist: lista });
  const cerrada = estado.empezada;
  const otStr = String(ot);

  const agregarBulto = async () => {
    const data = await accion({ accion: "bulto_agregar", ot: otStr, contenido: contenido.trim() || null });
    if (data?.bulto) { setDatos((d) => ({ ...d, bultos: [...d.bultos, data.bulto] })); setContenido(""); }
  };
  const borrarBulto = async (b) => {
    setConfirmar(null);
    if (await accion({ accion: "bulto_borrar", id: b.id })) {
      setDatos((d) => ({ ...d, bultos: d.bultos.filter((x) => x.id !== b.id).map((x) => (x.numero > b.numero ? { ...x, numero: x.numero - 1 } : x)) }));
    }
  };
  const tildarBulto = async (b) => {
    const data = await accion({ accion: "bulto_tildar", id: b.id, valor: !b.cargado });
    if (data) setDatos((d) => ({ ...d, bultos: d.bultos.map((x) => (x.id === b.id ? { ...x, cargado: !b.cargado, ...(data.bulto || {}) } : x)) }));
  };
  const tildarSuelto = async (s) => {
    const data = await enviar("/api/sueltos", { accion: "tildar", id: s.id, columna: "carga", valor: !s.carga });
    if (data) setDatos((d) => ({ ...d, sueltos: d.sueltos.map((x) => (x.id === s.id ? { ...x, carga: !s.carga } : x)) }));
  };
  const tildarPunto = async (t) => {
    const nuevos = tildados.has(t) ? [...tildados].filter((x) => x !== t) : [...tildados, t];
    ponerCarga(await accion({ accion: "checklist", ot: otStr, items: nuevos }));
  };
  const guardarFaltantes = async () => {
    ponerCarga(await accion({ accion: "faltantes", ot: otStr, texto: faltantes.texto.trim() || null, fecha: faltantes.fecha || null }));
  };
  const subirFoto = async (file) => {
    if (!file) return;
    setGuardando(true);
    setError(null);
    try {
      const url = await subirImagen(await fotoBase64(file));
      setGuardando(false);
      ponerCarga(await accion({ accion: "foto", ot: otStr, url }));
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  };
  const firmar = async (rol) => ponerCarga(await accion({ accion: "firmar", ot: otStr, rol }));
  const desfirmar = async () => { setConfirmar(null); ponerCarga(await accion({ accion: "desfirmar", ot: otStr })); };
  const imprimir = async () => {
    const t = TAMANOS_ETIQUETA.find((x) => x.id === tamano) || TAMANOS_ETIQUETA[0];
    try { localStorage.setItem(CLAVE_TAMANO, t.id); } catch { /* sin almacenamiento */ }
    try {
      await imprimirRotulos({
        empresa: empresa?.nombre_corto || empresa?.nombre || "",
        proyecto: proyecto || { ot: otStr },
        bultos,
        link: linkCarga(window.location.origin, empresa?.slug || "", otStr),
        tamano: t,
      });
    } catch (e) {
      setError(e.message);
    }
  };
  const firma = (rol, texto) => {
    const por = carga?.[`firma_${rol}_por`];
    const at = carga?.[`firma_${rol}_at`];
    return (
      <div className="flex items-center gap-2 bg-gypi-surface rounded-xl p-3 border border-gypi-border">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold">{texto}</div>
          <div className="text-[11px] text-gypi-dim">{por ? `Firmado ${horaCorta(at)}${usuario?.id && por === usuario.id ? " (vos)" : ""}` : "Sin firmar"}</div>
        </div>
        {por ? <span className="text-gypi-green font-bold text-sm">✓</span> : (
          <button onClick={() => firmar(rol)} disabled={guardando || !estado.puedeFirmar} className="g-btn g-btn-primary !py-2 text-xs">Firmar</button>
        )}
      </div>
    );
  };

  return (
    <Marco ot={ot} onClose={onClose} titulo={proyecto?.cliente || proyecto?.proyecto} detalle={[proyecto?.obra, proyecto?.fecha_entrega && `Entrega ${fechaCorta(proyecto.fecha_entrega)}`].filter(Boolean).join(" · ")}>
      <div className={`p-3 rounded-[10px] text-[13px] mb-3 border ${estado.firmada ? "bg-gypi-green/10 border-gypi-green/30 text-gypi-green" : "bg-gypi-surface border-gypi-border"}`} role="status">
        {estado.firmada ? (estado.conFaltantes ? "🚚 Carga firmada, con faltantes anotados." : "🚚 Carga completa y firmada.")
          : `Bultos ${estado.bultosCargados} de ${estado.bultos} cargados${estado.sueltos ? ` · Sueltos ${estado.sueltosCargados} de ${estado.sueltos}` : ""}${lista.length ? ` · Checklist ${lista.length - estado.checklistFaltan.length} de ${lista.length}` : ""}`}
      </div>
      {aviso && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{aviso}</div>}
      {error && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{error}</div>}
      {cerrada && !estado.firmada && <div className="text-[12px] text-gypi-dim mb-2.5">Con una firma puesta la lista queda cerrada. Falta la otra firma.</div>}

      <Seccion titulo="Bultos">
        {bultos.length === 0 ? <div className="text-[13px] text-gypi-dim mb-2">Todavía no hay bultos. Agregá uno por cada paquete que va al camión.</div> : (
          <ul aria-label="Lista de bultos" className="list-none p-0 m-0 mb-2 flex flex-col gap-1.5">
            {bultos.map((b) => (
              <li key={b.id} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold">Bulto {b.numero} de {bultos.length}</div>
                  {b.contenido && <div className="text-[11px] text-gypi-dim">{b.contenido}</div>}
                </div>
                <Tilde activo={b.cargado} disabled={guardando || cerrada} onClick={() => tildarBulto(b)} label={`Cargado bulto ${b.numero}`} texto="Cargado" />
                {!cerrada && (confirmar === b.id ? (
                  <button onClick={() => borrarBulto(b)} disabled={guardando} className={`${BOTON_TILDE} border-gypi-red bg-gypi-red/10 text-gypi-red`}>Sí, sacar</button>
                ) : (
                  <button onClick={() => setConfirmar(b.id)} aria-label={`Sacar bulto ${b.numero}`} className="min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-transparent text-gypi-red text-sm cursor-pointer">🗑</button>
                ))}
              </li>
            ))}
          </ul>
        )}
        {proyecto?.total_modulos ? <div className="text-[11px] text-gypi-dim mb-2">La OT tiene {proyecto.total_modulos} módulos: revisá que todos estén en algún bulto.</div> : null}
        {!cerrada && (
          <div className="flex gap-2 mb-2">
            <input className="g-input flex-1 min-w-0" value={contenido} maxLength={300} aria-label="Contenido del bulto nuevo"
              onChange={(e) => setContenido(e.target.value)} placeholder="Qué lleva (ej: 1.GB2P + 1.GB3C, caja de herrajes)" />
            <button onClick={agregarBulto} disabled={guardando} className="g-btn g-btn-secondary">＋ Bulto</button>
          </div>
        )}
        {bultos.length > 0 && (
          <div className="flex gap-2">
            <select className="g-input flex-1 min-w-0" value={tamano} onChange={(e) => setTamano(e.target.value)} aria-label="Tamaño de la etiqueta">
              {TAMANOS_ETIQUETA.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
            <button onClick={imprimir} className="g-btn g-btn-secondary">🖨 Imprimir rótulos</button>
          </div>
        )}
      </Seccion>

      {sueltos.length > 0 && (
        <Seccion titulo="Sueltos">
          <ul aria-label="Sueltos para cargar" className="list-none p-0 m-0 flex flex-col gap-1.5">
            {sueltos.map((s) => (
              <li key={s.id} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                <div className="flex-1 min-w-0 text-[13px]">{nombreSuelto(s)} <span className="text-[11px] text-gypi-dim">× {Number(s.cantidad).toLocaleString("es-AR")}</span></div>
                <Tilde activo={s.carga} disabled={guardando || cerrada} onClick={() => tildarSuelto(s)} label={`Cargado ${nombreSuelto(s)}`} texto="Cargado" />
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      {lista.length > 0 && (
        <Seccion titulo="Checklist de carga">
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

      <Seccion titulo="Faltantes">
        <textarea className="g-input w-full min-h-[70px]" maxLength={1000} disabled={cerrada} aria-label="Qué falta"
          value={faltantes.texto} onChange={(e) => setFaltantes({ ...faltantes, texto: e.target.value })} placeholder="Si se sale con algo faltante, anotalo acá (y avisale al cliente)" />
        <div className="flex gap-2 mt-1.5 items-center">
          <label className="text-[12px] text-gypi-dim" htmlFor="faltantes-fecha">Se entrega el</label>
          <input id="faltantes-fecha" type="date" className="g-input flex-1 min-w-0" disabled={cerrada} value={faltantes.fecha} onChange={(e) => setFaltantes({ ...faltantes, fecha: e.target.value })} />
          {!cerrada && (faltantes.texto.trim() !== (carga?.faltantes || "") || (faltantes.fecha || null) !== (carga?.faltantes_fecha || null)) && (
            <button onClick={guardarFaltantes} disabled={guardando} className="g-btn g-btn-secondary">Guardar</button>
          )}
        </div>
      </Seccion>

      <Seccion titulo="Foto de la carga completa">
        {carga?.foto_url && <a href={carga.foto_url} target="_blank" rel="noreferrer" className="text-[13px] text-gypi-cyan block mb-1.5">📷 Ver la foto</a>}
        {!cerrada && (
          <label className="g-btn g-btn-secondary w-full text-center cursor-pointer block">
            {carga?.foto_url ? "Cambiar la foto" : "📷 Sacar o subir la foto"}
            <input type="file" accept="image/*" capture="environment" className="hidden" aria-label="Foto de la carga" disabled={guardando} onChange={(e) => subirFoto(e.target.files?.[0])} />
          </label>
        )}
      </Seccion>

      <Seccion titulo="Firmas">
        {!estado.firmada && !estado.puedeFirmar && (
          <div className="text-[12px] text-gypi-amber-ink mb-2">
            {estado.bultos ? `Para firmar: ${estado.pendientes.join(" · ")}. Si se sale igual, anotá el faltante con su fecha.` : "Para firmar, primero armá la lista de bultos."}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {firma("carga", "Quien carga")}
          {firma("instalacion", "Responsable de instalación")}
        </div>
        {esGestion && cerrada && (confirmar === "desfirmar" ? (
          <button onClick={desfirmar} disabled={guardando} className="w-full mt-2 min-h-[44px] rounded-lg border border-gypi-red bg-gypi-red/10 text-gypi-red text-xs font-bold cursor-pointer">Sí, deshacer las firmas</button>
        ) : (
          <button onClick={() => setConfirmar("desfirmar")} className="w-full mt-2 min-h-[44px] rounded-lg border-none bg-transparent text-gypi-red text-xs cursor-pointer">Deshacer las firmas para corregir la carga</button>
        ))}
      </Seccion>

      {/* En obra, el instalador escanea un bulto y sigue con el acta (parte 11) */}
      {onAbrirActa && estado.firmada && (
        <button onClick={onAbrirActa} className="g-btn g-btn-primary w-full">✍️ Acta de instalación</button>
      )}
    </Marco>
  );
}

function Marco({ ot, titulo, detalle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label={`Carga de la OT ${ot}`}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="g-overline text-gypi-amber-ink">Orden {ot} · Acopio y carga</div>
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
