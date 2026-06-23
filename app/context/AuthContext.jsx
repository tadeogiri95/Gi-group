"use client";
// ═══════════════════════════════════════════════════════════
// AuthContext — Sesión, login, logout, empresa
//
// ENTREGA 2C: Centraliza los siguientes estados de page.js:
//   usuario, empresa, init, slugInvalido
// Y las funciones: login, logout, cargarEmpresa, loadConfigEmpresa
//
// Reemplaza:
//   - 5 useStates (usuario, empresa, init, slugInvalido, forceRender)
//   - Lógica de sessionStorage gi-session / gi-session-time
//   - cargarEmpresa() con pre-login (slug) y post-login (token)
//   - loadConfigEmpresa() para divisiones/etapas
//   - onUnauthorized callback
//
// Uso en cualquier componente:
//   const { usuario, empresa, login, logout, isGer, divisiones, etapas } = useAuth();
// ═══════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { setToken, getToken, clearToken, onUnauthorized, setEmpresaId, setRefreshToken } from "../lib/supabase";
import { setColoresEmpresa } from "../lib/theme";

// Exportado (además de useAuth) para poder envolver componentes en tests
// con un valor de contexto mínimo, sin pasar por el AuthProvider real
// (que depende de next/navigation y hace fetch al montar).
export const AuthContext = createContext(null);

const SIETE_DIAS = 7 * 24 * 60 * 60 * 1000;

export function AuthProvider({ children }) {
  const { slug } = useParams();
  const router = useRouter();

  const [usuario, setUsuario] = useState(null);
  const [empresa, setEmpresa] = useState({
    nombre: "Gypi", nombre_corto: "Gypi",
    color_primario: "#F97316", color_secundario: "#8B5CF6",
    prompt_ia_obra: "", prompt_ia_chat: "",
  });
  const [divisiones, setDivisionesState] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [init, setInit] = useState(false);
  const [slugInvalido, setSlugInvalido] = useState(false);

  // ─── Cargar config de empresa (divisiones/etapas) ───
  const loadConfigEmpresa = useCallback(async (eid) => {
    if (!eid) return;
    try {
      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch("/api/config-empresa", { headers });
      const data = await res.json();
      if (data.divisiones) {
        setDivisionesState(data.divisiones);
      }
      if (data.etapas) setEtapas(data.etapas);
    } catch (e) {
      console.error("Error cargando config empresa:", e);
    }
  }, []);

  // ─── Cargar empresa (pre-login: por slug, post-login: via cookie) ───
  // No usa getToken() — la sesión autenticada se detecta por gi-session en sessionStorage.
  // Las cookies httpOnly autentican las llamadas al servidor automáticamente.
  const cargarEmpresa = useCallback(async () => {
    let hasSession = false;
    try { hasSession = !!sessionStorage.getItem("gi-session"); } catch {}

    try {
      if (!hasSession && slug) {
        // Pre-login: resolver por slug (público)
        const r = await fetch(`/api/empresa?slug=${encodeURIComponent(slug)}`);
        const d = await r.json();
        if (r.status === 404 || d?.error) { setSlugInvalido(true); return; }
        setEmpresa(d);
        setColoresEmpresa(d);
        return;
      }
      if (hasSession) {
        // Post-login: traer empresa completa (autenticado via cookie httpOnly).
        // Solo actualizamos si la respuesta contiene un id real — el servidor
        // puede devolver DEFAULTS (sin id) si la sesión aún no fue validada.
        const r = await fetch("/api/empresa", { credentials: "include" });
        const d = await r.json();
        if (d && !d.error && d.id) {
          setEmpresa(d);
          setColoresEmpresa(d);
          loadConfigEmpresa(d.id);
        }
      }
    } catch (e) {
      if (process.env.NODE_ENV !== "production") console.error("cargarEmpresa error:", e);
    }
  }, [slug, loadConfigEmpresa]);

  // ─── Resolver branding al montar ───
  useEffect(() => { cargarEmpresa(); }, [cargarEmpresa]);

  // ─── Restaurar sesión de sessionStorage ───
  useEffect(() => {
    try {
      const s = sessionStorage.getItem("gi-session");
      if (s) {
        const parsed = JSON.parse(s);
        const guardado = sessionStorage.getItem("gi-session-time");
        const ahora = Date.now();
        if (guardado && (ahora - Number(guardado)) > SIETE_DIAS) {
          sessionStorage.removeItem("gi-session");
          sessionStorage.removeItem("gi-session-time");
          clearToken();
        } else {
          setUsuario(parsed);
          if (parsed.empresa_id) setEmpresaId(parsed.empresa_id);
        }
      }
    } catch {}
    setInit(true);
  }, []);

  // ─── Auto-logout en 401 del servidor ───
  useEffect(() => {
    onUnauthorized(() => {
      setUsuario(null);
      clearToken();
      try {
        sessionStorage.removeItem("gi-session");
        sessionStorage.removeItem("gi-session-time");
      } catch {}
      // Re-cargar empresa por slug para que empresa.id esté disponible al re-loguear
      cargarEmpresa();
    });
  }, [cargarEmpresa]);

  // ─── Login ───
  const login = useCallback((u, tokens = {}) => {
    const safe = { ...u };
    delete safe.password;
    setUsuario(safe);
    if (safe.empresa_id) setEmpresaId(safe.empresa_id);

    // Guardar tokens si vienen del login (1E JWT)
    if (tokens.token) setToken(tokens.token);
    if (tokens.refresh_token) setRefreshToken(tokens.refresh_token);

    // Persistir sesión
    try {
      sessionStorage.setItem("gi-session", JSON.stringify(safe));
      sessionStorage.setItem("gi-session-time", String(Date.now()));
    } catch {}

    // Cargar config de empresa
    if (safe.empresa_id) loadConfigEmpresa(safe.empresa_id);
    cargarEmpresa();
  }, [loadConfigEmpresa, cargarEmpresa]);

  // ─── Logout ───
  const logout = useCallback(async () => {
    setUsuario(null);
    clearToken();
    try {
      sessionStorage.removeItem("gi-session");
      sessionStorage.removeItem("gi-session-time");
    } catch {}
    // Limpiar cookies httpOnly desde el servidor
    await fetch("/api/logout", { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/");
  }, [router]);

  // ─── Actualizar empresa (desde admin_empresa_screen) ───
  const updateEmpresa = useCallback((updates) => {
    setEmpresa(prev => {
      const updated = { ...prev, ...updates };
      setColoresEmpresa(updated);
      return updated;
    });
    if (usuario?.empresa_id) loadConfigEmpresa(usuario.empresa_id);
  }, [usuario, loadConfigEmpresa]);

  const isGer = usuario && (usuario.rol === "gerencial" || usuario.rol === "administrativo");

  return (
    <AuthContext.Provider value={{
      usuario,
      empresa,
      divisiones,
      etapas,
      init,
      slugInvalido,
      isGer,
      login,
      logout,
      updateEmpresa,
      loadConfigEmpresa,
      cargarEmpresa,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
