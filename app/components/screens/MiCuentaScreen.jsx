"use client";
// Mi cuenta del operario: lo que no se usa todos los días (horario, semana,
// fichadas, documentos, PIN y salir). Antes era un renglón al final del
// Inicio; ahora es una pestaña de la barra de abajo (revisión de la
// interfaz, 2026-10). Sin estilos sueltos (R11).
import { ahoraArg } from "../../lib/dates";
import { Ic } from "../Icons";
import EmptyState from "../ui/EmptyState";
import ListItem from "../ui/ListItem";
import { Button } from "../ui";
import { useConfirm } from "../ui/ConfirmDialog";
import PinCard from "../PinCard";
import { BotonInstalar } from "../InstalarApp";
import { tieneModulo } from "../../lib/modulos";

const DIAS_G = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_LABEL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
const flecha = <span className="text-gypi-dim" aria-hidden="true"><Ic.chevR /></span>;

export default function MiCuentaScreen({ usuario, ctx, goto, logout, onPinCambiado, demo = false, empresa = null }) {
  // Sin fichaje (la empresa usa su propio control de acceso) no hay fichadas que mostrar
  const conFichaje = tieneModulo(empresa, "fichaje");
  const [confirmar, ConfirmDialog] = useConfirm();
  const diag = usuario.diagrama;
  const diaHoy = ahoraArg().diaKey;
  let totalH = 0;
  if (diag) DIAS_G.forEach(d => { if (diag[d]) { const [hI, mI] = diag[d].in.split(":").map(Number); const [hO, mO] = diag[d].out.split(":").map(Number); totalH += (hO * 60 + mO - hI * 60 - mI) / 60; } });
  const semana = ctx.fichadasSemana || [];

  const salir = async () => {
    if (await confirmar("Para volver a entrar vas a necesitar tu PIN o tu contraseña.", { title: "¿Cerrar la sesión?", confirmLabel: "Cerrar sesión" })) logout?.();
  };

  return (
    <div className="g-fade-in flex-1 overflow-y-auto px-4 pb-[120px]">
      <p className="m-0 mb-5 text-[15px] text-gypi-dim">{usuario.nombre || usuario.apodo}{usuario.legajo ? ` · Legajo ${usuario.legajo}` : ""}</p>

      {/* Horario */}
      {diag && (
        <section aria-label="Mi horario" className="mb-5">
          <h3 className="m-0 mb-2.5 text-base font-bold text-gypi-text font-heading">Mi horario</h3>
          <div className="bg-gypi-surface rounded-2xl p-3 border border-gypi-border">
            {DIAS_G.map(d => {
              const h = diag[d];
              const esHoy = d === diaHoy;
              return (
                <div key={d} className={`flex items-center py-2.5 px-2 rounded-[10px] mb-1 last:mb-0 border ${esHoy ? "bg-gypi-amber/[0.07] border-gypi-amber/20" : "border-transparent"}`}>
                  <div className={`w-[86px] text-[15px] font-heading ${esHoy ? "font-bold text-gypi-amber-ink" : "font-medium text-gypi-text"}`}>{DIAS_LABEL[d]}</div>
                  {h
                    ? <div className={`flex-1 font-mono text-[15px] font-semibold ${esHoy ? "text-gypi-text" : "text-gypi-dim"}`}>{h.in} → {h.out}</div>
                    : <div className="flex-1 text-[15px] text-gypi-green-ink font-semibold">Franco</div>}
                  {esHoy && <span className="text-xs text-gypi-amber-ink font-bold py-0.5 px-2 rounded-md bg-gypi-amber/10 ml-1.5">HOY</span>}
                </div>
              );
            })}
            <div className="mt-2.5 pt-2.5 flex justify-between text-[14px] border-t border-gypi-border">
              <span className="text-gypi-dim">{DIAS_G.filter(d => diag[d]).length} días de trabajo</span>
              <span className="text-gypi-text font-bold font-mono">{totalH.toFixed(1)} h por semana</span>
            </div>
          </div>
        </section>
      )}

      {/* Esta semana */}
      {conFichaje && <section aria-label="Fichadas de la semana" className="mb-5">
        <h3 className="m-0 mb-2.5 text-base font-bold text-gypi-text font-heading">Esta semana</h3>
        <div className="bg-gypi-surface rounded-2xl px-3.5 py-1 border border-gypi-border">
          {semana.length === 0
            ? <EmptyState icon="clock" title="Sin fichadas esta semana" description="Tus entradas y salidas van a aparecer acá." color="var(--color-cyan)" />
            : semana.map((d, i) => (
              <div key={i} className="flex justify-between items-center py-2.5 border-b border-gypi-border last:border-b-0">
                <div>
                  <div className="text-[15px] font-semibold text-gypi-text">
                    {new Date(d.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                  </div>
                  {d.ingreso && <div className="text-[14px] text-gypi-dim mt-0.5 font-mono">{d.ingreso.slice(0, 5)} → {d.egreso ? d.egreso.slice(0, 5) : "todavía adentro"}</div>}
                </div>
                <div className="flex items-center gap-1.5">
                  {d.horas_trabajadas && <span className="text-[14px] text-gypi-dim font-mono">{Number(d.horas_trabajadas).toFixed(1)} h</span>}
                  <span className={`font-mono text-sm font-bold ${d.ingreso ? "text-gypi-green-ink" : "text-gypi-mute"}`}>{d.ingreso ? "✓" : "—"}</span>
                </div>
              </div>
            ))}
        </div>
      </section>}

      <div className="flex flex-col gap-2 mb-5">
        {conFichaje && <ListItem icon="🕐" title="Historial de fichajes" detail="Meses anteriores, tardanzas y permisos" right={flecha} onClick={() => goto("historial-fichajes")} />}
        <ListItem icon="📄" title="Mi documentación" detail="DNI, licencia y otros papeles" right={flecha} onClick={() => goto("documentos")} />
      </div>

      {/* PIN para entrar rápido (F4-06) */}
      {usuario.rol === "operativo" && <PinCard tienePin={!!usuario.tiene_pin} onCambio={onPinCambiado} demo={demo} />}

      {!demo && <div className="mb-2"><BotonInstalar /></div>}

      {/* Salir, con confirmación (U-13) */}
      <Button size="lg" variant="outline" className="w-full mt-2" onClick={salir}>🚪 Cerrar sesión</Button>
      {ConfirmDialog}
    </div>
  );
}
