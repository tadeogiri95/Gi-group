"use client";
import { useState, useEffect } from "react";
import { C, fH, fB } from "../lib/theme";
import { PLANES } from "../lib/plans";
import { getToken } from "../lib/supabase";

const ORDEN_PLANES = ["free", "starter", "pro", "enterprise"];

export default function BillingScreen({ onClose }) {
  const [info, setInfo] = useState(null);
  const [pagos, setPagos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const cargar = async () => {
    setLoading(true);
    setError("");
    try {
      const token = getToken();
      if (!token) throw new Error("Sin sesión");

      const [rInfo, rPagos] = await Promise.all([
        fetch("/api/billing/info", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch("/api/data?tabla=pagos&order=fecha_pago.desc&limit=20", {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
      ]);

      if (rInfo.error) throw new Error(rInfo.error);
      setInfo(rInfo);
      setPagos(Array.isArray(rPagos?.data) ? rPagos.data : Array.isArray(rPagos) ? rPagos : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const upgrade = async (plan) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const token = getToken();
      const r = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const d = await r.json();
      if (!r.ok || !d.init_point) throw new Error(d.error || "Error creando suscripción");
      // Redirigir a Mercado Pago
      window.location.href = d.init_point;
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const cancelar = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const token = getToken();
      const r = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error cancelando");
      setConfirmCancel(false);
      await cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const abrirPortalMP = async () => {
    try {
      const token = getToken();
      const r = await fetch("/api/billing/portal", { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.portal_url) window.open(d.portal_url, "_blank");
    } catch (e) { setError(e.message); }
  };

  const planActual = info?.plan || "free";
  const estado = info?.estado || "activa";

  const estadoLabel = {
    trial: { txt: "Período de prueba", color: C.amber },
    activa: { txt: "Activa", color: C.green },
    vencida: { txt: "Vencida", color: C.red },
    suspendida: { txt: "Suspendida", color: C.amber },
    cancelada: { txt: "Cancelada", color: C.dim },
  }[estado] || { txt: estado, color: C.dim };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: C.bg, overflowY: "auto" }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, background: C.bg, borderBottom: `1px solid ${C.border}`, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, zIndex: 10 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.text, fontSize: 20, cursor: "pointer", padding: 4 }}>←</button>
        <h1 style={{ margin: 0, fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>Plan y facturación</h1>
      </div>

      <div style={{ padding: 18, maxWidth: 720, margin: "0 auto" }}>
        {loading && <div style={{ color: C.dim, textAlign: "center", padding: 40 }}>Cargando…</div>}

        {error && (
          <div style={{ background: `${C.red}15`, border: `1px solid ${C.red}50`, color: C.red, padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {!loading && info && (
          <>
            {/* ─── Plan actual ─── */}
            <div style={{ background: C.surface, borderRadius: 16, padding: 18, border: `1px solid ${C.border}`, marginBottom: 18 }}>
              <div style={{ fontSize: 11, color: C.dim, fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>TU PLAN ACTUAL</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <span style={{ fontFamily: fH, fontSize: 28, fontWeight: 700, color: C.amber }}>
                  {PLANES[planActual]?.nombre || planActual}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: estadoLabel.color, background: `${estadoLabel.color}20`, padding: "3px 8px", borderRadius: 6 }}>
                  {estadoLabel.txt}
                </span>
              </div>

              {estado === "trial" && info.dias_restantes !== null && (
                <div style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>
                  🎁 Te quedan <b>{info.dias_restantes} día{info.dias_restantes !== 1 ? "s" : ""}</b> de prueba.
                </div>
              )}

              {info.periodo_fin && estado === "activa" && (
                <div style={{ fontSize: 12, color: C.dim }}>
                  Próximo cobro: {new Date(info.periodo_fin).toLocaleDateString("es-AR")}
                </div>
              )}

              {info.precio > 0 && (
                <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>
                  ${Number(info.precio).toLocaleString("es-AR")} {info.moneda}/mes
                </div>
              )}

              {/* Botones gestión */}
              {(estado === "activa" || estado === "suspendida") && info.gateway === "mercadopago" && (
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <button onClick={abrirPortalMP} style={btnSecundario}>Ver historial en MP</button>
                  <button onClick={() => setConfirmCancel(true)} style={{ ...btnSecundario, color: C.red, borderColor: `${C.red}50` }}>
                    Cancelar suscripción
                  </button>
                </div>
              )}
            </div>

            {/* ─── Planes disponibles ─── */}
            <div style={{ marginBottom: 8, fontSize: 12, color: C.dim, fontWeight: 600, letterSpacing: 0.5 }}>
              {planActual === "free" || estado === "trial" || estado === "vencida" ? "ELEGÍ TU PLAN" : "CAMBIAR DE PLAN"}
            </div>

            <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
              {ORDEN_PLANES.map((pid) => {
                const p = PLANES[pid];
                const esActual = pid === planActual && estado === "activa";
                const esEnterprise = pid === "enterprise";
                return (
                  <div key={pid} style={{
                    background: C.surface,
                    borderRadius: 14,
                    padding: 16,
                    border: `1px solid ${esActual ? C.amber : C.border}`,
                    opacity: esActual ? 0.7 : 1,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>{p.nombre}</div>
                        <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                          Hasta {p.max_empleados.toLocaleString("es-AR")} empleados
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, color: C.amber }}>
                          {p.precio === 0 ? "Gratis" : p.precio ? `$${p.precio.toLocaleString("es-AR")}` : "A convenir"}
                        </div>
                        {p.precio > 0 && <div style={{ fontSize: 11, color: C.dim }}>{p.moneda}/mes</div>}
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.7, marginBottom: 12 }}>
                      {p.geolocalizacion && <>✓ Geo {p.max_ubicaciones >= 999 ? "ilimitada" : `(${p.max_ubicaciones} ubic.)`}<br /></>}
                      {p.exportar_csv && <>✓ Exportar CSV<br /></>}
                      {p.exportar_pdf && <>✓ Reportes PDF<br /></>}
                      {p.calendario && <>✓ Calendario con notas<br /></>}
                      {p.reglas_bot && <>✓ Reglas personalizadas del bot<br /></>}
                      {p.soporte && <>✓ Soporte {p.soporte}<br /></>}
                      {p.api_access && <>✓ Acceso API<br /></>}
                    </div>

                    {esActual ? (
                      <div style={{ background: `${C.amber}20`, color: C.amber, textAlign: "center", padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                        Plan actual
                      </div>
                    ) : esEnterprise ? (
                      <a href="mailto:tadeogiri@gmail.com?subject=Consulta plan Enterprise" style={{
                        display: "block", textAlign: "center", padding: 11, borderRadius: 10,
                        background: "transparent", border: `1px solid ${C.amber}`, color: C.amber,
                        fontSize: 13, fontWeight: 700, textDecoration: "none", fontFamily: fB,
                      }}>
                        Contactanos
                      </a>
                    ) : pid === "free" ? null : (
                      <button
                        onClick={() => upgrade(pid)}
                        disabled={busy}
                        style={{
                          width: "100%", padding: 11, borderRadius: 10, border: "none",
                          background: C.amber, color: "#000", fontSize: 13, fontWeight: 700,
                          cursor: busy ? "wait" : "pointer", fontFamily: fB, opacity: busy ? 0.6 : 1,
                        }}
                      >
                        {busy ? "Redirigiendo a MP…" : `Suscribirme a ${p.nombre}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ─── Historial de pagos ─── */}
            <div style={{ marginBottom: 8, fontSize: 12, color: C.dim, fontWeight: 600, letterSpacing: 0.5 }}>HISTORIAL DE PAGOS</div>
            <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 30 }}>
              {pagos.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: C.dim, fontSize: 13 }}>Aún no hay pagos registrados.</div>
              ) : (
                pagos.map((p, i) => {
                  const estadoCol = p.estado === "aprobado" ? C.green : p.estado === "rechazado" ? C.red : C.amber;
                  return (
                    <div key={p.id || i} style={{
                      padding: 13,
                      borderBottom: i < pagos.length - 1 ? `1px solid ${C.border}` : "none",
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                    }}>
                      <div>
                        <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                          ${Number(p.monto).toLocaleString("es-AR")} {p.moneda}
                        </div>
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                          {p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString("es-AR") : "—"}
                          {p.gateway && ` · ${p.gateway}`}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: estadoCol, background: `${estadoCol}20`, padding: "3px 8px", borderRadius: 6 }}>
                        {p.estado}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── Modal confirmar cancelación ─── */}
      {confirmCancel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={() => setConfirmCancel(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 380, background: C.bg, borderRadius: 20, padding: 24, border: `1px solid ${C.red}40` }}>
            <h2 style={{ margin: 0, fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text, textAlign: "center" }}>
              ¿Cancelar suscripción?
            </h2>
            <p style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.5, margin: "10px 0 18px" }}>
              Vas a seguir teniendo acceso hasta el fin del período pago. Después pasarás al plan Free.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmCancel(false)} style={{ ...btnSecundario, flex: 1 }}>Volver</button>
              <button onClick={cancelar} disabled={busy} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: C.red, color: "#fff", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: fB, opacity: busy ? 0.6 : 1 }}>
                {busy ? "..." : "Sí, cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnSecundario = {
  padding: "9px 14px",
  borderRadius: 8,
  background: "transparent",
  border: `1px solid ${C.border}`,
  color: C.text,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: fB,
};