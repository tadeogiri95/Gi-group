'use client';
// app/components/FinanzasDevengamiento.jsx — Finanzas → 📆 Devengamiento
// (parte 8 del plan de Tesorería, 13/11; /api/finanzas/devengamiento; reglas
// en app/lib/finanzasDevengamiento.js). Sin migración.
//
// Por mes, la lista completa de lo que una pyme devenga. Cada renglón tiene
// su total del mes y un botón para cargarlo ahí mismo (un gasto, un asiento,
// el S.O.S, o ir a Sueldos). Arriba, "Falta este mes". Los recurrentes
// (aguinaldo, vacaciones, amortizaciones, seguros) vienen propuestos: se
// abre el asiento ya lleno para confirmarlo o corregirlo. Cada renglón se
// puede ocultar (⚙) y volver a mostrar.
//
// Parte 9 (migración 190, /api/finanzas/meses): 🔒 Cerrar el mes. Cerrado, la
// base no deja cargar, corregir ni anular nada con fecha de ese mes; 🔓 Reabrir
// pide el motivo y queda quién y cuándo, con el historial.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, plata } from "../lib/finanzasOperaciones";
import { GRUPOS_DEVENGAMIENTO } from "../lib/finanzasDevengamiento";
import { MAX_MOTIVO } from "../lib/finanzasMeses";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";
import CargarGasto from "./FinanzasCargarGasto";
import FinanzasSos, { textoDelArchivo } from "./FinanzasSos";
import { NuevoAsiento } from "./FinanzasMayor";

const pesos = (n) => plata(n, "ARS");
const BOTON = { gasto: "＋ Cargar gasto", asiento: "＋ Asiento", sueldos: "👷 Ir a Sueldos", sos: "📄 Subir S.O.S", ventas: "📄 Subir S.O.S ventas" };

const cuando = (at) => (at ? new Date(at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }) : "");
const porQuien = (n) => (n ? ` por ${n}` : "");

