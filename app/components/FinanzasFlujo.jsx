'use client';
// app/components/FinanzasFlujo.jsx — Finanzas → 💵 Flujo de caja (parte F6b;
// /api/finanzas/flujo; reglas en app/lib/finanzasFlujo.js).
//
// Arriba, lo que viene: las próximas 8 semanas desde el saldo de hoy en pesos
// (cheques a depositar y a debitar, órdenes de pago, sueldos por pagar), con
// el detalle de cada semana. Abajo, el flujo real de 12 meses por línea, como
// la hoja FLUJO_V2 del libro, en pesos o en dólares.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr } from "../lib/finanzasOperaciones";
import { fechaCorta } from "../lib/finanzasPagos";
import { nombreMes } from "../lib/finanzasResultados";
import { Chip, Modal, Spinner } from "./ui";

const miles = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const rojo = (n) => (n < 0 ? "text-gypi-red" : "");

function DetalleSemana({ fila, semana, onCerrar }) {
  const i = fila.semana;
  return (
    <Modal open onClose={onCerrar} title={`${fila.nombre} · semana del ${fechaCorta(semana)}`} maxWidth={520}>
      <ul className="list-none m-0 p-0 flex flex-col gap-1 text-[13px] text-gypi-text">
        {fila.detalle[i].map((d, j) => (
          <li key={j} className="flex gap-2">
            <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(d.fecha)}</span>
            <span className="flex-1 min-w-0">{d.texto}</span>
            <span className={`font-mono ${rojo(d.importe)}`}>{miles(d.importe)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function Previsto({ p }) {
  const [abierto, setAbierto] = useState(null);
  return (
    <section aria-label="Lo que viene" className="mb-4">
      <h2 className="m-0 mb-1 text-[16px] font-bold text-gypi-text">Lo que viene (pesos)</h2>
      <p className="m-0 mb-2 text-[13px] text-gypi-dim">Desde el saldo de hoy de cajas y bancos: <b className={`text-gypi-text ${rojo(p.saldo_hoy)}`}>$ {miles(p.saldo_hoy)}</b>. Lo vencido entra en la primera semana. Tocá un importe para ver el detalle.</p>
      <div className="overflow-x-auto border border-gypi-border rounded-lg">
        <table className="w-full border-collapse text-[13px]" aria-label="Lo que viene">
          <thead>
            <tr className="bg-gypi-surface">
              <th className="text-left px-2 py-1.5 sticky left-0 bg-gypi-surface min-w-[200px]">Semana del</th>
              {p.semanas.map((s) => <th key={s} className="text-right px-2 py-1.5 whitespace-nowrap">{fechaCorta(s)}</th>)}
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Después</th>
            </tr>
          </thead>
          <tbody>
            {p.filas.map((f) => (
              <tr key={f.id} className="border-t border-gypi-border text-gypi-text">
                <td className="px-2 py-1 sticky left-0 bg-gypi-bg">{f.nombre}</td>
                {f.valores.map((v, i) => (
                  <td key={i} className="px-1 py-0.5 text-right">
                    {v ? (
                      <button type="button" className={`bg-transparent border-none p-1 font-mono cursor-pointer ${rojo(v)}`} aria-label={`${f.nombre}, semana del ${fechaCorta(p.semanas[i])}`} onClick={() => setAbierto({ ...f, semana: i })}>{miles(v)}</button>
                    ) : <span className="font-mono text-gypi-dim">–</span>}
                  </td>
                ))}
                <td className={`px-2 py-1 text-right font-mono ${rojo(f.despues)}`}>{f.despues ? miles(f.despues) : "–"}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gypi-border bg-gypi-surface font-bold text-gypi-text">
              <td className="px-2 py-1.5 sticky left-0 bg-gypi-surface">Saldo al fin de la semana</td>
              {p.saldo.map((v, i) => <td key={i} className={`px-2 py-1.5 text-right font-mono whitespace-nowrap ${rojo(v)}`}>{miles(v)}</td>)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {abierto && <DetalleSemana fila={abierto} semana={p.semanas[abierto.semana]} onCerrar={() => setAbierto(null)} />}
    </section>
  );
}

export default function FinanzasFlujo() {
  const [hasta, setHasta] = useState(hoyAr().slice(0, 7));
  const [moneda, setMoneda] = useState("ARS");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [cerradas, setCerradas] = useState(() => new Set(["TES"]));

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch(`/api/finanzas/flujo?hasta=${hasta}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo armar el flujo de caja");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const m = datos.monedas[moneda];
  const abrirCerrar = (id) => setCerradas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const visibles = m.filas.filter((f) => f.tipo === "seccion" || !cerradas.has(f.seccion));

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      {!datos.lineas_cargadas && (
        <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">
          ⚠ Faltan las líneas del flujo de cada tipo. Andá a Finanzas → Configuración → 📥 Copiar desde el libro y copiá “Líneas del flujo de caja” (hoja dim_flujo).
        </p>
      )}
      <Previsto p={datos.previsto} />

      <section aria-label="Flujo real">
        <h2 className="m-0 mb-1 text-[16px] font-bold text-gypi-text">Lo que entró y salió</h2>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
            Hasta el mes
            <input type="month" className="g-input" aria-label="Hasta el mes" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} />
          </label>
          <Chip active={moneda === "ARS"} onClick={() => setMoneda("ARS")}>Pesos</Chip>
          <Chip active={moneda === "USD"} onClick={() => setMoneda("USD")}>Dólares</Chip>
          {cargando && <Spinner size={16} />}
        </div>
        {datos.tipos_sin_linea.length > 0 && (
          <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">⚠ Tipos que mueven plata y no tienen línea en dim_flujo: {datos.tipos_sin_linea.join(", ")}.</p>
        )}
        {!m.hay ? (
          <p className="m-0 text-[13px] text-gypi-dim">No hay movimientos de cajas en {moneda === "USD" ? "dólares" : "pesos"} en estos meses.</p>
        ) : (
          <div className="overflow-x-auto border border-gypi-border rounded-lg">
            <table className="w-full border-collapse text-[13px]" aria-label="Flujo de caja">
              <thead>
                <tr className="bg-gypi-surface">
                  <th className="text-left px-2 py-1.5 sticky left-0 bg-gypi-surface min-w-[220px]">Concepto</th>
                  {datos.meses.map((x) => <th key={x} className="text-right px-2 py-1.5 whitespace-nowrap">{nombreMes(x)}</th>)}
                  <th className="text-right px-2 py-1.5 whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-gypi-border text-gypi-dim">
                  <td className="px-2 py-1 sticky left-0 bg-gypi-bg">Saldo al empezar el mes</td>
                  {datos.meses.map((x, i) => { const v = i ? m.cierre[i - 1] : m.apertura; return <td key={x} className={`px-2 py-1 text-right font-mono ${rojo(v)}`}>{miles(v)}</td>; })}
                  <td />
                </tr>
                {visibles.map((f) => (
                  <tr key={f.id} className={`border-t border-gypi-border text-gypi-text ${f.tipo === "seccion" ? "bg-gypi-surface font-bold" : ""}`}>
                    <td className={`pr-2 py-1 sticky left-0 ${f.tipo === "seccion" ? "bg-gypi-surface pl-2" : "bg-gypi-bg pl-5"}`}>
                      {f.tipo === "seccion" ? (
                        <button type="button" className="bg-transparent border-none p-0 font-bold text-gypi-text cursor-pointer text-left" aria-expanded={!cerradas.has(f.id)} onClick={() => abrirCerrar(f.id)}>
                          {cerradas.has(f.id) ? "▸ " : "▾ "}{f.nombre}
                        </button>
                      ) : f.nombre}
                    </td>
                    {f.valores.map((v, i) => <td key={i} className={`px-2 py-1 text-right font-mono whitespace-nowrap ${rojo(v)}`}>{v ? miles(v) : "–"}</td>)}
                    <td className={`px-2 py-1 text-right font-mono whitespace-nowrap font-semibold ${rojo(f.total)}`}>{miles(f.total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gypi-border bg-gypi-surface font-bold text-gypi-text">
                  <td className="px-2 py-1.5 sticky left-0 bg-gypi-surface">Flujo neto del mes</td>
                  {m.neto.map((v, i) => <td key={i} className={`px-2 py-1.5 text-right font-mono whitespace-nowrap ${rojo(v)}`}>{miles(v)}</td>)}
                  <td className={`px-2 py-1.5 text-right font-mono ${rojo(m.neto.reduce((s, v) => s + v, 0))}`}>{miles(m.neto.reduce((s, v) => s + v, 0))}</td>
                </tr>
                <tr className="border-t border-gypi-border font-semibold text-gypi-text">
                  <td className="px-2 py-1.5 sticky left-0 bg-gypi-bg">Saldo al cerrar el mes</td>
                  {m.cierre.map((v, i) => <td key={i} className={`px-2 py-1.5 text-right font-mono whitespace-nowrap ${rojo(v)}`}>{miles(v)}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
