'use client';
// app/components/MiCaja.jsx — "📱 Mi caja" (Finanzas, parte F3b; migración
// 176; /api/mi-caja; reglas en app/lib/finanzasMiCaja.js). Lo ve quien es
// responsable de una caja, en el Inicio del celular o en el Panel de la
// oficina: el saldo, lo último que se movió y dos botones, "Gasté" y
// "Recibí plata". Lo que carga entra a su caja en el momento y le queda al
// dueño para revisar. Mientras el dueño no lo revisó lo puede anular.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { numero, plata, separaIva } from "../lib/finanzasOperaciones";
import Modal from "./ui/Modal";
import SelectBuscable from "./ui/SelectBuscable";
import BotonFoto from "./BotonFoto";
import BotonNuevaPersona from "./AltaPersona";
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
  // El titular ve todas las cajas y bancos (11/11): con muchas, solo las suyas y cuántas hay
  const mias = cajas.filter((c) => c.propia !== false);
  const otras = cajas.length - mias.length;
  const saldos = [
    ...mias.map((c) => `${cajas.length > 1 ? `${c.nombre}: ` : "Saldo "}${plata(c.saldo, c.moneda)}`),
    ...(otras ? [`cargás en ${otras === 1 ? "1 caja o banco más" : `${otras} cajas y bancos más`}`] : []),
  ].join(" · ");
  const revisar = cajas.reduce((n, c) => n + c.para_revisar, 0);
  const n = paraConfirmar?.length || 0;
  return `${n ? `💸 ${n === 1 ? "1 pase" : `${n} pases`} para confirmar · ` : ""}${saldos}${revisar ? ` · ${revisar} sin revisar` : ""}`;
}

