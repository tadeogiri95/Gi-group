'use client';
// app/components/FinanzasPatrimonio.jsx — Finanzas → ⚖ Situación patrimonial
// (etapa 6 de la auditoría de Finanzas integrada, 14/11;
// /api/finanzas/patrimonio; reglas en app/lib/finanzasPatrimonio.js).
//
// Tres vistas de lo mismo (el libro de Gypi, a una fecha):
//   ⚖ Situación patrimonial: lo que la empresa tiene (activo), lo que debe
//     (pasivo) y lo que es de los dueños (patrimonio neto).
//   💧 Liquidez: con qué se pagan las deudas de corto plazo.
//   🔄 Orígenes y aplicaciones: de dónde salió la plata y en qué se usó entre
//     dos fechas.
// Solo el rol Dueño.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, plata } from "../lib/finanzasOperaciones";
import { fechaCorta } from "../lib/finanzasPagos";
import { semaforo } from "../lib/finanzasPatrimonio";
import { Chip, Spinner } from "./ui";

const VISTAS = [
  { id: "situacion", nombre: "⚖ Situación patrimonial" },
  { id: "liquidez", nombre: "💧 Liquidez" },
  { id: "origenes", nombre: "🔄 Orígenes y aplicaciones" },
];
const color = (n) => (n < 0 ? "text-gypi-red" : "text-gypi-text");
const veces = (n) => (n === null || n === undefined ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const COLOR_SEMAFORO = { verde: "text-gypi-green", amarillo: "text-gypi-amber-ink", rojo: "text-gypi-red", gris: "text-gypi-dim" };

function Renglon({ nombre, importe, fuerte = false, sangria = false }) {
  return (
    <div className={`flex items-baseline gap-2 py-1 border-t border-gypi-border ${fuerte ? "font-bold" : ""} ${sangria ? "pl-4" : ""}`}>
      <span className="flex-1 min-w-0 text-[13px] text-gypi-text">{nombre}</span>
      <span className={`font-mono text-[13px] whitespace-nowrap ${color(importe)}`}>{plata(importe)}</span>
    </div>
  );
}

function Seccion({ s }) {
  return (
    <div className="mb-3">
      <Renglon nombre={s.nombre} importe={s.total} fuerte />
      {s.rubros.length === 0 && <p className="m-0 pl-4 py-1 text-[12px] text-gypi-dim">Sin saldo</p>}
      {s.rubros.map((r) => <Renglon key={r.codigo} nombre={r.nombre} importe={r.saldo} sangria />)}
    </div>
  );
}

function Situacion({ sit }) {
  const sec = (id) => sit.secciones.find((s) => s.id === id);
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Activo" className="g-card p-3">
          <h3 className="m-0 mb-1 text-[15px] font-bold text-gypi-text">Lo que tiene la empresa (activo)</h3>
          <Seccion s={sec("AC")} />
          <Seccion s={sec("ANC")} />
          <Renglon nombre="Total del activo" importe={sit.activo} fuerte />
        </section>
        <section aria-label="Pasivo y patrimonio" className="g-card p-3">
          <h3 className="m-0 mb-1 text-[15px] font-bold text-gypi-text">Lo que debe (pasivo) y lo de los dueños (patrimonio)</h3>
          <Seccion s={sec("PC")} />
          <Seccion s={sec("PNC")} />
          <Renglon nombre="Total del pasivo" importe={sit.pasivo} fuerte />
          <div className="mt-3"><Seccion s={sec("PN")} /></div>
          <Renglon nombre="Pasivo + patrimonio neto" importe={Math.round((sit.pasivo + sit.patrimonio) * 100) / 100} fuerte />
        </section>
      </div>
      {sit.cuadra
        ? <p className="m-0 mt-2 text-[12px] text-gypi-dim">✓ El activo es igual al pasivo más el patrimonio.</p>
        : <p role="alert" className="m-0 mt-2 text-[13px] text-gypi-red">⚠ No cuadra por {plata(sit.diferencia)}: hay operaciones con una cuenta que no está en el plan.</p>}
    </>
  );
}

const INDICADORES = [
  { id: "corriente", nombre: "Liquidez corriente", formula: "Activo corriente ÷ pasivo corriente", ayuda: "Cuántos pesos hay para pagar cada peso que se debe en el corto plazo. Bien desde 1,5." },
  { id: "acida", nombre: "Prueba ácida", formula: "(Activo corriente − stock) ÷ pasivo corriente", ayuda: "Lo mismo sin contar el stock, que tarda en hacerse plata. Bien desde 1." },
  { id: "inmediata", nombre: "Liquidez inmediata", formula: "Caja, bancos e inversiones cortas ÷ pasivo corriente", ayuda: "Lo que se puede pagar hoy con la plata disponible. Bien desde 0,5." },
  { id: "endeudamiento", nombre: "Endeudamiento", formula: "Pasivo ÷ patrimonio neto", ayuda: "Cuánto se debe por cada peso de los dueños. Bien hasta 1." },
];

