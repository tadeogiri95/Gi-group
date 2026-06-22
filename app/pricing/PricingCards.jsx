"use client";
import { useState } from "react";
import Link from "next/link";
import { fH } from "../lib/theme";
import { PLANES, precioAnual } from "../lib/plans";
import EnterpriseContactButton from "../components/EnterpriseContactButton";

const AMBER = "var(--color-empresa-primary, #F97316)";
const AMBER_TEXT = "#000";
const GREEN = "#16A34A";
const DIM = "var(--color-text-dim)";
const TEXT = "var(--color-text)";
const SURFACE = "var(--color-surface)";
const SURF_HI = "var(--color-surf-hi)";
const BORDER = "var(--color-border)";

const PLAN_IDS = ["free", "starter", "pro", "enterprise"];

function formatPrecio(p, anual) {
  if (p.precio == null) return "A medida";
  if (p.precio === 0) return "Gratis";
  return "$" + (anual ? precioAnual(p.id) : p.precio).toLocaleString("es-AR") + "/mes";
}

export default function PricingCards() {
  const [anual, setAnual] = useState(false);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, margin: "0 0 28px" }}>
        <span style={{ fontSize: 13, fontWeight: anual ? 400 : 700, color: anual ? DIM : TEXT }}>Mensual</span>
        <button
          onClick={() => setAnual(!anual)}
          aria-label={anual ? "Cambiar a precio mensual" : "Cambiar a precio anual"}
          style={{
            position: "relative", width: 44, height: 24, borderRadius: 999, cursor: "pointer", padding: 0,
            border: `1px solid ${anual ? AMBER : BORDER}`,
            background: anual ? AMBER : SURFACE,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute", top: 2, left: anual ? 22 : 3,
              width: 18, height: 18, borderRadius: "50%", transition: "left 0.2s",
              background: anual ? "#000" : "var(--color-text-muted)",
            }}
          />
        </button>
        <span style={{ fontSize: 13, fontWeight: anual ? 700 : 400, color: anual ? TEXT : DIM }}>
          Anual <span style={{ fontSize: 10, color: GREEN, fontWeight: 700 }}>-20%</span>
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {PLAN_IDS.map((id) => {
          const p = PLANES[id];
          const isPopular = id === "pro";
          return (
            <div key={id} style={{
              padding: 28, borderRadius: 20,
              background: isPopular ? `linear-gradient(160deg, ${SURFACE}, ${SURF_HI})` : SURFACE,
              border: isPopular ? `2px solid ${AMBER}` : `1px solid ${BORDER}`,
              position: "relative",
            }}>
              {isPopular && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", padding: "4px 16px", borderRadius: 20, background: AMBER, color: AMBER_TEXT, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>
                  POPULAR
                </div>
              )}
              <h2 style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, margin: isPopular ? "8px 0 4px" : "0 0 4px" }}>{p.nombre}</h2>
              <div style={{ fontSize: 13, color: DIM, marginBottom: 16 }}>
                Hasta {p.max_empleados >= 99999 ? "ilimitados" : p.max_empleados} empleados
              </div>
              <div style={{ marginBottom: 20 }}>
                <span style={{ fontFamily: fH, fontSize: 32, fontWeight: 800, color: isPopular ? AMBER : TEXT }}>
                  {formatPrecio(p, anual)}
                </span>
                {p.precio > 0 && anual && (
                  <div style={{ fontSize: 11, color: GREEN, marginTop: 4 }}>
                    Total anual: ${(precioAnual(id) * 12).toLocaleString("es-AR")}
                  </div>
                )}
              </div>
              {id === "enterprise" ? (
                <EnterpriseContactButton style={{
                  display: "block", textAlign: "center", width: "100%", padding: 12, borderRadius: 12,
                  border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: fH,
                  background: SURF_HI, color: TEXT,
                }}>
                  Contactanos
                </EnterpriseContactButton>
              ) : (
                <Link href="/" style={{
                  display: "block", textAlign: "center", width: "100%", padding: 12, borderRadius: 12,
                  textDecoration: "none", fontSize: 14, fontWeight: 700, fontFamily: fH,
                  background: isPopular ? AMBER : SURF_HI,
                  color: isPopular ? "#000" : TEXT,
                }}>
                  {id === "free" ? "Empezar gratis" : "Elegir plan"}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
