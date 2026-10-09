"use client";
// Precios públicos (landing y /pricing, ítem 25): Asistencia y Planta por
// tramos de operarios activos + add-ons, en dólares. Se cobran en pesos al
// dólar oficial del día, después de 30 días de prueba gratis.
import { useState } from "react";
import { LINEAS, TRAMOS, ADDONS, DESCUENTO_ANUAL, DIAS_TRIAL } from "../lib/plans";
import EnterpriseContactButton from "./EnterpriseContactButton";

export function usdMes(n, anual) {
  const v = anual ? Math.round(n * (1 - DESCUENTO_ANUAL) * 100) / 100 : n;
  return `USD ${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}

// R11: clases en vez de estilos sueltos; el botón principal con el color de la marca
const BOTON = "block text-center w-full min-h-12 p-3 rounded-xl border-none cursor-pointer text-[15px] font-bold font-heading no-underline";

export default function TablaPrecios({ onEmpezar }) {
  const [anual, setAnual] = useState(false);

  return (
    <>
      <div className="flex justify-center items-center gap-2.5 mb-7">
        <span className={`text-[14px] ${anual ? "font-normal text-gypi-dim" : "font-bold text-gypi-text"}`}>Mensual</span>
        <button
          onClick={() => setAnual(!anual)}
          aria-label={anual ? "Ver precio mensual" : "Ver precio pagando un año"}
          aria-pressed={anual}
          className={`relative w-12 h-7 rounded-full cursor-pointer p-0 border ${anual ? "border-gypi-amber bg-gypi-amber" : "border-gypi-border bg-gypi-surface"}`}
        >
          <span aria-hidden="true" className={`absolute top-[3px] w-5 h-5 rounded-full transition-all duration-200 ${anual ? "left-[23px] bg-gypi-on-amber" : "left-[3px] bg-(--color-text-muted)"}`} />
        </button>
        <span className={`text-[14px] ${anual ? "font-bold text-gypi-text" : "font-normal text-gypi-dim"}`}>
          Anual <span className="text-[13px] font-bold text-gypi-green-ink">-{Math.round(DESCUENTO_ANUAL * 100)}%</span>
        </span>
      </div>

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
        {Object.values(LINEAS).map((l) => {
          const destacada = l.id === "planta";
          return (
            <div key={l.id} className={`p-7 rounded-[20px] ${destacada ? "bg-linear-160 from-gypi-surface to-gypi-surf-hi border-2 border-gypi-amber" : "bg-gypi-surface border border-gypi-border"}`}>
              <h3 className="font-heading text-[22px] font-bold m-0 mb-1.5">{l.nombre}</h3>
              <p className="text-[14px] text-gypi-dim leading-normal m-0 mb-4">{l.descripcion}</p>
              <table className="w-full border-collapse mb-5">
                <caption className="text-left text-[12px] text-gypi-dim font-semibold pb-1.5">Por mes, según operarios activos</caption>
                <tbody>
                  {TRAMOS.map((t) => (
                    <tr key={t}>
                      <th scope="row" className="text-left text-[14px] text-gypi-dim font-normal py-1.5 border-t border-gypi-border">Hasta {t}</th>
                      <td className={`text-right font-heading text-[18px] font-extrabold py-1.5 border-t border-gypi-border ${destacada ? "text-gypi-amber-ink" : "text-gypi-text"}`}>{usdMes(l.usd[t], anual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={onEmpezar} className={`${BOTON} ${destacada ? "bg-gypi-amber text-gypi-on-amber" : "bg-gypi-surf-hi text-gypi-text"}`}>
                Probar {DIAS_TRIAL} días gratis
              </button>
            </div>
          );
        })}

        <div className="p-7 rounded-[20px] bg-gypi-surface border border-gypi-border">
          <h3 className="font-heading text-[22px] font-bold m-0 mb-1.5">Add-ons</h3>
          <p className="text-[14px] text-gypi-dim leading-normal m-0 mb-4">Se suman a cualquiera de los dos planes.</p>
          {Object.values(ADDONS).map((a) => (
            <div key={a.id} className="py-2 border-t border-gypi-border">
              <div className="flex justify-between text-[14px] font-bold">
                <span>{a.nombre}</span><span>{usdMes(a.usd, anual)}</span>
              </div>
              <div className="text-[13px] text-gypi-dim mt-0.5">{a.descripcion}</div>
            </div>
          ))}
          <h3 className="font-heading text-[18px] font-bold mt-5 mb-1.5">Enterprise</h3>
          <p className="text-[14px] text-gypi-dim leading-normal m-0 mb-3">Más de {TRAMOS.at(-1)} operarios, varias plantas o acuerdos a medida.</p>
          <EnterpriseContactButton className={`${BOTON} bg-gypi-surf-hi text-gypi-text`}>Contactanos</EnterpriseContactButton>
        </div>
      </div>

      <p className="text-[13px] text-gypi-dim text-center leading-relaxed max-w-[640px] mx-auto mt-5">
        Los precios están en dólares y se cobran en pesos con Mercado Pago, al dólar oficial del Banco Nación del día en que te suscribís.
        Si el dólar se mueve, te avisamos 30 días antes de cobrar otro monto. El tramo se calcula con las personas activas cargadas en la app.
        {anual ? " Pagando un año, se cobran los 12 meses juntos con el descuento." : ""}
      </p>
    </>
  );
}
