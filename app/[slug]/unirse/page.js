'use client';

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Button, Field } from "../../components/ui";
import { problemaPin, recordarLegajoPin } from "../../lib/pin";

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
      <main className="max-w-[480px] mx-auto min-h-dvh flex flex-col items-center justify-center p-7 text-center text-gypi-text font-body">
        <div aria-hidden="true" className="text-[52px] mb-4">🔍</div>
        <h1 className="font-heading text-[22px] font-bold m-0">Empresa no encontrada</h1>
        <p className="text-gypi-dim text-[15px] mt-2">El enlace <code className="text-gypi-amber-ink">gypi.app/{slug}/unirse</code> no es válido. Pedile el link correcto a tu empresa.</p>
        <Button onClick={() => router.push("/")} className="mt-6">Volver al inicio</Button>
      </main>
    );
  }

  if (!empresa) return null;

  const codigoListo = !!codigo.trim() && !loading;
  const avisoError = error ? <div role="alert" className="p-3 mt-3 rounded-[10px] text-[14px] bg-gypi-red/10 text-gypi-red">{error}</div> : null;
  const saludo = (
    <>
      <div aria-hidden="true" className="w-14 h-14 rounded-2xl bg-gypi-green/15 text-gypi-green flex items-center justify-center text-[28px] mb-4">✓</div>
      <h1 className="m-0 font-heading text-2xl font-bold">¡Hola, {empleado?.apodo || empleado?.nombre}!</h1>
    </>
  );
  // Activación (reforma UX R11): mismas piezas que el resto de la app (Button,
  // Field, tokens); sin estilos sueltos ni colores escritos a mano.
  const claseCodigo = "g-input text-center font-mono! text-[28px]! tracking-[0.5em]";

  return (
    <main className="max-w-[480px] mx-auto min-h-dvh flex flex-col justify-center px-7 py-8 text-gypi-text font-body">
      {empresa.logo_url ? (
        <Image src={empresa.logo_url} alt={empresa.nombre_corto || empresa.nombre} width={72} height={72} className="rounded-[20px] object-contain mb-6" />
      ) : (
        <div aria-hidden="true" className="w-[72px] h-[72px] rounded-[20px] bg-gypi-amber text-gypi-on-amber flex items-center justify-center mb-6 font-heading font-extrabold text-[22px]">
          {(empresa.nombre_corto || "Gypi").slice(0, 4)}
        </div>
      )}

      {/* PASO 1: código de activación */}
      {step === 1 && (
        <>
          <h1 className="m-0 font-heading text-[28px] font-bold tracking-tight">Unite a {empresa.nombre_corto || empresa.nombre}</h1>
          <p className="text-[15px] text-gypi-dim mt-2 mb-6 leading-relaxed">
            Escribí el código que te dio tu empresa. Si no lo tenés o venció, pedile uno nuevo a tu supervisor.
          </p>
          <Field label="Código de activación">
            <input
              value={codigo}
              onChange={e => setCodigo(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && verificarCodigo()}
              autoCapitalize="characters"
              autoComplete="one-time-code"
              spellCheck={false}
              placeholder="XXXX-XXXX"
              maxLength={20}
              className="g-input text-center font-mono! text-[20px]! tracking-[0.15em]"
            />
          </Field>
          <Button size="lg" onClick={verificarCodigo} disabled={!codigoListo} className="w-full">
            {loading ? "Verificando..." : "Continuar"}
          </Button>
          {avisoError}
          <p className="text-center mt-6 text-[14px] text-gypi-dim">
            ¿Ya tenés cuenta?{" "}
            <button onClick={() => router.push(`/${slug}`)} className="min-h-[44px] bg-transparent border-none text-gypi-amber-ink font-bold cursor-pointer text-[14px]">Iniciar sesión</button>
          </p>
        </>
      )}

      {/* PASO 2 (operario): elegir PIN */}
      {step === 2 && usarPin && (
        <>
          {saludo}
          <p className="text-[15px] mt-2 mb-5 leading-relaxed">
            Elegí un <b>PIN de 4 números</b>. Con tu legajo <b>{empleado?.legajo}</b> y este PIN entrás a la app y fichás en el kiosco.
          </p>
          <Field label="Tu PIN">
            <input id="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]*" maxLength={4}
              value={pin} onChange={e => setPin(soloNumeros(e.target.value))} placeholder="••••" className={claseCodigo} />
          </Field>
          <Field label="Repetí el PIN" help="No uses números repetidos (1111) ni seguidos (1234).">
            <input id="pin2" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]*" maxLength={4}
              value={pinConfirm} onChange={e => setPinConfirm(soloNumeros(e.target.value))} onKeyDown={e => e.key === "Enter" && activar()} placeholder="••••" className={claseCodigo} />
          </Field>
          <Button size="lg" onClick={activar} disabled={loading || !listoPin} className="w-full">
            {loading ? "Activando..." : "Activar mi cuenta"}
          </Button>
          {avisoError}
          <button onClick={() => { setUsarPin(false); setError(""); }} className="min-h-[48px] mt-2 bg-transparent border-none text-gypi-dim underline cursor-pointer text-[14px]">
            Prefiero una contraseña
          </button>
        </>
      )}

      {/* PASO 2: crear contraseña */}
      {step === 2 && !usarPin && (
        <>
          {saludo}
          <p className="text-[15px] text-gypi-dim mt-2 mb-5 leading-relaxed">
            Creá tu contraseña para terminar de activar tu cuenta en <b className="text-gypi-text">{empleado?.empresaNombre}</b>.
          </p>
          <Field label="Nueva contraseña" help="8 caracteres o más, con mayúscula, minúscula y número.">
            <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} className="g-input" />
          </Field>
          <Field label="Repetí la contraseña">
            <input type={showPwd ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === "Enter" && activar()} className="g-input" />
          </Field>
          <button onClick={() => setShowPwd(!showPwd)} className="min-h-[44px] mb-3 self-start bg-transparent border-none text-gypi-dim cursor-pointer text-[14px]">
            {showPwd ? "🙈 Ocultar contraseñas" : "👁️ Mostrar contraseñas"}
          </button>
          <Button size="lg" onClick={activar} disabled={loading || !password || !confirm} className="w-full">
            {loading ? "Activando..." : "Activar mi cuenta"}
          </Button>
          {avisoError}
          {empleado?.rol === "operativo" && (
            <button onClick={() => { setUsarPin(true); setError(""); }} className="min-h-[48px] mt-2 bg-transparent border-none text-gypi-dim underline cursor-pointer text-[14px]">
              Prefiero un PIN de 4 números
            </button>
          )}
        </>
      )}

      {/* PASO 3: listo */}
      {step === 3 && (
        <div role="status" className="text-center">
          <div aria-hidden="true" className="text-[64px] mb-4">🎉</div>
          <h1 className="m-0 font-heading text-[26px] font-bold text-gypi-green">¡Cuenta activada!</h1>
          {conPin ? (
            <>
              <p className="text-base mt-3 leading-relaxed">Para entrar: tu legajo <b>{empleado?.legajo}</b> y tu PIN.</p>
              <Button size="lg" onClick={() => router.push(`/${slug}`)} className="w-full mt-5">Entrar ahora</Button>
            </>
          ) : (
            <p className="text-[15px] text-gypi-dim mt-3">Te llevamos al inicio de sesión…</p>
          )}
        </div>
      )}
    </main>
  );
}
