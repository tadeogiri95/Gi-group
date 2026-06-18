"use client";
import { useState } from "react";
import Image from "next/image";
import { Input, Button } from "../ui";

export default function LoginScreen({ onLogin, empresa }) {
  const [legajo, setLegajo]   = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // -- Recuperar contrasena --
  const [modoRecuperar, setModoRecuperar] = useState(false);
  const [emailReset, setEmailReset]       = useState("");
  const [resetLoading, setResetLoading]   = useState(false);
  const [resetMsg, setResetMsg]           = useState("");

  const login = async () => {
    if (!legajo || !password) return;
    setLoading(true); setError("");
    try {
      if (!empresa?.id) {
        setError("Error cargando datos de la empresa. Recargá la página.");
        setLoading(false);
        return;
      }
      const res = await fetch("/api/login-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legajo: legajo.trim(), password, empresa_id: empresa.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error de login");
      onLogin(data.usuario);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  const solicitarReset = async () => {
    if (!emailReset.trim()) return;
    setResetLoading(true); setResetMsg("");
    try {
      await fetch("/api/recuperar-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailReset.trim(), empresa_id: empresa?.id }),
      });
      setResetMsg("Si el email está registrado, recibirás el link en minutos. Revisá tu bandeja y spam.");
    } catch {
      setResetMsg("No se pudo enviar el email. Intentá de nuevo.");
    } finally {
      setResetLoading(false);
    }
  };

  if (modoRecuperar) {
    return (
      <div className="g-fade-in flex flex-col h-full px-7 justify-center">
        <button
          onClick={() => { setModoRecuperar(false); setResetMsg(""); setEmailReset(""); }}
          className="self-start bg-transparent border-none text-gypi-dim cursor-pointer text-[13px] font-semibold mb-7 p-0"
        >
          ← Volver al login
        </button>
        <h1 className="m-0 mb-2 font-heading text-[28px] font-extrabold text-gypi-text tracking-tight">
          Recuperar contraseña
        </h1>
        <div className="text-[15px] text-gypi-text opacity-55 mb-8 leading-normal">
          Ingresá el email con el que te registraste. Te enviamos un link para crear una nueva contraseña.
        </div>

        {resetMsg ? (
          <div
            className="py-4 px-[18px] rounded-[14px] text-gypi-green text-sm leading-normal"
            style={{ background: "var(--color-green-subtle)" }}
          >
            {resetMsg}
          </div>
        ) : (
          <>
            <Input
              value={emailReset}
              onChange={e => setEmailReset(e.target.value)}
              placeholder="tu@email.com"
              type="email"
              autoComplete="email"
              style={{ marginBottom: 16 }}
              onKeyDown={e => e.key === "Enter" && solicitarReset()}
            />
            <Button
              variant="primary"
              size="lg"
              onClick={solicitarReset}
              disabled={resetLoading || !emailReset.trim()}
              loading={resetLoading}
              style={{ width: "100%" }}
            >
              {resetLoading ? "Enviando..." : "Enviar link"}
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="g-fade-in flex flex-col h-full px-7 justify-center relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute top-[15%] left-1/2 -translate-x-1/2 w-[260px] h-[260px] rounded-full pointer-events-none blur-[40px]"
        style={{ background: `radial-gradient(circle, var(--color-empresa-primary)12 0%, transparent 70%)` }}
      />

      <div className="relative">
        {empresa?.logo_url ? (
          <div
            className="w-20 h-20 rounded-[22px] mb-7 relative overflow-hidden border border-gypi-border"
            style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
          >
            <Image src={empresa.logo_url} alt={empresa?.nombre_corto || "Logo"} fill style={{ objectFit: "contain" }} sizes="80px" />
          </div>
        ) : (
          <div
            className="w-20 h-20 rounded-[22px] flex items-center justify-center text-black mb-7"
            style={{
              background: `linear-gradient(135deg, var(--color-empresa-primary), var(--color-empresa-secondary))`,
              boxShadow: `0 8px 30px var(--color-empresa-primary-subtle), 0 4px 12px rgba(0,0,0,0.1)`,
            }}
          >
            <span className={`font-heading font-extrabold ${empresa?.nombre_corto?.length > 4 ? "text-xl" : "text-[28px]"}`}>
              {empresa?.nombre_corto || "Gypi"}
            </span>
          </div>
        )}

        <h1 className="m-0 font-heading text-[34px] font-extrabold text-gypi-text tracking-[-0.035em] leading-[1.1]">
          Bienvenido
        </h1>
        <div className="text-[15px] text-gypi-text opacity-55 mt-2 mb-9 font-medium">
          {"Iniciá sesión en " + (empresa?.nombre_corto || "Gypi")}
        </div>

        {error && (
          <div
            className="text-gypi-red text-[13px] font-semibold mb-3.5 py-3 px-4 rounded-[12px] flex items-center gap-2"
            style={{
              background: "var(--color-red-subtle)",
              border: "1px solid color-mix(in srgb, var(--color-red) 12%, transparent)",
            }}
          >
            <span className="text-base" aria-hidden="true">&#x26A0;</span> {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Input
            value={legajo}
            onChange={e => setLegajo(e.target.value)}
            placeholder="Legajo o email"
            type="text"
            inputMode="text"
            autoComplete="username"
            onKeyDown={e => e.key === "Enter" && login()}
          />

          <div className="relative">
            <Input
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Contraseña"
              type={showPwd ? "text" : "password"}
              style={{ marginBottom: 0 }}
              onKeyDown={e => e.key === "Enter" && login()}
            />
            <button
              onClick={() => setShowPwd(!showPwd)}
              aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-gypi-surf-hi border-none text-gypi-dim cursor-pointer text-xs font-bold py-1 px-2.5 rounded-lg"
            >
              {showPwd ? "Ocultar" : "Ver"}
            </button>
          </div>
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={login}
          disabled={loading || !legajo || !password}
          loading={loading}
          style={{
            marginTop: 24, width: "100%",
            boxShadow: (loading || !legajo || !password) ? "none" : "0 4px 14px rgba(249,115,22,0.35)",
          }}
        >
          {loading ? "Ingresando..." : "Ingresar"}
        </Button>

        <Button
          variant="ghost"
          onClick={() => setModoRecuperar(true)}
          className="mt-5 w-full text-gypi-text opacity-45"
        >
          ¿Olvidaste tu contraseña?
        </Button>
      </div>
    </div>
  );
}
