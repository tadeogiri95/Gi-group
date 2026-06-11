"use client";
// ═══════════════════════════════════════════════════════════
// [slug]/HomeContent.jsx — Contenido principal de la app
//
// Fase 1: auth/empresa/divisiones/etapas vienen de AuthContext.
// Este componente solo maneja datos de la app (loadData/ctx)
// y el routing de pantallas.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { C, fH } from "../lib/theme";
import { sb } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useActividad } from "../hooks/useActividad";
import { useRealtimeSync } from "../hooks/useRealtimeSync";
import PushManager from "../../components/PushManager";

// Screens
import LoginScreen from "../components/screens/LoginScreen";
import CambiarPasswordScreen from "../components/screens/CambiarPasswordScreen";
import ResetPasswordScreen from "../components/screens/ResetPasswordScreen";
import ChatScreen from "../components/screens/ChatScreen";
import HomeEmp from "../components/screens/HomeEmp";
import InboxScreen from "../components/screens/InboxScreen";
import HistorialFichajesScreen from "../components/screens/HistorialFichajesScreen";
import ConfigScreen from "../components/screens/ConfigScreen";
import Nav from "../components/Nav";
import SolCard from "../components/cards/SolCard";
import ErrorBoundary from "../components/ErrorBoundary";
import Paywall from "../components/Paywall";
import BillingScreen from "../components/BillingScreen";

// External screens
import ActividadScreen from "../actividad_screen";
import GerenciaActividadScreen from "../gerencia_actividad_screen";
import DashboardGerencia from "../dashboard_gerencia";
import GestionPersonalScreen from "../gestion_personal_screen";
import OnboardingWizard from "../onboarding_wizard";

// ─── Valid screens whitelist ───
const VALID_SCREENS = new Set([
  "home", "chat", "solicitudes", "mis-sols", "actividad",
  "historial-fichajes", "equipo", "config", "ger-actividad", "reglas",
]);

