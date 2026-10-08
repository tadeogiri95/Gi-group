"use client";
// Elegir plan (ítem 25): línea (Asistencia o Planta), tramo de operarios
// activos y add-ons. Precio en dólares y lo que se cobra en pesos hoy.
import { useState, useEffect } from "react";
import { LINEAS, TRAMOS, ADDONS, PLANES, precioUsd, aPesos } from "../lib/plans";
import { getToken } from "../lib/supabase";
import EnterpriseContactButton from "./EnterpriseContactButton";

const usd = (n) => `USD ${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const pesos = (n) => `$${Number(n).toLocaleString("es-AR")}`;

export function TarjetaLinea({ linea, cotizacion, tramoMinimo, anual, busy, actual, onElegir }) {
  const l = LINEAS[linea];
  const minimo = tramoMinimo ?? TRAMOS[0];
  const [tramo, setTramo] = useState(minimo);
  const [addons, setAddons] = useState([]);
  useEffect(() => { setTramo((t) => Math.max(t, minimo)); }, [minimo]);

  const plan = `${linea}_${tramo}`;
  const periodo = anual ? "anual" : "mensual";
  const total = precioUsd({ plan, addons, periodo });
  const enPesos = aPesos(total, cotizacion?.usd_ars);
  const esActual = actual?.plan === plan && [...(actual.addons || [])].sort().join() === [...addons].sort().join();
  const toggle = (a) => setAddons((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]));

  return (
    <div className="g-card p-4">
      <div className="font-heading text-lg font-bold text-gypi-text">{l.nombre}</div>
      <p className="text-xs text-gypi-dim mt-1 mb-3 leading-relaxed">{l.descripcion}</p>

      <fieldset className="border-none p-0 m-0 mb-3">
        <legend className="text-[11px] text-gypi-dim font-semibold mb-1.5">OPERARIOS ACTIVOS</legend>
        <div className="flex gap-2">
          {TRAMOS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTramo(t)}
              disabled={t < minimo}
              aria-pressed={tramo === t}
              className="flex-1 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                border: `1px solid ${tramo === t ? "var(--color-empresa-primary)" : "var(--color-border)"}`,
                background: tramo === t ? "var(--color-empresa-primary-subtle)" : "transparent",
                color: "var(--color-text)",
              }}
            >
              Hasta {t}
              <span className="block text-xs font-normal text-gypi-dim">{usd(l.usd[t])}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="border-none p-0 m-0 mb-3">
        <legend className="text-[11px] text-gypi-dim font-semibold mb-1.5">ADD-ONS</legend>
        {Object.values(ADDONS).map((a) => (
          <label key={a.id} className="flex items-start gap-2 text-xs text-gypi-text py-1 cursor-pointer">
            <input type="checkbox" checked={addons.includes(a.id)} onChange={() => toggle(a.id)} className="mt-0.5" />
            <span>
              <b>{a.nombre}</b> · {usd(a.usd)}/mes
              <span className="block text-[11px] text-gypi-dim">{a.descripcion}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="font-heading text-xl font-bold text-gypi-amber">{usd(total)}<span className="text-[11px] text-gypi-dim font-normal">/mes</span></div>
          {anual && <div className="text-xs text-gypi-green">Con 20% de descuento · se cobran 12 meses juntos</div>}
        </div>
        <div className="text-right text-[11px] text-gypi-dim">
          {enPesos
            ? <>Hoy: <b className="text-gypi-text">{pesos(enPesos)}</b>/mes<br />Dólar oficial {pesos(cotizacion.usd_ars)}</>
            : "Se cobra en pesos al dólar oficial del día"}
        </div>
      </div>

      {esActual ? (
        <div className="text-gypi-amber text-center py-2.5 rounded-lg text-xs font-bold" style={{ background: "var(--color-empresa-primary-subtle)" }}>
          Plan actual
        </div>
      ) : (
        <button onClick={() => onElegir({ linea, tramo, addons, periodo })} disabled={busy || !enPesos} className="g-btn g-btn-primary w-full">
          {busy ? "Redirigiendo a Mercado Pago..." : `Suscribirme a ${PLANES[plan].nombre}`}
        </button>
      )}
    </div>
  );
}

export default function ElegirPlan({ anual, busy, actual, onElegir }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/billing/precios", { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.json())
      .then((d) => { if (vivo) d.error ? setError(d.error) : setDatos(d); })
      .catch(() => vivo && setError("No pudimos cargar los precios."));
    return () => { vivo = false; };
  }, []);

  if (error) return <div className="text-xs text-gypi-red mb-4">{error}</div>;
  if (!datos) return <div className="text-gypi-dim text-center py-6 text-sm">Calculando precios…</div>;

  const masDeLaCuenta = datos.tramo_minimo?.asistencia == null;
  return (
    <div className="grid gap-3 mb-6">
      <div className="text-xs text-gypi-dim">
        Hoy tenés <b className="text-gypi-text">{datos.operarios}</b> operario{datos.operarios === 1 ? "" : "s"} activo{datos.operarios === 1 ? "" : "s"}.
        Los precios están en dólares y se cobran en pesos al dólar oficial; si el dólar cambia, te avisamos 30 días antes de cobrarte otro monto.
      </div>
      {!masDeLaCuenta && Object.keys(LINEAS).map((l) => (
        <TarjetaLinea
          key={l}
          linea={l}
          cotizacion={datos.cotizacion}
          tramoMinimo={datos.tramo_minimo[l]}
          anual={anual}
          busy={busy}
          actual={actual}
          onElegir={onElegir}
        />
      ))}
      <div className="g-card p-4">
        <div className="font-heading text-lg font-bold text-gypi-text">Enterprise</div>
        <p className="text-xs text-gypi-dim mt-1 mb-3">
          {masDeLaCuenta ? `Con más de ${TRAMOS.at(-1)} operarios armamos un plan a medida.` : `Más de ${TRAMOS.at(-1)} operarios, varias plantas o acuerdos a medida.`}
        </p>
        <EnterpriseContactButton
          className="block w-full text-center py-[11px] rounded-[10px] bg-transparent font-body text-[13px] font-bold cursor-pointer"
          style={{ border: "1px solid var(--color-empresa-primary)", color: "var(--color-empresa-primary)" }}
        >
          Contactanos
        </EnterpriseContactButton>
      </div>
    </div>
  );
}
