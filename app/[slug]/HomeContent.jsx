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
import { sb, sbGetAll } from "../lib/supabase";
import { hoyArg, lunesDeLaSemana } from "../lib/dates";
import { useAuth } from "../context/AuthContext";
import { useActividad } from "../hooks/useActividad";
import { useRealtimeSync } from "../hooks/useRealtimeSync";
import { useRefrescoVisible } from "../hooks/useRefrescoVisible";
import PushManager from "../components/PushManager";
import CuentaEnPausa from "../components/CuentaEnPausa";
import { planVigente } from "../lib/plans";
import { tieneModulo } from "../lib/modulos";
import ModuloBloqueado from "../components/ModuloBloqueado";
import { guardarInstantanea, leerInstantanea } from "../lib/instantanea";
import { registrarServiceWorker } from "../lib/registrarSW";

// LoginScreen es la primera pantalla para usuarios no logueados — se mantiene
// estática para no agregar un salto de carga al camino crítico de entrada.
import LoginScreen from "../components/screens/LoginScreen";
import Nav from "../components/nav/BottomNav";
import ErrorBoundary from "../components/ErrorBoundary";
import EmpresaNoEncontrada from "../components/EmpresaNoEncontrada";
import MisSolicitudesScreen from "../components/screens/MisSolicitudesScreen";
import { partirDestino } from "../lib/menuGestion";
import { consultasInicio } from "../lib/cargaInicio";

// Screens — lazy-loaded: solo se descarga el código de la pantalla activa
const CambiarPasswordScreen = dynamic(() => import("../components/screens/CambiarPasswordScreen"), { ssr: false });
const ResetPasswordScreen = dynamic(() => import("../components/screens/ResetPasswordScreen"), { ssr: false });
const ChatScreen = dynamic(() => import("../components/screens/ChatScreen"), { ssr: false });
const HomeEmp = dynamic(() => import("../components/screens/HomeEmp"), { ssr: false });
const MiCuentaScreen = dynamic(() => import("../components/screens/MiCuentaScreen"), { ssr: false });
const InboxScreen = dynamic(() => import("../components/screens/InboxScreen"), { ssr: false });
const HistorialFichajesScreen = dynamic(() => import("../components/screens/HistorialFichajesScreen"), { ssr: false });
const DocumentosScreen = dynamic(() => import("../components/screens/DocumentosScreen"), { ssr: false });
const ConfigScreen = dynamic(() => import("../components/screens/ConfigScreen"), { ssr: false });
const Paywall = dynamic(() => import("../components/Paywall"), { ssr: false });
const BillingScreen = dynamic(() => import("../components/BillingScreen"), { ssr: false });

// External screens — lazy-loaded
const ActividadScreen = dynamic(() => import("../actividad_screen"), { ssr: false });
const GerenciaActividadScreen = dynamic(() => import("../gerencia_actividad_screen"), { ssr: false });
const BotonGestionScreen = dynamic(() => import("../components/screens/BotonGestionScreen"), { ssr: false });
const DashboardGerencia = dynamic(() => import("../dashboard_gerencia"), { ssr: false });
const EquipoScreen = dynamic(() => import("../components/screens/EquipoScreen"), { ssr: false });
const OnboardingWizard = dynamic(() => import("../onboarding_wizard"), { ssr: false });
const CargaOt = dynamic(() => import("../components/CargaOt"), { ssr: false });
const ActaOt = dynamic(() => import("../components/ActaOt"), { ssr: false });
const InstalacionesScreen = dynamic(() => import("../components/screens/InstalacionesScreen"), { ssr: false });
const FichaArticulo = dynamic(() => import("../components/FichaArticulo"), { ssr: false });

// Demo data — cargado dinámicamente solo cuando ?demo=true (nunca para usuarios reales)

// ─── Valid screens whitelist ───
const VALID_SCREENS = new Set([
  "home", "chat", "solicitudes", "mis-sols", "actividad",
  "historial-fichajes", "equipo", "config", "ger-actividad", "reglas",
  "proyectos", "inventario", "mantenimiento",
  "documentos", "instalaciones", "cuenta",
]);
// Botones de la barra de gestión con pestañas (menú nuevo, parte 32)
const BOTONES = new Set(["proyectos", "inventario", "mantenimiento"]);
// Permisos y Equipo se abren desde "Más": ahí la barra marca "Más"
const DESDE_MAS = new Set(["solicitudes", "equipo"]);