/** 🔒 Cerrar o 🔓 Reabrir el mes (reabrir pide el motivo). */
function CambiarMes({ cierre, onCerrar, onListo }) {
  const toast = useToast();
  const reabrir = cierre.cerrado;
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  async function confirmar() {
    if (reabrir && !motivo.trim()) { setError("Escribí el motivo para reabrir el mes"); return; }
    setError(null);
    setGuardando(true);
    try {
      const res = await apiFetch("/api/finanzas/meses", { method: "POST", body: JSON.stringify({ accion: reabrir ? "reabrir" : "cerrar", mes: cierre.mes, motivo }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      toast.success(reabrir ? `🔓 Reabriste ${cierre.nombre}` : `🔒 Cerraste ${cierre.nombre}`);
      onListo();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title={reabrir ? `🔓 Reabrir ${cierre.nombre}` : `🔒 Cerrar ${cierre.nombre}`} maxWidth={520}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        {reabrir ? (
          <>
            <p className="m-0">Al reabrirlo se puede volver a cargar, corregir y anular en {cierre.nombre}. Queda anotado quién lo reabrió, cuándo y por qué.</p>
            <label className="flex flex-col gap-1 font-semibold">
              Motivo
              <textarea className="g-input min-h-[80px] font-normal" value={motivo} maxLength={MAX_MOTIVO} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo para reabrir" placeholder="Ej.: faltaba la factura de luz" />
            </label>
          </>
        ) : (
          <p className="m-0">Con {cierre.nombre} cerrado nadie puede cargar, corregir ni anular nada con fecha de ese mes: ni lo devengado ni los movimientos de cajas y bancos. Se puede reabrir después, con un motivo.</p>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={confirmar}>
            {guardando ? "Guardando…" : reabrir ? "🔓 Reabrir" : "🔒 Cerrar el mes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** El mes cerrado (o reabierto) con su historial. */
function EstadoMes({ cierre, onCambiar }) {
  const historial = [...cierre.historial].reverse();
  if (!cierre.cerrado && !historial.length) return null;
  return (
    <section aria-label="Cierre del mes" className={`rounded-lg border p-3 text-[13px] ${cierre.cerrado ? "border-gypi-border bg-gypi-border/20" : "border-gypi-amber/40 bg-gypi-amber/10"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 min-w-[220px]">
          {cierre.cerrado ? (
            <><b>🔒 {cierre.nombre} está cerrado</b> desde el {cuando(cierre.cerrado_at)}{porQuien(cierre.cerrado_por_nombre)}. No se puede cargar, corregir ni anular nada con fecha de este mes.</>
          ) : (
            <><b>🔓 {cierre.nombre} se reabrió</b> el {cuando(cierre.reabierto_at)}{porQuien(cierre.reabierto_por_nombre)}{cierre.motivo ? `. Motivo: ${cierre.motivo}` : ""}</>
          )}
        </span>
        {cierre.cerrado && <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[13px]" onClick={onCambiar}>🔓 Reabrir</button>}
      </div>
      {historial.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-gypi-dim">Historial ({historial.length})</summary>
          <ul className="list-none m-0 mt-1 p-0 flex flex-col gap-0.5">
            {historial.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                {h.accion === "cerrar" ? "🔒 Cerrado" : "🔓 Reabierto"} el {cuando(h.at)}{porQuien(h.por)}{h.motivo ? `. Motivo: ${h.motivo}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** El CSV de ventas del S.O.S: se guarda el total de cada mes y se compara con las entregas. */
function SubirVentas({ onCerrar, onSubido }) {
  const toast = useToast();
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState(null);
  async function subir(file) {
    if (!file) return;
    setError(null);
    setLeyendo(true);
    try {
      const texto = await textoDelArchivo(file);
      const res = await apiFetch("/api/finanzas/devengamiento", { method: "POST", body: JSON.stringify({ accion: "ventas", texto, archivo: file.name }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo leer el archivo");
      const meses = Object.keys(d.meses || {}).sort();
      toast.success(`✅ Ventas del S.O.S guardadas: ${meses.length} ${meses.length === 1 ? "mes" : "meses"}`);
      onSubido();
    } catch (e) {
      setError(e.message);
      setLeyendo(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title="📄 S.O.S ventas" maxWidth={520}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">Subí el CSV de ventas que baja el S.O.S Contador. Gypi guarda el total facturado de cada mes y lo compara con las entregas. Es solo un dato: el ingreso del resultado siguen siendo las entregas.</p>
        <label className={`g-btn g-btn-primary self-start ${leyendo ? "opacity-60" : "cursor-pointer"}`}>
          📄 Elegir el CSV de ventas
          <input type="file" className="sr-only" accept=".csv,.txt" aria-label="CSV de ventas del S.O.S" disabled={leyendo} onChange={(e) => subir(e.target.files?.[0])} />
        </label>
        {leyendo && <p className="m-0 flex items-center gap-2 text-gypi-dim"><Spinner /> Leyendo…</p>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end"><button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button></div>
      </div>
    </Modal>
  );
}

export default function FinanzasDevengamiento({ onIr = null }) {
  const toast = useToast();
  const [mes, setMes] = useState(() => hoyAr().slice(0, 7));
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [verOcultos, setVerOcultos] = useState(false);
  const [gasto, setGasto] = useState(null);
  const [asiento, setAsiento] = useState(null);
  const [sos, setSos] = useState(false);
  const [ventas, setVentas] = useState(false);
  const [cambiarMes, setCambiarMes] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/finanzas/devengamiento?mes=${mes}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo cargar el devengamiento");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const porId = useMemo(() => new Map((datos?.items || []).map((i) => [i.id, i])), [datos]);

  async function ocultar(it, oculto) {
    try {
      const res = await apiFetch("/api/finanzas/devengamiento", { method: "POST", body: JSON.stringify({ accion: "ocultar", id: it.id, oculto }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      toast.success(oculto ? `Ocultaste "${it.nombre}"` : `Volvió "${it.nombre}"`);
      cargar();
    } catch (e) {
      toast.error(e.message);
    }
  }

  // Cada forma de cargar abre su pantalla acá mismo
  function cargarItem(it) {
    if (it.cargar === "sueldos") { onIr?.("fin-sueldos"); return; }
    if (it.cargar === "sos") { setSos(true); return; }
    if (it.cargar === "ventas") { setVentas(true); return; }
    if (it.recurrente && it.propuesta) { proponer(it); return; }
    if (it.cargar === "asiento") {
      setAsiento({ fecha: finMesOHoy(), tipo: "", cuenta_debe: it.cuentas[0] || "", cuenta_haber: "", importe: "", descripcion: `${it.nombre.replace(/ \(.*\)$/, "")} de ${datos.nombre}` });
      return;
    }
    setGasto({ mes, cuenta_gasto: it.cuentas[0] || "" });
  }
  function proponer(it) {
    const p = it.propuesta;
    setAsiento({ fecha: p.fecha, tipo: "", cuenta_debe: p.cuenta_debe, cuenta_haber: p.cuenta_haber, importe: String(p.importe.toFixed(2)).replace(".", ","), descripcion: p.descripcion, como: p.como });
  }
  const finMesOHoy = () => {
    const [a, m] = mes.split("-").map(Number);
    const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    return fin > datos.hoy ? datos.hoy : fin;
  };
  function accionFalta(f) {
    if (f.accion === "sueldos") return onIr?.("fin-sueldos");
    if (f.accion === "sos") return setSos(true);
    if (f.accion === "ventas") return setVentas(true);
    const it = porId.get(f.item);
    if (it) cargarItem(it);
  }
  const listo = () => { setGasto(null); setAsiento(null); setSos(false); setVentas(false); setCambiarMes(false); cargar(); };

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <Spinner />;
  const ocultos = datos.items.filter((i) => i.oculto);
  // Con el mes cerrado no se carga nada (la base tampoco lo deja)
  const cerrado = Boolean(datos.cierre?.cerrado);
  const sinCargar = cerrado ? { disabled: true, title: "El mes está cerrado" } : {};

  return (
    // 13/11 (revisión de la navegación): se puede bajar hasta el final
    <div className="flex-1 min-h-0 overflow-y-auto p-[18px] pb-6 text-[14px] text-gypi-text">
      <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 font-semibold">
          Mes
          <input type="month" className="g-input" value={mes} max={datos.hoy.slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} aria-label="Mes" />
        </label>
        {datos.cierre && !cerrado && (
          <button type="button" className="g-btn g-btn-secondary" onClick={() => setCambiarMes(true)}>🔒 Cerrar {datos.cierre.nombre}</button>
        )}
        {ocultos.length > 0 && (
          <button type="button" className="g-btn g-btn-secondary ml-auto" aria-pressed={verOcultos} onClick={() => setVerOcultos((v) => !v)}>
            ⚙ {verOcultos ? "Esconder los ocultos" : `Ver los ocultos (${ocultos.length})`}
          </button>
        )}
      </div>
      <p className="m-0 text-[13px] text-gypi-dim">
        Devengar es anotar cada cosa en el mes en que pasó, aunque se pague o se cobre en otro. Acá está todo lo que una pyme tiene que devengar en {datos.nombre}, con lo que ya está cargado.
      </p>

      {datos.cierre && <EstadoMes cierre={datos.cierre} onCambiar={() => setCambiarMes(true)} />}

      <section aria-label="Falta este mes" className={`rounded-lg border p-3 ${datos.falta.length ? "border-gypi-amber/40 bg-gypi-amber/10" : "border-gypi-green/30 bg-gypi-green/10"}`}>
        <b>{datos.falta.length ? `⚠ Falta este mes (${datos.falta.length})` : `✅ No falta nada de lo que se carga todos los meses en ${datos.nombre}`}</b>
        {datos.falta.length > 0 && (
          <ul className="list-none m-0 mt-2 p-0 flex flex-col gap-1.5">
            {datos.falta.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-[200px]">{f.texto}</span>
                <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[13px]" {...sinCargar} onClick={() => accionFalta(f)}>
                  {f.accion === "sueldos" ? "👷 Ir a Sueldos" : f.accion === "sos" || f.accion === "ventas" ? "📄 Subir" : f.accion === "proponer" ? "✨ Ver propuesta" : "＋ Cargar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {datos.ventas && (
        <section aria-label="S.O.S ventas contra entregas" className="rounded-lg border border-gypi-border p-3 text-[13px]">
          <b>🧮 Ventas facturadas (S.O.S) contra entregas de {datos.nombre}</b>
          <p className="m-0 mt-1">
            Facturado sin IVA <b className="font-mono">{pesos(datos.ventas.neto)}</b> ({datos.ventas.comprobantes} comprobantes) · entregas <b className="font-mono">{pesos(datos.ventas.entregas)}</b> ·{" "}
            {Math.abs(datos.ventas.diferencia) < 0.01
              ? <span className="text-gypi-green">iguales ✓</span>
              : <span>{datos.ventas.diferencia > 0 ? "se facturó más de lo entregado" : "se entregó más de lo facturado"}: <b className="font-mono">{pesos(Math.abs(datos.ventas.diferencia))}</b></span>}
          </p>
        </section>
      )}

      {GRUPOS_DEVENGAMIENTO.map((g) => {
        const del = datos.items.filter((i) => i.grupo === g.id && (verOcultos || !i.oculto));
        if (!del.length) return null;
        return (
          <section key={g.id} aria-label={g.titulo} className="rounded-lg border border-gypi-border">
            <h3 className="m-0 px-3 py-2 text-[15px] font-semibold border-b border-gypi-border">{g.titulo}</h3>
            <ul className="list-none m-0 p-0">
              {del.map((it) => (
                <li key={it.id} className={`px-3 py-2 flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-gypi-border first:border-t-0 ${it.oculto ? "opacity-60" : ""}`}>
                  <span className="flex-1 min-w-[220px]">
                    <span className="font-semibold">{it.nombre}</span>
                    {it.ayuda && <span className="block text-[12px] text-gypi-dim">{it.ayuda}</span>}
                    {it.propuesta && !it.total && <span className="block text-[12px] text-gypi-text">✨ Gypi propone {pesos(it.propuesta.importe)}: {it.propuesta.como}</span>}
                    {!it.cuentas.length && it.id !== "ventas_sos" && <span className="block text-[12px] text-gypi-dim">No hay una cuenta para esto en tu plan de cuentas.</span>}
                  </span>
                  <span className="text-right font-mono whitespace-nowrap">
                    <b>{it.total == null ? "—" : pesos(it.total)}</b>
                    <span className="block text-[12px] text-gypi-dim">mes anterior {it.anterior == null ? "—" : pesos(it.anterior)}</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {it.recurrente && it.propuesta && (
                      <button type="button" className="g-btn g-btn-primary !py-0.5 !px-2 text-[13px]" {...sinCargar} onClick={() => proponer(it)}>✨ Proponer</button>
                    )}
                    {BOTON[it.cargar] && !(it.recurrente && it.propuesta && it.cargar === "asiento") && (
                      <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[13px]" {...sinCargar} onClick={() => cargarItem(it)}>{BOTON[it.cargar]}</button>
                    )}
                    {it.cargar === "mantenimiento" && <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[13px]" {...sinCargar} onClick={() => setGasto({ mes, cuenta_gasto: it.cuentas[0] || "" })}>＋ Cargar gasto</button>}
                    <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[13px]" aria-label={`${it.oculto ? "Mostrar" : "Ocultar"} ${it.nombre}`} onClick={() => ocultar(it, !it.oculto)}>
                      {it.oculto ? "Mostrar" : "⚙ Ocultar"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {gasto && <CargarGasto datos={datos.listas} inicial={gasto} onCerrar={() => setGasto(null)} onGuardada={listo} />}
      {asiento && <NuevoAsiento datos={datos.listas} inicial={asiento} onCerrar={() => setAsiento(null)} onGuardado={listo} />}
      {sos && <FinanzasSos onCerrar={() => setSos(false)} onImportado={listo} />}
      {ventas && <SubirVentas onCerrar={() => setVentas(false)} onSubido={listo} />}
      {cambiarMes && datos.cierre && <CambiarMes cierre={datos.cierre} onCerrar={() => setCambiarMes(false)} onListo={listo} />}
      </div>
    </div>
  );
}