function Liquidez({ liq }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {INDICADORES.map((i) => {
          const v = liq[i.id];
          return (
            <div key={i.id} className="g-card p-3">
              <p className="m-0 text-[13px] font-semibold text-gypi-dim">{i.nombre}</p>
              <p className={`m-0 text-[26px] font-bold font-mono ${COLOR_SEMAFORO[semaforo(i.id, v)]}`}>{veces(v)}</p>
              <p className="m-0 text-[12px] text-gypi-dim">{i.formula}</p>
              <p className="m-0 mt-1 text-[12px] text-gypi-text">{i.ayuda}</p>
            </div>
          );
        })}
      </div>
      <div className="g-card p-3 mt-3 max-w-[560px]">
        <Renglon nombre="Activo corriente" importe={liq.activo_corriente} />
        <Renglon nombre="Caja, bancos e inversiones cortas" importe={liq.disponible} sangria />
        <Renglon nombre="Stock (bienes de cambio)" importe={liq.stock} sangria />
        <Renglon nombre="Pasivo corriente" importe={liq.pasivo_corriente} />
        <Renglon nombre="Capital de trabajo (activo corriente − pasivo corriente)" importe={liq.capital_trabajo} fuerte />
      </div>
      {liq.corriente === null && <p className="m-0 mt-2 text-[13px] text-gypi-dim">Sin deudas de corto plazo cargadas, los cocientes no se pueden calcular.</p>}
    </>
  );
}

function Origenes({ o, desde, hasta }) {
  return (
    <div className="g-card p-3 max-w-[720px]">
      <Renglon nombre={`Caja y bancos al ${fechaCorta(desde)} (al empezar el día)`} importe={o.fondos_inicio} fuerte />
      <p className="m-0 mt-3 text-[13px] font-bold text-gypi-text">De dónde salió la plata (orígenes)</p>
      {o.origenes.length === 0 && <p className="m-0 pl-4 py-1 text-[12px] text-gypi-dim">Nada</p>}
      {o.origenes.map((x) => <Renglon key={x.codigo} nombre={x.nombre} importe={x.importe} sangria />)}
      <Renglon nombre="Total de orígenes" importe={o.total_origenes} fuerte />
      <p className="m-0 mt-3 text-[13px] font-bold text-gypi-text">En qué se usó (aplicaciones)</p>
      {o.aplicaciones.length === 0 && <p className="m-0 pl-4 py-1 text-[12px] text-gypi-dim">Nada</p>}
      {o.aplicaciones.map((x) => <Renglon key={x.codigo} nombre={x.nombre} importe={x.importe} sangria />)}
      <Renglon nombre="Total de aplicaciones" importe={o.total_aplicaciones} fuerte />
      <div className="mt-3">
        <Renglon nombre="Variación de caja y bancos (orígenes − aplicaciones)" importe={o.variacion} fuerte />
        <Renglon nombre={`Caja y bancos al ${fechaCorta(hasta)}`} importe={o.fondos_fin} fuerte />
      </div>
      {!o.cuadra && <p role="alert" className="m-0 mt-2 text-[13px] text-gypi-red">⚠ No cuadra: hay operaciones con una cuenta que no está en el plan.</p>}
    </div>
  );
}

export default function FinanzasPatrimonio() {
  const hoy = hoyAr();
  const [vista, setVista] = useState("situacion");
  const [hasta, setHasta] = useState(hoy);
  const [desde, setDesde] = useState(`${hoy.slice(0, 4)}-01-01`);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch(`/api/finanzas/patrimonio?hasta=${hasta}&desde=${desde}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo armar la situación patrimonial");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [hasta, desde]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Qué ver">
        {VISTAS.map((v) => <Chip key={v.id} active={vista === v.id} onClick={() => setVista(v.id)}>{v.nombre}</Chip>)}
      </div>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        {vista === "origenes" && (
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
            Desde
            <input type="date" className="g-input" aria-label="Desde" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
          {vista === "origenes" ? "Hasta" : "Al día"}
          <input type="date" className="g-input" aria-label={vista === "origenes" ? "Hasta" : "Al día"} value={hasta} max={hoy} onChange={(e) => e.target.value && setHasta(e.target.value)} />
        </label>
        <p className="m-0 text-[13px] text-gypi-dim flex-1 min-w-[200px]">
          Sale del libro de Gypi (todas las operaciones confirmadas y para revisar, como el Mayor), en pesos. Si una cuenta da al revés, casi siempre falta su saldo inicial: revisala en 📚 Mayor.
        </p>
        {cargando && <Spinner size={16} />}
      </div>
      {error && <p role="alert" className="m-0 mb-2 text-[14px] text-gypi-red">⚠ {error}</p>}
      {!datos && !error && <div className="flex justify-center py-10"><Spinner /></div>}
      {datos?.truncado && <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">⚠ Hay demasiadas operaciones: se tomaron las primeras.</p>}
      {datos && vista === "situacion" && <Situacion sit={datos.situacion} />}
      {datos && vista === "liquidez" && <Liquidez liq={datos.liquidez} />}
      {datos && vista === "origenes" && <Origenes o={datos.origenes} desde={datos.desde} hasta={datos.hasta} />}
    </div>
  );
}