export default function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ─── Auth y empresa desde contexto ───
  const {
    usuario, empresa,
    divisiones: divisionesEmpresa, etapas: etapasEmpresa, causasParada, defectos, checklistCarga, checklistInstalacion,
    init, slugInvalido, isGer,
    login, logout, updateEmpresa, cargarEmpresa, actualizarUsuario,
  } = useAuth();

  // ─── Screen desde URL ───
  // ?screen=planta (enlaces de antes del menú nuevo) abre Proyectos
  const screenFromUrl = searchParams.get("screen") === "planta" ? "proyectos" : (searchParams.get("screen") || "home");
  const screen = VALID_SCREENS.has(screenFromUrl) ? screenFromUrl : "home";

  const setScreen = (pantalla) => {
    if (!VALID_SCREENS.has(pantalla)) pantalla = "home";
    const params = new URLSearchParams(searchParams);
    if (pantalla === "home") {
      params.delete("screen");
    } else {
      params.set("screen", pantalla);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // ─── Carga de una OT desde el QR de un bulto (?carga=OT) y acta de
  // instalación (?acta=OT, se llega desde la carga firmada) ───
  const otDeParam = (clave) => (/^[\w.-]{1,40}$/.test(searchParams.get(clave) || "") ? searchParams.get(clave) : null);
  const otCarga = otDeParam("carga");
  const otActa = otCarga ? null : otDeParam("acta");
  const cambiarParams = (cambiar) => {
    const params = new URLSearchParams(searchParams);
    cambiar(params);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const abrirCarga = (ot) => cambiarParams((p) => { p.delete("acta"); p.set("carga", ot); });
  const cerrarCarga = () => cambiarParams((p) => p.delete("carga"));
  const cerrarActa = () => cambiarParams((p) => p.delete("acta"));
  // QR de la etiqueta de un artículo (Stock, parte 13): ?articulo=SKU abre su ficha
  // (mismo formato que SKU_VALIDO de lib/stock.js, sin cargar esa librería acá)
  const skuArticulo = /^[\w.-]{1,60}$/.test(searchParams.get("articulo") || "") ? searchParams.get("articulo") : null;
  const cerrarArticulo = () => cambiarParams((p) => p.delete("articulo"));
  const abrirActa = () => cambiarParams((p) => { p.delete("carga"); p.set("acta", otCarga); });

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

  // ─── Google OAuth exchange (google/callback → ?oauth=code) ───
  useEffect(() => {
    const oauthCode = searchParams.get("oauth");
    if (!oauthCode || usuario) return;
    fetch("/api/auth/google/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ exchangeCode: oauthCode }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.usuario && d.token) {
          login(d.usuario, { token: d.token });
        }
        // Limpiar el código de la URL en cualquier caso (de un solo uso)
        router.replace(pathname, { scroll: false });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ─── Demo mode — el módulo de datos demo se carga dinámicamente, nunca
  // forma parte del bundle inicial de usuarios reales ───
  const isDemo = searchParams.get("demo") === "true";
  // Service worker: la app abre sin conexión (ítem 21)
  useEffect(() => { if (!isDemo) registrarServiceWorker(); }, [isDemo]);
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
  // Sección abierta dentro de "Más" (R5). irA("config:ubicaciones") abre la
  // sección justa (lo usan los primeros pasos y el tablero).
  const [seccionMas, setSeccionMas] = useState(null);
  const irA = (destino, legajo) => {
    const { pantalla, seccion } = partirDestino(destino);
    if (legajo) setHistorialLegajo(legajo);
    setSeccionMas(seccion);
    setScreen(pantalla);
  };

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
      const ayer = hoyArg(new Date(Date.now() - 24 * 60 * 60 * 1000));
      // Solo lo que usa cada rol (app liviana): ver lib/cargaInicio.js
      const consultas = Object.entries(consultasInicio({ usuario, hoy: today, lunes: monStr, ayer }));
      const resultados = await Promise.all(consultas.map(([, c]) => (c.todas ? sbGetAll(c.path).then((r) => r.data) : sb.get(c.path))));
      const d = Object.fromEntries(consultas.map(([clave], i) => [clave, resultados[i] || []]));
      const { empleados = [], fichadasHoy = [], miFichada = [], fichadasSemana = [], solicitudes = [], misSolicitudes = [], reglas = [], notificaciones = [], miAbierta = [] } = d;

      const fHoy = fichadasHoy.map(f => ({ ...f, nombre: f.empleados?.nombre || "", division: f.empleados?.division || "" }));

      let geoZonaNombre = null;
      const gc = usuario.geo_config;
      if (gc?.activo && gc.ubicacion_id) {
        try {
          const zonas = await sb.get(`geo_zonas?id=eq.${gc.ubicacion_id}&select=nombre&limit=1`);
          geoZonaNombre = zonas?.[0]?.nombre || null;
        } catch {}
      }

      // Para abrir la app sin conexión: el estado de fichada de hoy (ítem 21)
      guardarInstantanea(`fichada_${usuario.id}`, { fecha: today, fichadaHoy: miFichada[0] || null, fichadaAbierta: miAbierta?.[0] || null });
      setCtx({
        empleados, fichadasHoy: fHoy, fichadaHoy: miFichada[0] || null, fichadaAbierta: miAbierta?.[0] || null,
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
        const snap = leerInstantanea(`fichada_${usuario.id}`, { fecha: hoyArg() });
        if (snap) setCtx((c) => ({ ...c, fichadaHoy: snap.fichadaHoy, fichadaAbierta: snap.fichadaAbierta }));
        const sinRed = typeof navigator !== "undefined" && navigator.onLine === false;
        setLoadError(sinRed
          ? "Sin conexión: podés fichar y cargar tareas, se envían solas cuando vuelva la señal."
          : "No se pudieron cargar los datos. Tocá para reintentar.");
      }
      setReady(true);
    }
  }, [usuario, isDemo, demoMod]);

  // Carga inicial y cuando cambia el usuario (o cuando termina de cargar el módulo demo)
  useEffect(() => { if (usuario || (isDemo && demoMod)) { setReady(false); loadData(); } }, [usuario, isDemo, demoMod, loadData]);
  // Polling de fallback cada 2 min, solo con la pestaña a la vista; los avisos
  // de Realtime se agrupan en una sola recarga (F3-04)
  const pedirRecarga = useRefrescoVisible(loadData, { intervaloMs: 120000, activo: !!usuario || isDemo });

  const u = isDemo ? (usuario || demoMod?.DEMO_USUARIO_GER) : usuario;
  const uIsGer = isDemo ? (u?.rol === "gerencial" || u?.rol === "administrativo") : isGer;
  const demoActividad = isDemo && demoMod ? demoMod.getDemoActividades() : null;

  // Las tareas propias son del operario: gestión no las baja (app liviana)
  const actividad = useActividad(
    u && !isDemo && !uIsGer ? { id: u.id, legajo: u.legajo, division: u.division, empresa_id: u?.empresa_id || empresa?.id } : null
  );
  useRealtimeSync(!isDemo && u ? (u.empresa_id || empresa?.id) : null, pedirRecarga);

  const pend = (ctx.solicitudes || []).filter(s => s.estado === "pendiente").length;
  // Pantallas que son de un módulo (ítem 36): sin el módulo se ve el aviso en vez de la pantalla
  const MODULO_PANTALLA = { chat: ["chat"], actividad: ["actividad", "obra"], "ger-actividad": ["actividad"] };
  const moduloFaltante = (MODULO_PANTALLA[screen] && !MODULO_PANTALLA[screen].some((m) => tieneModulo(empresa, m)))
    ? MODULO_PANTALLA[screen][0] : null;
  const isChat = screen === "chat" && !moduloFaltante;

  const getScreenSubtitle = () => {
    if (uIsGer) {
      const subtitles = { "ger-actividad": "Tareas del equipo", config: "Ajustes de la empresa", proyectos: "Órdenes de trabajo y reportes", inventario: "Stock y compras", mantenimiento: "Flota vehicular y maquinaria", equipo: "Personas, horarios y reportes", solicitudes: "Permisos, vacaciones y avisos", "historial-fichajes": "Control de asistencia" };
      return subtitles[screen] || empresa?.nombre_corto || "Gypi";
    }
    const subtitles = { cuenta: "Horario, fichadas y documentos", instalaciones: "El reporte del día", actividad: "Lo que hacés en la jornada", "mis-sols": "Permisos, vacaciones y avisos", "historial-fichajes": "Mi asistencia", documentos: "Mi documentación" };
    return subtitles[screen] || empresa?.nombre_corto || "Gypi";
  };

  const getScreenTitle = () => {
    const titles = { cuenta: "Mi cuenta", instalaciones: "Instalaciones", solicitudes: "Permisos", equipo: "Equipo", "mis-sols": "Mis permisos", actividad: "Tareas", "ger-actividad": "Producción en vivo", config: "Más", proyectos: "Proyectos", inventario: "Inventario", mantenimiento: "Mantenimiento", "historial-fichajes": "Fichajes", documentos: "Documentos" };
    return titles[screen] || empresa?.nombre_corto || "Gypi";
  };

  // ─── Early returns ───
  if (slugInvalido && !isDemo) return <EmpresaNoEncontrada slugActual={pathname?.split("/")[1]} />;
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
  // Sin plan vigente (D20): prueba vencida o suscripción cancelada
  if (!isDemo && empresa?.plan_activo && !planVigente(empresa.plan_activo)) return (
    <CuentaEnPausa usuario={usuario} empresa={empresa} onLogout={logout} />
  );
  if (!isDemo && uIsGer && empresa?.onboarding_completado === false) return (
    <div className="app-shell">
      <div className="flex-1 overflow-hidden flex flex-col">
        <OnboardingWizard empresa={empresa} empresaId={empresa.id} onComplete={() => { cargarEmpresa(); loadData(); }} />
      </div>
    </div>
  );

  // ─── App shell ───
  // En la computadora, Proyectos, Inventario, Mantenimiento y Equipo (trabajo
  // de oficina) usan todo el ancho; el resto sigue como un celular en el medio
  // (auditoría 22/10)
  const ancho = uIsGer && (BOTONES.has(screen) || screen === "equipo");
  return (
    <div className={`app-shell bg-gypi-bg ${ancho ? "app-shell--ancho" : ""}`}>
      {!isDemo && <PushManager legajo={u.legajo} empresaId={u.empresa_id || empresa?.id} />}

      {/* Dentro de una sección de "Más" el título lo pone la sección, con "← Más" */}
      {!isChat && screen !== "home" && !(screen === "config" && seccionMas) && (
        <div className="safe-top px-[18px] pt-4 pb-2.5 shrink-0">
          {uIsGer && DESDE_MAS.has(screen) && (
            <button onClick={() => setScreen("config")} className="min-h-[44px] -ml-1 mb-1 px-1 bg-transparent border-none cursor-pointer text-[15px] font-semibold text-gypi-text">
              ← Más
            </button>
          )}
          {screen === "ger-actividad" && (
            <button onClick={() => setScreen("home")} className="min-h-[44px] -ml-1 mb-1 px-1 bg-transparent border-none cursor-pointer text-[14px] font-semibold text-gypi-text">
              ← Volver al inicio
            </button>
          )}
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
        {uIsGer && (
          <div className={screen === "home" ? "contents" : "hidden"}>
            <ErrorBoundary name="home">
              <DashboardGerencia goto={irA} ctx={ctx} reload={loadData} logout={logout} empresa={empresa} isDemo={isDemo} />
            </ErrorBoundary>
          </div>
        )}
        <ErrorBoundary name={screen}>
          {moduloFaltante ? (
            <ModuloBloqueado modulo={moduloFaltante} empresa={empresa} rol={u?.rol} onVerPlanes={() => setShowBilling(true)} />
          ) : <>
          {!uIsGer && screen === "home" && <HomeEmp usuario={u} ctx={ctx} empresa={empresa} tareaActiva={isDemo ? demoActividad.tareaActiva : actividad.tareaActiva} etapas={isDemo ? demoMod.DEMO_ETAPAS : actividad.etapas} reload={loadData} demo={isDemo} onAbrirCarga={isDemo ? undefined : abrirCarga} />}
          {!uIsGer && screen === "cuenta" && <MiCuentaScreen usuario={u} ctx={ctx} empresa={isDemo ? null : empresa} goto={setScreen} logout={logout} demo={isDemo} onPinCambiado={(t) => actualizarUsuario?.({ tiene_pin: t })} />}
          {!uIsGer && screen === "historial-fichajes" && <HistorialFichajesScreen usuario={u} ctx={ctx} reglas={empresa?.reglas_asistencia} onBack={() => setScreen("cuenta")} />}
          {!uIsGer && screen === "actividad" && <ActividadScreen {...(isDemo ? { historial: demoActividad.actividadesHoy, tareaActiva: demoActividad.tareaActiva, etapas: demoMod.DEMO_ETAPAS, elapsed: 0, proyectos: [], proyectosLoading: false, loading: false, iniciarTarea: ()=>{}, finalizarTarea: ()=>{}, cargarProyectos: ()=>{} } : actividad)} usuario={u} empresa={empresa} divisiones={divisionesEmpresa} causas={causasParada} defectos={defectos} fichadaHoy={ctx.fichadaHoy} onIrAInicio={() => setScreen("home")} />}
          {!uIsGer && screen === "chat" && <ChatScreen usuario={u} ctx={ctx} reload={loadData} empresa={empresa} onBack={() => setScreen("home")} />}
          {!uIsGer && screen === "mis-sols" && (
            <MisSolicitudesScreen solicitudes={ctx.misSolicitudes} usuario={u} empresa={empresa} demo={isDemo} reload={loadData} />
          )}
          {!uIsGer && screen === "documentos" && <DocumentosScreen />}
          {!uIsGer && screen === "instalaciones" && <InstalacionesScreen empresaId={u?.empresa_id || empresa?.id} />}
          {uIsGer && screen === "historial-fichajes" && <HistorialFichajesScreen usuario={u} ctx={ctx} reglas={empresa?.reglas_asistencia} legajoVer={historialLegajo} onBack={() => setScreen("home")} />}
          {uIsGer && screen === "solicitudes" && <InboxScreen ctx={ctx} reload={loadData} usuario={u} />}
          {uIsGer && screen === "equipo" && <EquipoScreen key={seccionMas || "equipo"} empresa={empresa} usuario={u} seccion={seccionMas} onVerPlanes={() => setShowBilling(true)} />}
          {uIsGer && screen === "ger-actividad" && <GerenciaActividadScreen empresaId={empresa?.id} />}
          {uIsGer && BOTONES.has(screen) && <BotonGestionScreen key={`${screen}:${seccionMas || ""}`} boton={screen} empresa={empresa} usuario={u} seccion={seccionMas} onVerPlanes={() => setShowBilling(true)} />}
          {uIsGer && screen === "config" && (
            <ConfigScreen
              seccion={seccionMas}
              onSeccion={setSeccionMas}
              onIr={(pantalla) => { setSeccionMas(null); setScreen(pantalla); }}
              pendientes={pend}
              ctx={ctx}
              reload={loadData}
              usuario={u}
              empresa={empresa}
              divisiones={divisionesEmpresa}
              etapas={etapasEmpresa}
              onUpdateEmpresa={updateEmpresa}
              onVerPlanes={() => setShowBilling(true)}
            />
          )}
          {/* Bot IA removido de vista gerencial */}
          </>}
        </ErrorBoundary>
      </div>

      {/* Historial y documentos del operario se abren desde "Mi cuenta": esa pestaña queda marcada */}
      {!isChat && <Nav active={!uIsGer && (screen === "historial-fichajes" || screen === "documentos") ? "cuenta" : uIsGer && DESDE_MAS.has(screen) ? "config" : screen} onChange={(s) => { setSeccionMas(null); setScreen(s); }} role={u.rol} pend={pend} modulos={isDemo ? undefined : empresa?.modulos} instalador={!!u.es_instalador} />}

      {paywallInfo && (
        <Paywall
          planActual={empresa?.plan_activo || "free"}
          planRequerido={paywallInfo.upgrade_a || "asistencia_15"}
          mensaje={paywallInfo.mensaje}
          onClose={() => setPaywallInfo(null)}
          onUpgrade={() => { setPaywallInfo(null); setShowBilling(true); }}
        />
      )}
      {showBilling && <BillingScreen onClose={() => setShowBilling(false)} />}
      {/* QR del rótulo de un bulto (OP parte 10): ?carga=OT abre la carga de esa OT */}
      {otCarga && !isDemo && (
        <CargaOt ot={otCarga} empresaId={u?.empresa_id || empresa?.id} empresa={empresa} usuario={u} checklist={checklistCarga}
          esGestion={u?.rol === "gerencial" || u?.rol === "administrativo"} onClose={cerrarCarga} onAbrirActa={abrirActa} />
      )}
      {skuArticulo && !otCarga && !otActa && !isDemo && <FichaArticulo sku={skuArticulo} usuario={u} empresaId={u?.empresa_id || empresa?.id} onClose={cerrarArticulo} />}
      {otActa && !isDemo && (
        <ActaOt ot={otActa} empresaId={u?.empresa_id || empresa?.id} empresa={empresa} checklist={checklistInstalacion}
          etapas={etapasEmpresa} defectos={defectos} esGestion={u?.rol === "gerencial" || u?.rol === "administrativo"} onClose={cerrarActa} />
      )}
    </div>
  );
}
