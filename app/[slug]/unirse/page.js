'use client';

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { fH, fB } from "../../lib/theme";

const V = {
  amber: "var(--color-empresa-primary, #F97316)",
  amberText: "#000",
  green: "#16A34A",
  red: "#DC2626",
  violet: "#7C3AED",
  dim: "var(--color-text-dim)",
  mute: "var(--color-text-muted)",
  text: "var(--color-text)",
  surface: "var(--color-surface)",
  border: "var(--color-border)",
};

export default function UnirseScreen() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug;
  const [empresa, setEmpresa] = useState(null);
  const [empresaNotFound, setEmpresaNotFound] = useState(false);
  const [step, setStep] = useState(1); // 1: legajo, 2: contraseña, 3: ok
  const [legajo, setLegajo] = useState("");
  const [empleado, setEmpleado] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Cargar branding empresa
  useEffect(() => {
    if (!slug) return;
    fetch(`/api/empresa?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => {
        if (d?.error || !d?.id) setEmpresaNotFound(true);
        else setEmpresa(d);
      })
      .catch(() => setEmpresaNotFound(true));
  }, [slug]);

  const verificarLegajo = async () => {
    if (!legajo.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/unirse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verificar", slug, legajo: legajo.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || "Error"); setLoading(false); return; }
      setEmpleado(data);
      setStep(2);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const activar = async () => {
    if (!password || password.length < 8) { setError("Mínimo 8 caracteres con mayúscula, minúscula y número"); return; }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) { setError("Debe tener mayúscula, minúscula y número"); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/unirse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activar", slug, legajo: legajo.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || "Error"); setLoading(false); return; }
      setStep(3);
      setTimeout(() => router.push(`/${slug}`), 2500);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  // Slug inválido
  if (empresaNotFound) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, color: V.text, fontFamily: fB, textAlign: "center" }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🔍</div>
        <h2 style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, margin: 0 }}>Empresa no encontrada</h2>
        <p style={{ color: V.dim, fontSize: 14, marginTop: 8 }}>El enlace <code style={{ color: V.amber }}>gypi.app/{slug}/unirse</code> no es válido.</p>
        <button onClick={() => router.push("/")} style={{ marginTop: 24, padding: "12px 24px", borderRadius: 12, background: V.amber, color: V.amberText, border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Volver al inicio</button>
      </div>
    );
  }

  if (!empresa) return null;

  const inputStyle = { width: "100%", padding: "14px 16px", borderRadius: 12, background: V.surface, border: `1px solid ${V.border}`, color: V.text, fontSize: 15, fontFamily: fB, outline: "none", boxSizing: "border-box" };
  const lblStyle = { display: "block", fontSize: 11, fontWeight: 700, color: V.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", padding: "0 28px", justifyContent: "center", color: V.text, fontFamily: fB }}>
      {/* Logo */}
      {empresa.logo_url ? (
        <Image src={empresa.logo_url} alt={empresa.nombre_corto} width={72} height={72} style={{ borderRadius: 20, objectFit: "contain", marginBottom: 24 }} />
      ) : (
        <div style={{ width: 72, height: 72, borderRadius: 20, background: `linear-gradient(135deg,${V.amber},${V.violet})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#000", marginBottom: 24 }}>
          <span style={{ fontFamily: fH, fontSize: empresa.nombre_corto?.length > 4 ? 18 : 26, fontWeight: 800 }}>{empresa.nombre_corto || "Gypi"}</span>
        </div>
      )}

      {/* STEP 1: Legajo */}
      {step === 1 && (
        <>
          <h1 style={{ margin: 0, fontFamily: fH, fontSize: 28, fontWeight: 700, color: V.text, letterSpacing: "-0.025em" }}>Unite a {empresa.nombre_corto || empresa.nombre}</h1>
          <p style={{ fontSize: 13, color: V.dim, marginTop: 8, marginBottom: 28, lineHeight: 1.5 }}>
            Ingresá tu legajo o DNI para activar tu cuenta. Si no lo sabés, pedíselo a tu administrador.
          </p>

          <label style={lblStyle}>Legajo / DNI</label>
          <input
            value={legajo}
            onChange={e => setLegajo(e.target.value)}
            onKeyDown={e => e.key === "Enter" && verificarLegajo()}
            inputMode="numeric"
            placeholder="Tu número de legajo"
            style={{ ...inputStyle, marginBottom: 16 }}
          />

          <button onClick={verificarLegajo} disabled={loading || !legajo.trim()} style={{ width: "100%", padding: 14, borderRadius: 12, background: legajo.trim() && !loading ? V.amber : V.surface, color: legajo.trim() && !loading ? V.amberText : V.mute, border: "none", fontSize: 15, fontWeight: 700, cursor: legajo.trim() && !loading ? "pointer" : "default" }}>
            {loading ? "Verificando..." : "Continuar"}
          </button>

          {error && <div style={{ padding: 12, background: `${V.red}15`, color: V.red, borderRadius: 10, fontSize: 12, marginTop: 12 }}>{error}</div>}

          <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: V.dim }}>
            ¿Ya tenés cuenta?{" "}
            <button onClick={() => router.push(`/${slug}`)} style={{ background: "none", border: "none", color: V.amber, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              Iniciar sesión
            </button>
          </div>
        </>
      )}

      {/* STEP 2: Crear contraseña */}
      {step === 2 && (
        <>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: `${V.green}22`, display: "flex", alignItems: "center", justifyContent: "center", color: V.green, marginBottom: 16, fontSize: 28 }}>✓</div>
          <h1 style={{ margin: 0, fontFamily: fH, fontSize: 24, fontWeight: 700, color: V.text }}>¡Hola, {empleado?.apodo || empleado?.nombre}!</h1>
          <p style={{ fontSize: 13, color: V.dim, marginTop: 8, marginBottom: 24, lineHeight: 1.5 }}>
            Creá tu contraseña para terminar de activar tu cuenta en <b style={{ color: V.text }}>{empleado?.empresaNombre}</b>.
          </p>

          <div style={{ marginBottom: 14 }}>
            <label style={lblStyle}>Nueva contraseña</label>
            <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lblStyle}>Confirmar contraseña</label>
            <input type={showPwd ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === "Enter" && activar()} placeholder="Repetí la contraseña" style={inputStyle} />
          </div>
          <button onClick={() => setShowPwd(!showPwd)} style={{ background: "none", border: "none", color: V.dim, cursor: "pointer", fontSize: 12, fontFamily: fB, padding: "4px 0", marginBottom: 16, textAlign: "left" }}>
            {showPwd ? "🙈 Ocultar contraseñas" : "👁️ Mostrar contraseñas"}
          </button>

          <button onClick={activar} disabled={loading || !password || !confirm} style={{ width: "100%", padding: 14, borderRadius: 12, background: password && confirm && !loading ? V.green : V.surface, color: password && confirm && !loading ? "#000" : V.mute, border: "none", fontSize: 15, fontWeight: 700, cursor: password && confirm && !loading ? "pointer" : "default" }}>
            {loading ? "Activando..." : "🚀 Activar mi cuenta"}
          </button>

          {error && <div style={{ padding: 12, background: `${V.red}15`, color: V.red, borderRadius: 10, fontSize: 12, marginTop: 12 }}>{error}</div>}
        </>
      )}

      {/* STEP 3: Éxito */}
      {step === 3 && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h1 style={{ margin: 0, fontFamily: fH, fontSize: 26, fontWeight: 700, color: V.green }}>¡Cuenta activada!</h1>
          <p style={{ fontSize: 14, color: V.dim, marginTop: 12 }}>Redirigiendo al login...</p>
        </div>
      )}
    </div>
  );
}