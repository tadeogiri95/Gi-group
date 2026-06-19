"use client";
// ═══════════════════════════════════════════════════════════
// [slug]/HomeContent.jsx — Contenido principal de la app
//
// Fase 1: auth/empresa/divisiones/etapas vienen de AuthContext.
// Este componente solo maneja datos de la app (loadData/ctx)
// y el routing de pantallas.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import dynamic from "next/dynamic";
import { sb } from "../lib/supabase";
import { hoyArg, lunesDeLaSemana } from "../lib/dates";
import { useAuth } from "../context/AuthContext";
import { useActividad } from "../hooks/useActividad";
import { useRealtimeSync } from "../hooks/useRealtimeSync";
import PushManager from "../components/PushManager";

// LoginScreen es la primera pantalla para usuarios no logueados — se mantiene
// estática para no agregar un salto de carga al camino crítico de entrada.
import LoginScreen from "../components/screens/LoginScreen";
import Nav from "../components/nav/BottomNav";
import SolCard from "../components/cards/SolCard";
import ErrorBoundary from "../components/ErrorBoundary";

// Screens — lazy-loaded: solo se descarga el código de la pantalla activa
const CambiarPasswordScreen = dynamic(() => import("../components/screens/CambiarPasswordScreen"), { ssr: false });
const ResetPasswordScreen = dynamic(() => import("../components/screens/ResetPasswordScreen"), { ssr: false });
const ChatScreen = dynamic(() => import("../components/screens/ChatScreen"), { ssr: false });
const HomeEmp = dynamic(() => import("../components/screens/HomeEmp"), { ssr: false });
const InboxScreen = dynamic(() => import("../components/screens/InboxScreen"), { ssr: false });
const HistorialFichajesScreen = dynamic(() => import("../components/screens/HistorialFichajesScreen"), { ssr: false });
const ConfigScreen = dynamic(() => import("../components/screens/ConfigScreen"), { ssr: false });
const Paywall = dynamic(() => import("../components/Paywall"), { ssr: false });
const BillingScreen = dynamic(() => import("../components/BillingScreen"), { ssr: false });

// External screens — lazy-loaded
const ActividadScreen = dynamic(() => import("../actividad_screen"), { ssr: false });
const GerenciaActividadScreen = dynamic(() => import("../gerencia_actividad_screen"), { ssr: false });
const DashboardGerencia = dynamic(() => import("../dashboard_gerencia"), { ssr: false });
const GestionPersonalScreen = dynamic(() => import("../gestion_personal_screen"), { ssr: false });
const OnboardingWizard = dynamic(() => import("../onboarding_wizard"), { ssr: false });

