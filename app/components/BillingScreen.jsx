"use client";
import { useState, useEffect } from "react";
import { PLANES, precioAnual } from "../lib/plans";
import { sb, getToken } from "../lib/supabase";
import EnterpriseContactButton from "./EnterpriseContactButton";

const ORDEN_PLANES = ["free", "starter", "pro", "enterprise"];

export default function BillingScreen({ onClose }) {
  const [info, setInfo] = useState(null);
  const [pagos, setPagos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [anual, setAnual] = useState(false);

  const cargar = async () => {
    setLoading(true);
    setError("");
    try {
      const token = getToken();
      if (!token) throw new Error("Sin sesión");

      const [rInfo, rPagos] = await Promise.all([
        fetch("/api/billing/info", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        sb.get("pagos?order=fecha_pago.desc&limit=20").catch(() => []),
      ]);

      if (rInfo.error) throw new Error(rInfo.error);
      setInfo(rInfo);
      setPagos(Array.isArray(rPagos) ? rPagos : []);
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
      const periodo = anual ? "anual" : "mensual";
      const r = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ plan, periodo }),
      });
      const txt = await r.text();
      let d = {};
      try { d = txt ? JSON.parse(txt) : {}; } catch {}
      if (!r.ok || !d.init_point) {
        throw new Error(d.error || `Error ${r.status}: ${txt?.slice(0, 200) || "respuesta vacía"}`);
      }
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

  const estadoMap = {
    trial:      { txt: "Período de prueba", colorClass: "text-gypi-amber",  bgStyle: "var(--color-empresa-primary)" },
    activa:     { txt: "Activa",            colorClass: "text-gypi-green",  bgStyle: "var(--color-green)" },
    vencida:    { txt: "Vencida",           colorClass: "text-gypi-red",    bgStyle: "var(--color-red)" },
    suspendida: { txt: "Suspendida",        colorClass: "text-gypi-amber",  bgStyle: "var(--color-empresa-primary)" },
    cancelada:  { txt: "Cancelada",         colorClass: "text-gypi-dim",    bgStyle: "var(--color-text-muted)" },
  };
  const estadoLabel = estadoMap[estado] || { txt: estado, colorClass: "text-gypi-dim", bgStyle: "var(--color-text-muted)" };

  return (
    <div className="fixed inset-0 z-[200] bg-gypi-bg overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-gypi-bg border-b border-gypi-border flex items-center gap-3 z-10 px-[18px] py-[14px]">
        <button
          onClick={onClose}
          aria-label="Volver"
          className="bg-transparent border-none text-gypi-text text-xl cursor-pointer p-1"
        >
          ←
        </button>
        <h1 className="m-0 font-heading text-lg font-bold text-gypi-text">Plan y facturación</h1>
      </div>

      <div className="p-[18px] max-w-[720px] mx-auto">
        {loading && <div className="text-gypi-dim text-center py-10">Cargando...</div>}

        {error && (
          <div
            className="text-gypi-red text-[13px] rounded-[10px] mb-[14px] p-3"
            style={{ background: "var(--color-red-subtle)", border: "1px solid color-mix(in srgb, var(--color-red) 30%, transparent)" }}
          >
            <span aria-hidden="true">&#x26A0;&#xFE0F;</span> {error}
          </div>
        )}

        {!loading && info && (
          <>
            {/* --- Plan actual --- */}
            <div className="g-card mb-[18px] p-[18px]">
              <div className="text-[11px] text-gypi-dim font-semibold tracking-wide mb-1.5">TU PLAN ACTUAL</div>
              <div className="flex items-baseline gap-2.5 mb-2">
                <span className="font-heading text-[28px] font-bold text-gypi-amber">
                  {PLANES[planActual]?.nombre || planActual}
                </span>
                <span
                  className={`text-[11px] font-bold ${estadoLabel.colorClass} py-[3px] px-2 rounded-md`}
                  style={{ background: `${estadoLabel.bgStyle}20` }}
                >
                  {estadoLabel.txt}
                </span>
              </div>

              {estado === "trial" && info.dias_restantes !== null && (
                <div className="text-[13px] text-gypi-text mb-1.5">
                  <span aria-hidden="true">&#x1F381;</span> Te quedan <b>{info.dias_restantes} día{info.dias_restantes !== 1 ? "s" : ""}</b> de prueba.
                </div>
              )}

              {info.periodo_fin && estado === "activa" && (
                <div className="text-xs text-gypi-dim">
                  Próximo cobro: {new Date(info.periodo_fin).toLocaleDateString("es-AR")}
                </div>
              )}

              {info.precio > 0 && (
                <div className="text-[13px] text-gypi-dim mt-1">
                  ${Number(info.precio).toLocaleString("es-AR")} {info.moneda}/mes
                </div>
              )}

              {/* Botones gestión */}
              {(estado === "activa" || estado === "suspendida") && info.gateway === "mercadopago" && (
                <div className="flex gap-2 mt-3.5 flex-wrap">
                  <button onClick={abrirPortalMP} className="g-btn g-btn-secondary text-xs">
                    Ver historial en MP
                  </button>
                  <button
                    onClick={() => setConfirmCancel(true)}
                    className="g-btn g-btn-secondary text-xs"
                    style={{ color: "var(--color-red)", borderColor: "color-mix(in srgb, var(--color-red) 30%, transparent)" }}
                  >
                    Cancelar suscripción
                  </button>
                </div>
              )}
            </div>

            {/* --- Planes disponibles --- */}
            <div className="flex items-center justify-between mb-3.5">
              <div className="text-xs text-gypi-dim font-semibold tracking-wide">
                {planActual === "free" || estado === "trial" || estado === "vencida" ? "ELEGÍ TU PLAN" : "CAMBIAR DE PLAN"}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${anual ? "text-gypi-dim font-normal" : "text-gypi-text font-bold"}`}>Mensual</span>
                <button
                  onClick={() => setAnual(!anual)}
                  aria-label={anual ? "Cambiar a mensual" : "Cambiar a anual"}
                  className="relative w-11 h-6 rounded-full border cursor-pointer p-0 transition-all duration-300"
                  style={{
                    background: anual ? "var(--color-empresa-primary)" : "var(--color-surface)",
                    borderColor: anual ? "var(--color-empresa-primary)" : "var(--color-border)",
                  }}
                >
                  <div
                    className="w-[18px] h-[18px] rounded-full absolute top-[2px] transition-[left] duration-300"
                    style={{
                      background: anual ? "#000" : "var(--color-text-muted)",
                      left: anual ? 22 : 3,
                    }}
                  />
                </button>
                <span className={`text-xs ${anual ? "text-gypi-text font-bold" : "text-gypi-dim font-normal"}`}>
                  Anual <span className="text-[10px] text-gypi-green font-bold">-20%</span>
                </span>
              </div>
            </div>

            <div className="grid gap-3 mb-6">
              {ORDEN_PLANES.map((pid) => {
                const p = PLANES[pid];
                const esActual = pid === planActual && estado === "activa";
                const esEnterprise = pid === "enterprise";
                return (
                  <div
                    key={pid}
                    className="g-card p-4"
                    style={{
                      borderColor: esActual ? "var(--color-empresa-primary)" : undefined,
                      opacity: esActual ? 0.7 : 1,
                    }}
                  >
                    <div className="flex justify-between items-start mb-2.5">
                      <div>
                        <div className="font-heading text-lg font-bold text-gypi-text">{p.nombre}</div>
                        <div className="text-xs text-gypi-dim mt-0.5">
                          Hasta {p.max_empleados.toLocaleString("es-AR")} empleados
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-heading text-xl font-bold text-gypi-amber">
                          {p.precio === 0 ? "Gratis" : p.precio ? `$${(anual ? precioAnual(pid) : p.precio).toLocaleString("es-AR")}` : "A convenir"}
                        </div>
                        {p.precio > 0 && <div className="text-[11px] text-gypi-dim">{p.moneda}/mes</div>}
                        {p.precio > 0 && anual && <div className="text-[10px] text-gypi-green">Total anual: ${(precioAnual(pid) * 12).toLocaleString("es-AR")}</div>}
                      </div>
                    </div>

                    <div className="text-xs text-gypi-dim leading-[1.7] mb-3">
                      {p.geolocalizacion && <>&#x2713; Geo {p.max_ubicaciones >= 999 ? "ilimitada" : `(${p.max_ubicaciones} ubic.)`}<br /></>}
                      {p.exportar_csv && <>&#x2713; Exportar CSV<br /></>}
                      {p.exportar_pdf && <>&#x2713; Reportes PDF<br /></>}
                      {p.calendario && <>&#x2713; Calendario con notas<br /></>}
                      {p.reglas_bot && <>&#x2713; Reglas personalizadas del bot<br /></>}
                      {p.soporte && <>&#x2713; Soporte {p.soporte}<br /></>}
                      {p.api_access && <>&#x2713; Acceso API<br /></>}
                    </div>

                    {esActual ? (
                      <div
                        className="text-gypi-amber text-center py-2.5 rounded-lg text-xs font-bold"
                        style={{ background: "var(--color-empresa-primary-subtle)" }}
                      >
                        Plan actual
                      </div>
                    ) : esEnterprise ? (
                      <EnterpriseContactButton
                        className="block w-full text-center py-[11px] rounded-[10px] bg-transparent font-body text-[13px] font-bold cursor-pointer"
                        style={{
                          border: "1px solid var(--color-empresa-primary)",
                          color: "var(--color-empresa-primary)",
                        }}
                      >
                        Contactanos
                      </EnterpriseContactButton>
                    ) : pid === "free" ? null : (
                      <button
                        onClick={() => upgrade(pid)}
                        disabled={busy}
                        className="g-btn g-btn-primary w-full"
                      >
                        {busy ? "Redirigiendo a MP..." : `Suscribirme a ${p.nombre}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* --- Historial de pagos --- */}
            <div className="mb-2 text-xs text-gypi-dim font-semibold tracking-wide">HISTORIAL DE PAGOS</div>
            <div className="bg-gypi-surface rounded-[14px] border border-gypi-border overflow-hidden mb-[30px]">
              {pagos.length === 0 ? (
                <div className="p-6 text-center text-gypi-dim text-[13px]">Aún no hay pagos registrados.</div>
              ) : (
                pagos.map((p, i) => {
                  const estadoCol = p.estado === "aprobado" ? "text-gypi-green" : p.estado === "rechazado" ? "text-gypi-red" : "text-gypi-amber";
                  const estadoBgVar = p.estado === "aprobado" ? "var(--color-green)" : p.estado === "rechazado" ? "var(--color-red)" : "var(--color-empresa-primary)";
                  return (
                    <div
                      key={p.id || i}
                      className="flex justify-between items-center gap-2.5 p-[13px]"
                      style={{ borderBottom: i < pagos.length - 1 ? "1px solid var(--color-border)" : "none" }}
                    >
                      <div>
                        <div className="text-[13px] text-gypi-text font-semibold">
                          ${Number(p.monto).toLocaleString("es-AR")} {p.moneda}
                        </div>
                        <div className="text-[11px] text-gypi-dim mt-0.5">
                          {p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString("es-AR") : "—"}
                          {p.gateway && ` · ${p.gateway}`}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-bold ${estadoCol} py-[3px] px-2 rounded-md`}
                        style={{ background: `${estadoBgVar}20` }}
                      >
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

      {/* --- Modal confirmar cancelación --- */}
      {confirmCancel && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-[18px]"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar cancelación de suscripción"
        >
          <div onClick={() => setConfirmCancel(false)} className="absolute inset-0 bg-black/70" />
          <div
            className="relative w-full max-w-[380px] bg-gypi-bg rounded-[20px] p-6"
            style={{ border: "1px solid color-mix(in srgb, var(--color-red) 25%, transparent)" }}
          >
            <h2 className="m-0 font-heading text-lg font-bold text-gypi-text text-center">
              ¿Cancelar suscripción?
            </h2>
            <p className="text-[13px] text-gypi-dim text-center leading-normal mx-0 mt-2.5 mb-[18px]">
              Vas a seguir teniendo acceso hasta el fin del período pago. Después pasarás al plan Free.
            </p>
            <div className="flex gap-2.5">
              <button onClick={() => setConfirmCancel(false)} className="g-btn g-btn-secondary flex-1">
                Volver
              </button>
              <button
                onClick={cancelar}
                disabled={busy}
                className="g-btn g-btn-danger flex-1"
                style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
              >
                {busy ? "..." : "Sí, cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