/** Pasarle plata a otra persona: queda esperando que la otra confirme (10/11). */
function Pasar({ caja, hoy, onCerrar, onHecho }) {
  const [f, setF] = useState({ hacia: caja.destinos.length === 1 ? caja.destinos[0].cuenta : "", importe: "", fecha: hoy, descripcion: "", tipo_cambio: "" });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // Ticket de materiales: además del gasto, los materiales van al stock para revisar (11/11)
  const [alStock, setAlStock] = useState(false);
  const [guardado, setGuardado] = useState(false);
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
const LETRAS_TICKET = ["A", "B", "C", "M", "E", "X"];

/** Comercio, CUIT y número de la factura: lo llena la foto y se puede corregir. */
function DatosTicket({ f, setF, abierto, onAbrir, separa = true }) {
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === "comercio" || k === "cuit" ? { proveedor_id: "" } : {}) }));
  const iva = numero(f.iva);
  return (
    <details open={abierto} onToggle={(e) => onAbrir(e.currentTarget.open)} className="rounded-lg border border-gypi-border p-2">
      <summary className="cursor-pointer text-[14px] font-semibold text-gypi-text">🧾 Comercio y número de factura{f.comercio ? `: ${f.comercio}` : " (opcional)"}</summary>
      <div className="flex flex-col gap-2 mt-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">Comercio o proveedor
          <input className="g-input w-full" aria-label="Comercio" maxLength={120} placeholder="Ej.: YPF, Ferretería Centro" value={f.comercio} onChange={set("comercio")} />
        </label>
        {f.proveedor_id && <span className="text-[12px] text-gypi-green-ink">✓ Está en la lista de proveedores</span>}
        {!f.proveedor_id && f.comercio.trim() && (
          <BotonNuevaPersona rol="proveedor" nombre={f.comercio.trim()} cuit={f.cuit} className="self-start"
            onCreada={(p) => setF((x) => ({ ...x, proveedor_id: String(p.proveedor_id), comercio: p.nombre, cuit: x.cuit || p.cuit || "" }))}>
            ➕ Dar de alta como proveedor
          </BotonNuevaPersona>
        )}
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">CUIT
          <input className="g-input w-[180px]" aria-label="CUIT" inputMode="numeric" maxLength={13} placeholder="30-12345678-9" value={f.cuit} onChange={set("cuit")} />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">Factura
            <select className="g-input w-[110px]" aria-label="Letra" value={f.letra} onChange={set("letra")}>
              <option value="">Ticket</option>
              {LETRAS_TICKET.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">Punto de venta
            <input className="g-input w-[90px]" aria-label="Punto de venta" inputMode="numeric" maxLength={5} value={f.punto_venta} onChange={set("punto_venta")} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">Número
            <input className="g-input w-[130px]" aria-label="Número" inputMode="numeric" maxLength={8} value={f.numero} onChange={set("numero")} />
          </label>
        </div>
        {separa && iva > 0 && <span className="text-[12px] text-gypi-dim">IVA discriminado: $ {iva.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>}
      </div>
    </details>
  );
}

/** La lista larga, por grupo ("Gastos", "Compras", "Inversión"…), cada grupo en el orden de la lista. */
function porGrupo(lista) {
  const grupos = new Map();
  for (const c of lista) {
    const g = c.grupo || "Otros";
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(c);
  }
  return [...grupos.entries()];
}

/** Gasté / Recibí plata (parte 10 del 11/11: muy fácil). Primero la foto del
 *  ticket (Gypi lee importe, fecha y concepto), los conceptos en botones con
 *  los más usados primero y la fecha en Hoy / Ayer / Otro día. */
function Cargar({ caja, clase, conceptos, hoy, conStock = false, onCerrar, onHecho }) {
  const gasto = clase === "gasto";
  const lista = conceptosPorUso(gasto ? conceptos.gastos : conceptos.ingresos, caja.movimientos);
  const [f, setF] = useState({
    concepto: lista.length === 1 ? lista[0].codigo : "", importe: "", fecha: hoy, descripcion: "", tipo_cambio: "", comprobante_url: "",
    comercio: "", cuit: "", proveedor_id: "", letra: "", punto_venta: "", numero: "", neto: "", iva: "", otros_impuestos: "",
  });
  const [verDatos, setVerDatos] = useState(false);
  const [repetido, setRepetido] = useState(null);
  const [parecido, setParecido] = useState(null);
  const [otroDia, setOtroDia] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // Ticket de materiales: además del gasto, los materiales van al stock para revisar (11/11)
  const [alStock, setAlStock] = useState(false);
  const [guardado, setGuardado] = useState(false);
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
      const texto = (v) => (v == null ? "" : String(v));
      setF((x) => ({
        ...x,
        importe: x.importe || (d.importe ? String(d.importe).replace(".", ",") : ""),
        fecha: d.fecha && x.fecha === hoy ? d.fecha : x.fecha,
        concepto: x.concepto || d.concepto || "",
        descripcion: x.descripcion || d.descripcion || "",
        comercio: x.comercio || texto(d.comercio),
        cuit: x.cuit || texto(d.cuit),
        proveedor_id: x.comercio ? x.proveedor_id : texto(d.proveedor_id),
        letra: x.numero ? x.letra : texto(d.letra),
        punto_venta: x.numero ? x.punto_venta : texto(d.punto_venta),
        numero: x.numero || texto(d.numero),
        neto: texto(d.neto), iva: texto(d.iva), otros_impuestos: texto(d.otros_impuestos),
      }));
      if (d.fecha && d.fecha !== hoy && d.fecha !== ayer) setOtroDia(true);
      if (d.comercio || d.numero) setVerDatos(true);
      setRepetido(d.repetido || null);
      setLectura(d.importe || d.fecha || d.concepto || d.comercio ? "✓ Leí el ticket: revisá que esté bien." : "No pude leer el ticket: completalo a mano.");
    } catch (e) {
      setLectura(`${e.message}`);
    }
    setLeyendo(false);
  }

  async function guardar(igualConfirmado = false) {
    setError(null);
    setParecido(null);
    setGuardando(true);
    try {
      const res = await apiFetch("/api/mi-caja", {
        method: "POST",
        body: JSON.stringify({
          accion: "cargar", cuenta: caja.cuenta, clase, ...f, importe: numero(f.importe), tipo_cambio: usd ? numero(f.tipo_cambio) : null,
          neto: numero(f.neto), iva: numero(f.iva), otros_impuestos: numero(f.otros_impuestos), igual_confirmado: igualConfirmado || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.parecido) { setParecido(d.error); setGuardando(false); return; }
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      if (gasto && alStock && f.comprobante_url) {
        setGuardado(true);
        const r = await apiFetch("/api/stock/remitos", {
          method: "POST",
          body: JSON.stringify({
            accion: "ticket", foto_url: f.comprobante_url, proveedor: f.comercio || null,
            numero: [f.punto_venta, f.numero].filter(Boolean).join("-") || null, fecha: f.fecha || null,
          }),
        }).catch(() => null);
        const t = r ? await r.json().catch(() => ({})) : {};
        if (!r?.ok || !t.ok) {
          setError(`El gasto se guardó, pero los materiales no fueron al stock: ${t.error || "revisá la conexión"} `);
          setGuardando(false);
          return;
        }
      }
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
                <button type="button" className="g-btn g-btn-secondary" onClick={() => { setF((x) => ({ ...x, comprobante_url: "" })); setLectura(null); setRepetido(null); }}>Sacar la foto</button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <BotonFoto label={gasto ? "📷 Sacar foto del ticket" : "📷 Foto del comprobante (opcional)"} onFoto={conFoto} />
                {gasto && <span className="text-[12px] text-gypi-dim">Gypi lee el importe, la fecha, el comercio y el número de factura. Si no tenés ticket, completá abajo.</span>}
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
                  {porGrupo(resto).map(([g, cs]) => (
                    <optgroup key={g} label={g}>
                      {cs.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                    </optgroup>
                  ))}
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
            {campo(gasto ? "Qué compraste (opcional)" : "Detalle (opcional)", <input className="g-input w-full" aria-label="Detalle" maxLength={300} placeholder={gasto ? "Ej.: nafta camioneta" : "Ej.: me la dio Tadeo"} value={f.descripcion} onChange={set("descripcion")} />)}
            {gasto && <DatosTicket f={f} setF={setF} abierto={verDatos} onAbrir={setVerDatos} separa={separaIva(lista.find((c) => c.codigo === f.concepto))} />}
          </>
        )}
        {repetido && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {repetido} No lo cargues de nuevo.</p>}
        {parecido && (
          <div role="alert" className="flex flex-col gap-2 p-2.5 rounded-lg border border-gypi-border">
            <p className="m-0 text-[13px] text-gypi-text">⚠ {parecido}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="g-btn g-btn-secondary" onClick={() => setParecido(null)}>No, es el mismo</button>
              <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={() => guardar(true)}>Sí, es otro: guardar</button>
            </div>
          </div>
        )}
        {gasto && conStock && f.comprobante_url && !guardado && (
          <label className="flex items-start gap-2 text-[13px] text-gypi-text cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={alStock} onChange={(e) => setAlStock(e.target.checked)} />
            <span>📦 Son materiales para el stock: Gypi lee los artículos del ticket y quedan para revisar en Stock → Movimientos.</span>
          </label>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          {guardado ? (
            <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={onHecho}>{guardando ? "Mandando al stock…" : "Listo"}</button>
          ) : (<>
            <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
            {lista.length > 0 && <button type="button" className="g-btn g-btn-primary" disabled={guardando || leyendo || !f.concepto || !f.importe} onClick={() => guardar()}>{guardando ? (alStock ? "Guardando y mandando al stock…" : "Guardando…") : "Guardar"}</button>}
          </>)}
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
          <div className="flex flex-col gap-1">
            {datos.titular && <span className="text-[13px] text-gypi-dim">Como titular cargás en cualquier caja o banco: elegí cuál.</span>}
            <SelectBuscable className="g-input w-full" aria-label="Caja" value={caja.cuenta} onChange={(e) => setElegida(e.target.value)}>
              {datos.titular ? (
                <>
                  {datos.cajas.some((c) => c.propia !== false) && (
                    <optgroup label="A tu cargo">
                      {datos.cajas.filter((c) => c.propia !== false).map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Cajas y bancos de la empresa">
                    {datos.cajas.filter((c) => c.propia === false).map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}{c.moneda === "USD" ? " (USD)" : ""}</option>)}
                  </optgroup>
                </>
              ) : datos.cajas.map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}</option>)}
            </SelectBuscable>
          </div>
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
        <Cargar caja={caja} clase={cargar} conceptos={datos.conceptos || { gastos: [], ingresos: [] }} hoy={datos.hoy} conStock={Boolean(datos.con_stock)}
          onCerrar={() => setCargar(null)}
          onHecho={() => { setCargar(null); setAviso(`${cargar === "gasto" ? "Gasto cargado" : "Plata recibida cargada"}${caja.propia === false ? ` en ${caja.nombre}: ya está confirmado` : ": ya cuenta en tu saldo y el dueño lo va a revisar"}`); onCambio(); }} />
      )}
    </Modal>
  );
}