// Demo data — cargado dinámicamente solo cuando ?demo=true (nunca para usuarios reales)

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

  // ─── Demo mode — el módulo de datos demo se carga dinámicamente, nunca
  // forma parte del bundle inicial de usuarios reales ───
  const isDemo = searchParams.get("demo") === "true";
  const [demoMod, setDemoMod] = useState(null);
  useEffect(() => {
    if (isDemo && !demoMod) import("../lib/demoData").then(setDemoMod);
  }, [isDemo, demoMod]);

  // ─── Estado local: solo datos de app, no auth ───
  const [ctx, setCtx] = useState({});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [historialLegajo, setHistorialLegajo] = useState(null);
  const [paywallInfo, setPaywallInfo] = useState(null);
  const [showBilling, setShowBilling] = useState(false);

  // ─── Carga de datos de la app ───
  const loadData = useCallback(async () => {
    if (isDemo) {
      if (!demoMod) return;
      const demoUser = usuario || demoMod.DEMO_USUARIO_GER;
      setCtx(demoMod.getDemoCtx(demoUser));
      setReady(true);
      return;
    }
    if (!usuario) return;
    setLoadError(null);
    try {
      const today = hoyArg();
      const monStr = lunesDeLaSemana(0);
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

      let geoZonaNombre = null;
      const gc = usuario.geo_config;
      if (gc?.activo && gc.ubicacion_id) {
        try {
          const zonas = await sb.get(`geo_zonas?id=eq.${gc.ubicacion_id}&select=nombre&limit=1`);
          geoZonaNombre = zonas?.[0]?.nombre || null;
        } catch {}
      }

      setCtx({
        empleados, fichadasHoy: fHoy, fichadaHoy: miFichada[0] || null,
        fichadasSemana, solicitudes, misSolicitudes,
        reglas: reglas.map(r => r.regla), reglasRaw: reglas, notificaciones,
        geoZonaNombre,
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
  }, [usuario, isDemo, demoMod]);

  // Carga inicial y cuando cambia el usuario (o cuando termina de cargar el módulo demo)
  useEffect(() => { if (usuario || (isDemo && demoMod)) { setReady(false); loadData(); } }, [usuario, isDemo, demoMod, loadData]);
  // Polling de fallback cada 2 min (Realtime cubre los cambios en tiempo real)
  useEffect(() => { if (!usuario && !isDemo) return; const t = setInterval(loadData, 120000); return () => clearInterval(t); }, [usuario, isDemo, loadData]);

  const u = isDemo ? (usuario || demoMod?.DEMO_USUARIO_GER) : usuario;
  const uIsGer = isDemo ? (u?.rol === "gerencial" || u?.rol === "administrativo") : isGer;
  const demoActividad = isDemo && demoMod ? demoMod.getDemoActividades() : null;

  const actividad = useActividad(
    u && !isDemo ? { id: u.id, legajo: u.legajo, division: u.division, empresa_id: u?.empresa_id || empresa?.id } : null
  );
  useRealtimeSync(!isDemo && u ? (u.empresa_id || empresa?.id) : null, loadData);

  const pend = (ctx.solicitudes || []).filter(s => s.estado === "pendiente").length;
  const isChat = screen === "chat";
  const showBack = screen === "reglas" || screen === "historial-fichajes" || screen === "ger-actividad";

  const getScreenSubtitle = () => {
    if (uIsGer) {
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
  if (slugInvalido && !isDemo) return (
    <div className="flex flex-col h-dvh items-center justify-center p-10 text-center">
      <h1 className="font-heading text-2xl text-gypi-text">Empresa no encontrada</h1>
      <p className="text-gypi-dim text-sm">El link no es válido o la empresa fue desactivada.</p>
    </div>
  );
  if ((!init && !isDemo) || (isDemo && !demoMod)) return (
    <div className="flex h-dvh items-center justify-center bg-gypi-bg">
      <div className="flex flex-col items-center gap-3.5">
        {empresa?.logo_url
          ? <Image src={empresa.logo_url} alt="" width={56} height={56} className="rounded-[14px] object-contain" />
          : <div className="w-14 h-14 rounded-[14px] bg-gypi-amber/[0.13] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-gypi-amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>
            </div>}
        <div className="gypi-dots">
          <span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" />
        </div>
      </div>
    </div>
  );

  // Reset de contraseña via link de email — no requiere estar logueado
  const resetToken = searchParams.get("token");
  if (!usuario && screenFromUrl === "reset_password" && resetToken) return (
    <div className="app-shell">
      <div className="flex-1 overflow-hidden">
        <ResetPasswordScreen token={resetToken} empresa={empresa} onVolver={() => router.push(pathname)} />
      </div>
    </div>
  );

  if (!usuario && !isDemo) return (
    <div className="app-shell">
      <div className="flex-1 overflow-hidden">
        <LoginScreen onLogin={login} empresa={empresa} />
      </div>
    </div>
  );
  if (usuario?.debe_cambiar_password) return (
    <div className="app-shell">
      <div className="flex-1 overflow-hidden">
        <CambiarPasswordScreen usuario={usuario} onDone={(u) => login(u)} />
      </div>
    </div>
  );
  if (!isDemo && uIsGer && empresa?.onboarding_completado === false) return (
    <div className="app-shell">
      <div className="flex-1 overflow-hidden flex flex-col">
        <OnboardingWizard empresa={empresa} empresaId={empresa.id} onComplete={() => { cargarEmpresa(); loadData(); }} />
      </div>
    </div>
  );

  // ─── App shell ───
  return (
    <div className="app-shell bg-gypi-bg">
      {!isDemo && <PushManager legajo={u.legajo} empresaId={u.empresa_id || empresa?.id} />}

      {!isChat && screen !== "home" && (
        <div className="safe-top px-[18px] pt-4 pb-2.5 shrink-0">
          <div className="g-overline text-gypi-dim mb-0.5">
            {getScreenSubtitle()}
          </div>
          <h1 className="m-0 text-[22px] font-bold text-gypi-text font-heading tracking-tight">
            {getScreenTitle()}
          </h1>
        </div>
      )}

      {loadError && (
        <button
          onClick={loadData}
          className="mx-[18px] mb-2 py-2.5 px-3.5 bg-red-50 border border-red-200 rounded-[10px] text-red-700 text-[13px] font-medium cursor-pointer text-left shrink-0"
        >
          ⚠ {loadError}
        </button>
      )}

      <div className="flex-1 overflow-hidden flex flex-col">
        <ErrorBoundary name={screen}>
          {!uIsGer && screen === "home" && <HomeEmp goto={setScreen} usuario={u} ctx={ctx} logout={logout} empresa={empresa} actividadesHoy={isDemo ? demoActividad.actividadesHoy : actividad.historial} tareaActiva={isDemo ? demoActividad.tareaActiva : actividad.tareaActiva} etapas={isDemo ? demoMod.DEMO_ETAPAS : actividad.etapas} />}
          {!uIsGer && screen === "historial-fichajes" && <HistorialFichajesScreen usuario={u} ctx={ctx} onBack={() => setScreen("home")} />}
          {!uIsGer && screen === "actividad" && <ActividadScreen {...(isDemo ? { historial: demoActividad.actividadesHoy, tareaActiva: demoActividad.tareaActiva, etapas: demoMod.DEMO_ETAPAS, elapsed: 0, proyectos: [], proyectosLoading: false, loading: false, iniciarTarea: ()=>{}, finalizarTarea: ()=>{}, cargarProyectos: ()=>{} } : actividad)} usuario={u} empresa={empresa} fichadaHoy={ctx.fichadaHoy} />}
          {!uIsGer && screen === "chat" && <ChatScreen usuario={u} ctx={ctx} reload={loadData} empresa={empresa} />}
          {!uIsGer && screen === "mis-sols" && (
            <div className="px-[18px] pb-5 overflow-y-auto flex-1">
              <div className="flex flex-col gap-2.5">
                {(ctx.misSolicitudes || []).map(s => <SolCard key={s.id} s={s} />)}
              </div>
            </div>
          )}
          {uIsGer && screen === "home" && <DashboardGerencia goto={(s, leg) => { if (leg) setHistorialLegajo(leg); setScreen(s); }} ctx={ctx} reload={loadData} logout={logout} empresa={empresa} isDemo={isDemo} />}
          {uIsGer && screen === "historial-fichajes" && <HistorialFichajesScreen usuario={u} ctx={ctx} legajoVer={historialLegajo} onBack={() => setScreen("home")} />}
          {uIsGer && screen === "solicitudes" && <InboxScreen ctx={ctx} reload={loadData} usuario={u} />}
          {uIsGer && screen === "equipo" && <GestionPersonalScreen ctx={ctx} reload={loadData} empresaId={u?.empresa_id || empresa?.id} />}
          {uIsGer && screen === "ger-actividad" && <GerenciaActividadScreen empresaId={empresa?.id} />}
          {uIsGer && screen === "config" && (
            <ConfigScreen
              goto={(s, leg) => { if (leg) setHistorialLegajo(leg); setScreen(s); }}
              ctx={ctx}
              reload={loadData}
              usuario={u}
              empresa={empresa}
              divisiones={divisionesEmpresa}
              etapas={etapasEmpresa}
              onUpdateEmpresa={updateEmpresa}
            />
          )}
          {/* Bot IA removido de vista gerencial */}
        </ErrorBoundary>
      </div>

      {!isChat && <Nav active={screen} onChange={setScreen} role={u.rol} pend={pend} />}

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
