'use client';
// app/components/FinanzasInversiones.jsx — Finanzas → 💰 Cajas y bancos →
// 📈 Inversiones (pedido de Tadeo del 12/11; /api/finanzas/inversiones,
// reglas en app/lib/finanzasInversiones.js). Sin migración.
//
// FCI: se pone el saldo real que dice el banco y la diferencia con Gypi entra
// como intereses ganados hasta ese día.
// Títulos públicos y privados: cada especie con sus láminas y su cotización.
// Comprar y vender mueve la plata y las láminas; al actualizar las
// cotizaciones, la diferencia entra como diferencia de cotización.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { valorEspecie, valorTitulos } from "../lib/finanzasInversiones";
import { Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

async function postInv(body) {
  const res = await apiFetch("/api/finanzas/inversiones", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const laminasTxt = (n) => (Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 4 });

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

function Botones({ onCerrar, guardando, onGuardar, texto, deshabilitado = false }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
      <button type="button" className="g-btn g-btn-primary" disabled={guardando || deshabilitado} onClick={onGuardar}>{guardando ? "Guardando…" : texto}</button>
    </div>
  );
}

/* ─── FCI con el saldo real ──────────────────────────────────────────── */

function ActualizarFci({ fci, hoy, onCerrar, onHecho }) {
  const toast = useToast();
  const [saldo, setSaldo] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const real = numero(saldo);
  const hay = saldo.trim() !== "" && Number.isFinite(real);
  const dif = hay ? Math.round((real - fci.saldo) * 100) / 100 : 0;

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const d = await postInv({ accion: "fci", cuenta: fci.cuenta, saldo_real: real, fecha });
      toast.success(d.diferencia ? `Listo: ${d.diferencia > 0 ? "entraron" : "salieron"} ${plata(Math.abs(d.diferencia))} de intereses` : "El saldo ya estaba bien");
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title={`Actualizar ${fci.nombre}`} maxWidth={480}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">Poné el saldo que te dice el banco. La diferencia con lo que tiene Gypi son los intereses que ganó el fondo hasta ese día.</p>
        <p className="m-0 text-[13px]">En Gypi: <b className="font-mono">{plata(fci.saldo)}</b></p>
        <div className="flex flex-wrap gap-2">
          {campo("Saldo real", <input className="g-input w-[180px] text-right font-mono" inputMode="decimal" aria-label="Saldo real" value={saldo} onChange={(e) => setSaldo(e.target.value)} />)}
          {campo("Al día", <input type="date" className="g-input" aria-label="Fecha del saldo" max={hoy} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
        </div>
        {hay && (
          <p className={`m-0 text-[14px] font-semibold ${dif < 0 ? "text-gypi-red" : "text-gypi-green-ink"}`}>
            {Math.abs(dif) < 0.01 ? "Da igual: no hay nada para cargar." : dif > 0 ? `Entran ${plata(dif)} de intereses (Intereses Ganados)` : `Baja ${plata(-dif)} (se descuenta de Intereses Ganados)`}
          </p>
        )}
        <p className="m-0 text-[12px] text-gypi-dim">Si la fecha es anterior al último movimiento, la cuenta se hace con el saldo de Gypi a esa fecha.</p>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <Botones onCerrar={onCerrar} guardando={guardando} onGuardar={guardar} texto="Actualizar" deshabilitado={!hay || real < 0} />
      </div>
    </Modal>
  );
}

/* ─── Títulos ────────────────────────────────────────────────────────── */

function AgregarTitulo({ datos, onCerrar, onHecho }) {
  const toast = useToast();
  const [f, setF] = useState({ especie: "", nombre: "", clase: "publico", moneda: "ARS", por: "100", laminas: "", cotizacion: "", como: "cargada", importe: "", caja: "", fecha: datos.hoy });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valor = valorEspecie({ laminas: numero(f.laminas), cotizacion: numero(f.cotizacion), por: Number(f.por) });

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      await postInv({
        accion: "titulo_alta", como: f.como, fecha: f.fecha, caja: f.como === "compra" ? f.caja : null, importe: f.como === "cargada" ? null : numero(f.importe),
        especie: { especie: f.especie, nombre: f.nombre, clase: f.clase, moneda: f.moneda, por: Number(f.por), laminas: numero(f.laminas), cotizacion: numero(f.cotizacion) || 0 },
      });
      toast.success(`${f.especie.toUpperCase()} agregado`);
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Agregar un título" maxWidth={560}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <div className="flex flex-wrap gap-2">
          {campo("Especie", <input className="g-input w-[120px] uppercase" aria-label="Especie" placeholder="GD35" maxLength={20} value={f.especie} onChange={set("especie")} />)}
          {campo("Nombre (opcional)", <input className="g-input w-[220px]" aria-label="Nombre del título" placeholder="Bono Global 2035" maxLength={80} value={f.nombre} onChange={set("nombre")} />)}
        </div>
        <div className="flex flex-wrap gap-2">
          {campo("Clase", (
            <select className="g-input" aria-label="Clase" value={f.clase} onChange={(e) => setF((x) => ({ ...x, clase: e.target.value, por: e.target.value === "privado" ? "1" : "100" }))}>
              <option value="publico">Público (bono)</option>
              <option value="privado">Privado (acción, ON)</option>
            </select>
          ))}
          {campo("Cotiza", (
            <select className="g-input" aria-label="Cotiza cada" value={f.por} onChange={set("por")}>
              <option value="100">cada 100 láminas</option>
              <option value="1">por lámina</option>
            </select>
          ))}
          {campo("Moneda de la cotización", (
            <select className="g-input" aria-label="Moneda" value={f.moneda} onChange={set("moneda")}>
              <option value="ARS">Pesos</option>
              <option value="USD">Dólares</option>
            </select>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {campo("Láminas", <input className="g-input w-[140px] text-right font-mono" inputMode="decimal" aria-label="Láminas" value={f.laminas} onChange={set("laminas")} />)}
          {campo("Cotización", <input className="g-input w-[140px] text-right font-mono" inputMode="decimal" aria-label="Cotización" value={f.cotizacion} onChange={set("cotizacion")} />)}
        </div>
        {valor > 0 && <p className="m-0 text-[13px]">Valen <b className="font-mono">{plata(valor, f.moneda)}</b></p>}
        <fieldset className="border border-gypi-border rounded-lg p-2 m-0 flex flex-col gap-1">
          <legend className="px-1 text-[13px] font-bold">¿Ya está en la cuenta de títulos?</legend>
          {[
            ["cargada", "Sí, ya está cargado (en el libro o en Gypi): solo lo anoto"],
            ["inicial", "Lo tenía pero no está cargado: entra como tenencia que ya había"],
            ["compra", "Lo compré ahora: sale la plata de una caja o banco"],
          ].map(([v, t]) => (
            <label key={v} className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="radio" name="como" value={v} checked={f.como === v} onChange={set("como")} /> {t}
            </label>
          ))}
        </fieldset>
        {f.como !== "cargada" && (
          <div className="flex flex-wrap gap-2">
            {campo(f.como === "compra" ? "Lo que pagaste (pesos)" : "Lo que valían (pesos)", <input className="g-input w-[160px] text-right font-mono" inputMode="decimal" aria-label="Importe en pesos" value={f.importe} onChange={set("importe")} />)}
            {f.como === "compra" && campo("Sale de", (
              <SelectBuscable className="g-input min-w-[200px]" aria-label="Sale de" value={f.caja} onChange={set("caja")}>
                <option value="">Elegí…</option>
                {datos.cajas.map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}</option>)}
              </SelectBuscable>
            ))}
            {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha" max={datos.hoy} value={f.fecha} onChange={set("fecha")} />)}
          </div>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <Botones onCerrar={onCerrar} guardando={guardando} onGuardar={guardar} texto="Agregar" deshabilitado={!f.especie.trim()} />
      </div>
    </Modal>
  );
}

function MoverTitulo({ especie, como, datos, onCerrar, onHecho }) {
  const toast = useToast();
  const [f, setF] = useState({ laminas: "", importe: "", caja: "", fecha: datos.hoy });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const venta = como === "venta";

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      await postInv({ accion: "titulo_mover", id: especie.id, como, laminas: numero(f.laminas), importe: numero(f.importe), caja: f.caja, fecha: f.fecha });
      toast.success(venta ? "Venta cargada" : "Compra cargada");
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title={`${venta ? "Vender" : "Comprar"} ${especie.especie}`} maxWidth={480}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px]">Tenés <b className="font-mono">{laminasTxt(especie.laminas)}</b> láminas.</p>
        <div className="flex flex-wrap gap-2">
          {campo("Láminas", <input className="g-input w-[140px] text-right font-mono" inputMode="decimal" aria-label="Láminas" value={f.laminas} onChange={set("laminas")} />)}
          {campo(venta ? "Lo que cobraste (pesos)" : "Lo que pagaste (pesos)", <input className="g-input w-[160px] text-right font-mono" inputMode="decimal" aria-label="Importe en pesos" value={f.importe} onChange={set("importe")} />)}
        </div>
        <div className="flex flex-wrap gap-2">
          {campo(venta ? "Entra en" : "Sale de", (
            <SelectBuscable className="g-input min-w-[200px]" aria-label={venta ? "Entra en" : "Sale de"} value={f.caja} onChange={set("caja")}>
              <option value="">Elegí…</option>
              {datos.cajas.map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}</option>)}
            </SelectBuscable>
          ))}
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha" max={datos.hoy} value={f.fecha} onChange={set("fecha")} />)}
        </div>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <Botones onCerrar={onCerrar} guardando={guardando} onGuardar={guardar} texto={venta ? "Cargar la venta" : "Cargar la compra"} />
      </div>
    </Modal>
  );
}

function Cotizar({ datos, onCerrar, onHecho }) {
  const toast = useToast();
  const t = datos.titulos;
  const [cot, setCot] = useState(() => Object.fromEntries(t.especies.map((e) => [e.id, e.cotizacion ? String(e.cotizacion).replace(".", ",") : ""])));
  const [tc, setTc] = useState(t.tipo_cambio ? String(t.tipo_cambio).replace(".", ",") : "");
  const [fecha, setFecha] = useState(datos.hoy);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const hayUsd = t.especies.some((e) => e.moneda === "USD");
  const especies = useMemo(() => t.especies.map((e) => ({ ...e, cotizacion: cot[e.id] === "" ? e.cotizacion : numero(cot[e.id]) })), [t.especies, cot]);
  const valor = valorTitulos(especies, numero(tc) > 0 ? numero(tc) : null);
  const dif = Math.round((valor.ars - t.saldo) * 100) / 100;

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const cotizaciones = Object.fromEntries(Object.entries(cot).filter(([, v]) => v !== "").map(([k, v]) => [k, numero(v)]));
      const d = await postInv({ accion: "cotizar", cotizaciones, tipo_cambio: hayUsd ? numero(tc) : null, fecha });
      toast.success(d.diferencia ? `Listo: ${d.diferencia > 0 ? "subieron" : "bajaron"} ${plata(Math.abs(d.diferencia))}` : "Cotizaciones guardadas");
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Actualizar cotizaciones" maxWidth={560}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">Poné la cotización de hoy de cada título. La diferencia entre lo que valen y lo que dice la cuenta entra como diferencia de cotización.</p>
        <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Cotizaciones">
          {t.especies.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[120px] font-semibold">{e.especie} <span className="font-normal text-[12px] text-gypi-dim">{laminasTxt(e.laminas)} láminas · {e.por === 1 ? "por lámina" : "cada 100"} · {e.moneda === "USD" ? "USD" : "$"}</span></span>
              <input className="g-input w-[140px] text-right font-mono" inputMode="decimal" aria-label={`Cotización de ${e.especie}`} value={cot[e.id] ?? ""} onChange={(ev) => setCot((x) => ({ ...x, [e.id]: ev.target.value }))} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {hayUsd && campo("Tipo de cambio", <input className="g-input w-[140px] text-right font-mono" inputMode="decimal" aria-label="Tipo de cambio" value={tc} onChange={(e) => setTc(e.target.value)} />)}
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha de la cotización" max={datos.hoy} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
        </div>
        {!valor.falta_tc && (
          <p className="m-0 text-[13px]">
            Valen <b className="font-mono">{plata(valor.ars)}</b> · la cuenta dice <b className="font-mono">{plata(t.saldo)}</b>
            {Math.abs(dif) >= 0.01 && <> · <b className={dif < 0 ? "text-gypi-red" : "text-gypi-green-ink"}>{dif > 0 ? "suben" : "bajan"} {plata(Math.abs(dif))}</b></>}
          </p>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <Botones onCerrar={onCerrar} guardando={guardando} onGuardar={guardar} texto="Guardar cotizaciones" deshabilitado={hayUsd && !(numero(tc) > 0)} />
      </div>
    </Modal>
  );
}

/* ─── Sección ────────────────────────────────────────────────────────── */

export default function FinanzasInversiones({ onCambio }) {
  const toast = useToast();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [fci, setFci] = useState(null);
  const [agregar, setAgregar] = useState(false);
  const [mover, setMover] = useState(null);
  const [cotizar, setCotizar] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/inversiones");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron leer las inversiones");
      setDatos({ ...d, fci: d.fci || [], cajas: d.cajas || [], titulos: { especies: [], saldo: 0, valor: 0, ...(d.titulos || {}) } });
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const hecho = () => { setFci(null); setAgregar(false); setMover(null); setCotizar(false); cargar(); onCambio?.(); };

  async function quitar(e) {
    try {
      await postInv({ accion: "titulo_quitar", id: e.id });
      toast.success(`${e.especie} sacado de la lista`);
      cargar();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const t = datos?.titulos;
  const dif = t ? Math.round((t.valor - t.saldo) * 100) / 100 : 0;
  return (
    <section aria-label="Inversiones" className="mb-4 p-3 border border-gypi-border rounded-lg">
      <div className="mb-2">
        <h2 className="m-0 text-[14px] font-bold text-gypi-text">📈 Inversiones</h2>
        <p className="m-0 text-[13px] text-gypi-dim">El FCI con su saldo real y los títulos con sus láminas y cotización.</p>
      </div>
      {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
      {!datos && !error && <Spinner size={18} />}
      {datos?.avisos?.length > 0 && <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">⚠ {datos.avisos.join(". ")}</p>}
      {datos && (
        <>
          <h3 className="m-0 mt-1 mb-1 text-[13px] font-bold text-gypi-dim">Fondos comunes de inversión</h3>
          {!datos.fci.length && <p className="m-0 mb-2 text-[13px] text-gypi-dim">No hay ningún FCI en Cajas y bancos.</p>}
          <ul className="list-none m-0 mb-3 p-0 flex flex-col gap-1.5" aria-label="FCI">
            {datos.fci.map((x) => (
              <li key={x.cuenta} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-gypi-border">
                <span className="flex-1 min-w-[160px] text-[14px] font-semibold text-gypi-text">{x.nombre}</span>
                <span className="font-mono font-semibold text-[14px]">{plata(x.saldo, x.moneda)}</span>
                {x.moneda !== "USD" && <button type="button" className="g-btn g-btn-secondary" onClick={() => setFci(x)}>🔄 Actualizar con el saldo real</button>}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="m-0 flex-1 min-w-[180px] text-[13px] font-bold text-gypi-dim">Títulos públicos y privados</h3>
            <button type="button" className="g-btn g-btn-secondary" disabled={!t.cuenta} onClick={() => setAgregar(true)}>+ Agregar título</button>
            {t.especies.length > 0 && <button type="button" className="g-btn g-btn-primary" onClick={() => setCotizar(true)}>💲 Actualizar cotizaciones</button>}
          </div>
          {!t.cuenta && <p className="m-0 text-[13px] text-gypi-amber-ink">⚠ Falta la cuenta Titulo Públicos y Privados en el plan de cuentas.</p>}
          {t.cuenta && (
            <p className="m-0 mb-1 text-[13px] text-gypi-text">
              Valen <b className="font-mono">{plata(t.valor)}</b> · la cuenta {t.nombre_cuenta || t.cuenta} dice <b className="font-mono">{plata(t.saldo)}</b>
              {t.falta_tc && <span className="text-gypi-amber-ink"> · falta el tipo de cambio para los que están en dólares</span>}
              {!t.falta_tc && Math.abs(dif) >= 0.01 && t.especies.length > 0 && <span className="text-gypi-amber-ink"> · actualizá las cotizaciones para que la cuenta quede al día</span>}
            </p>
          )}
          {t.cuenta && !t.especies.length && <p className="m-0 text-[13px] text-gypi-dim">Todavía no agregaste ningún título.</p>}
          {t.especies.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]" aria-label="Títulos">
                <thead>
                  <tr className="text-left text-gypi-dim">
                    <th className="font-semibold py-1">Título</th>
                    <th className="font-semibold py-1 text-right">Láminas</th>
                    <th className="font-semibold py-1 text-right">Cotización</th>
                    <th className="font-semibold py-1 text-right">Valor</th>
                    <th className="py-1"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {t.especies.map((e) => (
                    <tr key={e.id} className="border-t border-gypi-border align-top">
                      <td className="py-1.5">
                        <b>{e.especie}</b>{e.nombre && <span className="text-gypi-dim"> · {e.nombre}</span>}
                        <span className="block text-[12px] text-gypi-dim">{e.clase === "privado" ? "Privado" : "Público"} · cotiza {e.por === 1 ? "por lámina" : "cada 100"}{e.fecha_cotizacion ? ` · al ${fechaCorta(e.fecha_cotizacion)}` : ""}</span>
                      </td>
                      <td className="py-1.5 text-right font-mono">{laminasTxt(e.laminas)}</td>
                      <td className="py-1.5 text-right font-mono">{e.cotizacion ? plata(e.cotizacion, e.moneda) : "—"}</td>
                      <td className="py-1.5 text-right font-mono font-semibold">{plata(e.valor, e.moneda)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <button type="button" className="g-btn g-btn-secondary" aria-label={`Comprar ${e.especie}`} onClick={() => setMover({ especie: e, como: "compra" })}>Comprar</button>{" "}
                        {e.laminas > 0
                          ? <button type="button" className="g-btn g-btn-secondary" aria-label={`Vender ${e.especie}`} onClick={() => setMover({ especie: e, como: "venta" })}>Vender</button>
                          : <button type="button" className="g-btn g-btn-secondary" aria-label={`Sacar ${e.especie}`} onClick={() => quitar(e)}>Sacar</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {fci && <ActualizarFci fci={fci} hoy={datos?.hoy || hoyAr()} onCerrar={() => setFci(null)} onHecho={hecho} />}
      {agregar && <AgregarTitulo datos={datos} onCerrar={() => setAgregar(false)} onHecho={hecho} />}
      {mover && <MoverTitulo especie={mover.especie} como={mover.como} datos={datos} onCerrar={() => setMover(null)} onHecho={hecho} />}
      {cotizar && <Cotizar datos={datos} onCerrar={() => setCotizar(false)} onHecho={hecho} />}
    </section>
  );
}
