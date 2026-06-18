"use client";
import { fmtDate, DIAS_KEY } from "../../lib/theme";
import { hoyArg, ahoraArg } from "../../lib/dates";
import { Ic } from "../Icons";
import SolCard from "../cards/SolCard";
import EmptyState from "../ui/EmptyState";

function fmtMin(m) {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

export default function HomeEmp({ goto, usuario, ctx, logout, empresa, actividadesHoy = [], tareaActiva = null, etapas = [] }) {
  const misSols = ctx.misSolicitudes || [];
  const dH = DIAS_KEY[new Date().getDay()];
  const diagH = usuario.diagrama?.[dH];

  const etapaLabel = (id) => {
    if (id === 0) return "Espera / tiempo muerto";
    const e = etapas.find(e => e.id === id);
    return e?.nombre || `Etapa ${id}`;
  };

  const minProductivo = actividadesHoy.filter(r => r.etapa > 0).reduce((s, r) => s + (r.duracion_min || 0), 0);
  const minMuerto = actividadesHoy.filter(r => r.etapa === 0).reduce((s, r) => s + (r.duracion_min || 0), 0);
  const tareasCount = actividadesHoy.filter(r => r.etapa > 0).length;
  const hayActividad = actividadesHoy.length > 0 || !!tareaActiva;
  const fichado = !!ctx.fichadaHoy?.ingreso;

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
          background: `linear-gradient(145deg,${statusColor}06,var(--color-surface) 50%)`,
          border: `1.5px solid ${fichado ? "var(--color-green)" : "var(--color-border)"}${fichado ? "25" : ""}`,
          boxShadow: `0 4px 20px ${statusColor}08, 0 1px 3px rgba(0,0,0,0.04)`,
        }}
      >
        <div
          className="absolute rounded-full"
          style={{
            top: -60, right: -60, width: 200, height: 200,
            background: `${statusColor}10`, filter: "blur(50px)",
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
            style={{ background: `${statusColor}08` }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}60` }}
            />
            <span className="text-[13px] font-bold" style={{ color: statusColor }}>
              {fichado
                ? `Ingreso ${ctx.fichadaHoy.ingreso.slice(0, 5)}${ctx.fichadaHoy?.egreso ? " · Egreso " + ctx.fichadaHoy.egreso.slice(0, 5) : ""}`
                : "Sin fichar"}
            </span>
          </div>
        </div>
      </div>

      {/* Notificaciones */}
      {notisResolucion.length > 0 && (
        <div className="mb-[18px]" role="status">
          {notisResolucion.map(n => {
            const isApproved = n.asunto?.includes("APROBADA") || n.asunto?.includes("aprobado");
            const ac = isApproved ? "var(--color-green)" : "var(--color-red)";
            return (
              <div
                key={n.id}
                className="rounded-[14px] p-[14px_16px] mb-2"
                style={{
                  background: `${ac}08`,
                  border: `1.5px solid ${ac}20`,
                  boxShadow: `0 2px 8px ${ac}08`,
                }}
              >
                <div className="text-sm font-bold text-gypi-text">{n.asunto}</div>
                <div className="text-xs text-gypi-dim mt-1 leading-[1.4]">{n.detalle}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bot CTA */}
      <button
        onClick={() => goto("chat")}
        aria-label="Abrir chat para fichar o hacer solicitudes"
        className="w-full p-[18px_20px] rounded-[18px] cursor-pointer flex items-center gap-3.5 font-body mb-[22px] transition-[transform,box-shadow] duration-150 ease-in-out"
        style={{
          background: `linear-gradient(135deg,var(--color-empresa-primary)12,var(--color-empresa-secondary)10)`,
          border: `1.5px solid var(--color-empresa-primary)25`,
          boxShadow: `0 4px 16px var(--color-empresa-primary)08`,
        }}
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-black shrink-0"
          style={{
            background: `linear-gradient(135deg,var(--color-empresa-primary),var(--color-empresa-secondary))`,
            boxShadow: `0 4px 12px var(--color-empresa-primary)30`,
          }}
        >
          <Ic.bot />
        </div>
        <div className="flex-1 text-left">
          <div className="text-[15px] font-extrabold text-gypi-text leading-[1.3] tracking-tight">
            Tocame para fichar ingreso, salida,
          </div>
          <div className="text-[13px] font-medium text-gypi-dim leading-[1.3] mt-0.5">
            pedir permisos o dar avisos
          </div>
        </div>
        <span className="text-gypi-amber shrink-0 opacity-60"><Ic.chevR /></span>
      </button>

      {/* Jornada de hoy */}
      {(hayActividad || (fichado && !ctx.fichadaHoy?.egreso)) && (
        <section className="mb-[22px]" aria-label="Jornada de hoy">
          <div className="flex justify-between items-center mb-3.5">
            <h3 className="m-0 font-heading text-lg font-extrabold text-gypi-text tracking-tight">
              Jornada de hoy
            </h3>
            <button
              onClick={() => goto("actividad")}
              className="text-xs text-gypi-amber font-bold font-body border-none cursor-pointer py-1.5 px-3 rounded-[10px]"
              style={{ background: `var(--color-empresa-primary)08` }}
            >
              Ver jornada →
            </button>
          </div>

          {/* Tarea activa */}
          {tareaActiva && (
            <div
              className="rounded-[14px] p-[12px_16px] mb-2.5 flex items-center gap-3"
              style={{
                background: `var(--color-green)08`,
                border: `1.5px solid var(--color-green)20`,
                boxShadow: `0 2px 8px var(--color-green)08`,
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  background: "var(--color-green)",
                  boxShadow: `0 0 0 3px var(--color-green)25, 0 0 12px var(--color-green)30`,
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
                  style={{ background: `var(--color-green)12` }}
                >
                  ✓ {fmtMin(minProductivo)} productivo
                </span>
              )}
              {minMuerto > 0 && (
                <span
                  className="text-[11px] font-bold text-gypi-amber font-body py-1 px-2.5 rounded-lg"
                  style={{ background: `var(--color-empresa-primary)12` }}
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
                    {r.duracion_min > 0 && (
                      <div style={{ color: r.etapa > 0 ? "var(--color-green)" : "var(--color-empresa-primary)" }}>
                        {fmtMin(r.duracion_min)}
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
          {!hayActividad && fichado && !ctx.fichadaHoy?.egreso && (
            <button
              onClick={() => goto("actividad")}
              className="w-full p-[14px_20px] rounded-[14px] cursor-pointer flex items-center gap-3 font-body"
              style={{
                background: `var(--color-green)10`,
                border: `1px solid var(--color-green)30`,
              }}
            >
              <div
                className="w-9 h-9 rounded-[10px] flex items-center justify-center text-lg shrink-0"
                style={{ background: `var(--color-green)22` }}
              >
                ▶
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
          background: `linear-gradient(135deg,var(--color-cyan)06,var(--color-surface))`,
          border: `1.5px solid var(--color-cyan)20`,
          boxShadow: `0 2px 10px var(--color-cyan)06`,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-[34px] h-[34px] rounded-[10px] text-gypi-cyan flex items-center justify-center"
            style={{ background: `var(--color-cyan)22` }}
          >
            📊
          </div>
          <div className="text-left">
            <div className="text-[13px] font-bold text-gypi-text">Historial de fichajes</div>
            <div className="text-[11px] text-gypi-dim mt-0.5">Tardanzas, presentismo y conversaciones</div>
          </div>
        </div>
        <span className="text-gypi-dim"><Ic.chevR /></span>
      </button>

      {/* Grilla semanal */}
      {usuario.diagrama && (() => {
        const DIAS_G = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
        const DIAS_LABEL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
        const diaHoy = DIAS_KEY[new Date().getDay()];
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
                      background: esHoy ? `var(--color-empresa-primary)12` : "transparent",
                      border: esHoy ? `1px solid var(--color-empresa-primary)30` : "1px solid transparent",
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
                        <span className="text-gypi-mute text-[10px]">→</span>
                        <span className="font-mono text-sm font-semibold" style={{ color: esHoy ? "var(--color-text)" : "var(--color-text-muted)" }}>{h.out}</span>
                      </div>
                    ) : (
                      <div className="flex-1 text-[13px] text-gypi-green font-semibold">Franco</div>
                    )}
                    {esHoy && (
                      <span
                        className="text-[10px] text-gypi-amber font-bold py-0.5 px-2 rounded-[6px] ml-1.5"
                        style={{ background: `var(--color-empresa-primary)22` }}
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
                    <span className="text-[10px] text-gypi-dim font-mono">{Number(d.horas_trabajadas).toFixed(1)}h</span>
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
        <div className="mb-3">
          <h3 className="m-0 text-base font-bold text-gypi-text font-heading">Mis solicitudes</h3>
        </div>
        <div className="flex flex-col gap-2.5">
          {misSols.length === 0
            ? (
              <div className="bg-gypi-surface rounded-[14px] border border-gypi-border">
                <EmptyState
                  icon="inbox"
                  title="Sin solicitudes"
                  description="Cuando pidas permisos o justifiques ausencias desde el chat, aparecerán acá."
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
