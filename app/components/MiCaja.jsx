'use client';
// app/components/MiCaja.jsx — "📱 Mi caja" (Finanzas, parte F3b; migración
// 176; /api/mi-caja; reglas en app/lib/finanzasMiCaja.js). Lo ve quien es
// responsable de una caja, en el Inicio del celular o en el Panel de la
// oficina: el saldo, lo último que se movió y dos botones, "Gasté" y
// "Recibí plata". Lo que carga entra a su caja en el momento y le queda al
// dueño para revisar. Mientras el dueño no lo revisó lo puede anular.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { numero, plata } from "../lib/finanzasOperaciones";
import Modal from "./ui/Modal";
import SelectBuscable from "./ui/SelectBuscable";
import BotonFoto from "./BotonFoto";
import { Chip } from "./ui";
import { ayerDe, conceptosPorUso } from "../lib/finanzasMiCaja";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");

/** El detalle de un movimiento sin repetir el concepto ni el nombre de la
 *  caja (lo que anotó el que lo cargó, o "De Caja Principal a …"). 10/11 */
export function detalleMovimiento(m, nombreCaja = "") {
  const fuera = new Set([String(m.concepto || "").trim(), String(nombreCaja || "").trim()]);
  return String(m.descripcion || "").split(" · ").map((x) => x.trim()).filter((x) => x && !fuera.has(x)).join(" · ");
}

/** Las cajas a cargo del empleado. Sin cajas devuelve una lista vacía. */
export function useMiCaja(activo = true) {
  const [datos, setDatos] = useState({ cajas: [] });
  const cargar = useCallback(async () => {
    if (!activo) return;
    try {
      const res = await apiFetch("/api/mi-caja");
      if (!res.ok) return;
      const d = await res.json().catch(() => null);
      if (Array.isArray(d?.cajas)) setDatos(d);
    } catch { /* sin señal: queda lo último */ }
  }, [activo]);
  useEffect(() => { cargar(); }, [cargar]);
  return { ...datos, cargar };
}

/** Texto corto para el botón: el saldo de cada caja y lo que tiene que confirmar. */
export function detalleMiCaja(cajas = [], paraConfirmar = []) {
  const saldos = cajas.map((c) => `${cajas.length > 1 ? `${c.nombre}: ` : "Saldo "}${plata(c.saldo, c.moneda)}`).join(" · ");
  const revisar = cajas.reduce((n, c) => n + c.para_revisar, 0);
  const n = paraConfirmar?.length || 0;
  return `${n ? `💸 ${n === 1 ? "1 pase" : `${n} pases`} para confirmar · ` : ""}${saldos}${revisar ? ` · ${revisar} sin revisar` : ""}`;
}