export default function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ─── Auth y empresa desde contexto ───
  const {
    usuario, empresa,
    divisiones: divisionesEmpresa, etapas: etapasEmpresa,
    init, slugInvalido, isGer,
    login, logout, updateEmpresa, cargarEmpresa,
  } = useAuth();

  // ─── Screen desde URL ───
  const screenFromUrl = searchParams.get("screen") || "home";
  const screen = VALID_SCREENS.has(screenFromUrl) ? screenFromUrl : "home";

  const setScreen = (pantalla) => {
    if (!VALID_SCREENS.has(pantalla)) pantalla = "home";
    if (pantalla === "home") {
      router.push(pathname, { scroll: false });
    } else {
      router.push(`${pathname}?screen=${pantalla}`, { scroll: false });
    }
  };

  // ─── Impersonation exchange (superadmin → ?imp=code) ───
  useEffect(() => {
    const impCode = searchParams.get("imp");
    if (!impCode || usuario) return;
    fetch("/api/superadmin/impersonate-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code: impCode }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.usuario && d.token) {
          login(d.usuario, { token: d.token });
          // Limpiar el código de la URL
          router.replace(pathname, { scroll: false });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ─── Estado local: solo datos de app, no auth ───
  const [ctx, setCtx] = useState({});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [historialLegajo, setHistorialLegajo] = useState(null);
  const [paywallInfo, setPaywallInfo] = useState(null);
  const [showBilling, setShowBilling] = useState(false);

  // ─── Carga de datos de la app ───
  const loadData = async () => {
    if (!usuario) return;
    setLoadError(null);
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      const monStr = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
      const isG = usuario.rol === "gerencial" || usuario.rol === "administrativo";

      const [empleados, fichadasHoy, miFichada, fichadasSemana, solicitudes, misSolicitudes, reglas, notificaciones] = await Promise.all([
        sb.get("empleados?select=id,legajo,nombre,apodo,email,rol,area,division,diagrama,activo,debe_cambiar_password,estado_activacion,created_at&activo=eq.true&order=legajo.asc"),
        sb.get(`fichadas?select=legajo,ingreso,egreso,horas_trabajadas,llegada_tarde,minutos_tarde,empleados(nombre,division)&fecha=eq.${today}&limit=200`),
        sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=eq.${today}`),
        sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=gte.${monStr}&order=fecha.asc`),
        sb.get("solicitudes?select=*&order=created_at.desc&limit=50"),
        sb.get(`solicitudes?legajo=eq.${usuario.legajo}&order=created_at.desc&limit=20`),
        sb.get("reglas_bot?activa=eq.true&order=id.asc"),
        sb.get(isG
          ? "notificaciones?destinatario_rol=eq.gerencial&order=created_at.desc&limit=10"
          : `notificaciones?destinatario_rol=eq.${usuario.legajo}&order=created_at.desc&limit=10`
        ),
      ]);

      const fHoy = fichadasHoy.map(f => ({ ...f, nombre: f.empleados?.nombre || "", division: f.empleados?.division || "" }));
      setCtx({
        empleados, fichadasHoy: fHoy, fichadaHoy: miFichada[0] || null,
        fichadasSemana, solicitudes, misSolicitudes,
        reglas: reglas.map(r => r.regla), reglasRaw: reglas, notificaciones,
      });
      setReady(true);
    } catch (e) {
      if (e.paywall) {
        setPaywallInfo({ upgrade_a: e.upgrade_a, mensaje: e.message });
      } else {
        console.error(e);
        setLoadError("No se pudieron cargar los datos. Tocá para reintentar.");
      }
      setReady(true);
    }
  };

  // Carga inicial y cuando cambia el usuario
  useEffect(() => { if (usuario) { setReady(false); loadData(); } }, [usuario]);
  // Polling de fallback cada 2 min (Realtime cubre los cambios en tiempo real)
  useEffect(() => { if (!usuario) return; const t = setInterval(loadData, 120000); return () => clearInterval(t); }, [usuario]);

  const actividad = useActividad(
    usuario ? { id: usuario.id, legajo: usuario.legajo, division: usuario.division, empresa_id: usuario?.empresa_id || empresa?.id } : null
  );
  useRealtimeSync(usuario ? (usuario.empresa_id || empresa?.id) : null, loadData);

  const pend = (ctx.solicitudes || []).filter(s => s.estado === "pendiente").length;
  const isChat = screen === "chat";
  const showBack = screen === "reglas" || screen === "historial-fichajes" || screen === "ger-actividad";

  const getScreenSubtitle = () => {
    if (isGer) {
      if (showBack) return "Configuración";
      const subtitles = { "ger-actividad": "Producción en vivo", config: "Configuración", equipo: "Gestión de personal", "historial-fichajes": "Control de asistencia" };
      return subtitles[screen] || empresa?.nombre_corto || "Gypi";
    }
    const subtitles = { actividad: "Registro de actividades", "historial-fichajes": "Mi asistencia" };
    return subtitles[screen] || empresa?.nombre_corto || "Gypi";
  };

  const getScreenTitle = () => {
    const titles = { solicitudes: "Inbox", equipo: "Personal", "mis-sols": "Solicitudes", actividad: "Mi Jornada", "ger-actividad": "Taller", config: "Gestión", "historial-fichajes": "Fichajes" };
    return titles[screen] || empresa?.nombre_corto || "Gypi";
  };

  // ─── Early returns ───
  if (slugInvalido) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
      <h1 style={{ fontFamily: fH, fontSize: 24, color: C.text }}>Empresa no encontrada</h1>
      <p style={{ color: C.dim, fontSize: 14 }}>El link no es válido o la empresa fue desactivada.</p>
    </div>
  );
  if (!init) return (
    <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: C.bg }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        {empresa?.logo_url
          ? <img src={empresa.logo_url} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: "contain" }} />
          : <div style={{ width: 56, height: 56, borderRadius: 14, background: `${C.amber}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>
            </div>}
        <div style={{ display: "flex", gap: 5 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: 3, background: C.amber, opacity: 0.9, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:.2;transform:scale(.7)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );

  // Reset de contraseña via link de email — no requiere estar logueado
  const resetToken = searchParams.get("token");
  if (!usuario && screenFromUrl === "reset_password" && resetToken) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 480, margin: "0 auto", width: "100%" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <ResetPasswordScreen token={resetToken} empresa={empresa} onVolver={() => router.push(pathname)} />
      </div>
    </div>
  );

  if (!usuario) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 480, margin: "0 auto", width: "100%" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <LoginScreen onLogin={login} empresa={empresa} />
      </div>
    </div>
  );
  if (usuario.debe_cambiar_password) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 480, margin: "0 auto", width: "100%" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <CambiarPasswordScreen usuario={usuario} onDone={(u) => login(u)} />
      </div>
    </div>
  );
  if (isGer && empresa?.onboarding_completado === false) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 480, margin: "0 auto", width: "100%" }}>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <OnboardingWizard empresa={empresa} empresaId={empresa.id} onComplete={() => { cargarEmpresa(); loadData(); }} />
      </div>
    </div>
  );

  // ─── App shell ───
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 480, margin: "0 auto", width: "100%", background: C.bg }}>
      <PushManager legajo={usuario.legajo} empresaId={usuario.empresa_id || empresa?.id} />

      {!isChat && (
        <div className="safe-top" style={{ padding: "16px 18px 10px", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
            {getScreenSubtitle()}
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text, fontFamily: fH, letterSpacing: "-0.02em" }}>
            {getScreenTitle()}
          </h1>
        </div>
      )}

      {loadError && (
        <button
          onClick={loadData}
          style={{
            margin: "0 18px 8px",
            padding: "10px 14px",
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 10,
            color: "#B91C1C",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
            flexShrink: 0,
          }}
        >
          ⚠ {loadError}
        </button>
      )}

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <ErrorBoundary name={screen}>
          {!isGer && screen === "home" && <HomeEmp goto={setScreen} usuario={usuario} ctx={ctx} logout={logout} empresa={empresa} />}
          {!isGer && screen === "historial-fichajes" && <HistorialFichajesScreen usuario={usuario} ctx={ctx} onBack={() => setScreen("home")} />}
          {!isGer && screen === "actividad" && <ActividadScreen {...actividad} usuario={usuario} empresa={empresa} fichadaHoy={ctx.fichadaHoy} />}
          {!isGer && screen === "chat" && <ChatScreen usuario={usuario} ctx={ctx} reload={loadData} empresa={empresa} />}
          {!isGer && screen === "mis-sols" && (
            <div style={{ padding: "0 18px 20px", overflowY: "auto", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(ctx.misSolicitudes || []).map(s => <SolCard key={s.id} s={s} />)}
              </div>
            </div>
          )}
          {isGer && screen === "home" && <DashboardGerencia goto={(s, leg) => { if (leg) setHistorialLegajo(leg); setScreen(s); }} ctx={ctx} reload={loadData} logout={logout} empresa={empresa} />}
          {isGer && screen === "historial-fichajes" && <HistorialFichajesScreen usuario={usuario} ctx={ctx} legajoVer={historialLegajo} onBack={() => setScreen("home")} />}
          {isGer && screen === "solicitudes" && <InboxScreen ctx={ctx} reload={loadData} usuario={usuario} />}
          {isGer && screen === "equipo" && <GestionPersonalScreen ctx={ctx} reload={loadData} empresaId={usuario?.empresa_id || empresa?.id} />}
          {isGer && screen === "ger-actividad" && <GerenciaActividadScreen empresaId={empresa?.id} />}
          {isGer && screen === "config" && (
            <ConfigScreen
              goto={(s, leg) => { if (leg) setHistorialLegajo(leg); setScreen(s); }}
              ctx={ctx}
              reload={loadData}
              usuario={usuario}
              empresa={empresa}
              divisiones={divisionesEmpresa}
              etapas={etapasEmpresa}
              onUpdateEmpresa={updateEmpresa}
            />
          )}
          {isGer && screen === "chat" && <ChatScreen usuario={usuario} ctx={ctx} reload={loadData} empresa={empresa} />}
        </ErrorBoundary>
      </div>

      {!isChat && <Nav active={screen} onChange={setScreen} role={usuario.rol} pend={pend} />}

      {paywallInfo && (
        <Paywall
          planActual={empresa?.plan_activo || "free"}
          planRequerido={paywallInfo.upgrade_a || "starter"}
          mensaje={paywallInfo.mensaje}
          onClose={() => setPaywallInfo(null)}
          onUpgrade={() => { setPaywallInfo(null); setShowBilling(true); }}
        />
      )}
      {showBilling && <BillingScreen onClose={() => setShowBilling(false)} />}
    </div>
  );
}
