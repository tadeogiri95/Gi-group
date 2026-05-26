"use client";
import { useState, useEffect } from "react";
import { sb } from "./lib/supabase";
import { C, fH, fB, fM } from "./lib/theme";
import { Tag } from "./components/ui";

/* ═══ ADMIN EMPRESA ═══ */
export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate }) {
  const [tab, setTab] = useState("general");
  const [form, setForm] = useState({
    nombre: empresa?.nombre || "",
    nombre_corto: empresa?.nombre_corto || "",
    color_primario: empresa?.color_primario || "#F97316",
    color_secundario: empresa?.color_secundario || "#8B5CF6",
    rubro: empresa?.rubro || "general",
    logo_url: empresa?.logo_url || "",
  });
  const [prompts, setPrompts] = useState({ prompt_ia_obra: "", prompt_ia_chat: "" });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState(null);

  // Cargar datos completos de empresa
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/empresa");
        const data = await res.json();
        if (data && !data.error) {
          setPrompts({
            prompt_ia_obra: data.prompt_ia_obra || "",
            prompt_ia_chat: data.prompt_ia_chat || "",
          });
        }
        // Estadísticas
        const emps = await sb.get(`empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=id`);
        const today = new Date().toISOString().split("T")[0];
        const fichas = await sb.get(`fichadas?empresa_id=eq.${empresaId}&fecha=eq.${today}&select=id`);
        setStats({
          empleados: emps?.length || 0,
          fichadasHoy: fichas?.length || 0,
          plan: empresa?.plan || "free",
          maxEmpleados: empresa?.max_empleados || 10,
        });
      } catch (e) {
        console.error(e);
      }
    })();
  }, [empresaId]);

  const guardar = async (campo, valor) => {
    setLoading(true);
    setMsg("");
    try {
      const body = {};
      body[campo] = valor;
      await sb.patch(`empresa?id=eq.${empresaId}`, body);
      setMsg("✅ Guardado");
      if (onUpdate) {
        onUpdate({ ...empresa, ...body });
      }
      setTimeout(() => setMsg(""), 2000);
    } catch (e) {
      setMsg("❌ Error: " + e.message);
    }
    setLoading(false);
  };

  const guardarGeneral = async () => {
    setLoading(true);
    setMsg("");
    try {
      await sb.patch(`empresa?id=eq.${empresaId}`, form);
      setMsg("✅ Guardado");
      if (onUpdate) onUpdate({ ...empresa, ...form });
      setTimeout(() => setMsg(""), 2000);
    } catch (e) {
      setMsg("❌ Error: " + e.message);
    }
    setLoading(false);
  };

  const guardarPrompts = async () => {
    setLoading(true);
    setMsg("");
    try {
      await sb.patch(`empresa?id=eq.${empresaId}`, prompts);
      setMsg("✅ Prompts actualizados");
      setTimeout(() => setMsg(""), 2000);
    } catch (e) {
      setMsg("❌ Error: " + e.message);
    }
    setLoading(false);
  };

  const tabs = [
    ["general", "⚙️ General"],
    ["prompts", "🤖 IA"],
    ["stats", "📊 Info"],
  ];

  const S = {
    card: {
      background: C.surface,
      borderRadius: 16,
      padding: 18,
      marginBottom: 12,
      border: `1px solid ${C.border}`,
    },
    label: {
      fontSize: 11,
      fontWeight: 700,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      marginBottom: 8,
      display: "block",
    },
    input: {
      width: "100%",
      padding: "12px 14px",
      borderRadius: 12,
      background: C.bg,
      border: `1px solid ${C.border}`,
      color: C.text,
      fontSize: 14,
      fontFamily: fB,
      outline: "none",
      boxSizing: "border-box",
    },
    textarea: {
      width: "100%",
      padding: "12px 14px",
      borderRadius: 12,
      background: C.bg,
      border: `1px solid ${C.border}`,
      color: C.text,
      fontSize: 13,
      fontFamily: fM,
      outline: "none",
      boxSizing: "border-box",
      minHeight: 120,
      resize: "vertical",
      lineHeight: 1.5,
    },
    btn: {
      padding: "12px 20px",
      borderRadius: 12,
      background: C.amber,
      color: "#000",
      border: "none",
      fontSize: 14,
      fontWeight: 700,
      fontFamily: fB,
      cursor: "pointer",
      width: "100%",
    },
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 20px" }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
        {tabs.map(([id, lbl]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: "8px 14px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              background: tab === id ? `${C.amber}22` : C.surface,
              color: tab === id ? C.amber : C.dim,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: fB,
              whiteSpace: "nowrap",
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Mensaje */}
      {msg && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: msg.includes("✅") ? C.greenS : C.redS,
            color: msg.includes("✅") ? C.green : C.red,
            fontSize: 13,
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          {msg}
        </div>
      )}

      {/* TAB: General */}
      {tab === "general" && (
        <>
          <div style={S.card}>
            <label style={S.label}>Nombre de la empresa</label>
            <input
              style={S.input}
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Ej: Metalúrgica García S.A."
            />
          </div>

          <div style={S.card}>
            <label style={S.label}>Nombre corto (logo / header)</label>
            <input
              style={S.input}
              value={form.nombre_corto}
              onChange={(e) => setForm({ ...form, nombre_corto: e.target.value })}
              placeholder="Ej: García"
              maxLength={15}
            />
            <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
              Máximo 15 caracteres. Aparece en el header y logo.
            </div>
          </div>

          <div style={S.card}>
            <label style={S.label}>Colores</label>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>Primario</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    value={form.color_primario}
                    onChange={(e) => setForm({ ...form, color_primario: e.target.value })}
                    style={{ width: 40, height: 40, border: "none", borderRadius: 8, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 12, fontFamily: fM, color: C.dim }}>{form.color_primario}</span>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>Secundario</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    value={form.color_secundario}
                    onChange={(e) => setForm({ ...form, color_secundario: e.target.value })}
                    style={{ width: 40, height: 40, border: "none", borderRadius: 8, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 12, fontFamily: fM, color: C.dim }}>{form.color_secundario}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={S.card}>
            <label style={S.label}>Rubro</label>
            <select
              value={form.rubro}
              onChange={(e) => setForm({ ...form, rubro: e.target.value })}
              style={{ ...S.input, cursor: "pointer" }}
            >
              {["industria", "construcción", "servicios", "comercio", "tecnología", "salud", "educación", "otro"].map(
                (r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                )
              )}
            </select>
          </div>

          <button
            onClick={guardarGeneral}
            disabled={loading}
            style={{ ...S.btn, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Guardando..." : "Guardar cambios"}
          </button>
        </>
      )}

      {/* TAB: Prompts IA */}
      {tab === "prompts" && (
        <>
          <div style={S.card}>
            <label style={S.label}>Prompt IA — Reporte de obra</label>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 8, lineHeight: 1.4 }}>
              Este prompt se usa cuando un instalador dicta o escribe su reporte diario de obra.
              La IA interpreta el texto libre y lo convierte en datos estructurados.
            </div>
            <textarea
              style={S.textarea}
              value={prompts.prompt_ia_obra}
              onChange={(e) => setPrompts({ ...prompts, prompt_ia_obra: e.target.value })}
              placeholder="Instrucciones para la IA al procesar reportes de obra..."
            />
          </div>

          <div style={S.card}>
            <label style={S.label}>Prompt IA — Chat asistente</label>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 8, lineHeight: 1.4 }}>
              Este prompt define la personalidad del chatbot que usan los empleados para consultar
              horarios, pedir permisos, fichar, etc.
            </div>
            <textarea
              style={S.textarea}
              value={prompts.prompt_ia_chat}
              onChange={(e) => setPrompts({ ...prompts, prompt_ia_chat: e.target.value })}
              placeholder="Instrucciones para el asistente de chat..."
            />
          </div>

          <button
            onClick={guardarPrompts}
            disabled={loading}
            style={{ ...S.btn, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Guardando..." : "Guardar prompts"}
          </button>
        </>
      )}

      {/* TAB: Stats */}
      {tab === "stats" && stats && (
        <>
          <div style={S.card}>
            <label style={S.label}>Tu plan</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Tag color={stats.plan === "free" ? C.dim : stats.plan === "pro" ? C.amber : C.green}>
                {stats.plan.toUpperCase()}
              </Tag>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                {stats.plan === "free" ? "Plan Gratuito" : stats.plan === "pro" ? "Plan Pro" : "Plan Enterprise"}
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div style={S.card}>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: fH, color: C.amber }}>{stats.empleados}</div>
              <div style={{ fontSize: 12, color: C.dim }}>Empleados activos</div>
              <div style={{ fontSize: 11, color: C.mute, marginTop: 4 }}>
                Máx: {stats.maxEmpleados}
              </div>
              {/* Barra de uso */}
              <div style={{ height: 4, borderRadius: 2, background: C.surfHi, marginTop: 6 }}>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: stats.empleados / stats.maxEmpleados > 0.8 ? C.red : C.green,
                    width: `${Math.min(100, (stats.empleados / stats.maxEmpleados) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div style={S.card}>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: fH, color: C.green }}>{stats.fichadasHoy}</div>
              <div style={{ fontSize: 12, color: C.dim }}>Fichadas hoy</div>
            </div>
          </div>

          <div style={S.card}>
            <label style={S.label}>Identificador de empresa</label>
            <div style={{ fontSize: 13, fontFamily: fM, color: C.text, wordBreak: "break-all" }}>
              {empresaId}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
              Slug: {empresa?.slug || "—"}
            </div>
          </div>

          <div style={{ ...S.card, background: C.amberS, border: `1px solid ${C.amber}33` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 4 }}>
              💡 Planes disponibles
            </div>
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
              <b>Free</b>: Hasta 10 empleados, funciones básicas.{"\n"}
              <b>Pro</b>: Hasta 50 empleados, reportes avanzados, IA ilimitada.{"\n"}
              <b>Enterprise</b>: Sin límites, soporte prioritario.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