/** Pasarle plata a otra persona: queda esperando que la otra confirme (10/11). */
function Pasar({ caja, hoy, onCerrar, onHecho }) {
  const [f, setF] = useState({ hacia: caja.destinos.length === 1 ? caja.destinos[0].cuenta : "", importe: "", fecha: hoy, descripcion: "", tipo_cambio: "" });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const usd = caja.moneda === "USD";
  const destino = caja.destinos.find((d) => d.cuenta === f.hacia);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const res = await apiFetch("/api/mi-caja", {
        method: "POST",
        body: JSON.stringify({ accion: "pasar", cuenta: caja.cuenta, ...f, importe: numero(f.importe), tipo_cambio: usd ? numero(f.tipo_cambio) : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      onHecho(destino?.persona);
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const campo = (label, input) => <label className="flex flex-col gap-1 text-[14px] font-semibold text-gypi-text">{label}{input}</label>;
  return (
    <Modal open onClose={onCerrar} title="Le pasé plata a…" maxWidth={480}>
      <div className="flex flex-col gap-3">
        {campo("¿A quién?", (
          <SelectBuscable className="g-input w-full" aria-label="A quién" value={f.hacia} onChange={set("hacia")}>
            <option value="">Elegí…</option>
            {caja.destinos.map((d) => <option key={d.cuenta} value={d.cuenta}>{d.persona} ({d.nombre})</option>)}
          </SelectBuscable>
        ))}
        <div className="flex flex-wrap gap-2">
          {campo(usd ? "Importe (USD)" : "Importe", <input className="g-input w-[160px] text-right font-mono" inputMode="decimal" aria-label="Importe" value={f.importe} onChange={set("importe")} />)}
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha" max={hoy} value={f.fecha} onChange={set("fecha")} />)}
          {usd && campo("Tipo de cambio", <input className="g-input w-[120px]" inputMode="decimal" aria-label="Tipo de cambio" value={f.tipo_cambio} onChange={set("tipo_cambio")} />)}
        </div>
        {campo("Detalle (opcional)", <input className="g-input w-full" aria-label="Detalle" maxLength={200} placeholder="Ej.: para gastos de la obra" value={f.descripcion} onChange={set("descripcion")} />)}
        <p className="m-0 text-[13px] text-gypi-dim">
          {destino ? `A ${destino.persona} le llega un aviso. ` : ""}La plata sale de tu caja cuando {destino ? destino.persona : "la otra persona"} confirme que la recibió.
        </p>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !f.hacia || !f.importe} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

const MAX_CHIPS = 8;

/** Gasté / Recibí plata (parte 10 del 11/11: muy fácil). Primero la foto del
 *  ticket (Gypi lee importe, fecha y concepto), los conceptos en botones con
 *  los más usados primero y la fecha en Hoy / Ayer / Otro día. */
function Cargar({ caja, clase, conceptos, hoy, onCerrar, onHecho }) {
  const gasto = clase === "gasto";
  const lista = conceptosPorUso(gasto ? conceptos.gastos : conceptos.ingresos, caja.movimientos);
  const [f, setF] = useState({ concepto: lista.length === 1 ? lista[0].codigo : "", importe: "", fecha: hoy, descripcion: "", tipo_cambio: "", comprobante_url: "" });
  const [otroDia, setOtroDia] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const usd = caja.moneda === "USD";
  const ayer = ayerDe(hoy);
  const chips = lista.length > MAX_CHIPS ? lista.slice(0, MAX_CHIPS - 1) : lista;
  const resto = lista.length > MAX_CHIPS ? lista.slice(MAX_CHIPS - 1) : [];
  const elegido = lista.find((c) => c.codigo === f.concepto);

  async function conFoto(url) {
    setF((x) => ({ ...x, comprobante_url: url }));
    if (!gasto) return;
    setLeyendo(true);
    setLectura(null);
    try {
      const res = await apiFetch("/api/mi-caja", { method: "POST", body: JSON.stringify({ accion: "leer_ticket", cuenta: caja.cuenta, comprobante_url: url }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo leer el ticket");
      setF((x) => ({
        ...x,
        importe: x.importe || (d.importe ? String(d.importe).replace(".", ",") : ""),
        fecha: d.fecha && x.fecha === hoy ? d.fecha : x.fecha,
        concepto: x.concepto || d.concepto || "",
        descripcion: x.descripcion || d.descripcion || "",
      }));
      if (d.fecha && d.fecha !== hoy && d.fecha !== ayer) setOtroDia(true);
      setLectura(d.importe || d.fecha || d.concepto ? "✓ Leí el ticket: revisá que esté bien." : "No pude leer el ticket: completalo a mano.");
    } catch (e) {
      setLectura(`${e.message}`);
    }
    setLeyendo(false);
  }

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const res = await apiFetch("/api/mi-caja", {
        method: "POST",
        body: JSON.stringify({ accion: "cargar", cuenta: caja.cuenta, clase, ...f, importe: numero(f.importe), tipo_cambio: usd ? numero(f.tipo_cambio) : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const campo = (label, input) => <label className="flex flex-col gap-1 text-[14px] font-semibold text-gypi-text">{label}{input}</label>;
  const titulo = (t) => <span className="block mb-1 text-[14px] font-semibold text-gypi-text">{t}</span>;
  return (
    <Modal open onClose={onCerrar} title={gasto ? "Cargar un gasto" : "Plata que recibí"} maxWidth={480}>
      <div className="flex flex-col gap-3">
        {!lista.length ? (
          <p className="m-0 text-[14px] text-gypi-text">Todavía no hay nada para elegir: pedile al dueño que lo arme en Finanzas → Cajas y bancos → ⚙ Mi caja.</p>
        ) : (
          <>
            {f.comprobante_url ? (
              <div className="flex items-center gap-2">
                <img src={f.comprobante_url} alt="Foto del ticket" className="w-16 h-16 object-cover rounded-lg border border-gypi-border" />
                <span className="flex-1 text-[13px] text-gypi-dim" role="status">{leyendo ? "Leyendo el ticket…" : lectura}</span>
                <button type="button" className="g-btn g-btn-secondary" onClick={() => { setF((x) => ({ ...x, comprobante_url: "" })); setLectura(null); }}>Sacar la foto</button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <BotonFoto label={gasto ? "📷 Sacar foto del ticket" : "📷 Foto del comprobante (opcional)"} onFoto={conFoto} />
                {gasto && <span className="text-[12px] text-gypi-dim">Gypi lee el importe y la fecha. Si no tenés ticket, completá abajo.</span>}
              </div>
            )}
            <div role="group" aria-label="Concepto">
              {titulo(gasto ? "¿En qué?" : "¿De dónde vino?")}
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <Chip key={c.codigo} type="button" active={f.concepto === c.codigo} onClick={() => setF((x) => ({ ...x, concepto: c.codigo }))}>{c.nombre}</Chip>
                ))}
              </div>
              {resto.length > 0 && (
                <SelectBuscable className="g-input w-full mt-1.5" aria-label="Otro concepto" value={resto.some((c) => c.codigo === f.concepto) ? f.concepto : ""} onChange={set("concepto")}>
                  <option value="">Otro…</option>
                  {resto.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                </SelectBuscable>
              )}
              {elegido?.leyenda && <p className="mt-1 mb-0 text-[12px] leading-snug text-gypi-dim">ℹ {elegido.leyenda}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {campo(usd ? "Importe (USD)" : "Importe", <input className="g-input w-[180px] text-right font-mono text-[18px]" inputMode="decimal" aria-label="Importe" placeholder="0" value={f.importe} onChange={set("importe")} />)}
              {usd && campo("Tipo de cambio", <input className="g-input w-[120px]" inputMode="decimal" aria-label="Tipo de cambio" value={f.tipo_cambio} onChange={set("tipo_cambio")} />)}
            </div>
            <div role="group" aria-label="Fecha">
              {titulo("¿Cuándo?")}
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip type="button" active={!otroDia && f.fecha === hoy} onClick={() => { setOtroDia(false); setF((x) => ({ ...x, fecha: hoy })); }}>Hoy</Chip>
                <Chip type="button" active={!otroDia && f.fecha === ayer} onClick={() => { setOtroDia(false); setF((x) => ({ ...x, fecha: ayer })); }}>Ayer</Chip>
                <Chip type="button" active={otroDia} onClick={() => setOtroDia(true)}>Otro día</Chip>
                {otroDia && <input type="date" className="g-input" aria-label="Fecha del movimiento" max={hoy} value={f.fecha} onChange={set("fecha")} />}
              </div>
            </div>
            {campo("Detalle (opcional)", <input className="g-input w-full" aria-label="Detalle" maxLength={300} placeholder={gasto ? "Ej.: nafta camioneta" : "Ej.: me la dio Tadeo"} value={f.descripcion} onChange={set("descripcion")} />)}
          </>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          {lista.length > 0 && <button type="button" className="g-btn g-btn-primary" disabled={guardando || leyendo || !f.concepto || !f.importe} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>}
        </div>
      </div>
    </Modal>
  );
}

/** La pantalla de Mi caja: saldo, Gasté / Recibí plata y los últimos movimientos. */
export default function MiCaja({ datos, onClose, onCambio }) {
  const [elegida, setElegida] = useState(datos.cajas[0]?.cuenta || "");
  const [cargar, setCargar] = useState(null);
  const [pasar, setPasar] = useState(false);
  const [resolviendo, setResolviendo] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const caja = datos.cajas.find((c) => c.cuenta === elegida) || datos.cajas[0];
  if (!caja) return null;

  async function anular(id) {
    setError(null);
    try {
      const res = await apiFetch("/api/mi-caja", { method: "POST", body: JSON.stringify({ accion: "anular", id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo anular");
      setAviso("Listo: lo anulaste");
      onCambio();
    } catch (e) {
      setError(e.message);
    }
  }

  async function resolver(id, accion) {
    setError(null);
    setAviso(null);
    setResolviendo(id);
    try {
      const res = await apiFetch("/api/mi-caja", { method: "POST", body: JSON.stringify({ accion, id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      setAviso(accion === "recibir" ? "Listo: la plata ya está en tu caja" : accion === "rechazar" ? "Avisamos que no la recibiste: no se anotó nada" : "Cancelaste el pase");
      onCambio();
    } catch (e) {
      setError(e.message);
    } finally {
      setResolviendo(null);
    }
  }

  const paraConfirmar = datos.para_confirmar || [];
  const esperando = (datos.esperando || []).filter((p) => p.desde === caja.cuenta);
  const destinos = caja.destinos || [];

  return (
    <Modal open onClose={onClose} title="📱 Mi caja" maxWidth={520}>
      <div className="flex flex-col gap-3 text-gypi-text">
        {paraConfirmar.map((p) => (
          <section key={p.id} aria-label="Pase para confirmar" className="p-3 rounded-[14px] bg-gypi-amber/10 border border-gypi-amber/30 flex flex-col gap-2">
            <p className="m-0 text-[15px] font-bold">💸 {p.de_nombre} te pasó {plata(p.importe, p.moneda)}</p>
            <p className="m-0 text-[13px] text-gypi-dim">El {fechaCorta(p.fecha)}{datos.cajas.length > 1 ? ` · a ${datos.cajas.find((c) => c.cuenta === p.hacia)?.nombre || "tu caja"}` : ""}{p.nota ? ` · ${p.nota}` : ""}. ¿La recibiste?</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="g-btn g-btn-primary min-h-[48px]" disabled={resolviendo === p.id} onClick={() => resolver(p.id, "recibir")}>✓ Sí, la recibí</button>
              <button type="button" className="g-btn g-btn-secondary min-h-[48px]" disabled={resolviendo === p.id} onClick={() => resolver(p.id, "rechazar")}>No la recibí</button>
            </div>
          </section>
        ))}
        {datos.cajas.length > 1 && (
          <SelectBuscable className="g-input w-full" aria-label="Caja" value={caja.cuenta} onChange={(e) => setElegida(e.target.value)}>
            {datos.cajas.map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}</option>)}
          </SelectBuscable>
        )}
        <div>
          <div className="text-[14px] text-gypi-dim">{caja.nombre}</div>
          <div className={`text-[30px] font-extrabold font-mono ${caja.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(caja.saldo, caja.moneda)}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="g-btn g-btn-primary min-h-[56px] text-[16px]" onClick={() => { setAviso(null); setCargar("gasto"); }}>➖ Gasté</button>
          <button type="button" className="g-btn g-btn-secondary min-h-[56px] text-[16px]" onClick={() => { setAviso(null); setCargar("ingreso"); }}>➕ Recibí plata</button>
          {destinos.length > 0 && (
            <button type="button" className="g-btn g-btn-secondary min-h-[48px] text-[15px] col-span-2" onClick={() => { setAviso(null); setPasar(true); }}>⇄ Le pasé plata a…</button>
          )}
        </div>
        {esperando.map((p) => (
          <p key={p.id} className="m-0 text-[13px] text-gypi-amber-ink font-semibold">
            ⏳ Esperando que {p.para_nombre} confirme {plata(p.importe, p.moneda)} ({fechaCorta(p.fecha)}){" "}
            <button type="button" className="ml-1 text-[12px] text-gypi-red underline bg-transparent border-none p-0 cursor-pointer" disabled={resolviendo === p.id} onClick={() => resolver(p.id, "cancelar")}>Cancelar</button>
          </p>
        ))}
        {aviso && <p role="status" className="m-0 text-[14px] text-gypi-green-ink font-semibold">✓ {aviso}</p>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <h3 className="m-0 mt-1 text-[14px] font-bold text-gypi-dim">Últimos movimientos</h3>
        {caja.movimientos.length ? (
          <ul className="list-none m-0 p-0 flex flex-col" aria-label="Movimientos de mi caja">
            {caja.movimientos.map((m) => (
              <li key={m.id} className="py-2 border-b border-gypi-border last:border-b-0 flex items-start gap-2 text-[14px]">
                <span className="font-mono text-[12px] text-gypi-dim pt-0.5">{fechaCorta(m.fecha)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold">{m.concepto}</span>
                  {detalleMovimiento(m, caja.nombre) && <span className="block text-[13px] text-gypi-dim break-words">{detalleMovimiento(m, caja.nombre)}</span>}
                  {m.estado === "para_revisar" && <span className="block text-[12px] text-gypi-amber-ink font-semibold">Falta que el dueño lo revise</span>}
                  {m.comprobante_url && <a href={m.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-gypi-cyan underline">🧾 Ticket</a>}
                  {m.propia && m.estado === "para_revisar" && (
                    <button type="button" className="ml-2 text-[12px] text-gypi-red underline bg-transparent border-none p-0 cursor-pointer" onClick={() => anular(m.id)}>Anular</button>
                  )}
                </span>
                <span className={`font-mono font-semibold ${m.sale ? "text-gypi-red" : "text-gypi-green-ink"}`}>{m.sale ? `−${plata(m.sale, caja.moneda)}` : `+${plata(m.entra, caja.moneda)}`}</span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-[14px] text-gypi-dim">Todavía no hay movimientos.</p>}
      </div>
      {pasar && (
        <Pasar caja={{ ...caja, destinos }} hoy={datos.hoy}
          onCerrar={() => setPasar(false)}
          onHecho={(persona) => { setPasar(false); setAviso(`Listo: cuando ${persona || "la otra persona"} confirme que la recibió, sale de tu caja`); onCambio(); }} />
      )}
      {cargar && (
        <Cargar caja={caja} clase={cargar} conceptos={datos.conceptos || { gastos: [], ingresos: [] }} hoy={datos.hoy}
          onCerrar={() => setCargar(null)}
          onHecho={() => { setCargar(null); setAviso(`${cargar === "gasto" ? "Gasto cargado" : "Plata recibida cargada"}: ya cuenta en tu saldo y el dueño lo va a revisar`); onCambio(); }} />
      )}
    </Modal>
  );
}
