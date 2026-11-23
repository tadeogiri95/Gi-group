import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { useRefrescoVisible } from "./hooks/useRefrescoVisible";
import { fmtTime, fmtDate } from "./lib/theme";
import { sbGetAll } from "./lib/supabase";
import { hoyArg } from "./lib/dates";
import TrialBanner from "./components/TrialBanner";
import ChecklistActivacion from "./components/ChecklistActivacion";
import BillingScreen from "./components/BillingScreen";
import { tieneModulo } from "./lib/modulos";
import { getDivisionesConTodas } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { esSupervisor } from "./lib/menuGestion";
import { Tag } from "./components/ui";
import AvisoMigraciones from "./components/AvisoMigraciones";
import { contarPorDivision, nombreDivisionOt } from "./lib/avance";
import { leerAvanceYHoras } from "./lib/otEnCursoDatos";
import { alertasVehiculo, urgentes as alertasUrgentes } from "./lib/alertasFlota";
import { textoVencimiento, SEMAFORO } from "./lib/flota";
import { alertasMantenimiento } from "./lib/panelMantenimiento";
import { otEnProduccion, escaneosDelDia, escaneosPorOt, inicioDelDiaArg } from "./lib/inicioGerencia";
import NombreOt from "./components/NombreOt";
import MisPlanillas, { detalleMisPlanillas, useMisPlanillas } from "./components/MisPlanillas";
import MiCaja, { detalleMiCaja, useMiCaja } from "./components/MiCaja";

/* ═══════════════════════════════════════════════════════
   PANEL DE CONTROL (Inicio de gerencia)
   Pedido de Tadeo (23/11): solo cuatro bloques y en este orden:
   Equipo · OT en curso en producción · Escaneos de hoy · Flota.
   La asistencia todavía no corre por Gypi: no se muestra.
   ═══════════════════════════════════════════════════════ */

// R11: colores por token. El color dice si algo está bien, para atender o mal;
// el de la empresa es solo para lo principal.
const MARCA = "var(--color-empresa-primary)";
const TONO = {
  bien: { txt: "text-gypi-green-ink", fondo: "bg-gypi-green/10", borde: "border-gypi-green/25", relleno: "fill-gypi-green" },
  mal: { txt: "text-gypi-red-ink", fondo: "bg-gypi-red/10", borde: "border-gypi-red/25", relleno: "fill-gypi-red" },
  marca: { relleno: "fill-(--color-empresa-primary)" },
};

/** Título de cada tarjeta del tablero. */
const Titulo = ({ children }) => <h3 className="m-0 font-heading text-[15px] font-bold text-gypi-text">{children}</h3>;

/** Barra de porcentaje: un SVG con el ancho como atributo (sin estilos sueltos). */
function Barra({ pct, alto = 6, className = "" }) {
  return (
    <svg className={`w-full block rounded-sm bg-gypi-surf-hi ${className}`} height={alto} viewBox={`0 0 100 ${alto}`} preserveAspectRatio="none" aria-hidden="true">
      <rect width={Math.max(0, Math.min(pct, 100))} height={alto} rx="1" className={TONO.marca.relleno} />
    </svg>
  );
}

/* ─── Punto que late ("en vivo") ─── */
const PulseDot = () => <span className="inline-block w-2 h-2 rounded-full animate-pulse bg-gypi-green" aria-hidden="true" />;

/** Botón del pie de una tarjeta que lleva a su pantalla. */
function BotonIr({ onClick, children }) {
  return (
    <button onClick={onClick}
      className="flex-1 w-full mt-3 p-3 min-h-12 rounded-(--radius-md) font-body text-[14px] font-bold cursor-pointer flex items-center justify-center gap-1.5 bg-gypi-surf-hi border border-gypi-border text-gypi-text"
    >
      {children} &rarr;
    </button>
  );
}

/** Hora de un escaneo, en la hora de Argentina. */
const horaArg = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
};

