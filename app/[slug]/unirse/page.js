'use client';

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { fH, fB } from "../../lib/theme";
import { problemaPin, recordarLegajoPin } from "../../lib/pin";

const AMBER = "var(--color-empresa-primary, #F97316)";
const AMBER_TEXT = "#000";
const GREEN = "#16A34A";
const RED = "#DC2626";
const VIOLET = "#7C3AED";
const DIM = "var(--color-text-dim)";
const MUTE = "var(--color-text-muted)";
const TEXT = "var(--color-text)";
const SURFACE = "var(--color-surface)";
const BORDER = "var(--color-border)";

export default function UnirseScreen() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug;
  const [empresa, setEmpresa] = useState(null);
  const [empresaNotFound, setEmpresaNotFound] = useState(false);
  const [step, setStep] = useState(1); // 1: código, 2: contraseña, 3: ok
  const [codigo, setCodigo] = useState("");
  const [empleado, setEmpleado] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  // Reforma UX R6: el operario elige un PIN de 4 números (más fácil que una
  // contraseña con mayúsculas); puede preferir contraseña. Gestión usa contraseña.
  const [usarPin, setUsarPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [conPin, setConPin] = useState(false);
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

  // El link/QR que entrega la empresa trae el código: /{slug}/unirse?code=XXXX-XXXX
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCodigo(c.toUpperCase());
  }, []);

  const verificarCodigo = async () => {
    if (!codigo.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/unirse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verificar", slug, codigo: codigo.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || "Error"); setLoading(false); return; }
      setEmpleado(data);
      setUsarPin(data.rol === "operativo");
      setStep(2);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const activar = async () => {
    if (usarPin) {
      const problema = problemaPin(pin);
      if (problema) { setError(problema); return; }
      if (pin !== pinConfirm) { setError("Los dos PIN no son iguales. Escribilo de nuevo."); return; }
    } else {
      if (!password || password.length < 8) { setError("Mínimo 8 caracteres con mayúscula, minúscula y número"); return; }
      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) { setError("Debe tener mayúscula, minúscula y número"); return; }
      if (password !== confirm) { setError("Las contraseñas no coinciden"); return; }
    }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/unirse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activar", slug, codigo: codigo.trim(), ...(usarPin ? { pin } : { password }) }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || "Error"); setLoading(false); return; }
      // Con PIN, el ingreso se abre en modo PIN con el legajo ya cargado
      if (data.con_pin) recordarLegajoPin(slug, data.legajo ?? empleado?.legajo);
      setConPin(!!data.con_pin);
      setStep(3);
      if (!data.con_pin) setTimeout(() => router.push(`/${slug}`), 2500);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const soloNumeros = (v) => v.replace(/\D/g, "").slice(0, 4);
  const listoPin = pin.length === 4 && pinConfirm.length === 4;

  // Slug inválido
  if (empresaNotFound) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, color: TEXT, fontFamily: fB, textAlign: "center" }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🔍</div>
        <h2 style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, margin: 0 }}>Empresa no encontrada</h2>
        <p style={{ color: DIM, fontSize: 14, marginTop: 8 }}>El enlace <code style={{ color: AMBER }}>gypi.app/{slug}/unirse</code> no es válido.</p>
        <button onClick={() => router.push("/")} style={{ marginTop: 24, padding: "12px 24px", borderRadius: 12, background: AMBER, color: AMBER_TEXT, border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Volver al inicio</button>
      </div>
    );
  }

  if (!empresa) return null;

  const inputStyle = { width: "100%", padding: "14px 16px", borderRadius: 12, background: SURFACE, border: `1px solid ${BORDER}`, color: TEXT, fontSize: 15, fontFamily: fB, outline: "none", boxSizing: "border-box" };
  const lblStyle = { display: "block", fontSize: 11, fontWeight: 700, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", padding: "0 28px", justifyContent: "center", color: TEXT, fontFamily: fB }}>
      {/* Logo */}
      {empresa.logo_url ? (
        <Image src={empresa.logo_url} alt={empresa.nombre_corto} width={72} height={72} style={{ borderRadius: 20, objectFit: "contain", marginBottom: 24 }} />
      ) : (
        <div style={{ width: 72, height: 72, borderRadius: 20, background: `linear-gradient(135deg,${AMBER},${VIOLET})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#000", marginBottom: 24 }}>
          <span style={{ fontFamily: fH, fontSize: empresa.nombre_corto?.length > 4 ? 18 : 26, fontWeight: 800 }}>{empresa.nombre_corto || "Gypi"}</span>
        </div>
      )}

      {/* STEP 1: Código de activación */}
      {step === 1 && (
        <>
          <h1 style={{ margin: 0, fontFamily: fH, fontSize: 28, fontWeight: 700, color: TEXT, letterSpacing: "-0.025em" }}>Unite a {empresa.nombre_corto || empresa.nombre}</h1>
          <p style={{ fontSize: 13, color: DIM, marginTop: 8, marginBottom: 28, lineHeight: 1.5 }}>
            Ingresá el código de activación que te dio tu empresa. Si no lo tenés o venció, pedile uno nuevo a tu supervisor.
          </p>

          <label style={lblStyle}>Código de activación</label>
          <input
            value={codigo}
            onChange={e => setCodigo(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && verificarCodigo()}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            maxLength={20}
            style={{ ...inputStyle, marginBottom: 16, letterSpacing: "0.15em", fontFamily: "monospace", fontSize: 18, textAlign: "center" }}
          />

          <button onClick={verificarCodigo} disabled={loading || !codigo.trim()} style={{ width: "100%", padding: 14, borderRadius: 12, background: codigo.trim() && !loading ? AMBER : SURFACE, color: codigo.trim() && !loading ? AMBER_TEXT : MUTE, border: "none", fontSize: 15, fontWeight: 700, cursor: codigo.trim() && !loading ? "pointer" : "default" }}>
            {loading ? "Verificando..." : "Continuar"}
          </button>

          {error && <div style={{ padding: 12, background: `${RED}15`, color: RED, borderRadius: 10, fontSize: 12, marginTop: 12 }}>{error}</div>}

          <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: DIM }}>
            ¿Ya tenés cuenta?{" "}
            <button onClick={() => router.push(`/${slug}`)} style={{ background: "none", border: "none", color: AMBER, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              Iniciar sesión
            </button>
          </div>
        </>
      )}

      {/* STEP 2 (operario): elegir PIN */}
      {step === 2 && usarPin && (
        <>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: `${GREEN}22`, display: "flex", alignItems: "center", justifyContent: "center", color: GREEN, marginBottom: 16, fontSize: 28 }}>✓</div>
          <h1 style={{ margin: 0, fontFamily: fH, fontSize: 24, fontWeight: 700, color: TEXT }}>¡Hola, {empleado?.apodo || empleado?.nombre}!</h1>
          <p style={{ fontSize: 15, color: TEXT, marginTop: 8, marginBottom: 20, lineHeight: 1.5 }}>
            Elegí un <b>PIN de 4 números</b>. Con tu legajo <b>{empleado?.legajo}</b> y este PIN entrás a la app y fichás en el kiosco.
          </p>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="pin" style={lblStyle}>Tu PIN</label>
            <input id="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]*" maxLength={4}
              value={pin} onChange={e => setPin(soloNumeros(e.target.value))} placeholder="••••"
              style={{ ...inputStyle, fontSize: 28, letterSpacing: "0.5em", textAlign: "center", fontFamily: "monospace" }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label htmlFor="pin2" style={lblStyle}>Repetí el PIN</label>
            <input id="pin2" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]*" maxLength={4}
              value={pinConfirm} onChange={e => setPinConfirm(soloNumeros(e.target.value))} onKeyDown={e => e.key === "Enter" && activar()} placeholder="••••"
              style={{ ...inputStyle, fontSize: 28, letterSpacing: "0.5em", textAlign: "center", fontFamily: "monospace" }} />
          </div>
          <p style={{ fontSize: 13, color: DIM, margin: "0 0 16px", lineHeight: 1.5 }}>No uses números repetidos (1111) ni seguidos (1234).</p>

          <button onClick={activar} disabled={loading || !listoPin} style={{ width: "100%", minHeight: 56, padding: 14, borderRadius: 12, background: listoPin && !loading ? AMBER : SURFACE, color: listoPin && !loading ? AMBER_TEXT : MUTE, border: "none", fontSize: 16, fontWeight: 700, cursor: listoPin && !loading ? "pointer" : "default" }}>
            {loading ? "Activando..." : "Activar mi cuenta"}
          </button>

          {error && <div role="alert" style={{ padding: 12, background: `${RED}15`, color: RED, borderRadius: 10, fontSize: 13, marginTop: 12 }}>{error}</div>}

          <button onClick={() => { setUsarPin(false); setError(""); }} style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 14, minHeight: 48, marginTop: 8, textDecoration: "underline" }}>
            Prefiero una contraseña
          </button>
        </>
      )}

      {/* STEP 2: Crear contraseña */}
      {step === 2 && !usarPin && (
        <>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: `${GREEN}22`, display: "flex", alignItems: "center", justifyContent: "center", color: GREEN, marginBottom: 16, fontSize: 28 }}>✓</div>
          <h1 style={{ margin: 0, fontFamily: fH, fontSize: 24, fontWeight: 700, color: TEXT }}>¡Hola, {empleado?.apodo || empleado?.nombre}!</h1>
          <p style={{ fontSize: 13, color: DIM, marginTop: 8, marginBottom: 24, lineHeight: 1.5 }}>
            Creá tu contraseña para terminar de activar tu cuenta en <b style={{ color: TEXT }}>{empleado?.empresaNombre}</b>.
          </p>

          <div style={{ marginBottom: 14 }}>
            <label style={lblStyle}>Nueva contraseña</label>
            <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lblStyle}>Confirmar contraseña</label>
            <input type={showPwd ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === "Enter" && activar()} placeholder="Repetí la contraseña" style={inputStyle} />
          </div>
          <button onClick={() => setShowPwd(!showPwd)} style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 12, fontFamily: fB, padding: "4px 0", marginBottom: 16, textAlign: "left" }}>
            {showPwd ? "🙈 Ocultar contraseñas" : "👁️ Mostrar contraseñas"}
          </button>

          <button onClick={activar} disabled={loading || !password || !confirm} style={{ width: "100%", padding: 14, borderRadius: 12, background: password && confirm && !loading ? GREEN : SURFACE, color: password && confirm && !loading ? "#000" : MUTE, border: "none", fontSize: 15, fontWeight: 700, cursor: password && confirm && !loading ? "pointer" : "default" }}>
            {loading ? "Activando..." : "🚀 Activar mi cuenta"}
          </button>

          {error && <div style={{ padding: 12, background: `${RED}15`, color: RED, borderRadius: 10, fontSize: 12, marginTop: 12 }}>{error}</div>}

          {empleado?.rol === "operativo" && (
            <button onClick={() => { setUsarPin(true); setError(""); }} style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 14, minHeight: 48, marginTop: 8, textDecoration: "underline" }}>
              Prefiero un PIN de 4 números
            </button>
          )}
        </>
      )}

      {/* STEP 3: Éxito */}
      {step === 3 && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h1 style={{ margin: 0, fontFamily: fH, fontSize: 26, fontWeight: 700, color: GREEN }}>¡Cuenta activada!</h1>
          {conPin ? (
            <>
              <p style={{ fontSize: 16, color: TEXT, marginTop: 12, lineHeight: 1.5 }}>
                Para entrar: tu legajo <b>{empleado?.legajo}</b> y tu PIN.
              </p>
              <button onClick={() => router.push(`/${slug}`)} style={{ marginTop: 20, width: "100%", minHeight: 56, borderRadius: 12, background: AMBER, color: AMBER_TEXT, border: "none", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
                Entrar ahora
              </button>
            </>
          ) : (
            <p style={{ fontSize: 14, color: DIM, marginTop: 12 }}>Redirigiendo al login...</p>
          )}
        </div>
      )}
    </div>
  );
}