"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useConfirm } from "../components/ui/ConfirmDialog";

const PLAN_LABEL = { free: "Free", trial: "Trial", starter: "Starter", pro: "Pro", enterprise: "Enterprise" };
const PLAN_COLOR = { free: "#6B7280", trial: "#0F6E56", starter: "#3B82F6", pro: "#F97316", enterprise: "#A78BFA" };
const PLANES_OPCIONES = ["free", "trial", "starter", "pro", "enterprise"];
const PLAN_ORDEN = ["free", "trial", "starter", "pro", "enterprise"];

const ACCION_COLOR = {
  login: "#3B82F6", logout: "#6B7280",
  impersonate: "#F97316", cambiar_plan: "#A78BFA",
  borrar_datos_empleado: "#EF4444",
};

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 12, padding: "18px 22px" }}>
      <div style={{ fontSize: 12, color: "#6B6560", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#F5F0E8", letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#9B8F85", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 20 }}>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid rgba(255,240,220,0.1)", background: "transparent", color: page <= 1 ? "#3A3530" : "#9B8F85", fontSize: 13, cursor: page <= 1 ? "default" : "pointer" }}
      >
        ‹
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} style={{ padding: "6px 4px", color: "#6B6560", fontSize: 13 }}>…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            style={{
              padding: "6px 12px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: p === page ? "rgba(249,115,22,0.2)" : "transparent",
              color: p === page ? "#F97316" : "#9B8F85",
            }}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid rgba(255,240,220,0.1)", background: "transparent", color: page >= totalPages ? "#3A3530" : "#9B8F85", fontSize: 13, cursor: page >= totalPages ? "default" : "pointer" }}
      >
        ›
      </button>
      <span style={{ marginLeft: 12, fontSize: 12, color: "#6B6560" }}>
        {total} empresa{total !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

export default function Dashboard({ initialData }) {
  const [empresas, setEmpresas] = useState(initialData?.empresas || []);
  const [total, setTotal] = useState(initialData?.total || 0);
  const [page, setPage] = useState(initialData?.page || 1);
  const [pageSize] = useState(initialData?.pageSize || 50);
  const [stats, setStats] = useState(initialData?.stats || null);
  const [loading, setLoading] = useState(false);
  const [impersonating, setImpersonating] = useState(null);
  const [changingPlan, setChangingPlan] = useState(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("empresas");
  const [confirmFn, ConfirmDialog] = useConfirm();
  const searchTimer = useRef(null);

  // ── Métricas SaaS ──
  const [metricas, setMetricas] = useState(null);
  const [metricasLoading, setMetricasLoading] = useState(false);

  // ── Auditoría ──
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditEmpresa, setAuditEmpresa] = useState("");
  const [auditAccion, setAuditAccion] = useState("");

  const fetchEmpresas = useCallback(async (p = page, s = search) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(pageSize) });
    if (s) params.set("search", s);
    const r = await fetch(`/api/superadmin/empresas?${params}`, { credentials: "include" });
    const d = await r.json();
    if (d.empresas) {
      setEmpresas(d.empresas);
      setTotal(d.total ?? 0);
      setPage(d.page ?? p);
      if (d.stats) setStats(d.stats);
    }
    setLoading(false);
  }, [page, pageSize, search]);

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (auditEmpresa) params.set("empresa_id", auditEmpresa);
    if (auditAccion) params.set("accion", auditAccion);
    const r = await fetch(`/api/superadmin/audit-log?${params}`, { credentials: "include" });
    const d = await r.json();
    if (d.rows) setAuditRows(d.rows);
    setAuditLoading(false);
  }, [auditEmpresa, auditAccion]);

  const fetchMetricas = useCallback(async () => {
    setMetricasLoading(true);
    try {
      const r = await fetch("/api/superadmin/metricas", { credentials: "include" });
      const d = await r.json();
      if (!d.error) setMetricas(d);
    } catch {}
    setMetricasLoading(false);
  }, []);

  useEffect(() => { if (tab === "metricas") fetchMetricas(); }, [tab, fetchMetricas]);
  useEffect(() => { if (tab === "auditoria") fetchAudit(); }, [tab, fetchAudit]);

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchEmpresas(newPage, search);
  };

  const handleSearch = (value) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      fetchEmpresas(1, value);
    }, 350);
  };

  const refresh = () => fetchEmpresas(page, search);

  const impersonate = async (e) => {
    setImpersonating(e.id);
    const r = await fetch("/api/superadmin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ empresa_id: e.id }),
    });
    const d = await r.json();
    setImpersonating(null);
    if (d.url) {
      window.open(d.url, "_blank");
    } else {
      alert(d.error || "Error generando acceso");
    }
  };

  const cambiarPlan = async (empresaId, nuevoPlan) => {
    const emp = empresas.find(e => e.id === empresaId);
    if (!await confirmFn(`¿Cambiar plan de "${emp?.nombre || empresaId}" a "${nuevoPlan}"?`, { title: "Cambiar plan", confirmLabel: "Cambiar" })) return;
    setChangingPlan(empresaId);
    const r = await fetch("/api/superadmin/cambiar-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ empresa_id: empresaId, plan: nuevoPlan }),
    });
    const d = await r.json();
    setChangingPlan(null);
    if (d.ok) {
      setEmpresas((prev) => prev.map((e) => e.id === empresaId ? { ...e, plan_activo: nuevoPlan } : e));
      fetchEmpresas(page, search);
    } else {
      alert(d.error || "Error cambiando plan");
    }
  };

  // Stats from server
  const st = stats || {};
  const tasaConversion = st.trial_usado > 0 ? (st.convertidas / st.trial_usado) * 100 : 0;
  const porPlan = PLAN_ORDEN.map((p) => {
    const found = (st.por_plan || []).find((x) => x.plan === p);
    return { plan: p, count: found?.count || 0 };
  });
  const totalEmpresas = st.total || total;

  // Trials por vencer: computed from current page empresas that are trials
  // (this is an approximation — for a precise list we'd need a dedicated endpoint)
  const diasRestantes = (fechaIso) => fechaIso ? Math.ceil((new Date(fechaIso) - new Date()) / 86400000) : null;
  const trialsPorVencer = empresas
    .filter((e) => e.plan_activo === "trial")
    .map((e) => ({ ...e, dias: diasRestantes(e.suscripcion?.trial_fin) }))
    .filter((e) => e.dias !== null && e.dias <= 3)
    .sort((a, b) => a.dias - b.dias);

  return (
    <div style={{ minHeight: "100dvh", background: "#0C0A09", fontFamily: "system-ui, sans-serif", color: "#F5F0E8" }}>
      {/* Header */}
      <div style={{ background: "#1A1714", borderBottom: "1px solid rgba(255,240,220,0.06)", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>Gypi Admin</span>
            <span style={{ marginLeft: 12, fontSize: 12, fontWeight: 600, background: "rgba(249,115,22,0.15)", color: "#F97316", padding: "3px 8px", borderRadius: 6 }}>SUPERADMIN</span>
          </div>
          <div style={{ display: "flex", gap: 4, marginLeft: 24 }}>
            {[["empresas", "Empresas"], ["metricas", "Métricas"], ["auditoria", "Auditoría"]].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ padding: "6px 14px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: tab === key ? "rgba(249,115,22,0.2)" : "transparent",
                  color: tab === key ? "#F97316" : "#6B6560" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={tab === "auditoria" ? fetchAudit : tab === "metricas" ? fetchMetricas : refresh} disabled={loading || auditLoading || metricasLoading}
          style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,240,220,0.1)", background: "transparent", color: "#9B8F85", fontSize: 13, cursor: "pointer" }}>
          {(loading || auditLoading || metricasLoading) ? "Actualizando…" : "↻ Actualizar"}
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

        {tab === "empresas" && (
          <>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
              <StatCard label="Total empresas" value={totalEmpresas} />
              <StatCard label="Activas" value={st.activas ?? 0} sub={`${(totalEmpresas) - (st.activas ?? 0)} inactivas`} />
              <StatCard label="En trial" value={st.trials ?? 0} sub={(st.trials ?? 0) > 0 ? "Convertir en oportunidades" : "—"} />
              <StatCard label="MRR" value={`$${(st.mrr ?? 0).toLocaleString("es-AR")}`} sub="Suscripciones activas" />
            </div>

            {/* Search */}
            <input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Buscar por nombre o slug…"
              style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,240,220,0.1)", background: "rgba(255,255,255,0.04)", color: "#F5F0E8", fontSize: 14, outline: "none", marginBottom: 20, boxSizing: "border-box" }}
            />

            {/* Table */}
            <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, overflow: "hidden", opacity: loading ? 0.6 : 1, transition: "opacity 0.2s" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,240,220,0.06)" }}>
                    {["Empresa", "Slug", "Plan", "Empleados", "Onboarding", "Registrada", "Acciones"].map((h) => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#6B6560", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {empresas.map((e) => (
                    <tr key={e.id} style={{ borderBottom: "1px solid rgba(255,240,220,0.04)" }}>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 700, color: e.activa ? "#F5F0E8" : "#6B6560" }}>{e.nombre_corto || e.nombre}</div>
                        {!e.activa && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 2 }}>INACTIVA</div>}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#9B8F85", fontFamily: "monospace" }}>{e.slug}</td>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${PLAN_COLOR[e.plan_activo] || "#6B7280"}22`, color: PLAN_COLOR[e.plan_activo] || "#9B8F85", whiteSpace: "nowrap" }}>
                            {PLAN_LABEL[e.plan_activo] || e.plan_activo || "—"}
                          </span>
                          <select
                            value={e.plan_activo || "free"}
                            onChange={(ev) => cambiarPlan(e.id, ev.target.value)}
                            disabled={changingPlan === e.id}
                            style={{ fontSize: 11, padding: "2px 4px", borderRadius: 5, border: "1px solid rgba(255,240,220,0.1)", background: "rgba(255,255,255,0.05)", color: "#9B8F85", cursor: "pointer" }}
                          >
                            {PLANES_OPCIONES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#C4B8AE" }}>{e.empleados_activos}</td>
                      <td style={{ padding: "14px 16px" }}>
                        <span style={{ fontSize: 16 }}>{e.onboarding_completado ? "✓" : "○"}</span>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#9B8F85" }}>
                        {e.created_at ? new Date(e.created_at).toLocaleDateString("es-AR") : "—"}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <button
                          onClick={() => impersonate(e)}
                          disabled={impersonating === e.id || !e.activa}
                          style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: impersonating === e.id ? "rgba(249,115,22,0.2)" : "rgba(249,115,22,0.15)", color: "#F97316", fontSize: 12, fontWeight: 600, cursor: !e.activa ? "default" : "pointer", opacity: !e.activa ? 0.4 : 1 }}
                        >
                          {impersonating === e.id ? "…" : "Acceder"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {empresas.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: "32px 16px", textAlign: "center", color: "#6B6560" }}>
                        {search ? "Sin resultados" : "Sin empresas registradas"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={handlePageChange} />
          </>
        )}

        {tab === "metricas" && (
          <>
            {/* Legacy stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
              <StatCard label="Usaron trial" value={st.trial_usado ?? 0} sub="histórico" />
              <StatCard label="Convirtieron a pago" value={st.convertidas ?? 0} sub={`${st.convertidas ?? 0} de ${st.trial_usado ?? 0}`} />
              <StatCard label="Tasa de conversión" value={`${tasaConversion.toFixed(0)}%`} sub="trial → plan pago" />
              <StatCard label="Trial → quedaron Free" value={st.perdidas_trial ?? 0} sub="oportunidad de reconquista" />
            </div>

            {metricasLoading && <div style={{ textAlign: "center", color: "#6B6560", padding: 40 }}>Cargando métricas…</div>}

            {metricas && (
              <>
                {/* MRR Trending */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#F5F0E8", marginBottom: 14 }}>MRR Trending (12m)</div>
                    {(metricas.mrr_trending || []).length === 0 ? (
                      <div style={{ fontSize: 12, color: "#6B6560" }}>Sin datos aún.</div>
                    ) : (() => {
                      const data = metricas.mrr_trending;
                      const maxMrr = Math.max(...data.map(d => Number(d.mrr) || 0), 1);
                      return (
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
                          {data.map((d, i) => (
                            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                              <div style={{
                                width: "100%", borderRadius: 3,
                                background: "linear-gradient(180deg, #F97316, #F97316aa)",
                                height: `${Math.max(2, (Number(d.mrr) / maxMrr) * 100)}px`,
                                transition: "height 0.3s",
                              }} title={`$${Number(d.mrr).toLocaleString("es-AR")}`} />
                              <span style={{ fontSize: 9, color: "#6B6560", transform: "rotate(-45deg)", transformOrigin: "center", whiteSpace: "nowrap" }}>
                                {d.mes?.slice(5)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Revenue por plan */}
                  <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#F5F0E8", marginBottom: 14 }}>Revenue por plan</div>
                    {(metricas.revenue_plan || []).length === 0 ? (
                      <div style={{ fontSize: 12, color: "#6B6560" }}>Sin suscripciones activas.</div>
                    ) : (metricas.revenue_plan || []).map((r) => (
                      <div key={r.plan} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,240,220,0.04)" }}>
                        <div>
                          <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${PLAN_COLOR[r.plan] || "#6B7280"}22`, color: PLAN_COLOR[r.plan] || "#9B8F85" }}>
                            {PLAN_LABEL[r.plan] || r.plan}
                          </span>
                          <span style={{ marginLeft: 10, fontSize: 12, color: "#9B8F85" }}>{r.empresas} empresa{r.empresas !== 1 ? "s" : ""}</span>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#F5F0E8" }}>${Number(r.mrr).toLocaleString("es-AR")}/m</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Funnel de activación */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#F5F0E8", marginBottom: 14 }}>Funnel de activación</div>
                    {(() => {
                      const funnel = metricas.funnel || [];
                      const pasoLabels = { registradas: "Registradas", onboarding_completo: "Onboarding", primera_fichada: "1er fichaje", trial_to_paid: "Convirtieron" };
                      const pasoColors = { registradas: "#3B82F6", onboarding_completo: "#F97316", primera_fichada: "#22C55E", trial_to_paid: "#A78BFA" };
                      const maxVal = Math.max(...funnel.map(f => Number(f.cantidad) || 0), 1);
                      return funnel.map((f) => (
                        <div key={f.paso} style={{ marginBottom: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: "#9B8F85" }}>{pasoLabels[f.paso] || f.paso}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#C4B8AE" }}>{f.cantidad}</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 4, background: pasoColors[f.paso] || "#6B7280", width: `${(Number(f.cantidad) / maxVal) * 100}%`, transition: "width 0.3s" }} />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Trials por vencer */}
                  <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#F5F0E8", marginBottom: 14 }}>Trials por vencer (≤3 días)</div>
                    {trialsPorVencer.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#6B6560" }}>Ninguno por ahora.</div>
                    ) : trialsPorVencer.map((e) => (
                      <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(255,240,220,0.04)" }}>
                        <span style={{ color: "#F5F0E8" }}>{e.nombre_corto || e.nombre}</span>
                        <span style={{ color: e.dias <= 1 ? "#EF4444" : "#F97316", fontWeight: 700 }}>
                          {e.dias <= 0 ? "Vence hoy" : `${e.dias}d`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cohortes de conversión */}
                <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#F5F0E8", marginBottom: 14 }}>Conversión por cohorte mensual</div>
                  {(metricas.cohortes || []).length === 0 ? (
                    <div style={{ fontSize: 12, color: "#6B6560" }}>Sin datos de cohortes aún.</div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid rgba(255,240,220,0.06)" }}>
                            {["Cohorte", "Registradas", "Onboarding", "1er fichaje", "Pago", "Conv %"].map((h) => (
                              <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#6B6560", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(metricas.cohortes || []).map((c) => {
                            const convRate = c.registradas > 0 ? ((c.convirtieron_pago / c.registradas) * 100).toFixed(0) : "0";
                            return (
                              <tr key={c.cohorte} style={{ borderBottom: "1px solid rgba(255,240,220,0.03)" }}>
                                <td style={{ padding: "8px 12px", color: "#C4B8AE", fontWeight: 600 }}>{c.cohorte}</td>
                                <td style={{ padding: "8px 12px", color: "#9B8F85" }}>{c.registradas}</td>
                                <td style={{ padding: "8px 12px", color: "#9B8F85" }}>{c.completaron_onboarding}</td>
                                <td style={{ padding: "8px 12px", color: "#9B8F85" }}>{c.primera_fichada}</td>
                                <td style={{ padding: "8px 12px", color: c.convirtieron_pago > 0 ? "#22C55E" : "#9B8F85", fontWeight: 700 }}>{c.convirtieron_pago}</td>
                                <td style={{ padding: "8px 12px", color: Number(convRate) > 10 ? "#22C55E" : Number(convRate) > 0 ? "#F97316" : "#6B6560", fontWeight: 700 }}>{convRate}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Distribución por plan (original) */}
                <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#F5F0E8", marginBottom: 14 }}>Distribución por plan</div>
                  {porPlan.map(({ plan, count }) => (
                    <div key={plan} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ width: 80, fontSize: 12, color: "#9B8F85" }}>{PLAN_LABEL[plan] || plan}</span>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 4, background: PLAN_COLOR[plan] || "#6B7280", width: totalEmpresas ? `${(count / totalEmpresas) * 100}%` : "0%" }} />
                      </div>
                      <span style={{ width: 28, textAlign: "right", fontSize: 12, color: "#C4B8AE", fontWeight: 700 }}>{count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "auditoria" && (
          <>
            {/* Filtros */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <select
                value={auditEmpresa}
                onChange={(e) => setAuditEmpresa(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,240,220,0.1)", background: "rgba(255,255,255,0.04)", color: "#F5F0E8", fontSize: 13, outline: "none" }}
              >
                <option value="">Todas las empresas</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre_corto || e.nombre}</option>)}
              </select>
              <select
                value={auditAccion}
                onChange={(e) => setAuditAccion(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,240,220,0.1)", background: "rgba(255,255,255,0.04)", color: "#F5F0E8", fontSize: 13, outline: "none" }}
              >
                <option value="">Todas las acciones</option>
                {["login", "logout", "impersonate", "cambiar_plan", "borrar_datos_empleado"].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <button onClick={fetchAudit} disabled={auditLoading}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,240,220,0.1)", background: "rgba(249,115,22,0.1)", color: "#F97316", fontSize: 13, cursor: "pointer" }}>
                Filtrar
              </button>
            </div>

            {/* Audit table */}
            <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, overflow: "auto" }}>
              {auditLoading ? (
                <div style={{ padding: 40, textAlign: "center", color: "#6B6560" }}>Cargando…</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,240,220,0.06)" }}>
                      {["Fecha", "Acción", "Actor", "Rol", "Entidad", "IP"].map((h) => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#6B6560", fontWeight: 600, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((row) => (
                      <tr key={row.id} style={{ borderBottom: "1px solid rgba(255,240,220,0.03)" }}>
                        <td style={{ padding: "10px 14px", color: "#9B8F85", whiteSpace: "nowrap" }}>
                          {row.created_at ? new Date(row.created_at).toLocaleString("es-AR") : "—"}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ padding: "2px 7px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                            background: `${ACCION_COLOR[row.accion] || "#6B7280"}22`,
                            color: ACCION_COLOR[row.accion] || "#9B8F85" }}>
                            {row.accion}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", color: "#C4B8AE" }}>
                          {row.actor_legajo || row.actor_id?.slice(0, 8) || "—"}
                        </td>
                        <td style={{ padding: "10px 14px", color: "#9B8F85" }}>{row.actor_rol || "—"}</td>
                        <td style={{ padding: "10px 14px", color: "#9B8F85" }}>
                          {row.entidad}{row.entidad_id ? ` #${row.entidad_id.slice(0, 8)}` : ""}
                        </td>
                        <td style={{ padding: "10px 14px", color: "#6B6560", fontFamily: "monospace" }}>{row.ip || "—"}</td>
                      </tr>
                    ))}
                    {auditRows.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: "32px 16px", textAlign: "center", color: "#6B6560" }}>
                          Sin registros de auditoría
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

      </div>
      {ConfirmDialog}
    </div>
  );
}
