"use client";
// Precios públicos (landing y /pricing, ítem 25): Asistencia y Planta por
// tramos de operarios activos + add-ons, en dólares. Se cobran en pesos al
// dólar oficial del día, después de 30 días de prueba gratis.
import { useState } from "react";
import { LINEAS, TRAMOS, ADDONS, DESCUENTO_ANUAL, DIAS_TRIAL } from "../lib/plans";
import EnterpriseContactButton from "./EnterpriseContactButton";

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const DIM = "var(--color-text-dim)";
const TEXT = "var(--color-text)";
const SURFACE = "var(--color-surface)";
const SURF_HI = "var(--color-surf-hi)";
const BORDER = "var(--color-border)";
const fH = "'Bricolage Grotesque', system-ui";

export function usdMes(n, anual) {
  const v = anual ? Math.round(n * (1 - DESCUENTO_ANUAL) * 100) / 100 : n;
  return `USD ${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}

export default function TablaPrecios({ onEmpezar }) {
  const [anual, setAnual] = useState(false);
  const boton = {
    display: "block", textAlign: "center", width: "100%", padding: 12, borderRadius: 12,
    border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: fH, textDecoration: "none",
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, margin: "0 0 28px" }}>
        <span style={{ fontSize: 13, fontWeight: anual ? 400 : 700, color: anual ? DIM : TEXT }}>Mensual</span>
        <button
          onClick={() => setAnual(!anual)}
          aria-label={anual ? "Ver precio mensual" : "Ver precio pagando un año"}
          aria-pressed={anual}
          style={{ position: "relative", width: 44, height: 24, borderRadius: 999, cursor: "pointer", padding: 0, border: `1px solid ${anual ? AMBER : BORDER}`, background: anual ? AMBER : SURFACE }}
        >
          <span aria-hidden="true" style={{ position: "absolute", top: 2, left: anual ? 22 : 3, width: 18, height: 18, borderRadius: "50%", transition: "left 0.2s", background: anual ? "#000" : "var(--color-text-muted)" }} />
        </button>
        <span style={{ fontSize: 13, fontWeight: anual ? 700 : 400, color: anual ? TEXT : DIM }}>
          Anual <span style={{ fontSize: 10, color: GREEN, fontWeight: 700 }}>-{Math.round(DESCUENTO_ANUAL * 100)}%</span>
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {Object.values(LINEAS).map((l) => {
          const destacada = l.id === "planta";
          return (
            <div key={l.id} style={{ padding: 28, borderRadius: 20, background: destacada ? `linear-gradient(160deg, ${SURFACE}, ${SURF_HI})` : SURFACE, border: destacada ? `2px solid ${AMBER}` : `1px solid ${BORDER}` }}>
              <h3 style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>{l.nombre}</h3>
              <p style={{ fontSize: 13, color: DIM, lineHeight: 1.5, margin: "0 0 16px" }}>{l.descripcion}</p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
                <caption style={{ textAlign: "left", fontSize: 11, color: DIM, fontWeight: 600, paddingBottom: 6 }}>Por mes, según operarios activos</caption>
                <tbody>
                  {TRAMOS.map((t) => (
                    <tr key={t}>
                      <th scope="row" style={{ textAlign: "left", fontSize: 13, color: DIM, fontWeight: 400, padding: "6px 0", borderTop: `1px solid ${BORDER}` }}>Hasta {t}</th>
                      <td style={{ textAlign: "right", fontFamily: fH, fontSize: 18, fontWeight: 800, color: destacada ? AMBER : TEXT, padding: "6px 0", borderTop: `1px solid ${BORDER}` }}>{usdMes(l.usd[t], anual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={onEmpezar} style={{ ...boton, background: destacada ? AMBER : SURF_HI, color: destacada ? "#000" : TEXT }}>
                Probar {DIAS_TRIAL} días gratis
              </button>
            </div>
          );
        })}

        <div style={{ padding: 28, borderRadius: 20, background: SURFACE, border: `1px solid ${BORDER}` }}>
          <h3 style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>Add-ons</h3>
          <p style={{ fontSize: 13, color: DIM, lineHeight: 1.5, margin: "0 0 16px" }}>Se suman a cualquiera de los dos planes.</p>
          {Object.values(ADDONS).map((a) => (
            <div key={a.id} style={{ padding: "8px 0", borderTop: `1px solid ${BORDER}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700 }}>
                <span>{a.nombre}</span><span>{usdMes(a.usd, anual)}</span>
              </div>
              <div style={{ fontSize: 12, color: DIM, marginTop: 2 }}>{a.descripcion}</div>
            </div>
          ))}
          <h3 style={{ fontFamily: fH, fontSize: 18, fontWeight: 700, margin: "20px 0 6px" }}>Enterprise</h3>
          <p style={{ fontSize: 13, color: DIM, lineHeight: 1.5, margin: "0 0 12px" }}>Más de {TRAMOS.at(-1)} operarios, varias plantas o acuerdos a medida.</p>
          <EnterpriseContactButton style={{ ...boton, background: SURF_HI, color: TEXT }}>Contactanos</EnterpriseContactButton>
        </div>
      </div>

      <p style={{ fontSize: 12, color: DIM, textAlign: "center", lineHeight: 1.6, maxWidth: 640, margin: "20px auto 0" }}>
        Los precios están en dólares y se cobran en pesos con Mercado Pago, al dólar oficial del Banco Nación del día en que te suscribís.
        Si el dólar se mueve, te avisamos 30 días antes de cobrar otro monto. El tramo se calcula con las personas activas cargadas en la app.
        {anual ? " Pagando un año, se cobran los 12 meses juntos con el descuento." : ""}
      </p>
    </>
  );
}
