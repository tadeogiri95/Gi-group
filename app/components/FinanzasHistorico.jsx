'use client';
// app/components/FinanzasHistorico.jsx — Finanzas → 🧾 Configuración →
// 📚 Pasar el histórico del libro (/api/finanzas/historico; reglas en
// app/lib/finanzasHistorico.js).
//
// Se sube el libro (.xlsx) y se elige desde qué fecha. Gypi lee T-OPERACIONES
// en el navegador, muestra qué va a pasar (apertura, renglones nuevos, los
// que ya estaban, los que cambiaron y las compras contra Ajuste De Capital
// que pasan a Proveedores), pide el tipo de cambio de los meses con
// dólares, y lo carga por partes. Se puede repetir: no duplica.
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { DESDE_HISTORICO, LOTE_HISTORICO, planHistorico } from "../lib/finanzasHistorico";
import { fechaCorta } from "../lib/finanzasPagos";
import { nombreMes } from "../lib/finanzasResultados";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
const miles = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");

async function leerOperacionesDelLibro(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hoja = hojasXlsx(bytes).find((n) => normal(n) === "TOPERACIONES");
  if (!hoja) return null;
  return leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [];
}

async function postHistorico(body) {
  const res = await apiFetch("/api/finanzas/historico", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

function PasarHistorico({ onCerrar, onPasado }) {
  const toast = useToast();
  const [desde, setDesde] = useState(DESDE_HISTORICO);
  const [grilla, setGrilla] = useState(null);
  const [base, setBase] = useState(null);
  const [tc, setTc] = useState({});
  const [error, setError] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [avance, setAvance] = useState(null);

  async function abrir(file) {
    if (!file) return;
    setLeyendo(true);
    setError(null);
    try {
      const [g, res] = await Promise.all([leerOperacionesDelLibro(file), apiFetch("/api/finanzas/historico")]);
      if (!g) throw new Error("El archivo no tiene la hoja T-OPERACIONES.");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo leer lo de Gypi");
      setGrilla(g);
      setBase(d);
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  }

  const plan = useMemo(() => {
    if (!grilla || !base || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) return null;
    // "1.450,50" o "1450.5"
    const tcNum = Object.fromEntries(Object.entries(tc).map(([k, v]) => {
      const s = String(v).trim();
      return [k, Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s)];
    }));
    return planHistorico({ grilla, desde, ...base, tc: tcNum });
  }, [grilla, base, desde, tc]);
  const mesesTc = plan && !plan.error ? [...(plan.hay_usd_antes || plan.apertura.some((o) => o.moneda === "USD") ? ["apertura"] : []), ...plan.meses_usd] : [];
  const listo = plan && !plan.error && !plan.faltan_cuentas.length && !plan.falta_tc.length;

  async function pasar() {
    setError(null);
    try {
      const pasos = Math.ceil(plan.anular.length / 2000) + Math.ceil(plan.apertura.length / LOTE_HISTORICO) + Math.ceil(plan.nuevas.length / LOTE_HISTORICO);
      let hechos = 0;
      const paso = () => setAvance(Math.round((++hechos / Math.max(1, pasos)) * 100));
      setAvance(0);
      for (let i = 0; i < plan.anular.length; i += 2000) { await postHistorico({ accion: "anular", ids: plan.anular.slice(i, i + 2000) }); paso(); }
      for (const lista of [plan.apertura, plan.nuevas]) {
        for (let i = 0; i < lista.length; i += LOTE_HISTORICO) { await postHistorico({ accion: "cargar", operaciones: lista.slice(i, i + LOTE_HISTORICO) }); paso(); }
      }
      await postHistorico({ accion: "terminar" });
      toast.success(`Listo: ${plan.nuevas.length} operaciones y ${plan.apertura.length} saldos`);
      onPasado();
    } catch (e) {
      setError(`${e.message}. Lo que ya pasó quedó; volvé a apretar Pasar y sigue desde ahí.`);
      setAvance(null);
    }
  }

  return (
    <Modal open onClose={avance != null ? () => {} : onCerrar} title="Pasar el histórico del libro" maxWidth={620}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Se pasa cada renglón CONFIRMADO de T-OPERACIONES desde la fecha elegida, y el saldo de cada cuenta el día anterior (reemplaza a los saldos iniciales). Los que vienen de Gypi no se repiten. Se puede volver a pasar: lo igual se saltea, lo nuevo se suma y lo que se borró o cambió en el libro se anula.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            Desde
            <input type="date" className="g-input" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            Libro (.xlsx)
            <input type="file" accept=".xlsx" aria-label="Libro (.xlsx)" className="text-[13px]" onChange={(e) => abrir(e.target.files?.[0])} />
          </label>
          {leyendo && <Spinner size={16} />}
        </div>

        {plan?.error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {plan.error}</p>}
        {plan && !plan.error && (
          <>
            <ul className="m-0 pl-5 flex flex-col gap-1 text-[13px]" aria-label="Qué se va a pasar">
              <li><b>{plan.apertura.length}</b> saldos al {fechaCorta(plan.fecha_apertura)} (cajas, bancos, proveedores, clientes y demás cuentas de balance).</li>
              <li><b>{miles(plan.nuevas.length)}</b> operaciones nuevas{plan.iguales ? `; ${miles(plan.iguales)} ya estaban` : ""}.</li>
              {plan.anular.length > 0 && <li><b>{plan.anular.length}</b> se anulan: saldos iniciales anteriores y renglones que ya no están igual en el libro.</li>}
              {plan.convertidas > 0 && <li><b>{plan.convertidas}</b> compras que en el libro van contra Ajuste De Capital pasan a Proveedores.</li>}
              {plan.anuladas_en_gypi > 0 && <li>{plan.anuladas_en_gypi} los anulaste en Gypi y no se vuelven a pasar.</li>}
              {plan.ya_en_gypi > 0 && <li>{plan.ya_en_gypi} ya estaban en Gypi por otro lado (extracto, plazos fijos, pagos…) y no se repiten.</li>}
              {plan.de_gypi > 0 && <li>{plan.de_gypi} renglones vienen de Gypi y no se repiten.</li>}
              {plan.sin_tipo > 0 && <li>{plan.sin_tipo} no tienen tipo de operación: entran como “SIN TIPO” (se ordenan con los tipos nuevos).</li>}
            </ul>
            {plan.faltan_cuentas.length > 0 && (
              <p role="alert" className="m-0 text-[13px] text-gypi-red">
                ⚠ Estas cuentas no están en el plan de cuentas de Gypi: {plan.faltan_cuentas.join(", ")}. Copiá de nuevo el plan de cuentas (📥 Copiar desde el libro) y volvé a subir el archivo.
              </p>
            )}
            {mesesTc.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="m-0 text-[13px] font-semibold">Tipo de cambio para lo que está en dólares (pesos por dólar)</p>
                <div className="flex flex-wrap gap-2">
                  {mesesTc.map((m) => (
                    <label key={m} className="flex flex-col gap-0.5 text-[12px] font-semibold">
                      {m === "apertura" ? `Al ${fechaCorta(plan.fecha_apertura)}` : nombreMes(m)}
                      <input className="g-input w-[110px] text-right" inputMode="decimal" aria-label={`Tipo de cambio ${m === "apertura" ? "de la apertura" : nombreMes(m)}`} value={tc[m] || ""} onChange={(e) => setTc((x) => ({ ...x, [m]: e.target.value }))} />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {avance != null && <p className="m-0 text-[13px] font-semibold" role="status">Pasando… {avance} %</p>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={avance != null} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!listo || avance != null || (!plan.nuevas.length && !plan.anular.length && !plan.apertura.length)} onClick={pasar}>
            {avance != null ? "Pasando…" : "Pasar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function FinanzasHistorico({ onPasado }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <section aria-label="Histórico del libro" className="mb-3 p-3 border border-gypi-border rounded-lg">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <h3 className="m-0 text-[14px] font-bold text-gypi-text">📚 Histórico del libro</h3>
          <p className="m-0 text-[13px] text-gypi-dim">Pasa a Gypi todas las operaciones del libro desde una fecha, para que los saldos, el flujo de caja y los resultados salgan de Gypi.</p>
        </div>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setAbierto(true)}>Pasar el histórico</button>
      </div>
      {abierto && <PasarHistorico onCerrar={() => setAbierto(false)} onPasado={() => { setAbierto(false); onPasado?.(); }} />}
    </section>
  );
}
