'use client';
// app/components/FinanzasDolares.jsx — ➕ Cargar → 💱 Comprar o vender dólares
// (14/11). Las cuentas las arma app/lib/finanzasDolares.js; guarda con
// /api/finanzas/tesoreria (acciones "dolares_costo" y "dolares").
//
// Vender: Gypi trae a cuánto están anotados los dólares de la caja (costo
// promedio del Mayor), muestra la ganancia o la pérdida contra el tipo de
// cambio de la venta y guarda las dos operaciones juntas. Comprar: una sola.
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { cuentasParaDiferencia, pesosPorDolar } from "../lib/finanzasDolares";
import AvisoRepetidos, { repetidosDe } from "./FinanzasAvisoRepetidos";
import { Chip, Modal, SelectBuscable } from "./ui";
import { useToast } from "./ui/Toast";

async function postTesoreria(body) {
  const res = await apiFetch("/api/finanzas/tesoreria", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || "No se pudo guardar"), { status: res.status, datos: d });
  return d;
}

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

const fechaCorta = (f) => String(f || "").split("-").reverse().join("/");

export default function Dolares({ datos, cajaInicial = "", onCerrar, onHecho }) {
  const toast = useToast();
  const vivas = (datos.tesoreria || []).filter((t) => t.activa !== false);
  const enUsd = vivas.filter((t) => t.moneda === "USD");
  const enPesos = vivas.filter((t) => t.moneda !== "USD");
  const inicial = vivas.find((t) => t.cuenta === cajaInicial);
  const [f, setF] = useState({
    accion: "vender", caja_usd: inicial?.moneda === "USD" ? inicial.cuenta : enUsd.length === 1 ? enUsd[0].cuenta : "",
    caja_pesos: inicial && inicial.moneda !== "USD" ? inicial.cuenta : "", usd: "", tipo_cambio: "", costo: "", fecha: hoyAr(),
    cuenta_diferencia: "", descripcion: "",
  });
  const [calc, setCalc] = useState(null); // { caja, fecha, usd, pesos, costo, sugeridas }
  const [costoTocado, setCostoTocado] = useState(false);
  const [cuentaTocada, setCuentaTocada] = useState(false);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [repetidos, setRepetidos] = useState(null);
  const set = (k) => (e) => { setRepetidos(null); setF((x) => ({ ...x, [k]: e.target.value })); };
  const vender = f.accion === "vender";

  // Vender: a cuánto están anotados los dólares de la caja a esa fecha
  useEffect(() => {
    if (!vender || !f.caja_usd || !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      postTesoreria({ accion: "dolares_costo", caja_usd: f.caja_usd, fecha: f.fecha })
        .then((d) => { if (vivo) setCalc(d); })
        .catch(() => { if (vivo) setCalc(null); });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [vender, f.caja_usd, f.fecha]);
  const calcVigente = calc && calc.caja === f.caja_usd && calc.fecha === f.fecha ? calc : null;
  useEffect(() => {
    if (!costoTocado && calcVigente) setF((x) => ({ ...x, costo: calcVigente.costo ? String(calcVigente.costo).replace(".", ",") : "" }));
  }, [calcVigente, costoTocado]);

  const usd = numero(f.usd);
  const tc = numero(f.tipo_cambio);
  const costo = numero(f.costo);
  const listo = usd > 0 && tc > 0;
  const pesos = listo ? Math.round(usd * tc * 100) / 100 : 0;
  const todoAlCalculado = calcVigente?.costo && Math.abs(usd - calcVigente.usd) < 0.005 && Math.abs(costo - calcVigente.costo) < 0.005;
  const costoPesos = vender && usd > 0 && costo > 0 ? (todoAlCalculado ? calcVigente.pesos : Math.round(usd * costo * 100) / 100) : 0;
  const diferencia = vender && listo && costo > 0 ? Math.round((pesos - costoPesos) * 100) / 100 : 0;
  const gana = diferencia > 0;

  const opcionesDif = useMemo(() => cuentasParaDiferencia(datos.cuentas || []), [datos.cuentas]);
  const sugerida = calcVigente?.sugeridas ? (gana ? calcVigente.sugeridas.ganancia : calcVigente.sugeridas.perdida) : null;
  useEffect(() => {
    if (!cuentaTocada && sugerida) setF((x) => ({ ...x, cuenta_diferencia: sugerida }));
  }, [sugerida, cuentaTocada]);

  async function guardar(confirmarRepetido = false) {
    setError(null);
    setGuardando(true);
    try {
      const { accion, ...resto } = f;
      const d = await postTesoreria({ accion: "dolares", accion_dolares: accion, ...resto, confirmar_repetido: confirmarRepetido });
      toast.success(vender ? "Listo: venta de dólares cargada" : "Listo: compra de dólares cargada");
      for (const a of d.avisos || []) toast.info(a);
      onHecho();
    } catch (e) {
      const rep = repetidosDe(e.status, e.datos);
      if (rep) setRepetidos(rep);
      else setError(e.message);
      setGuardando(false);
    }
  }

  const cajaUsd = enUsd.find((t) => t.cuenta === f.caja_usd);
  const cajaPesos = enPesos.find((t) => t.cuenta === f.caja_pesos);
  const faltaCuenta = vender && Math.abs(diferencia) >= 0.01 && !f.cuenta_diferencia;
  const puedeGuardar = cajaUsd && cajaPesos && listo && (!vender || costo > 0) && !faltaCuenta;

  if (!enUsd.length) {
    return (
      <Modal open onClose={onCerrar} title="💱 Comprar o vender dólares" maxWidth={480}>
        <p className="m-0 text-[14px] text-gypi-text">No hay ninguna caja ni banco en dólares. Creala primero en Finanzas → Configuración (cajas y bancos, moneda USD).</p>
        <div className="flex justify-end mt-3"><button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button></div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onCerrar} title="💱 Comprar o vender dólares" maxWidth={520}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2" role="group" aria-label="Qué hiciste">
          <Chip active={vender} aria-pressed={vender} onClick={() => setF((x) => ({ ...x, accion: "vender" }))}>Vendí dólares</Chip>
          <Chip active={!vender} aria-pressed={!vender} onClick={() => setF((x) => ({ ...x, accion: "comprar" }))}>Compré dólares</Chip>
        </div>
        {campo(vender ? "Salen de (dólares)" : "Entran en (dólares)", (
          <SelectBuscable className="g-input w-full" aria-label="Caja en dólares" value={f.caja_usd} onChange={set("caja_usd")}>
            <option value="">Elegí…</option>
            {enUsd.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
          </SelectBuscable>
        ))}
        {campo(vender ? "Entran en (pesos)" : "Salen de (pesos)", (
          <SelectBuscable className="g-input w-full" aria-label="Caja en pesos" value={f.caja_pesos} onChange={set("caja_pesos")}>
            <option value="">Elegí…</option>
            {enPesos.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
          </SelectBuscable>
        ))}
        <div className="flex flex-wrap gap-2">
          {campo("Dólares (USD)", <input className="g-input w-[140px] text-right font-mono" inputMode="decimal" aria-label="Dólares" value={f.usd} onChange={set("usd")} />)}
          {campo(vender ? "Tipo de cambio de la venta" : "Tipo de cambio de la compra", <input className="g-input w-[140px] text-right font-mono" inputMode="decimal" aria-label="Tipo de cambio" placeholder="1400" value={f.tipo_cambio} onChange={set("tipo_cambio")} />)}
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha" value={f.fecha} onChange={set("fecha")} />)}
        </div>
        {vender && (
          <div className="flex flex-col gap-1">
            {campo("Costo de esos dólares ($ por dólar)", (
              <input className="g-input w-[140px] text-right font-mono" inputMode="decimal" aria-label="Costo de esos dólares" value={f.costo}
                onChange={(e) => { setCostoTocado(true); set("costo")(e); }} />
            ))}
            {calcVigente && (calcVigente.costo
              ? <p className="m-0 text-[12px] text-gypi-dim">Gypi calculó {pesosPorDolar(calcVigente.costo)}: al {fechaCorta(calcVigente.fecha)} {cajaUsd?.nombre} tiene {plata(calcVigente.usd, "USD")} anotados por {plata(calcVigente.pesos)}. Si sabés que es otro, cambialo.</p>
              : <p className="m-0 text-[12px] text-gypi-amber-ink">No pude calcular el costo: {cajaUsd?.nombre} no tiene dólares anotados al {fechaCorta(calcVigente.fecha)}. Poné a cuánto los compraste.</p>)}
          </div>
        )}
        {campo("Nota (opcional)", <input className="g-input w-full" aria-label="Nota" maxLength={200} value={f.descripcion} onChange={set("descripcion")} placeholder="Ej.: venta en la casa de cambio" />)}

        {listo && cajaUsd && cajaPesos && (
          <section aria-label="Así queda" className="rounded-lg border border-gypi-border bg-gypi-surface p-2 text-[13px] text-gypi-text flex flex-col gap-1">
            {vender ? (
              <>
                <span>Salen <b className="font-mono">{plata(usd, "USD")}</b> de {cajaUsd.nombre}{costo > 0 && <> (anotados por <span className="font-mono">{plata(costoPesos)}</span>)</>}.</span>
                <span>Entran <b className="font-mono">{plata(pesos)}</b> en {cajaPesos.nombre}.</span>
                {costo > 0 && (Math.abs(diferencia) < 0.01
                  ? <span>Sin diferencia de cotización.</span>
                  : <span className={gana ? "text-gypi-green font-semibold" : "text-gypi-red font-semibold"}>{gana ? "Ganancia" : "Pérdida"} por diferencia de cotización: {plata(Math.abs(diferencia))}</span>)}
                {calcVigente && usd - calcVigente.usd > 0.005 && <span className="text-gypi-amber-ink">⚠ {cajaUsd.nombre} tiene {plata(calcVigente.usd, "USD")}: la caja queda en negativo.</span>}
              </>
            ) : (
              <>
                <span>Salen <b className="font-mono">{plata(pesos)}</b> de {cajaPesos.nombre}.</span>
                <span>Entran <b className="font-mono">{plata(usd, "USD")}</b> en {cajaUsd.nombre}, anotados a {pesosPorDolar(tc)}.</span>
              </>
            )}
          </section>
        )}

        {vender && Math.abs(diferencia) >= 0.01 && campo(`Cuenta de la ${gana ? "ganancia" : "pérdida"} por diferencia de cotización`, (
          <SelectBuscable className="g-input w-full" aria-label="Cuenta de la diferencia" value={f.cuenta_diferencia} onChange={(e) => { setCuentaTocada(true); set("cuenta_diferencia")(e); }}>
            <option value="">Elegí…</option>
            {opcionesDif.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre} ({c.codigo})</option>)}
          </SelectBuscable>
        ))}

        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {repetidos
          ? <AvisoRepetidos repetidos={repetidos} ocupado={guardando} onCargarIgual={() => guardar(true)} onCancelar={() => setRepetidos(null)} />
          : (
            <div className="flex justify-end gap-2">
              <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
              <button type="button" className="g-btn g-btn-primary" disabled={guardando || !puedeGuardar} onClick={() => guardar()}>{guardando ? "Guardando…" : vender ? "Cargar la venta" : "Cargar la compra"}</button>
            </div>
          )}
      </div>
    </Modal>
  );
}
