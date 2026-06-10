"use client";
import { useState, useEffect, useCallback } from "react";

const PLAN_LABEL = { free: "Free", trial: "Trial", starter: "Starter", pro: "Pro", enterprise: "Enterprise" };
const PLAN_COLOR = { free: "#6B7280", trial: "#0F6E56", starter: "#3B82F6", pro: "#F97316", enterprise: "#A78BFA" };
const PLANES_OPCIONES = ["free", "trial", "starter", "pro", "enterprise"];

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

export default function Dashboard({ initialData }) {
  const [empresas, setEmpresas] = useState(initialData?.empresas || []);
  const [loading, setLoading] = useState(false);
  const [impersonating, setImpersonating] = useState(null);
  const [changingPlan, setChangingPlan] = useState(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("empresas");

  // ── Auditoría ──
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditEmpresa, setAuditEmpresa] = useState("");
  const [auditAccion, setAuditAccion] = useState("");

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

  useEffect(() => { if (tab === "auditoria") fetchAudit(); }, [tab, fetchAudit]);

  const refresh = async () => {
    setLoading(true);
    const r = await fetch("/api/superadmin/empresas", { credentials: "include" });
    const d = await r.json();
    if (d.empresas) setEmpresas(d.empresas);
    setLoading(false);
  };

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
    } else {
      alert(d.error || "Error cambiando plan");
    }
  };

  const activas = empresas.filter((e) => e.activa);
  const trials = empresas.filter((e) => e.plan_activo === "trial");
  const mrr = empresas.reduce((acc, e) => acc + (e.suscripcion?.monto || 0), 0);
  const filtered = empresas.filter((e) =>
    !search || e.nombre?.toLowerCase().includes(search.toLowerCase()) || e.slug?.includes(search.toLowerCase())
  );

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
            {[["empresas", "Empresas"], ["auditoria", "Auditoría"]].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ padding: "6px 14px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: tab === key ? "rgba(249,115,22,0.2)" : "transparent",
                  color: tab === key ? "#F97316" : "#6B6560" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={tab === "auditoria" ? fetchAudit : refresh} disabled={loading || auditLoading}
          style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,240,220,0.1)", background: "transparent", color: "#9B8F85", fontSize: 13, cursor: "pointer" }}>
          {(loading || auditLoading) ? "Actualizando…" : "↻ Actualizar"}
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

        {tab === "empresas" && (
          <>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
              <StatCard label="Total empresas" value={empresas.length} />
              <StatCard label="Activas" value={activas.length} sub={`${empresas.length - activas.length} inactivas`} />
              <StatCard label="En trial" value={trials.length} sub={trials.length > 0 ? "Convertir en oportunidades" : "—"} />
              <StatCard label="MRR" value={`$${mrr.toLocaleString("es-AR")}`} sub="Suscripciones activas" />
            </div>

            {/* Search */}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o slug…"
              style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,240,220,0.1)", background: "rgba(255,255,255,0.04)", color: "#F5F0E8", fontSize: 14, outline: "none", marginBottom: 20, boxSizing: "border-box" }}
            />

            {/* Table */}
            <div style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 14, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,240,220,0.06)" }}>
                    {["Empresa", "Slug", "Plan", "Empleados", "Onboarding", "Registrada", "Acciones"].map((h) => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#6B6560", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
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
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: "32px 16px", textAlign: "center", color: "#6B6560" }}>
                        {search ? "Sin resultados" : "Sin empresas registradas"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
    </div>
  );
}
