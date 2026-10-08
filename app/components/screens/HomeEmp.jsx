"use client";
import { useState } from "react";
import { fmtDate } from "../../lib/theme";
import { hoyArg, ahoraArg } from "../../lib/dates";
import { duracionMinutos } from "../../lib/calc";
import { Ic } from "../Icons";
import Icon from "../Icon";
import SolCard from "../cards/SolCard";
import EmptyState from "../ui/EmptyState";
import BotonFichar from "../BotonFichar";
import PinCard from "../PinCard";
import NuevaSolicitud from "../NuevaSolicitud";
import { notificacionAprobada } from "../../lib/textos";
import EstadoConexion from "../EstadoConexion";
import { useColaOffline } from "../../hooks/useColaOffline";
import { fichadaConPendientes } from "../../lib/colaOffline";
import { tieneModulo } from "../../lib/modulos";

function fmtMin(m) {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

export default function HomeEmp({ goto, usuario, ctx, logout, empresa, actividadesHoy = [], tareaActiva = null, etapas = [], reload, demo = false, onPinCambiado }) {
  const misSols = ctx.misSolicitudes || [];
  // Lo que se muestra según los módulos de la empresa (ítem 36)
  const conChat = tieneModulo(empresa, "chat");
  const conTareas = tieneModulo(empresa, "actividad");
  const [formSolicitud, setFormSolicitud] = useState(false);
  // Lo fichado sin señal todavía no está en ctx: se suma para que el botón no ofrezca fichar de nuevo (ítem 21)
  const cola = useColaOffline(demo ? null : usuario.id, { alTerminar: reload });
  const fichadasSinEnviar = cola.pendientes.filter((op) => op.tipo === "fichar");
  const fichadaHoy = fichadaConPendientes(ctx.fichadaHoy, fichadasSinEnviar, hoyArg());
  const salidaSinEnviar = fichadasSinEnviar.some((op) => op.body?.accion === "egreso");
  const fichadaAbierta = salidaSinEnviar && !fichadaHoy?.ingreso ? null : ctx.fichadaAbierta;
  const dH = ahoraArg().diaKey;
  const diagH = usuario.diagrama?.[dH];

  const etapaLabel = (id) => {
    if (id === 0) return "Parado";
    const e = etapas.find(e => e.id === id);
    return e?.nombre || `Etapa ${id}`;
  };

  const minProductivo = actividadesHoy.filter(r => r.etapa > 0).reduce((s, r) => s + duracionMinutos(r), 0);
  const minMuerto = actividadesHoy.filter(r => r.etapa === 0).reduce((s, r) => s + duracionMinutos(r), 0);
  const tareasCount = actividadesHoy.filter(r => r.etapa > 0).length;
  const hayActividad = actividadesHoy.length > 0 || !!tareaActiva;
  const fichado = !!fichadaHoy?.ingreso;

  const notisResolucion = (() => {
    const { fecha: hoy, hora } = ahoraArg();
    if (diagH) { const [hS, mS] = diagH.out.split(":").map(Number); const [hA, mA] = hora.split(":").map(Number); if (hA * 60 + mA >= hS * 60 + mS) return []; }
    const todasResol = (ctx.notificaciones || []).filter(n => n.tipo === "aprobacion" && n.created_at?.startsWith(hoy));
    return todasResol.length > 0 ? [todasResol[0]] : [];
  })();

  const statusColor = fichado ? "var(--color-green)" : "var(--color-empresa-primary)";

  return (
    <div className="g-fade-in flex-1 overflow-y-auto px-4 pb-[110px]">
      {/* Hero card */}
      <div
        className="relative overflow-hidden rounded-[22px] p-[22px_20px] mb-[18px]"
        style={{
          background: `linear-gradient(145deg,color-mix(in srgb, ${statusColor} 2%, transparent),var(--color-surface) 50%)`,
          border: `1.5px solid ${fichado ? "color-mix(in srgb, var(--color-green) 15%, transparent)" : "var(--color-border)"}`,
          boxShadow: `0 4px 20px color-mix(in srgb, ${statusColor} 3%, transparent), 0 1px 3px rgba(0,0,0,0.04)`,
        }}
      >
        <div
          className="absolute rounded-full"
          style={{
            top: -60, right: -60, width: 200, height: 200,
            background: `color-mix(in srgb, ${statusColor} 6%, transparent)`, filter: "blur(50px)",
          }}
        />
        <div className="relative">
          <div className="flex justify-between items-start mb-3.5">
            <div>
              <div className="text-[13px] text-gypi-dim font-medium mb-1.5">{fmtDate(new Date())}</div>
              <h2 className="m-0 font-heading text-[26px] font-extrabold text-gypi-text tracking-tight leading-[1.1]">
                Hola, {usuario.apodo}
              </h2>
              {diagH && (
                <div className="text-[13px] text-gypi-dim mt-1.5">
                  Jornada: <span className="text-gypi-text font-bold">{diagH.in} a {diagH.out}</span>
                </div>
              )}
              {!diagH && usuario.diagrama && (
                <div className="text-[13px] text-gypi-green font-bold mt-1.5">Hoy es franco</div>
              )}
            </div>
            <button
              onClick={logout}
              aria-label="Cerrar sesión"
              className="w-10 h-10 rounded-[12px] bg-gypi-surface text-gypi-dim border border-gypi-border flex items-center justify-center cursor-pointer shrink-0 shadow-sm"
            >
              <Ic.logout />
            </button>
          </div>
          <div
            className="flex items-center gap-2 py-2 px-3 rounded-[12px]"
            style={{ background: `color-mix(in srgb, ${statusColor} 3%, transparent)` }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: statusColor, boxShadow: `0 0 8px color-mix(in srgb, ${statusColor} 38%, transparent)` }}
            />
            <span className="text-[13px] font-bold" style={{ color: statusColor }}>
              {fichado
                ? `Entrada ${fichadaHoy.ingreso.slice(0, 5)}${fichadaHoy?.egreso ? " · Salida " + fichadaHoy.egreso.slice(0, 5) : ""}`
                : "Sin fichar"}
            </span>
          </div>
        </div>
      </div>

      {/* Notificaciones */}
      {notisResolucion.length > 0 && (
        <div className="mb-[18px]" role="status">
          {notisResolucion.map(n => {
            const isApproved = notificacionAprobada(n.asunto);
            const ac = isApproved ? "var(--color-green)" : "var(--color-red)";
            return (
              <div
                key={n.id}
                className="rounded-[14px] p-[14px_16px] mb-2"
                style={{
                  background: `color-mix(in srgb, ${ac} 3%, transparent)`,
                  border: `1.5px solid color-mix(in srgb, ${ac} 13%, transparent)`,
                  boxShadow: `0 2px 8px color-mix(in srgb, ${ac} 3%, transparent)`,
                }}
              >
                <div className="text-sm font-bold text-gypi-text">{n.asunto}</div>
                <div className="text-xs text-gypi-dim mt-1 leading-[1.4]">{n.detalle}</div>
              </div>
            );
          })}
        </div>
      )}

      <EstadoConexion cola={cola} />

      {/* Botón grande de fichar (D6): fichar ya no depende del chat */}
      <BotonFichar
        usuario={usuario}
        fichadaHoy={fichadaHoy}
        fichadaAbierta={fichadaAbierta}
        onFichado={reload}
        irAlChat={conChat ? () => goto("chat") : undefined}
        demo={demo}
      />

      {/* Chat: permisos, avisos y consultas */}
      {conChat && <button
        onClick={() => goto("chat")}
        aria-label="Abrir el asistente para pedir permisos o dar avisos"
        className="w-full p-[14px_16px] rounded-[16px] cursor-pointer flex items-center gap-3 font-body mb-[22px] border border-gypi-border bg-gypi-surface"
        style={{ minHeight: 56 }}
      >
        <div
          className="w-10 h-10 rounded-[12px] flex items-center justify-center text-black shrink-0"
          style={{ background: `linear-gradient(135deg,var(--color-empresa-primary),var(--color-empresa-secondary))` }}
        >
          <Ic.bot />
        </div>
        <div className="flex-1 text-left">
          <div className="text-[14px] font-bold text-gypi-text leading-[1.3]">Pedir permisos o dar avisos</div>
          <div className="text-[12px] text-gypi-dim leading-[1.3] mt-0.5">Hablá con el asistente</div>
        </div>
        <span className="text-gypi-amber-ink shrink-0 opacity-60"><Ic.chevR /></span>
      </button>}

      {/* PIN para entrar rápido (F4-06) */}
      {usuario.rol === "operativo" && (
        <PinCard tienePin={!!usuario.tiene_pin} onCambio={onPinCambiado} demo={demo} />
      )}

      {/* Jornada de hoy */}
      {conTareas && (hayActividad || (fichado && !fichadaHoy?.egreso)) && (
        <section className="mb-[22px]" aria-label="Jornada de hoy">
          <div className="flex justify-between items-center mb-3.5">
            <h3 className="m-0 font-heading text-lg font-extrabold text-gypi-text tracking-tight">
              Jornada de hoy
            </h3>
            <button
              onClick={() => goto("actividad")}
              className="text-xs text-gypi-amber-ink font-bold font-body border-none cursor-pointer py-1.5 px-3 rounded-[10px]"
              style={{ background: `color-mix(in srgb, var(--color-empresa-primary) 3%, transparent)` }}
            >
              Ver jornada →
            </button>
          </div>

          {/* Tarea activa */}
          {tareaActiva && (
            <div
              className="rounded-[14px] p-[12px_16px] mb-2.5 flex items-center gap-3"
              style={{
                background: `color-mix(in srgb, var(--color-green) 3%, transparent)`,
                border: `1.5px solid color-mix(in srgb, var(--color-green) 13%, transparent)`,
                boxShadow: `0 2px 8px color-mix(in srgb, var(--color-green) 3%, transparent)`,
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  background: "var(--color-green)",
                  boxShadow: `0 0 0 3px color-mix(in srgb, var(--color-green) 15%, transparent), 0 0 12px color-mix(in srgb, var(--color-green) 19%, transparent)`,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-gypi-green">En curso</div>
                <div className="text-xs text-gypi-text mt-0.5">
                  {etapaLabel(tareaActiva.etapa)}{tareaActiva.codigo_proyecto ? ` · OT ${tareaActiva.codigo_proyecto}` : ""}
                </div>
              </div>
              <div className="text-[11px] text-gypi-dim font-mono shrink-0">
                desde {new Date(tareaActiva.hora_inicio).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          )}

          {/* Chips resumen */}
          {(minProductivo > 0 || minMuerto > 0) && (
            <div className="flex gap-1.5 flex-wrap mb-2.5">
              {minProductivo > 0 && (
                <span
                  className="text-[11px] font-bold text-gypi-green font-body py-1 px-2.5 rounded-lg"
                  style={{ background: `color-mix(in srgb, var(--color-green) 7%, transparent)` }}
                >
                  ✓ {fmtMin(minProductivo)} productivo
                </span>
              )}
              {minMuerto > 0 && (
                <span
                  className="text-[11px] font-bold text-gypi-amber-ink font-body py-1 px-2.5 rounded-lg"
                  style={{ background: `color-mix(in srgb, var(--color-empresa-primary) 7%, transparent)` }}
                >
                  ⏸ {fmtMin(minMuerto)} espera
                </span>
              )}
              {tareasCount > 0 && (
                <span className="text-[11px] font-bold text-gypi-dim bg-gypi-surf-hi font-body py-1 px-2.5 rounded-lg">
                  {tareasCount} tarea{tareasCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}

          {/* Lista de actividades */}
          {actividadesHoy.length === 0 && tareaActiva && (
            <EmptyState
              icon="clock"
              title="Primera actividad del día"
              description="A medida que avances con tus tareas, el detalle va a aparecer acá."
              color="var(--color-cyan)"
              style={{ padding: "24px 16px" }}
            />
          )}
          {actividadesHoy.length > 0 && (
            <div className="bg-gypi-surface rounded-2xl border border-gypi-border overflow-hidden shadow-sm">
              {actividadesHoy.slice(0, 6).map((r, i, arr) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2.5 py-2.5 px-3.5"
                  style={{ borderBottom: i < Math.min(arr.length, 6) - 1 ? `1px solid var(--color-border)` : "none" }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: r.etapa > 0 ? "var(--color-green)" : "var(--color-empresa-primary)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gypi-text whitespace-nowrap overflow-hidden text-ellipsis">
                      {etapaLabel(r.etapa)}{r.codigo_proyecto ? ` · OT ${r.codigo_proyecto}` : ""}
                    </div>
                  </div>
                  <div className="text-[11px] text-gypi-dim font-mono shrink-0 text-right">
                    <div>{new Date(r.hora_inicio).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</div>
                    {duracionMinutos(r) > 0 && (
                      <div style={{ color: r.etapa > 0 ? "var(--color-green)" : "var(--color-empresa-primary)" }}>
                        {fmtMin(duracionMinutos(r))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {actividadesHoy.length > 6 && (
                <button
                  onClick={() => goto("actividad")}
                  className="w-full py-2.5 px-3.5 bg-gypi-surf-lo border-none text-xs text-gypi-dim font-semibold font-body cursor-pointer text-center"
                  style={{ borderTop: `1px solid var(--color-border)` }}
                >
                  +{actividadesHoy.length - 6} actividades más
                </button>
              )}
            </div>
          )}

          {/* CTA iniciar si fichado pero sin actividades */}
          {!hayActividad && fichado && !fichadaHoy?.egreso && (
            <button
              onClick={() => goto("actividad")}
              className="w-full p-[14px_20px] rounded-[14px] cursor-pointer flex items-center gap-3 font-body"
              style={{
                background: `color-mix(in srgb, var(--color-green) 6%, transparent)`,
                border: `1px solid color-mix(in srgb, var(--color-green) 19%, transparent)`,
              }}
            >
              <div
                className="w-9 h-9 rounded-[10px] flex items-center justify-center text-gypi-green shrink-0"
                style={{ background: `color-mix(in srgb, var(--color-green) 13%, transparent)` }}
              >
                <Icon name="play" size={16} />
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-gypi-text">Registrar actividad</div>
                <div className="text-xs text-gypi-dim mt-0.5">Anotá en qué estás trabajando</div>
              </div>
            </button>
          )}
        </section>
      )}

      {/* Historial link */}
      <button
        onClick={() => goto("historial-fichajes")}
        aria-label="Ver historial de fichajes"
        className="w-full p-4 rounded-2xl text-gypi-text text-[13px] font-semibold font-body cursor-pointer flex items-center justify-between mb-[22px]"
        style={{
          background: `linear-gradient(135deg,color-mix(in srgb, var(--color-cyan) 2%, transparent),var(--color-surface))`,
          border: `1.5px solid color-mix(in srgb, var(--color-cyan) 13%, transparent)`,
          boxShadow: `0 2px 10px color-mix(in srgb, var(--color-cyan) 2%, transparent)`,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-[34px] h-[34px] rounded-[10px] text-gypi-cyan flex items-center justify-center"
            style={{ background: `color-mix(in srgb, var(--color-cyan) 13%, transparent)` }}
          >
            <Icon name="chart" size={17} />
          </div>
          <div className="text-left">
            <div className="text-[13px] font-bold text-gypi-text">Historial de fichajes</div>
            <div className="text-[11px] text-gypi-dim mt-0.5">Tardanzas, permisos y conversaciones</div>
          </div>
        </div>
        <span className="text-gypi-dim"><Ic.chevR /></span>
      </button>

      {/* Mi documentación */}
      <button
        onClick={() => goto("documentos")}
        aria-label="Ver mi documentación"
        className="w-full p-4 rounded-2xl text-gypi-text text-[13px] font-semibold font-body cursor-pointer flex items-center justify-between mb-[22px]"
        style={{
          background: `linear-gradient(135deg,color-mix(in srgb, var(--color-empresa-secondary) 2%, transparent),var(--color-surface))`,
          border: `1.5px solid color-mix(in srgb, var(--color-empresa-secondary) 13%, transparent)`,
          boxShadow: `0 2px 10px color-mix(in srgb, var(--color-empresa-secondary) 2%, transparent)`,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center"
            style={{ background: `color-mix(in srgb, var(--color-empresa-secondary) 13%, transparent)`, color: "var(--color-empresa-secondary)" }}
          >
            <Icon name="document" size={17} />
          </div>
          <div className="text-left">
            <div className="text-[13px] font-bold text-gypi-text">Mi documentación</div>
            <div className="text-[11px] text-gypi-dim mt-0.5">DNI, licencia y otros documentos exigidos</div>
          </div>
        </div>
        <span className="text-gypi-dim"><Ic.chevR /></span>
      </button>

      {/* Grilla semanal */}
      {usuario.diagrama && (() => {
        const DIAS_G = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
        const DIAS_LABEL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
        const diaHoy = ahoraArg().diaKey;
        const diag = usuario.diagrama;
        let totalH = 0;
        DIAS_G.forEach(d => { if (diag[d]) { const [hI, mI] = diag[d].in.split(":").map(Number); const [hO, mO] = diag[d].out.split(":").map(Number); totalH += (hO * 60 + mO - hI * 60 - mI) / 60; } });
        return (
          <section aria-label="Grilla semanal">
            <div className="mb-3">
              <h3 className="m-0 text-base font-bold text-gypi-text font-heading">Mi grilla semanal</h3>
            </div>
            <div className="bg-gypi-surface rounded-2xl p-3.5 border border-gypi-border mb-[18px]">
              {DIAS_G.map((d, i) => {
                const h = diag[d];
                const esHoy = d === diaHoy;
                return (
                  <div
                    key={d}
                    className="flex items-center py-2.5 px-2 rounded-[10px]"
                    style={{
                      background: esHoy ? `color-mix(in srgb, var(--color-empresa-primary) 7%, transparent)` : "transparent",
                      border: esHoy ? `1px solid color-mix(in srgb, var(--color-empresa-primary) 19%, transparent)` : "1px solid transparent",
                      marginBottom: i < 6 ? 4 : 0,
                    }}
                  >
                    <div
                      className="w-[70px] text-[13px] font-heading"
                      style={{
                        fontWeight: esHoy ? 700 : 500,
                        color: esHoy ? "var(--color-empresa-primary)" : "var(--color-text)",
                      }}
                    >
                      {DIAS_LABEL[d]}
                    </div>
                    {h ? (
                      <div className="flex-1 flex items-center gap-1.5">
                        <span className="font-mono text-sm font-semibold" style={{ color: esHoy ? "var(--color-text)" : "var(--color-text-muted)" }}>{h.in}</span>
                        <span className="text-gypi-mute text-xs">→</span>
                        <span className="font-mono text-sm font-semibold" style={{ color: esHoy ? "var(--color-text)" : "var(--color-text-muted)" }}>{h.out}</span>
                      </div>
                    ) : (
                      <div className="flex-1 text-[13px] text-gypi-green font-semibold">Franco</div>
                    )}
                    {esHoy && (
                      <span
                        className="text-xs text-gypi-amber-ink font-bold py-0.5 px-2 rounded-[6px] ml-1.5"
                        style={{ background: `color-mix(in srgb, var(--color-empresa-primary) 13%, transparent)` }}
                      >
                        HOY
                      </span>
                    )}
                  </div>
                );
              })}
              <div
                className="mt-2.5 pt-2.5 flex justify-between text-xs"
                style={{ borderTop: `1px solid var(--color-border)` }}
              >
                <span className="text-gypi-dim">{DIAS_G.filter(d => diag[d]).length} días laborales</span>
                <span className="text-gypi-text font-bold font-mono">{totalH.toFixed(1)}h/semana</span>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Mi semana */}
      <section aria-label="Fichadas de la semana">
        <div className="mb-3">
          <h3 className="m-0 text-base font-bold text-gypi-text font-heading">Mi semana</h3>
        </div>
        <div className="bg-gypi-surface rounded-2xl p-3.5 border border-gypi-border mb-[18px]">
          {(ctx.fichadasSemana || []).length === 0
            ? <EmptyState icon="clock" title="Sin fichadas esta semana" description="Tus registros de entrada y salida aparecerán acá." color="var(--color-cyan)" style={{ padding: "24px 16px" }} />
            : (ctx.fichadasSemana || []).map((d, i, a) => (
              <div
                key={i}
                className="flex justify-between items-center py-2.5"
                style={{ borderBottom: i < a.length - 1 ? `1px solid var(--color-border)` : "none" }}
              >
                <div>
                  <div className="text-[13px] font-semibold text-gypi-text">
                    {new Date(d.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                  </div>
                  {d.ingreso && (
                    <div className="text-[11px] text-gypi-dim mt-0.5 font-mono">
                      {d.ingreso.slice(0, 5)} → {d.egreso ? d.egreso.slice(0, 5) : "en curso"}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {d.horas_trabajadas && (
                    <span className="text-xs text-gypi-dim font-mono">{Number(d.horas_trabajadas).toFixed(1)}h</span>
                  )}
                  <span
                    className="font-mono text-sm font-bold"
                    style={{ color: d.ingreso ? "var(--color-green)" : "var(--color-text-secondary)" }}
                  >
                    {d.ingreso ? "✓" : "—"}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* Mis solicitudes */}
      <section aria-label="Mis solicitudes">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="m-0 text-base font-bold text-gypi-text font-heading">Mis solicitudes</h3>
          <button onClick={() => setFormSolicitud(true)} className="min-h-[40px] px-3.5 rounded-[10px] border-none bg-gypi-amber/[0.13] text-gypi-amber-ink text-xs font-bold cursor-pointer">+ Nueva solicitud</button>
        </div>
        {formSolicitud && (
          <NuevaSolicitud
            usuario={usuario}
            empresa={empresa}
            demo={demo}
            onCerrar={() => setFormSolicitud(false)}
            onEnviada={() => { setFormSolicitud(false); reload?.(); }}
          />
        )}
        <div className="flex flex-col gap-2.5">
          {misSols.length === 0
            ? (
              <div className="bg-gypi-surface rounded-[14px] border border-gypi-border">
                <EmptyState
                  icon="inbox"
                  title="Sin solicitudes"
                  description="Cuando pidas un permiso, vacaciones o justifiques una falta, aparecen acá."
                  color="var(--color-empresa-secondary)"
                  style={{ padding: "28px 16px" }}
                />
              </div>
            )
            : misSols.map(s => <SolCard key={s.id} s={s} />)}
        </div>
      </section>
    </div>
  );
}