/** 📐 Mis planillas de la arquitecta que entra (parte 50); nada si no es arquitecta. */
function TarjetaMisPlanillas() {
  const datos = useMisPlanillas(true);
  const [ver, setVer] = useState(false);
  if (!datos) return null;
  return (
    <section aria-label="Mis planillas" className="card-hover g-card mb-4">
      <button type="button" onClick={() => setVer(true)} className="w-full flex items-center gap-3 bg-transparent border-none p-0 cursor-pointer text-left font-body text-gypi-text">
        <span aria-hidden="true" className="text-[26px]">📐</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[16px] font-bold">Mis planillas</span>
          <span className="block text-[14px] text-gypi-dim">{detalleMisPlanillas(datos)}</span>
        </span>
      </button>
      {ver && <MisPlanillas datos={datos} onClose={() => setVer(false)} />}
    </section>
  );
}

/** 📱 Mi caja del que entra (Finanzas F3b, 176); nada si no es responsable de una caja. */
function TarjetaMiCaja() {
  const datos = useMiCaja(true);
  const [ver, setVer] = useState(false);
  if (!datos.cajas.length) return null;
  return (
    <section aria-label="Mi caja" className="card-hover g-card mb-4">
      <button type="button" onClick={() => setVer(true)} className="w-full flex items-center gap-3 bg-transparent border-none p-0 cursor-pointer text-left font-body text-gypi-text">
        <span aria-hidden="true" className="text-[26px]">📱</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[16px] font-bold">Mi caja</span>
          <span className="block text-[14px] text-gypi-dim">{detalleMiCaja(datos.cajas, datos.para_confirmar)}</span>
        </span>
      </button>
      {ver && <MiCaja datos={datos} onClose={() => setVer(false)} onCambio={datos.cargar} />}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL: DashboardGerencia
   ═══════════════════════════════════════════════════════ */
export default function DashboardGerencia({ goto, ctx, reload, empresa, isDemo = false }) {
  const { divisiones: divisionesCtx, etapas: etapasCtx, usuario } = useAuth();
  // El supervisor de división no paga ni pone en marcha la empresa: sin el
  // cartel de la prueba ni los primeros pasos del dueño (auditoría 01/11)
  const supervisor = esSupervisor(usuario);
  const DIVISIONES = getDivisionesConTodas(divisionesCtx);
  const [now, setNow] = useState(new Date());
  const [showBilling, setShowBilling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // null = no se pudo leer o la empresa no usa ese módulo: la tarjeta no aparece
  const [otCurso, setOtCurso] = useState(null);
  const [escaneos, setEscaneos] = useState(null);
  const [flota, setFlota] = useState(null);

  const hoy = hoyArg();
  const empleados = ctx.empleados || [];
  const empActivos = empleados.filter(e => e.activo !== false);

  const empresaId = empresa?.id;
  // OT y Flota son módulos propios (131): apagado o no contratado, su tarjeta no aparece
  const conOt = tieneModulo(empresa, "proyectos");
  const conFlota = tieneModulo(empresa, "flota");

  /* ─── Timer del reloj ─── */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  /* ─── OT en curso: el avance real (escaneo de piezas o % cargado a mano) ─── */
  const cargarOt = useCallback(async () => {
    if (isDemo || !empresaId || !conOt) return;
    try {
      const [proy, avHs] = await Promise.all([
        sbGetAll(`proyectos?empresa_id=eq.${empresaId}&estado=neq.cerrado&select=*&order=id.asc`, { maxFilas: 20000 }),
        leerAvanceYHoras(empresaId),
      ]);
      setOtCurso(otEnProduccion(proy.data || [], avHs.piezas || []));
    } catch (e) {
      console.error("Panel OT en curso:", e);
      setOtCurso(null);
    }
  }, [isDemo, empresaId, conOt]);

  /* ─── Escaneos de piezas de hoy (se refrescan cada minuto) ─── */
  const cargarEscaneos = useCallback(async () => {
    if (isDemo || !empresaId || !conOt) return;
    try {
      // Sin la migración 110 no hay escaneo por pieza: la tarjeta no aparece
      const r = await sbGetAll(`pasos_pieza?empresa_id=eq.${empresaId}&created_at=gte.${encodeURIComponent(inicioDelDiaArg(hoyArg()))}&select=id,ot,etapa,created_at,piezas_ot(nombre,modulo),empleados(nombre)&order=created_at.desc,id.desc`, { maxFilas: 5000 });
      setEscaneos(escaneosDelDia(r.data || [], etapasCtx || []));
    } catch (e) {
      console.error("Panel escaneos:", e);
      setEscaneos(null);
    }
  }, [isDemo, empresaId, conOt, etapasCtx]);

  /* ─── Flota: vehículos con lo que necesitan para sus alertas (Mantenimiento parte 30) ─── */
  const cargarFlota = useCallback(async () => {
    if (isDemo || !empresaId || !conFlota) return;
    try {
      // Sin la migración 126 no hay flota: la tarjeta no aparece
      const [veh, pap, chk, cho, arr] = await Promise.all([
        sbGetAll(`vehiculos?activo=eq.true&order=patente.asc,id.asc`, { maxFilas: 2000 }),
        sbGetAll(`vehiculo_papeles?order=created_at.desc,id.desc`, { maxFilas: 20000 }).catch(() => ({ data: [] })),
        sbGetAll(`vehiculo_checklists?select=id,vehiculo_id,created_at,km,secciones&order=created_at.desc,id.desc`, { maxFilas: 2000 }).catch(() => ({ data: [] })),
        sbGetAll(`empleados?activo=eq.true&select=id,nombre,licencia_categoria,licencia_vencimiento&order=id.asc`, { maxFilas: 5000 }).catch(() => ({ data: [] })),
        sbGetAll(`vehiculo_arreglos?estado=eq.pendiente&select=id,vehiculo_id,descripcion,prioridad,estado&order=id.asc`, { maxFilas: 5000 }).catch(() => ({ data: [] })),
      ]);
      setFlota({ vehiculos: veh.data || [], papeles: pap.data || [], checklists: chk.data || [], choferes: cho.data || [], arreglos: arr.data || [] });
    } catch (e) {
      console.error("Panel flota:", e);
      setFlota(null);
    }
  }, [isDemo, empresaId, conFlota]);

  useEffect(() => { cargarOt(); cargarFlota(); }, [cargarOt, cargarFlota]); // eslint-disable-line react-hooks/set-state-in-effect
  // Los escaneos, al abrir y cada minuto con la pestaña a la vista (F3-04)
  useRefrescoVisible(cargarEscaneos, { intervaloMs: 60000 });
  useEffect(() => { cargarEscaneos(); }, [cargarEscaneos]); // eslint-disable-line react-hooks/set-state-in-effect

  // Alertas de los vehículos: lo vencido y lo que vence pronto, lo más urgente primero
  const alertasFlota = useMemo(() => {
    if (!flota?.vehiculos.length) return null;
    const porId = new Map(flota.choferes.map(e => [e.id, e]));
    const alertas = alertasUrgentes(flota.vehiculos.flatMap(v => alertasVehiculo(v, {
      papeles: flota.papeles.filter(p => p.vehiculo_id === v.id), checklists: flota.checklists, arreglos: flota.arreglos, responsable: porId.get(v.responsable_id), hoy,
    }).map(a => ({ ...a, patente: v.patente }))));
    return alertasMantenimiento({ alertasFlota: alertas, hoy, textoVencimiento });
  }, [flota, hoy]);

  const resumenEscaneos = useMemo(() => escaneosPorOt(escaneos || []), [escaneos]);

  /* ═══ RENDER ═══ */
  return (
    <div className="g-fade-in safe-top font-body flex-1 overflow-y-auto px-4 pb-28">

      {/* ─── Header con fecha/hora ─── */}
      <header className="mb-5 pt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {empresa?.logo_url && <Image src={empresa.logo_url} alt="" width={44} height={44} className="rounded-[14px] object-contain shadow-sm" />}
            <div>
              <div className="text-[13px] text-gypi-dim font-medium">{fmtDate(now)} &middot; {fmtTime(now)}</div>
              <h2 className="mt-0.5 font-heading text-[28px] font-extrabold text-gypi-text tracking-tight leading-none">Panel de control</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${TONO.bien.fondo} ${TONO.bien.borde}`}>
              <PulseDot />
              <span className={`text-[12px] font-bold ${TONO.bien.txt}`}>En vivo</span>
            </div>
            <button
              onClick={async () => { setRefreshing(true); try { await Promise.all([reload?.(), cargarOt(), cargarEscaneos(), cargarFlota()]) } finally { setNow(new Date()); setRefreshing(false) } }}
              aria-label="Actualizar datos"
              className="w-11 h-11 rounded-xl bg-gypi-surface text-gypi-dim border border-gypi-border flex items-center justify-center cursor-pointer shadow-sm"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={refreshing ? "animate-spin text-gypi-amber-ink" : ""}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Avisos del sistema: prueba gratis, primeros pasos, migraciones ─── */}
      {!supervisor && <TrialBanner onUpgrade={() => setShowBilling(true)} reload={reload} />}
      {!isDemo && !supervisor && <ChecklistActivacion empresa={empresa} goto={goto} />}
      {!isDemo && usuario?.rol === "gerencial" && <AvisoMigraciones />}
      {showBilling && <BillingScreen onClose={() => setShowBilling(false)} />}

      {/* ─── 1. Equipo: con qué personal cuenta la empresa ─── */}
      <section aria-label="Equipo" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-3.5">
          <Titulo>👥 Equipo</Titulo>
          <Tag color="var(--color-cyan)">{empActivos.length} activos</Tag>
        </div>
        <div className="flex gap-2">
          {DIVISIONES.filter(d => d.id !== "todas").map(d => {
            const count = empActivos.filter(e => e.division === d.id).length;
            return (
              <div key={d.id} className="flex-1 text-center px-1 py-2 rounded-[10px] bg-gypi-surf-hi">
                <div className="text-sm" aria-hidden="true">{d.icon}</div>
                <div className="font-mono text-sm font-bold mt-0.5 text-gypi-text">{count}</div>
                <div className="text-[12px] text-gypi-dim font-semibold mt-px">{d.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── 2. OT en curso en producción: avance real por escaneo o % a mano ─── */}
      {otCurso && (
        <section aria-label="OT en curso" className="card-hover g-card mb-4">
          <div className="flex justify-between items-center mb-1">
            <Titulo>🏭 OT en curso en producción</Titulo>
            <Tag color={MARCA}>{otCurso.length}</Tag>
          </div>
          <p className="m-0 mb-2.5 text-[12px] text-gypi-dim">Con piezas escaneadas o % cargado a mano, sin llegar al 100 %.</p>
          {otCurso.length === 0 ? (
            <p className="m-0 text-[13px] text-gypi-dim">Ninguna OT tiene avance en producción ahora.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {contarPorDivision(otCurso, divisionesCtx || []).map(d => (
                  <span key={d.nombre} className="px-2.5 py-1 rounded-lg bg-gypi-surf-hi text-[12px] font-semibold text-gypi-text">{d.nombre}: {d.cantidad}</span>
                ))}
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {otCurso.map(f => (
                  <div key={f.proyecto.id ?? f.proyecto.ot} className="py-2 border-b border-gypi-border last:border-b-0">
                    <div className="flex items-center gap-2.5">
                      <span className="min-w-[52px] font-mono text-[13px] font-bold text-gypi-text">{f.proyecto.ot}</span>
                      <div className="flex-1 min-w-0">
                        <NombreOt proyecto={f.proyecto} sinCodigo truncar className="block text-[13px] text-gypi-text" />
                        <div className="text-[12px] text-gypi-dim truncate">{nombreDivisionOt(divisionesCtx || [], f.proyecto.division)}</div>
                      </div>
                      <span className="shrink-0 font-mono text-[14px] font-bold text-gypi-text">{f.porcentaje}%</span>
                    </div>
                    <Barra pct={f.porcentaje} className="mt-1.5" />
                  </div>
                ))}
              </div>
            </>
          )}
          <BotonIr onClick={() => goto?.("proyectos:ot")}>Ver las OT</BotonIr>
        </section>
      )}

      {/* ─── 3. Escaneos de piezas de hoy: en qué se está avanzando en la fábrica ─── */}
      {escaneos && (
        <section aria-label="Escaneos de hoy" className="card-hover g-card mb-4">
          <div className="flex justify-between items-center mb-1">
            <Titulo>🧩 Escaneos de hoy</Titulo>
            <Tag color={MARCA}>{escaneos.length} pieza{escaneos.length !== 1 ? "s" : ""}</Tag>
          </div>
          <p className="m-0 mb-2.5 text-[12px] text-gypi-dim">Lo último arriba. Se actualiza solo cada minuto.</p>
          {escaneos.length === 0 ? (
            <p className="m-0 text-[13px] text-gypi-dim">Todavía no se escaneó ninguna pieza hoy.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {resumenEscaneos.slice(0, 8).map(r => (
                  <span key={r.ot} className="px-2.5 py-1 rounded-lg bg-gypi-surf-hi text-[12px] font-semibold text-gypi-text">OT {r.ot}: {r.cantidad}</span>
                ))}
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {escaneos.slice(0, 100).map(e => (
                  <div key={e.id} className="flex items-center gap-2.5 py-2 border-b border-gypi-border last:border-b-0">
                    <span className="min-w-[44px] font-mono text-[12px] font-bold text-gypi-dim">{horaArg(e.hora)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-gypi-text truncate"><span className="font-mono font-bold">{e.ot}</span> &middot; {e.pieza}{e.modulo ? ` (${e.modulo})` : ""}</div>
                      <div className="text-[12px] text-gypi-dim truncate">{e.proceso}{e.quien ? ` · ${e.quien}` : ""}</div>
                    </div>
                  </div>
                ))}
                {escaneos.length > 100 && <p className="m-0 pt-2 text-[12px] text-gypi-dim">Y {escaneos.length - 100} más.</p>}
              </div>
            </>
          )}
        </section>
      )}

      {/* ─── 4. Flota vehicular: papeles, services y arreglos (Mantenimiento → Flota) ─── */}
      {alertasFlota && (() => {
        const vencidas = alertasFlota.filter(a => a.nivel === "vencido").length;
        const pronto = alertasFlota.length - vencidas;
        return (
          <section aria-label="Flota" className="card-hover g-card mb-4">
            <div className="flex justify-between items-center mb-2 gap-2">
              <Titulo>🚚 Flota</Titulo>
              <div className="flex gap-1.5 flex-wrap justify-end">
                {vencidas > 0 && <Tag color="var(--color-red)">{vencidas} vencida{vencidas !== 1 ? "s" : ""}</Tag>}
                {pronto > 0 && <Tag color={MARCA}>{pronto} para pronto</Tag>}
              </div>
            </div>
            {alertasFlota.length === 0 ? (
              <p className="m-0 text-[13px] text-gypi-dim">✅ Vehículos al día.</p>
            ) : (
              <div className="max-h-[240px] overflow-y-auto">
                {alertasFlota.slice(0, 10).map(a => (
                  <button key={a.clave} type="button" onClick={() => goto?.(a.destino)}
                    className="w-full flex items-center gap-2.5 py-2 min-h-11 bg-transparent border-0 border-b border-gypi-border last:border-b-0 text-left font-body cursor-pointer text-gypi-text">
                    <span aria-hidden="true">{SEMAFORO[a.nivel].emoji}</span>
                    <span className="flex-1 min-w-0 text-[13px] truncate">{a.texto}</span>
                    <span className="font-mono text-[12px] font-bold text-gypi-dim shrink-0">{a.quien}</span>
                  </button>
                ))}
                {alertasFlota.length > 10 && <p className="m-0 pt-2 text-[12px] text-gypi-dim">Y {alertasFlota.length - 10} más.</p>}
              </div>
            )}
            <BotonIr onClick={() => goto?.("mantenimiento:flota-alertas")}>Ir a Flota</BotonIr>
          </section>
        );
      })()}

      {/* ─── Atajos personales, al final: solo le aparecen a quien es responsable de una
           caja (es la única forma de cargar sus gastos) o arquitecta de Diseño y Técnica ─── */}
      {!isDemo && conOt && <TarjetaMisPlanillas />}
      {!isDemo && tieneModulo(empresa, "finanzas") && <TarjetaMiCaja />}

      {/* ─── Footer info ─── */}
      <footer className="text-center py-2 pb-3">
        <div className="text-xs text-gypi-mute">
          Los escaneos se actualizan solos cada minuto &middot; Última vez: {fmtTime(now)}
        </div>
      </footer>
    </div>
  );
}
