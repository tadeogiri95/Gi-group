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

  // ─── Estado local: solo datos de app, no auth ───
  const [ctx, setCtx] = useState({});
  const [ready, setReady] = useState(false);
  const [historialLegajo, setHistorialLegajo] = useState(null);
  const [paywallInfo, setPaywallInfo] = useState(null);
  const [showBilling, setShowBilling] = useState(false);

  // ─── Carga de datos de la app ───
  const loadData = async () => {
    if (!usuario) return;
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      const monStr = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
      const isG = usuario.rol === "gerencial" || usuario.rol === "administrativo";

      const [empleados, fichadasHoy, miFichada, fichadasSemana, solicitudes, misSolicitudes, reglas, notificaciones] = await Promise.all([
        sb.get("empleados?select=*&activo=eq.true&order=legajo.asc"),
        sb.get(`fichadas?select=legajo,ingreso,egreso,horas_trabajadas,llegada_tarde,minutos_tarde,empleados(nombre,division)&fecha=eq.${today}`),
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

  // ─── Early returns ───
  if (slugInvalido) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
      <h1 style={{ fontFamily: fH, fontSize: 24, color: C.text }}>Empresa no encontrada</h1>
      <p style={{ color: C.dim, fontSize: 14 }}>El link no es válido o la empresa fue desactivada.</p>
    </div>
  );
  if (!init) return null;
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
            {isGer
              ? (showBack ? "Configuración" : screen === "ger-actividad" ? "Producción en vivo" : screen === "config" ? "Configuración" : screen === "equipo" ? "Gestión de personal" : screen === "historial-fichajes" ? "Control de asistencia" : (empresa?.nombre_corto || "Gypi"))
              : screen === "actividad" ? "Registro de actividades" : screen === "historial-fichajes" ? "Mi asistencia" : (empresa?.nombre_corto || "Gypi")}
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text, fontFamily: fH, letterSpacing: "-0.02em" }}>
            {screen === "solicitudes" ? "Inbox" : screen === "equipo" ? "Personal" : screen === "mis-sols" ? "Solicitudes" : screen === "actividad" ? "Mi Jornada" : screen === "ger-actividad" ? "Taller" : screen === "config" ? "Gestión" : screen === "historial-fichajes" ? "Fichajes" : (empresa?.nombre_corto || "Gypi")}
          </h1>
        </div>
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
