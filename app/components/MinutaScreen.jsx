"use client";
// app/components/MinutaScreen.jsx — Producción → 📝 Minuta (Minuta, parte M1;
// migración 150; diseño en notes/diseno-minuta-buenos-dias.md).
//
// La minuta de la reunión de Buenos Días con las secciones de la minuta v2 en
// papel. Cada renglón se elige de lo que ya está en Gypi: las OT (con su
// división, proyecto y cliente), las personas, los artículos del inventario,
// los proveedores y los vehículos. Siempre se puede escribir a mano lo que no
// está (un instalador de afuera, una obra sin OT). Solo Dueño / Gerencia.
// Se guarda por /api/minutas; se imprime o se baja en PDF con el formato v2.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch, sb, sbGetAll } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import {
  AREAS_DYT, AREAS_FEEDBACK, BLOQUES, CLAVE_CONFIG_MINUTA, ESTADOS_DYT, LISTO, SEMAFOROS, URGENCIAS,
  VECES_A_GERENCIA, listaInstaladores, textoInstaladores, datosDeOt, pedidoDesdeMinuta, textoCantidad, duracionMinutos, renglonQueSigue, seguimientoPendiente, textoSeguimiento, SECCIONES_SEGUIMIENTO, faltantesMinuta, hora, imprimirMinuta, participantesDe, clientesDe, listaUnica, tiposFeedbackDe, renglonNuevo, renglonesParaGuardar, seccionesDe,
} from "../lib/minutas";
import { nombreDivisionOt } from "../lib/avance";
import { sugerenciasPendientes } from "../lib/minutasPrecarga";
import { calendarioMinuta, nombreEvento, iconoEvento, fechaCorta as ddmmCal, DIAS_CORTOS } from "../lib/minutasCalendario";
import { armarRevision, textoRevision, tipoRevision, TIPOS_REVISION, ESTADO_PEDIDO, SECCION_REVISION } from "../lib/minutasRevision";
import { useAuth } from "../context/AuthContext";
import { tieneModulo } from "../lib/modulos";
import { Chip, Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const MAX_SUGERENCIAS = 8;
const OTRO = "__otro";
const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Caja de texto que sugiere de una lista y deja escribir lo que no está.
 * Con el teclado: ↓ / ↑ recorren las opciones, Enter elige y Esc cierra.
 * nuevo: { texto: (q) => string, onNuevo: (q) => void } agrega al final la
 * opción de dar de alta lo escrito cuando no está en la lista.
 */
function Sugerencias({ label, value, onChange, opciones, onElegir, placeholder = "", disabled = false, nuevo = null }) {
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const idLista = useId();
  const lista = useMemo(() => {
    const q = normal(value).trim();
    if (!q) return [];
    const l = opciones.filter((o) => normal(`${o.label} ${o.detalle || ""}`).includes(q)).slice(0, MAX_SUGERENCIAS);
    if (nuevo && !opciones.some((o) => normal(o.label).trim() === q)) {
      l.push({ valor: "__nuevo", label: nuevo.texto(String(value).trim()), esNuevo: true });
    }
    return l;
  }, [value, opciones, nuevo]);
  useEffect(() => { setActiva(-1); }, [value]);
  const elegir = (o) => {
    if (o.esNuevo) nuevo.onNuevo(String(value).trim());
    else onElegir(o);
    setAbierto(false);
    setActiva(-1);
  };
  const visible = abierto && lista.length > 0;
  function tecla(e) {
    if (e.key === "Escape") { setAbierto(false); return; }
    if (!lista.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAbierto(true); setActiva((i) => (i + 1) % lista.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAbierto(true); setActiva((i) => (i <= 0 ? lista.length - 1 : i - 1)); }
    else if (e.key === "Enter" && visible && activa >= 0) { e.preventDefault(); elegir(lista[activa]); }
  }
  return (
    <div className="relative">
      <input
        className="g-input w-full"
        aria-label={label}
        role="combobox"
        aria-expanded={visible}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={visible && activa >= 0 ? `${idLista}-${activa}` : undefined}
        placeholder={placeholder || label}
        value={value || ""}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setAbierto(true); }}
        onKeyDown={tecla}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
      />
      {visible && (
        <ul id={idLista} role="listbox" aria-label={`Sugerencias de ${label}`} className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-lg border border-gypi-border bg-gypi-bg shadow-lg list-none p-1 m-0">
          {lista.map((o, i) => (
            <li key={o.valor} id={`${idLista}-${i}`} role="option" aria-selected={i === activa}
              onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(o)} onMouseEnter={() => setActiva(i)}
              className={`cursor-pointer px-2 py-2 rounded-md text-[14px] min-h-[44px] ${i === activa ? "bg-gypi-surf-hi" : ""} ${o.esNuevo ? "text-gypi-cyan font-semibold" : "text-gypi-text"}`}>
              <span className={o.esNuevo ? "" : "font-semibold"}>{o.label}</span>
              {o.detalle && <span className="block text-[12px] text-gypi-mute">{o.detalle}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Con un botón adentro va como div: un <label> le pondría su texto de nombre
function Campo({ label, children, ancho = false, div = false }) {
  const Tag = div ? "div" : "label";
  return (
    <Tag className={`flex flex-col gap-1 text-[12px] text-gypi-mute ${ancho ? "sm:col-span-2" : ""}`}>
      <span>{label}</span>
      {children}
    </Tag>
  );
}

/** Los tres colores del estado. */
function Semaforo({ value, onChange, disabled }) {
  return (
    <div role="group" aria-label="Estado" className="flex gap-1">
      {SEMAFOROS.map((s) => (
        <button key={s.id} type="button" disabled={disabled} aria-pressed={value === s.id} aria-label={s.label}
          onClick={() => onChange(value === s.id ? null : s.id)}
          className={`min-h-[44px] flex-1 rounded-lg border text-[13px] cursor-pointer ${value === s.id ? "border-gypi-text bg-gypi-surf-hi font-bold" : "border-gypi-border bg-transparent"}`}>
          {s.punto} {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Diseño y técnica: el primer eslabón, muchas veces sin OT todavía
 * (presupuesto, diseño, relevamiento). Se elige la OT si ya existe; si no,
 * el cliente (o se agrega uno nuevo) y se escribe el proyecto.
 */
function ClienteProyecto({ it, cambiar, listas, disabled }) {
  const [buscar, setBuscar] = useState("");
  const clientes = useMemo(() => listas.clientes.map((c) => ({ valor: c, label: c })), [listas.clientes]);
  const nuevo = useMemo(() => ({
    texto: (q) => `＋ Agregar nuevo cliente "${q}"`,
    onNuevo: (q) => { cambiar({ cliente: q }); listas.agregarCliente(q); },
  }), [cambiar, listas]);
  return (
    <>
      <Campo label="OT (si ya tiene)" div>
        {it.ot ? (
          <div className="flex items-center gap-2 min-h-[44px]">
            <span className="text-[14px] font-semibold flex-1 min-w-0 truncate">OT {it.ot}{it.division ? ` · ${it.division}` : ""}</span>
            {!disabled && <button type="button" className="min-h-[44px] px-2 bg-transparent border-none text-gypi-red-ink cursor-pointer text-[13px]" onClick={() => cambiar({ ot: null, division: null })}>✕ Quitar</button>}
          </div>
        ) : (
          <Sugerencias label="OT (si ya tiene)" value={buscar} disabled={disabled} opciones={listas.ots}
            onChange={setBuscar} onElegir={(o) => { setBuscar(""); cambiar(datosDeOt(o.dato)); }} placeholder="Sin OT todavía: dejalo vacío" />
        )}
      </Campo>
      <Campo label="Cliente" div>
        <Sugerencias label="Cliente" value={it.cliente || ""} disabled={disabled} opciones={clientes} nuevo={nuevo}
          onChange={(v) => cambiar({ cliente: v })} onElegir={(o) => cambiar({ cliente: o.label })} placeholder="Buscá o agregá el cliente" />
      </Campo>
      <Campo label="Proyecto">
        <input className="g-input w-full" aria-label="Proyecto" value={it.proyecto || ""} maxLength={200} disabled={disabled} onChange={(e) => cambiar({ proyecto: e.target.value })} />
      </Campo>
    </>
  );
}

/** Tipo de feedback: los de siempre, los agregados y "Otro" para escribir uno nuevo que queda en la lista. */
function TipoFeedback({ it, cambiar, listas, disabled }) {
  const [otro, setOtro] = useState(null);
  const tipos = it.tipo && !listas.tiposFeedback.includes(it.tipo) ? [...listas.tiposFeedback, it.tipo] : listas.tiposFeedback;
  const agregar = () => {
    const t = String(otro || "").trim();
    if (!t) return;
    cambiar({ tipo: t });
    listas.agregarTipoFeedback(t);
    setOtro(null);
  };
  return (
    <Campo label="Tipo" div>
      {otro === null ? (
        <select className="g-input w-full" aria-label="Tipo de feedback" value={it.tipo || ""} disabled={disabled}
          onChange={(e) => (e.target.value === OTRO ? setOtro("") : cambiar({ tipo: e.target.value || null }))}>
          <option value="">Elegí</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          <option value={OTRO}>Otro…</option>
        </select>
      ) : (
        <div className="flex gap-1">
          <input className="g-input w-full" aria-label="Nuevo tipo de feedback" placeholder="Escribí el tipo" value={otro} maxLength={40} autoFocus
            onChange={(e) => setOtro(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } else if (e.key === "Escape") setOtro(null); }} />
          <button type="button" className="g-btn g-btn-primary" disabled={!otro.trim()} onClick={agregar}>Agregar</button>
          <button type="button" aria-label="Cancelar tipo nuevo" className="min-h-[44px] min-w-[44px] bg-transparent border-none text-gypi-mute cursor-pointer" onClick={() => setOtro(null)}>✕</button>
        </div>
      )}
    </Campo>
  );
}

/**
 * Instaladores de una instalación en curso: se tildan del equipo de
 * instaladores (empleados marcados como instalador) y con "Otro…" se escribe
 * a alguien de producción o nuevo.
 */
function Instaladores({ it, cambiar, listas, disabled }) {
  const [otro, setOtro] = useState(null);
  const elegidos = listaInstaladores(it.datos?.instaladores);
  const poner = (lista) => cambiar({ datos: { ...it.datos, instaladores: textoInstaladores(lista) } });
  const alternar = (n) => poner(elegidos.includes(n) ? elegidos.filter((x) => x !== n) : [...elegidos, n]);
  const equipo = listas.instaladores || [];
  const extras = elegidos.filter((n) => !equipo.some((p) => p.label === n));
  const agregar = () => {
    const n = String(otro || "").trim();
    if (n) poner([...elegidos, n]);
    setOtro(null);
  };
  return (
    <Campo label="Instaladores" ancho div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Instaladores">
        {equipo.map((p) => (
          <Chip key={p.valor} active={elegidos.includes(p.label)} aria-pressed={elegidos.includes(p.label)} disabled={disabled} onClick={() => alternar(p.label)}>{p.label}</Chip>
        ))}
        {extras.map((n) => (
          <Chip key={n} active aria-pressed="true" aria-label={`Sacar a ${n}`} disabled={disabled} onClick={() => alternar(n)}>{n} ✕</Chip>
        ))}
        {otro === null ? (
          !disabled && <Chip onClick={() => setOtro("")}>＋ Otro…</Chip>
        ) : (
          <span className="flex gap-1 w-full">
            <input className="g-input w-full" aria-label="Otro instalador" placeholder="Nombre (de producción o nuevo)" value={otro} maxLength={60} autoFocus
              onChange={(e) => setOtro(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } else if (e.key === "Escape") setOtro(null); }} />
            <button type="button" className="g-btn g-btn-primary" disabled={!otro.trim()} onClick={agregar}>Agregar</button>
            <button type="button" aria-label="Cancelar otro instalador" className="min-h-[44px] min-w-[44px] bg-transparent border-none text-gypi-mute cursor-pointer" onClick={() => setOtro(null)}>✕</button>
          </span>
        )}
      </div>
      {!equipo.length && <span className="text-[12px] text-gypi-mute">No hay instaladores marcados en Equipo: usá "Otro…" o marcá "Es instalador" en la ficha de cada uno.</span>}
    </Campo>
  );
}

const TONO_CAL = { rojo: "border-gypi-red bg-gypi-red/10", amarillo: "border-yellow-400 bg-yellow-400/15", verde: "border-gypi-green bg-gypi-green/10" };
function EventoCal({ e, conFecha = false }) {
  return (
    <span className={`block rounded-md border px-1 py-0.5 text-[12px] leading-tight truncate ${TONO_CAL[e.semaforo] || "border-gypi-border bg-gypi-surface"}`}
      title={[nombreEvento(e), e.proyecto, e.responsable].filter(Boolean).join(" · ")}>
      {iconoEvento(e)} {nombreEvento(e)}{conFecha ? ` · ${ddmmCal(e.fecha)}` : ""}
    </span>
  );
}

/**
 * Calendario al final de la minuta: las fechas objetivo de producción (🏭) e
 * instalación (🔧) en curso, día por día; lo vencido va arriba.
 */
function CalendarioMinuta({ items, fecha }) {
  const cal = useMemo(() => calendarioMinuta(items, fecha), [items, fecha]);
  return (
    <section className="g-card p-3 mb-3" aria-label="Calendario de fechas objetivo">
      <h2 className="text-[15px] font-bold m-0 mb-1">📅 Calendario de fechas objetivo</h2>
      <p className="text-[12px] text-gypi-mute m-0 mb-2">🏭 producción y 🔧 instalación en curso, con el color de su semáforo.</p>
      {cal.total === 0 ? <p className="text-[13px] text-gypi-mute m-0">Todavía no hay producción ni instalaciones en curso en esta minuta.</p> : (
        <>
          {cal.vencidas.length > 0 && (
            <div className="mb-2" aria-label="Fechas objetivo vencidas">
              <div className="text-[13px] font-semibold text-gypi-red-ink mb-1">⏰ Ya vencieron</div>
              <div className="flex flex-wrap gap-1">{cal.vencidas.map((e, i) => <EventoCal key={i} e={e} conFecha />)}</div>
            </div>
          )}
          <div className="grid grid-cols-7 gap-1 text-center text-[12px] text-gypi-mute mb-1">{DIAS_CORTOS.map((d) => <div key={d}>{d}</div>)}</div>
          {cal.semanas.map((sem) => (
            <div key={sem[0].fecha} className="grid grid-cols-7 gap-1 mb-1">
              {sem.map((d) => (
                <div key={d.fecha} aria-label={`Día ${d.etiqueta}`}
                  className={`min-h-[56px] min-w-0 rounded-lg border p-1 ${d.hoy ? "border-gypi-amber bg-gypi-amber/10" : "border-gypi-border"} ${d.pasado || d.finde ? "opacity-70" : ""}`}>
                  <div className={`text-[12px] ${d.hoy ? "font-bold text-gypi-amber-ink" : "text-gypi-mute"}`}>{d.hoy ? "Hoy" : d.etiqueta}</div>
                  <div className="flex flex-col gap-0.5">{d.eventos.map((e, i) => <EventoCal key={i} e={e} />)}</div>
                </div>
              ))}
            </div>
          ))}
          {cal.masAdelante.length > 0 && (
            <div className="text-[12px] text-gypi-mute mt-1">Más adelante: {cal.masAdelante.map((e) => `${iconoEvento(e)} ${nombreEvento(e)} ${ddmmCal(e.fecha)}`).join(" · ")}</div>
          )}
          {cal.sinFecha.length > 0 && (
            <div className="text-[12px] text-gypi-mute mt-1">Sin fecha objetivo: {cal.sinFecha.map((e) => `${iconoEvento(e)} ${nombreEvento(e)}`).join(" · ")}</div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 🔁 Revisión de ayer (155): lo que hay que mirar de la minuta anterior, ya
 * cargado. Se contesta con un toque: ¿se mitigó?, ¿se cumplió?, ¿se hizo?
 */
function RevisionAyer({ items, cambiar, sacar, disabled, anterior }) {
  const rev = items.filter((it) => it.seccion === SECCION_REVISION);
  if (!rev.length) return null;
  const fechaAyer = rev[0]?.datos?.fecha_ayer || anterior;
  const contestadas = rev.filter((it) => it.datos?.resultado).length;
  return (
    <section className="g-card p-3 mb-3" aria-label="Revisión de ayer">
      <h2 className="text-[15px] font-bold m-0 mb-1">🔁 Revisión de la minuta anterior{fechaAyer ? <span className="text-[12px] font-normal text-gypi-mute"> · {fechaAyer.slice(8, 10)}/{fechaAyer.slice(5, 7)}</span> : null}</h2>
      <p className="text-[12px] text-gypi-mute m-0 mb-2">Contestadas {contestadas} de {rev.length}. Lo que siga abierto, sumalo abajo con "↩ Sigue abierto".</p>
      {TIPOS_REVISION.map((t) => {
        const l = rev.filter((it) => it.tipo === t.id);
        if (!l.length) return null;
        return (
          <div key={t.id} className="mb-2" role="group" aria-label={t.titulo}>
            <h3 className="text-[14px] font-bold m-0 mb-1">{t.titulo} <span className="font-normal text-[12px] text-gypi-mute">{t.pregunta}</span></h3>
            <div className="flex flex-col gap-1.5">
              {l.map((it) => {
                const res = it.datos?.resultado || null;
                const marcar = (v) => cambiar(it.id, { datos: { ...it.datos, resultado: res === v ? null : v } });
                const punto = it.semaforo === "rojo" ? "🔴 " : it.semaforo === "amarillo" ? "🟡 " : "";
                return (
                  <div key={it.id} className={`rounded-xl border p-2 ${res === "si" ? "border-gypi-green bg-gypi-green/5" : res === "no" ? "border-gypi-red bg-gypi-red/5" : "border-gypi-border"}`}>
                    <div className="text-[13px]">{t.id === "alerta" ? punto : ""}{textoRevision(it) || "Sin detalle"}</div>
                    <div className="text-[12px] text-gypi-mute">
                      {[it.responsable && `👤 ${it.responsable}`, it.fecha_objetivo && `📅 ${it.fecha_objetivo.slice(8, 10)}/${it.fecha_objetivo.slice(5, 7)}`, it.datos?.pedido_estado && `🛒 ${ESTADO_PEDIDO[it.datos.pedido_estado] || it.datos.pedido_estado}`, t.id === "compra" && !it.datos?.pedido_id && "🛒 no se creó pedido desde la minuta"].filter(Boolean).join(" · ")}
                    </div>
                    <div className="flex gap-1.5 mt-1">
                      <Chip active={res === "si"} disabled={disabled} color="var(--color-green)" onClick={() => marcar("si")}>{t.si}</Chip>
                      <Chip active={res === "no"} disabled={disabled} color="var(--color-red)" onClick={() => marcar("no")}>{t.no}</Chip>
                      {!disabled && <button type="button" aria-label={`Sacar de la revisión: ${textoRevision(it)}`} className="ml-auto min-h-[40px] min-w-[40px] bg-transparent border-none text-gypi-mute cursor-pointer" onClick={() => sacar(it.id)}>✕</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Un renglón de una sección, con los campos que lleva esa sección. */
function Renglon({ s, it, cambiar, sacar, listas, disabled, resolver = null, pedir = null }) {
  const c = (campo) => s.campos.includes(campo);
  const datos = (k, v) => cambiar({ datos: { ...it.datos, [k]: v } });
  const textoOt = it.ot ? `OT ${it.ot}${it.proyecto ? ` · ${it.proyecto}` : ""}` : it.proyecto || "";
  const falta = (campo) => s.obligatorios?.includes(campo) && !it[campo === "fecha" ? "fecha_objetivo" : campo] && (it.ot || it.proyecto || it.texto);
  return (
    <div className={`g-card p-3 mb-2 ${it.resuelto_at ? "opacity-60" : ""}`}>
      {(textoSeguimiento(it) || it.datos?.gerencia || it.resuelto_at) && (
        <div className="flex flex-wrap gap-2 mb-2 text-[12px]">
          {textoSeguimiento(it) && <span className="text-gypi-amber-ink font-semibold">{textoSeguimiento(it)}</span>}
          {it.datos?.gerencia && <span className="text-gypi-red-ink font-semibold">🔴 {VECES_A_GERENCIA} días seguidos: lo toma Gerencia</span>}
          {it.resuelto_at && <span className="text-gypi-green-ink font-semibold">✓ Resuelto</span>}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {c("articulo") && (
          <Campo label={s.texto} ancho>
            <Sugerencias label={s.texto} value={it.texto} disabled={disabled} opciones={listas.articulos}
              onChange={(v) => cambiar({ texto: v, datos: { ...it.datos, sku: null } })}
              onElegir={(o) => cambiar({ texto: o.label, datos: { ...it.datos, sku: o.valor } })} placeholder="Artículo del inventario o texto libre" />
          </Campo>
        )}
        {c("area") && s.id === "dyt" && (
          <Campo label="Estado">
            <select className="g-input w-full" aria-label="Estado del ítem" value={it.tipo || ""} disabled={disabled} onChange={(e) => cambiar({ tipo: e.target.value || null })}>
              {ESTADOS_DYT.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </Campo>
        )}
        {c("ot") && s.id === "dyt" && <ClienteProyecto it={it} cambiar={cambiar} listas={listas} disabled={disabled} />}
        {c("ot") && s.id !== "dyt" && (
          <Campo label={s.id === "compra" ? "Para proyecto" : "OT o proyecto"} ancho={s.id !== "compra"}>
            <Sugerencias label={s.id === "compra" ? "Para proyecto" : "OT o proyecto"} value={textoOt} disabled={disabled} opciones={listas.ots}
              onChange={(v) => cambiar({ ot: null, proyecto: v })}
              onElegir={(o) => cambiar(datosDeOt(o.dato))} placeholder="Buscá la OT, el cliente o la obra" />
            {it.ot ? (
              <span className="text-[12px] text-gypi-mute">{[it.division, it.cliente].filter(Boolean).join(" · ")}</span>
            ) : s.id !== "compra" && (it.proyecto || "") !== "" ? (
              <input className="g-input w-full" aria-label="Cliente" placeholder="Cliente" value={it.cliente || ""} disabled={disabled} onChange={(e) => cambiar({ cliente: e.target.value })} />
            ) : null}
          </Campo>
        )}
        {c("semaforo") && (
          <Campo label="Estado" ancho div><Semaforo value={it.semaforo} disabled={disabled} onChange={(v) => cambiar({ semaforo: v })} /></Campo>
        )}
        {c("instaladores") && <Instaladores it={it} cambiar={cambiar} listas={listas} disabled={disabled} />}
        {s.id === "feedback" && (
          <>
            <TipoFeedback it={it} cambiar={cambiar} listas={listas} disabled={disabled} />
            <Campo label="Feedback para">
              <select className="g-input w-full" aria-label="Feedback para" value={it.area || ""} disabled={disabled} onChange={(e) => cambiar({ area: e.target.value || null })}>
                <option value="">Elegí</option>
                {AREAS_FEEDBACK.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
          </>
        )}
        {c("proveedor") && (
          <Campo label="Proveedor">
            <Sugerencias label="Proveedor" value={it.datos?.proveedor} disabled={disabled} opciones={listas.proveedores}
              onChange={(v) => datos("proveedor", v)} onElegir={(o) => datos("proveedor", o.label)} />
          </Campo>
        )}
        {s.id === "compra" && (
          <Campo label={`Cantidad${it.datos?.unidad ? ` (${it.datos.unidad})` : ""}`}>
            <input type="number" min="0" step="any" inputMode="decimal" className="g-input w-full" aria-label="Cantidad" value={it.datos?.cantidad ?? ""} disabled={disabled}
              onChange={(e) => datos("cantidad", e.target.value === "" ? null : Number(e.target.value))} />
            {it.datos?.ots && <span className="text-[12px] text-gypi-mute">Para OT {it.datos.ots}</span>}
          </Campo>
        )}
        {s.id === "compra" && (
          <Campo label="Urgencia">
            <select className="g-input w-full" aria-label="Urgencia" value={it.tipo || "normal"} disabled={disabled} onChange={(e) => cambiar({ tipo: e.target.value })}>
              {URGENCIAS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </Campo>
        )}
        {c("texto") && (
          <Campo label={s.texto} ancho>
            <input className="g-input w-full" aria-label={s.texto} value={it.texto || ""} maxLength={1000} disabled={disabled} onChange={(e) => cambiar({ texto: e.target.value })} />
          </Campo>
        )}
        {c("desde") && (
          <>
            <Campo label="Desde"><input className="g-input w-full" aria-label="Desde" value={it.datos?.desde || ""} disabled={disabled} onChange={(e) => datos("desde", e.target.value)} /></Campo>
            <Campo label="Hasta"><input className="g-input w-full" aria-label="Hasta" value={it.datos?.hasta || ""} disabled={disabled} onChange={(e) => datos("hasta", e.target.value)} /></Campo>
          </>
        )}
        {c("listo") && (
          <Campo label="¿Planilla y material?">
            <select className="g-input w-full" aria-label="¿Planilla y material?" value={it.datos?.listo || ""} disabled={disabled} onChange={(e) => datos("listo", e.target.value || null)}>
              <option value="">Sin revisar</option>
              {LISTO.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Campo>
        )}
        {c("responsable") && (
          <Campo label={`${s.responsable || "Responsable"}${s.obligatorios?.includes("responsable") ? " *" : ""}`}>
            <Sugerencias label={s.responsable || "Responsable"} value={it.responsable} disabled={disabled} opciones={listas.personas}
              onChange={(v) => cambiar({ responsable: v })} onElegir={(o) => cambiar({ responsable: o.label })} placeholder="Persona de Gypi o nombre" />
            {falta("responsable") && <span className="text-[12px] text-gypi-red-ink">Sin responsable no se registra</span>}
          </Campo>
        )}
        {c("vehiculo") && (
          <Campo label="Vehículo">
            <select className="g-input w-full" aria-label="Vehículo" value={it.datos?.vehiculo || ""} disabled={disabled} onChange={(e) => datos("vehiculo", e.target.value || null)}>
              <option value="">Sin vehículo</option>
              {listas.vehiculos.map((v) => <option key={v.valor} value={v.label}>{v.label}</option>)}
            </select>
          </Campo>
        )}
        {c("fecha") && (
          <Campo label={`${s.fecha || "Fecha objetivo"}${s.obligatorios?.includes("fecha") ? " *" : ""}`}>
            <input type="date" className="g-input w-full" aria-label={s.fecha || "Fecha objetivo"} value={it.fecha_objetivo || ""} disabled={disabled} onChange={(e) => cambiar({ fecha_objetivo: e.target.value || null })} />
            {falta("fecha") && <span className="text-[12px] text-gypi-red-ink">Sin fecha objetivo no se registra</span>}
          </Campo>
        )}
        {c("donde") && (
          <Campo label="Dónde"><input className="g-input w-full" aria-label="Dónde" value={it.datos?.donde || ""} disabled={disabled} onChange={(e) => datos("donde", e.target.value)} /></Campo>
        )}
      </div>
      {(resolver || !disabled || it.datos?.pedido_id) && (
        <div className="flex flex-wrap justify-end items-center gap-2 mt-1">
          {it.datos?.pedido_id && <span className="text-[13px] text-gypi-green-ink font-semibold">✓ Pedido creado en Compras</span>}
          {pedir && !disabled && !it.datos?.pedido_id && (
            <button type="button" onClick={pedir} className="min-h-[44px] px-3 bg-transparent border-none text-gypi-cyan cursor-pointer text-[13px] font-semibold">
              🛒 Crear pedido
            </button>
          )}
          {resolver && (
            <button type="button" onClick={resolver} aria-pressed={!!it.resuelto_at}
              className="min-h-[44px] px-3 bg-transparent border-none text-gypi-green-ink cursor-pointer text-[13px] font-semibold">
              {it.resuelto_at ? "↺ Reabrir" : "✓ Resuelto"}
            </button>
          )}
          {!disabled && <button type="button" onClick={sacar} className="min-h-[44px] px-3 bg-transparent border-none text-gypi-red-ink cursor-pointer text-[13px]">🗑 Sacar renglón</button>}
        </div>
      )}
    </div>
  );
}

const fechaCorta = (f) => (f ? `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}` : "");

/**
 * Renglones para agregar con un toque: lo que Gypi sugiere (parte M2) o lo que
 * sigue abierto de minutas anteriores (parte M3).
 * opciones: [{ clave, nombre, detalle, valor }]
 */
function ParaAgregar({ titulo, label, opciones, onAgregar, alerta = false }) {
  const [abierto, setAbierto] = useState(true);
  if (!opciones.length) return null;
  return (
    <div className={`rounded-lg border border-dashed p-2 mb-2 ${alerta ? "border-gypi-amber" : "border-gypi-border"}`} aria-label={label} role="group">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="bg-transparent border-none cursor-pointer text-left text-[13px] font-semibold text-gypi-text min-h-[44px] px-1"
          aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
          {titulo} ({opciones.length}) {abierto ? "▾" : "▸"}
        </button>
        {opciones.length > 1 && <button type="button" className="g-btn g-btn-secondary" onClick={() => onAgregar(opciones.map((o) => o.valor))}>＋ Agregar todos</button>}
      </div>
      {abierto && (
        <ul className="list-none m-0 p-0">
          {opciones.map((o) => (
            <li key={o.clave} className="flex items-center gap-2 py-1 border-t border-gypi-border first:border-t-0">
              <span className="flex-1 min-w-0 text-[13px]">
                <span className="font-semibold">{o.nombre}</span>
                {o.detalle && <span className="block text-[12px] text-gypi-mute">{o.detalle}</span>}
              </span>
              <button type="button" className="g-btn g-btn-secondary" aria-label={`Agregar ${o.nombre}`} onClick={() => onAgregar([o.valor])}>＋</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Texto de una sugerencia de Gypi: "40 % · arranca hoy · Todo listo · entrega 6/11". */
function detalleSugerencia(x, s, hoy) {
  return [
    x.datos?.avance != null ? `${x.datos.avance} %` : "",
    x.datos?.arranca ? (x.datos.arranca === hoy ? "arranca hoy" : `arranca el ${fechaCorta(x.datos.arranca)}`) : "",
    x.datos?.listo ? LISTO.find((l) => l.id === x.datos.listo)?.label : "",
    x.texto || "",
    x.fecha_objetivo ? `${s.id === "prod_a_iniciar" ? "entrega" : "fecha"} ${fechaCorta(x.fecha_objetivo)}` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * Revisión del jueves (parte M3): el feedback de la última semana junto, por
 * área, para revisarlo entre todos. ✓ Revisado lo deja anotado.
 */
function RevisionFeedback({ abierto, hasta, onCerrar }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!abierto) return;
    setItems(null);
    const desde = new Date(Date.parse(`${hasta}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    apiFetch(`/api/minutas?feedback=${desde}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => setItems(ok ? j.items || [] : []))
      .catch(() => setItems([]));
  }, [abierto, hasta]);
  async function revisar(it) {
    const r = await apiFetch("/api/minutas", { method: "POST", body: JSON.stringify({ accion: "resolver", id: it.id, resuelto: !it.resuelto_at }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error || "No se pudo marcar"); return; }
    setItems((l) => l.map((x) => (x.id === it.id ? { ...x, resuelto_at: j.item?.resuelto_at ?? null } : x)));
  }
  const areas = [...new Set((items || []).map((it) => it.area || "Sin área"))];
  return (
    <Modal open={abierto} onClose={onCerrar} title="Revisión del jueves: feedback de la semana" maxWidth={640}>
      {items === null ? <div className="flex justify-center py-6"><Spinner /></div> : items.length === 0 ? (
        <p className="text-[14px] text-gypi-mute">No hubo feedback en los últimos 7 días.</p>
      ) : areas.map((area) => {
        const deArea = items.filter((it) => (it.area || "Sin área") === area);
        return (
          <section key={area} className="mb-3" aria-label={`Feedback para ${area}`}>
            <h3 className="text-[14px] font-bold m-0 mb-1">{area} <span className="font-normal text-gypi-mute text-[12px]">{deArea.filter((it) => it.resuelto_at).length} de {deArea.length} revisados</span></h3>
            {deArea.map((it) => (
              <div key={it.id} className={`flex items-center gap-2 py-2 border-t border-gypi-border ${it.resuelto_at ? "opacity-60" : ""}`}>
                <span className="flex-1 min-w-0 text-[13px]">
                  <span className="font-semibold">{[it.tipo, it.ot ? `OT ${it.ot}` : it.proyecto, it.cliente].filter(Boolean).join(" · ")}</span>
                  <span className="block">{it.texto}</span>
                  <span className="block text-[12px] text-gypi-mute">{[fechaCorta(it.fecha), it.responsable ? `lo trajo ${it.responsable}` : ""].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" className="g-btn g-btn-secondary whitespace-nowrap" aria-pressed={!!it.resuelto_at} onClick={() => revisar(it)}>
                  {it.resuelto_at ? "✓ Revisado" : "Revisar"}
                </button>
              </div>
            ))}
          </section>
        );
      })}
      <button type="button" className="g-btn g-btn-secondary w-full mt-2" onClick={onCerrar}>Cerrar</button>
    </Modal>
  );
}

/**
 * Modera / Registra: una persona del equipo de la empresa. Los participantes
 * de la reunión van primero. Un nombre viejo que no está en el equipo se
 * sigue mostrando para no perderlo.
 */
function ElegirPersona({ label, value, onChange, personas, participantes, disabled }) {
  const enReunion = new Set(participantes.map((p) => p.nombre));
  const primero = personas.filter((p) => enReunion.has(p.label));
  const resto = personas.filter((p) => !enReunion.has(p.label));
  const fuera = value && !personas.some((p) => p.label === value);
  return (
    <select className="g-input w-full" aria-label={label} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Elegí</option>
      {fuera && <option value={value}>{value}</option>}
      {primero.length > 0 && (
        <optgroup label="En la reunión">{primero.map((p) => <option key={p.valor} value={p.label}>{p.label}</option>)}</optgroup>
      )}
      {resto.length > 0 && (
        <optgroup label={primero.length ? "Resto del equipo" : "Equipo"}>{resto.map((p) => <option key={p.valor} value={p.label}>{p.label}</option>)}</optgroup>
      )}
    </select>
  );
}

/**
 * Participantes de la reunión: se tildan del equipo cargado en la empresa
 * (Equipo). El área es lo que cada uno cuenta; por defecto, su división.
 */
function EditarParticipantes({ abierto, inicial, personas, onCerrar, onGuardar }) {
  const [elegidos, setElegidos] = useState({});
  const [buscar, setBuscar] = useState("");
  useEffect(() => {
    if (!abierto) return;
    const m = {};
    for (const p of inicial) m[p.nombre] = { ...p };
    setElegidos(m);
    setBuscar("");
  }, [abierto, inicial]);
  const q = normal(buscar).trim();
  const equipo = personas.filter((p) => !q || normal(`${p.label} ${p.detalle || ""}`).includes(q));
  // Los que quedaron de antes y no están en el equipo: se pueden sacar
  const viejos = Object.values(elegidos).filter((p) => !personas.some((x) => x.label === p.nombre));
  const tildar = (p) => setElegidos((m) => {
    const n = { ...m };
    if (n[p.label]) delete n[p.label];
    else n[p.label] = { nombre: p.label, area: p.detalle || "", empleado_id: p.valor };
    return n;
  });
  const area = (nombre, v) => setElegidos((m) => ({ ...m, [nombre]: { ...m[nombre], area: v } }));
  const guardar = () => {
    const orden = [...personas.map((p) => p.label), ...viejos.map((p) => p.nombre)];
    onGuardar(participantesDe({ participantes: orden.filter((n) => elegidos[n]).map((n) => elegidos[n]) }));
  };
  return (
    <Modal open={abierto} onClose={onCerrar} title="Participantes de la reunión" maxWidth={560}>
      <p className="text-[13px] text-gypi-mute mt-0">Tildá del equipo a los que participan. El área es lo que cada uno cuenta (por ejemplo, Prod. muebles).</p>
      <input className="g-input w-full mb-2" aria-label="Buscar en el equipo" placeholder="Buscar en el equipo" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      {personas.length === 0 && <p className="text-[13px] text-gypi-mute">No hay personas activas en el equipo. Cargalas en Equipo.</p>}
      <ul className="list-none m-0 p-0 max-h-[50vh] overflow-y-auto" aria-label="Equipo">
        {equipo.map((p) => {
          const el = elegidos[p.label];
          return (
            <li key={p.valor} className="flex items-center gap-2 py-1 border-b border-gypi-border last:border-b-0">
              <label className="flex items-center gap-2 flex-1 min-w-0 min-h-[44px] cursor-pointer text-[14px]">
                <input type="checkbox" checked={!!el} onChange={() => tildar(p)} aria-label={`Participa ${p.label}`} />
                <span className="truncate">{p.label}</span>
              </label>
              {el && <input className="g-input !w-40" aria-label={`Área de ${p.label}`} placeholder="Área" value={el.area} maxLength={60} onChange={(e) => area(p.label, e.target.value)} />}
            </li>
          );
        })}
        {viejos.map((p) => (
          <li key={`v-${p.nombre}`} className="flex items-center gap-2 py-1 border-b border-gypi-border last:border-b-0">
            <span className="flex-1 min-w-0 text-[14px]">{p.nombre} <span className="text-[12px] text-gypi-mute">no está en el equipo</span></span>
            <button type="button" aria-label={`Sacar ${p.nombre}`} onClick={() => setElegidos((m) => { const n = { ...m }; delete n[p.nombre]; return n; })}
              className="min-h-[44px] min-w-[44px] bg-transparent border-none text-gypi-red-ink cursor-pointer">✕</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-3">
        <button type="button" className="g-btn g-btn-secondary flex-1" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="g-btn g-btn-primary flex-1" onClick={guardar}>Guardar ({Object.keys(elegidos).length})</button>
      </div>
    </Modal>
  );
}

const MINUTA_VACIA = { inicio: null, cierre: null, modera: "", registra: "", asistentes: [], notas: "", estado: "abierta" };

export default function MinutaScreen({ empresa = null }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(hoyArg());
  const [minuta, setMinuta] = useState(MINUTA_VACIA);
  const [items, setItems] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [cambios, setCambios] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [participantes, setParticipantes] = useState([]);
  const [editarGente, setEditarGente] = useState(false);
  const [otsCrudas, setOtsCrudas] = useState([]);
  const [sugeridos, setSugeridos] = useState(null);
  const [abiertos, setAbiertos] = useState([]);
  const [revisionAyer, setRevisionAyer] = useState(null);
  const [revision, setRevision] = useState(false);
  const [otrasListas, setOtrasListas] = useState({ personas: [], instaladores: [], articulos: [], proveedores: [], vehiculos: [] });
  const [configMinuta, setConfigMinuta] = useState(null);
  const { divisiones } = useAuth();
  // La división de la OT se guarda con su nombre (en proyectos puede estar el id)
  const listas = useMemo(() => ({
    ...otrasListas,
    ots: otsCrudas.map((p) => {
      const division = p.division ? nombreDivisionOt(divisiones || [], p.division) : null;
      const dato = { ...p, division };
      return { valor: p.ot, label: `OT ${p.ot}`, detalle: [p.descripcion || p.proyecto, p.cliente || p.obra, division, p.estado === "cerrado" ? "cerrada" : ""].filter(Boolean).join(" · "), dato };
    }),
    clientes: clientesDe(otsCrudas, configMinuta),
    tiposFeedback: tiposFeedbackDe(configMinuta),
    agregarCliente: (c) => agregarAConfig("clientes", c),
    agregarTipoFeedback: (t) => agregarAConfig("tipos_feedback", t),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [otsCrudas, otrasListas, divisiones, configMinuta]);

  // Lo que se elige en los buscadores: si alguna lista no se puede leer, se escribe a mano
  useEffect(() => {
    const leer = (p, o) => sbGetAll(p, o).then((r) => r.data || []).catch(() => []);
    Promise.all([
      leer("proyectos?select=ot,cliente,obra,proyecto,descripcion,division,estado&order=ot.desc", { maxFilas: 5000 }),
      leer("empleados?activo=eq.true&select=id,nombre,division&order=nombre.asc", { maxFilas: 2000 }),
      leer("articulos_stock?select=sku,nombre,unidad&order=nombre.asc", { maxFilas: 20000 }),
      leer("proveedores?select=id,nombre&order=nombre.asc", { maxFilas: 2000 }),
      leer("vehiculos?activo=eq.true&select=id,patente,marca,modelo&order=patente.asc", { maxFilas: 200 }),
      sb.get(`config_sistema?clave=eq.${CLAVE_CONFIG_MINUTA}&select=valor&limit=1`).catch(() => []),
      // Los marcados como instalador (116); sin la columna, la lista queda vacía y se usa "Otro…"
      leer("empleados?activo=eq.true&es_instalador=eq.true&select=id,nombre&order=nombre.asc", { maxFilas: 500 }),
    ]).then(([ots, personas, articulos, proveedores, vehiculos, config, instaladores]) => {
      // Las cerradas van al final: lo de hoy son casi siempre las abiertas
      const orden = [...ots].sort((a, b) => (a.estado === "cerrado") - (b.estado === "cerrado"));
      setOtsCrudas(orden);
      setOtrasListas({
        personas: personas.map((e) => ({ valor: e.id, label: e.nombre, detalle: e.division || "" })),
        instaladores: instaladores.map((e) => ({ valor: e.id, label: e.nombre })),
        articulos: articulos.map((a) => ({ valor: a.sku, label: a.nombre || a.sku, detalle: [a.sku, a.unidad].filter(Boolean).join(" · ") })),
        proveedores: proveedores.map((p) => ({ valor: String(p.id), label: p.nombre })),
        vehiculos: vehiculos.map((v) => ({ valor: String(v.id), label: [v.patente, v.marca, v.modelo].filter(Boolean).join(" ") })),
      });
      setParticipantes(participantesDe(config?.[0]?.valor));
      setConfigMinuta(config?.[0]?.valor || {});
    });
  }, []);

  const cargarHistorial = useCallback(async () => {
    const r = await apiFetch("/api/minutas").catch(() => null);
    const j = await r?.json().catch(() => null);
    if (r?.ok) setHistorial(j.minutas || []);
  }, []);

  const cargar = useCallback(async (dia) => {
    setCargando(true);
    try {
      const r = await apiFetch(`/api/minutas?fecha=${dia}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo leer la minuta");
      setMinuta(j.minuta ? { ...MINUTA_VACIA, ...j.minuta, modera: j.minuta.modera || "", registra: j.minuta.registra || "", notas: j.minuta.notas || "" } : MINUTA_VACIA);
      setItems((j.items || []).map((it) => ({ ...it, texto: it.texto || "", responsable: it.responsable || "", datos: it.datos || {} })));
      setCambios(false);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(fecha); }, [fecha, cargar]);
  // Lo que Gypi sugiere para ese día (parte M2); si no se puede leer, la minuta anda igual
  useEffect(() => {
    let vivo = true;
    setSugeridos(null);
    apiFetch(`/api/minutas?precarga=${fecha}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setSugeridos(j?.sugeridos || {}); })
      .catch(() => { if (vivo) setSugeridos({}); });
    // Revisión de la minuta anterior (155)
    setRevisionAyer(null);
    apiFetch(`/api/minutas?revision=${fecha}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setRevisionAyer(j || { anterior: null, items: [] }); })
      .catch(() => { if (vivo) setRevisionAyer({ anterior: null, items: [] }); });
    // Lo que sigue abierto de minutas anteriores (parte M3)
    setAbiertos([]);
    apiFetch(`/api/minutas?seguimiento=${fecha}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setAbiertos(j?.items || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [fecha]);
  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);
  // Al abrir la minuta, la revisión de la anterior ya viene cargada (una vez por día)
  const revisionPuesta = useRef(null);
  useEffect(() => {
    if (cargando || !revisionAyer || minuta.estado === "cerrada" || revisionPuesta.current === fecha) return;
    revisionPuesta.current = fecha;
    const nuevos = armarRevision({ anterior: revisionAyer.anterior, items: revisionAyer.items || [], pedidos: revisionAyer.pedidos || [], hoy: fecha, ya: items });
    if (nuevos.length) setItems((l) => [...nuevos, ...l]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, revisionAyer, fecha]);

  const cerrada = minuta.estado === "cerrada";
  const cambiarMinuta = (c) => { setMinuta((m) => ({ ...m, ...c })); setCambios(true); };
  const cambiarItem = (id, c) => { setItems((l) => l.map((it) => (it.id === id ? { ...it, ...c } : it))); setCambios(true); };
  const sacarItem = (id) => { setItems((l) => l.filter((it) => it.id !== id)); setCambios(true); };
  const agregar = (seccionId, extra = {}) => {
    setItems((l) => [...l, renglonNuevo(seccionId, seccionId === "compra" ? { tipo: "normal", ...extra } : extra)]);
    setCambios(true);
  };
  const otDe = (ot) => listas.ots.find((o) => o.valor === ot)?.dato || null;
  const agregarSugeridos = (seccionId, lista) => {
    setItems((l) => [...l, ...lista.map((x) => {
      const p = otDe(x.ot);
      return renglonNuevo(seccionId, {
        ...(p ? datosDeOt(p) : { ot: x.ot }),
        texto: x.texto || "", semaforo: x.semaforo || null, ...(x.tipo ? { tipo: x.tipo } : {}), fecha_objetivo: x.fecha_objetivo || null, datos: { ...(x.datos || {}) },
      });
    })]);
    setCambios(true);
  };
  const agregarQueSiguen = (lista) => {
    setItems((l) => [...l, ...lista.map((it) => renglonQueSigue(it, it.fecha))]);
    setCambios(true);
  };
  // ✓ Resuelto: se anota en el momento (también con la minuta cerrada); no pasa más al día siguiente
  async function resolver(it) {
    const resuelto = !it.resuelto_at;
    const r = await apiFetch("/api/minutas", { method: "POST", body: JSON.stringify({ accion: "resolver", id: it.id, resuelto }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error || "No se pudo marcar"); return; }
    setItems((l) => l.map((x) => (x.id === it.id ? { ...x, resuelto_at: j.item?.resuelto_at ?? null } : x)));
    toast.success(resuelto ? "✓ Marcado como resuelto" : "Vuelve a quedar abierto");
  }
  // 🛒 Crear pedido (parte M4): la compra pasa a Compras → Pedidos como un pedido de material
  const conCompras = tieneModulo(empresa, "compras");
  async function crearPedido(it) {
    const body = pedidoDesdeMinuta(it, fecha);
    if (body.error) { toast.error(body.error); return; }
    const r = await apiFetch("/api/compras", { method: "POST", body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { toast.error(j.error || "No se pudo crear el pedido"); return; }
    cambiarItem(it.id, { datos: { ...it.datos, pedido_id: j.pedido?.id ?? true } });
    toast.success("🛒 Pedido creado en Compras. Guardá la minuta para que quede anotado.");
  }
  const asistio = (nombre) => cambiarMinuta({ asistentes: minuta.asistentes.includes(nombre) ? minuta.asistentes.filter((n) => n !== nombre) : [...minuta.asistentes, nombre] });

  const elegirFecha = (dia) => {
    if (!dia || dia === fecha) return;
    if (cambios && !window.confirm("Hay cambios sin guardar en esta minuta. ¿Cambiar de día igual?")) return;
    setFecha(dia);
  };

  async function guardar({ cerrar = false } = {}) {
    const faltan = faltantesMinuta(items);
    if (faltan.length) { toast.error(faltan[0]); return; }
    setGuardando(true);
    try {
      const body = {
        accion: "guardar", fecha, cerrar,
        minuta: {
          inicio: minuta.inicio ? hora(minuta.inicio) : null, cierre: minuta.cierre ? hora(minuta.cierre) : null,
          modera: minuta.modera || null, registra: minuta.registra || null, asistentes: minuta.asistentes, notas: minuta.notas || null,
        },
        items: renglonesParaGuardar(items),
      };
      const r = await apiFetch("/api/minutas", { method: "POST", body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      setMinuta({ ...MINUTA_VACIA, ...j.minuta, modera: j.minuta.modera || "", registra: j.minuta.registra || "", notas: j.minuta.notas || "" });
      setItems((j.items || []).map((it) => ({ ...it, texto: it.texto || "", responsable: it.responsable || "", datos: it.datos || {} })));
      setCambios(false);
      if (j.aviso) toast.error(j.aviso);
      else toast.success(cerrar ? "✅ Minuta cerrada" : "✅ Minuta guardada");
      cargarHistorial();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function reabrir() {
    const r = await apiFetch("/api/minutas", { method: "POST", body: JSON.stringify({ accion: "reabrir", fecha }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error || "No se pudo reabrir"); return; }
    setMinuta((m) => ({ ...m, estado: "abierta" }));
    toast.success("La minuta quedó abierta para corregirla");
  }

  // La configuración de la minuta (participantes, clientes y tipos agregados) se relee antes de escribir
  async function guardarConfig(cambiar) {
    const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_CONFIG_MINUTA}&select=valor&limit=1`);
    const valor = cambiar(rows?.[0]?.valor || {});
    if (rows?.length) await sb.patch(`config_sistema?clave=eq.${CLAVE_CONFIG_MINUTA}`, { valor });
    else await sb.post("config_sistema", { clave: CLAVE_CONFIG_MINUTA, valor });
    setConfigMinuta(valor);
    return valor;
  }

  async function guardarParticipantes(lista) {
    try {
      await guardarConfig((v) => ({ ...v, participantes: lista }));
      setParticipantes(lista);
      setEditarGente(false);
      toast.success("✅ Participantes guardados");
    } catch (e) {
      toast.error(`No se pudo guardar: ${e.message}`);
    }
  }

  // "Agregar nuevo cliente" y el tipo "Otro" del feedback quedan en la lista para la próxima
  async function agregarAConfig(clave, texto) {
    try {
      await guardarConfig((v) => ({ ...v, [clave]: listaUnica(Array.isArray(v[clave]) ? v[clave] : [], [texto]) }));
      toast.success(clave === "clientes" ? `✅ Cliente "${texto}" agregado` : `✅ Tipo "${texto}" agregado a la lista`);
    } catch (e) {
      toast.error(`No se pudo agregar: ${e.message}`);
    }
  }

  const imprimir = () => {
    try {
      imprimirMinuta({ empresa: empresa?.nombre || "", minuta: { ...minuta, fecha }, items: renglonesParaGuardar(items), participantes });
    } catch (e) { toast.error(e.message); }
  };

  const presentes = [...participantes.map((p) => p.nombre), ...minuta.asistentes.filter((n) => !participantes.some((p) => p.nombre === n))];
  const duracion = duracionMinutos(minuta.inicio && hora(minuta.inicio), minuta.cierre && hora(minuta.cierre));
  const de = (id) => items.filter((it) => it.seccion === id);

  if (error) {
    return <div className="flex-1 p-4"><div className="g-card p-4 text-[14px]" role="alert">{error}</div></div>;
  }

  const listaSeccion = (s) => (
    <div key={s.id} className="mb-3">
      {s.letra && <h3 className="text-[14px] font-bold m-0 mt-2">{s.letra}. {s.titulo}</h3>}
      {s.ayuda && <p className="text-[12px] text-gypi-mute m-0 mb-2">{s.ayuda}</p>}
      {s.id === "prod_en_curso" && (
        <p className="text-[13px] m-0 mb-2">Proyectos en producción hoy: <b>{sugeridos?.prod_en_curso ? Math.max(sugeridos.prod_en_curso.length, de(s.id).length) : de(s.id).length}</b> en total.</p>
      )}
      {!cerrada && (
        <ParaAgregar titulo={`↩ Sigue abierto de minutas anteriores`} label={`Sigue abierto en ${s.titulo}`} alerta
          opciones={seguimientoPendiente(abiertos, items, s.id).map((it) => ({
            clave: it.id,
            nombre: [it.ot ? `OT ${it.ot}` : "", it.proyecto, it.cliente].filter(Boolean).join(" · ") || it.texto || "Sin detalle",
            detalle: [`del ${fechaCorta(it.fecha)}`, it.texto, it.responsable, it.fecha_objetivo ? `fecha ${fechaCorta(it.fecha_objetivo)}` : ""].filter(Boolean).join(" · "),
            valor: it,
          }))}
          onAgregar={agregarQueSiguen} />
      )}
      {!cerrada && sugeridos && (
        <ParaAgregar titulo="✨ Gypi sugiere" label={`Gypi sugiere para ${s.titulo}`}
          opciones={sugerenciasPendientes(sugeridos, items, s.id).map((x) => {
            if (s.id === "compra") {
              const nombre = [x.texto, textoCantidad(x)].filter(Boolean).join(" · ");
              const detalle = [x.tipo === "urgente" ? "🔴 Urgente" : "", x.ot ? `OT ${x.ot}` : x.datos?.ots ? `OT ${x.datos.ots}` : ""].filter(Boolean).join(" · ");
              return { clave: x.clave, nombre, detalle, valor: x };
            }
            const p = datosDeOt(otDe(x.ot));
            return { clave: x.clave, nombre: [`OT ${x.ot}`, p.proyecto, p.cliente].filter(Boolean).join(" · "), detalle: detalleSugerencia(x, s, fecha), valor: x };
          })}
          onAgregar={(l) => agregarSugeridos(s.id, l)} />
      )}
      {de(s.id).map((it) => (
        <Renglon key={it.id} s={s} it={it} listas={listas} disabled={cerrada} cambiar={(c) => cambiarItem(it.id, c)} sacar={() => sacarItem(it.id)}
          resolver={SECCIONES_SEGUIMIENTO.includes(s.id) && it.created_at ? () => resolver(it) : null}
          pedir={s.id === "compra" && conCompras ? () => crearPedido(it) : null} />
      ))}
      {!cerrada && <button type="button" className="g-btn g-btn-secondary" onClick={() => agregar(s.id)} aria-label={`Agregar a ${s.titulo}`}>＋ Agregar</button>}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 pb-28">
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <Campo label="Día de la minuta">
            <input type="date" className="g-input w-full" aria-label="Día de la minuta" value={fecha} onChange={(e) => elegirFecha(e.target.value)} />
          </Campo>
          {historial.length > 0 && (
            <Campo label="Minutas anteriores">
              <select className="g-input w-full" aria-label="Minutas anteriores" value="" onChange={(e) => elegirFecha(e.target.value)}>
                <option value="">Elegí un día</option>
                {historial.map((m) => (
                  <option key={m.id} value={m.fecha}>{String(m.fecha).split("-").reverse().join("/")}{m.estado === "cerrada" ? " · cerrada" : " · abierta"}</option>
                ))}
              </select>
            </Campo>
          )}
          {cerrada && <span className="text-[13px] font-semibold text-gypi-green-ink py-3">✅ Cerrada{minuta.modera ? ` · firmó ${minuta.modera}` : ""}</span>}
        </div>

        {cargando ? <div className="flex justify-center py-10"><Spinner /></div> : (
          <>
            <section className="g-card p-3 mb-3" aria-label="Cabecera">
              <h2 className="text-[16px] font-bold m-0 mb-2">Minuta — Reunión de Buenos Días <span className="text-[13px] font-normal text-gypi-mute">8:45 a 9:05 hs</span></h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <Campo label="Inicio" div>
                  {minuta.inicio ? <span className="text-[16px] font-bold text-gypi-text py-2">{hora(minuta.inicio)}</span> : (
                    <button type="button" className="g-btn g-btn-primary" disabled={cerrada} onClick={() => cambiarMinuta({ inicio: hora(new Date()) })}>▶ Empezar</button>
                  )}
                </Campo>
                <Campo label="Cierre" div>
                  <span className="text-[16px] font-bold text-gypi-text py-2">{minuta.cierre ? `${hora(minuta.cierre)}${duracion != null ? ` · ${duracion} min` : ""}` : "—"}</span>
                </Campo>
                <Campo label="Modera">
                  <ElegirPersona label="Modera" value={minuta.modera} disabled={cerrada} personas={listas.personas} participantes={participantes} onChange={(v) => cambiarMinuta({ modera: v })} />
                </Campo>
                <Campo label="Registra">
                  <ElegirPersona label="Registra" value={minuta.registra} disabled={cerrada} personas={listas.personas} participantes={participantes} onChange={(v) => cambiarMinuta({ registra: v })} />
                </Campo>
              </div>
            </section>

            <section className="g-card p-3 mb-3" aria-label="Asistencia">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-[15px] font-bold m-0">Asistencia</h2>
                <button type="button" className="g-btn g-btn-secondary" onClick={() => setEditarGente(true)}>⚙ Participantes</button>
              </div>
              {presentes.length === 0 ? (
                <p className="text-[13px] text-gypi-mute m-0">Elegí del equipo a los que participan con ⚙ Participantes.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {presentes.map((n) => {
                    const area = participantes.find((p) => p.nombre === n)?.area;
                    return <Chip key={n} active={minuta.asistentes.includes(n)} disabled={cerrada} onClick={() => asistio(n)}>{minuta.asistentes.includes(n) ? "✓ " : ""}{n}{area ? ` · ${area}` : ""}</Chip>;
                  })}
                </div>
              )}
            </section>

            <RevisionAyer items={items} anterior={revisionAyer?.anterior} disabled={cerrada} cambiar={cambiarItem} sacar={sacarItem} />

            {BLOQUES.map((b) => (
              <section key={b.id} className="g-card p-3 mb-3" aria-label={b.titulo}>
                <h2 className="text-[15px] font-bold m-0">{b.numero ? `${b.numero} · ` : ""}{b.titulo} {b.horario && <span className="text-[12px] font-normal text-gypi-mute">{b.horario}</span>}</h2>
                {b.ayuda && <p className="text-[12px] text-gypi-mute m-0 mb-2">{b.ayuda}</p>}
                {b.id === "feedback" && <button type="button" className="g-btn g-btn-secondary mb-2" onClick={() => setRevision(true)}>🗂 Revisión del jueves</button>}
                {b.id === "dyt" ? AREAS_DYT.map((a) => {
                  const s = seccionesDe("dyt")[0];
                  const deArea = de("dyt").filter((it) => it.area === a.id);
                  return (
                    <div key={a.id} className="mb-3">
                      <h3 className="text-[14px] font-bold m-0 mt-2">{a.label} <span className="font-normal text-[12px] text-gypi-mute">{a.detalle}</span></h3>
                      {deArea.length === 0 && <p className="text-[12px] text-gypi-mute m-0 mb-1">Sin cambios</p>}
                      {deArea.map((it) => <Renglon key={it.id} s={s} it={it} listas={listas} disabled={cerrada} cambiar={(c) => cambiarItem(it.id, c)} sacar={() => sacarItem(it.id)} />)}
                      {!cerrada && <button type="button" className="g-btn g-btn-secondary" aria-label={`Agregar a ${a.label}`} onClick={() => agregar("dyt", { area: a.id, tipo: "en_curso" })}>＋ Agregar</button>}
                    </div>
                  );
                }) : seccionesDe(b.id).map(listaSeccion)}
              </section>
            ))}

            <section className="g-card p-3 mb-3" aria-label="Notas libres">
              <h2 className="text-[15px] font-bold m-0 mb-2">Notas libres <span className="text-[12px] font-normal text-gypi-mute">opcional</span></h2>
              <textarea className="g-input w-full min-h-[96px]" aria-label="Notas libres" value={minuta.notas || ""} maxLength={4000} disabled={cerrada}
                onChange={(e) => cambiarMinuta({ notas: e.target.value })} placeholder="Cualquier cosa que no entre arriba." />
            </section>

            <CalendarioMinuta items={items} fecha={fecha} />
          </>
        )}
      </div>

      {!cargando && (
        <div className="sticky bottom-0 border-t border-gypi-border bg-gypi-bg px-3 py-2">
          <div className="max-w-5xl mx-auto flex gap-2">
            {cerrada ? (
              <button type="button" className="g-btn g-btn-secondary flex-1 whitespace-nowrap" onClick={reabrir}>✏ Reabrir</button>
            ) : (
              <>
                <button type="button" className="g-btn g-btn-primary flex-1 whitespace-nowrap" disabled={guardando} onClick={() => guardar()}>{guardando ? "Guardando…" : cambios ? "💾 Guardar" : "💾 Guardado"}</button>
                <button type="button" className="g-btn g-btn-secondary flex-1 whitespace-nowrap" disabled={guardando}
                  onClick={() => { if (window.confirm("¿Cerrar la minuta? Queda anotada la hora de cierre y firmada por el moderador.")) guardar({ cerrar: true }); }}>■ Cerrar</button>
              </>
            )}
            <button type="button" className="g-btn g-btn-secondary flex-1 whitespace-nowrap" onClick={imprimir} aria-label="Imprimir o PDF">🖨 PDF</button>
          </div>
        </div>
      )}

      <RevisionFeedback abierto={revision} hasta={fecha} onCerrar={() => setRevision(false)} />
      <EditarParticipantes abierto={editarGente} inicial={participantes} personas={listas.personas} onCerrar={() => setEditarGente(false)} onGuardar={guardarParticipantes} />
    </div>
  );
}
