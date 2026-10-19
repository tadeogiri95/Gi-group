"use client";
// Inicio del operario (R8): solo lo de todos los días — cómo está, fichar, la
// tarea en curso y pedir permiso. Lo demás (horario, semana, fichadas,
// documentos, PIN y salir) está en "Mi cuenta". Sin estilos sueltos (R11).
import { useState } from "react";
import { fmtDate } from "../../lib/theme";
import { hoyArg, ahoraArg } from "../../lib/dates";
import { Ic } from "../Icons";
import SolCard from "../cards/SolCard";
import EmptyState from "../ui/EmptyState";
import ListItem from "../ui/ListItem";
import { Button } from "../ui";
import { useConfirm } from "../ui/ConfirmDialog";
import BotonFichar from "../BotonFichar";
import PinCard from "../PinCard";
import NuevaSolicitud from "../NuevaSolicitud";
import { notificacionAprobada } from "../../lib/textos";
import EstadoConexion from "../EstadoConexion";
import { useColaOffline } from "../../hooks/useColaOffline";
import { fichadaConPendientes } from "../../lib/colaOffline";
import { tieneModulo } from "../../lib/modulos";
import ElegirOtCarga from "../ElegirOtCarga";
import RetirarMaterial from "../RetirarMaterial";
import EscanearPiezas from "../EscanearPiezas";

const DIAS_G = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_LABEL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
const flecha = <span className="text-gypi-dim" aria-hidden="true"><Ic.chevR /></span>;

/* ─── Mi cuenta: lo que no se usa todos los días ─── */
function MiCuenta({ usuario, ctx, goto, onVolver, onSalir, onPinCambiado, demo }) {
  const diag = usuario.diagrama;
  const diaHoy = ahoraArg().diaKey;
  let totalH = 0;
  if (diag) DIAS_G.forEach(d => { if (diag[d]) { const [hI, mI] = diag[d].in.split(":").map(Number); const [hO, mO] = diag[d].out.split(":").map(Number); totalH += (hO * 60 + mO - hI * 60 - mI) / 60; } });
  const semana = ctx.fichadasSemana || [];

  return (
    <div className="g-fade-in flex-1 overflow-y-auto px-4 pb-[110px]">
      <button onClick={onVolver} className="min-h-11 -ml-1 px-1 bg-transparent border-none cursor-pointer text-[15px] font-semibold text-gypi-text font-body">← Inicio</button>
      <h2 className="m-0 mb-1 font-heading text-[24px] font-extrabold text-gypi-text">Mi cuenta</h2>
      <p className="m-0 mb-5 text-[14px] text-gypi-dim">{usuario.nombre || usuario.apodo}{usuario.legajo ? ` · Legajo ${usuario.legajo}` : ""}</p>

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
                  <div className={`w-[86px] text-[14px] font-heading ${esHoy ? "font-bold text-gypi-amber-ink" : "font-medium text-gypi-text"}`}>{DIAS_LABEL[d]}</div>
                  {h
                    ? <div className={`flex-1 font-mono text-[15px] font-semibold ${esHoy ? "text-gypi-text" : "text-gypi-dim"}`}>{h.in} → {h.out}</div>
                    : <div className="flex-1 text-[14px] text-gypi-green-ink font-semibold">Franco</div>}
                  {esHoy && <span className="text-xs text-gypi-amber-ink font-bold py-0.5 px-2 rounded-md bg-gypi-amber/10 ml-1.5">HOY</span>}
                </div>
              );
            })}
            <div className="mt-2.5 pt-2.5 flex justify-between text-[13px] border-t border-gypi-border">
              <span className="text-gypi-dim">{DIAS_G.filter(d => diag[d]).length} días de trabajo</span>
              <span className="text-gypi-text font-bold font-mono">{totalH.toFixed(1)} h por semana</span>
            </div>
          </div>
        </section>
      )}

      {/* Esta semana */}
      <section aria-label="Fichadas de la semana" className="mb-5">
        <h3 className="m-0 mb-2.5 text-base font-bold text-gypi-text font-heading">Esta semana</h3>
        <div className="bg-gypi-surface rounded-2xl px-3.5 py-1 border border-gypi-border">
          {semana.length === 0
            ? <EmptyState icon="clock" title="Sin fichadas esta semana" description="Tus entradas y salidas van a aparecer acá." color="var(--color-cyan)" />
            : semana.map((d, i) => (
              <div key={i} className="flex justify-between items-center py-2.5 border-b border-gypi-border last:border-b-0">
                <div>
                  <div className="text-[14px] font-semibold text-gypi-text">
                    {new Date(d.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                  </div>
                  {d.ingreso && <div className="text-[13px] text-gypi-dim mt-0.5 font-mono">{d.ingreso.slice(0, 5)} → {d.egreso ? d.egreso.slice(0, 5) : "todavía adentro"}</div>}
                </div>
                <div className="flex items-center gap-1.5">
                  {d.horas_trabajadas && <span className="text-[13px] text-gypi-dim font-mono">{Number(d.horas_trabajadas).toFixed(1)} h</span>}
                  <span className={`font-mono text-sm font-bold ${d.ingreso ? "text-gypi-green-ink" : "text-gypi-mute"}`}>{d.ingreso ? "✓" : "—"}</span>
                </div>
              </div>
            ))}
        </div>
      </section>

      <div className="flex flex-col gap-2 mb-5">
        <ListItem icon="🕐" title="Historial de fichajes" detail="Meses anteriores, tardanzas y permisos" right={flecha} onClick={() => goto("historial-fichajes")} />
        <ListItem icon="📄" title="Mi documentación" detail="DNI, licencia y otros papeles" right={flecha} onClick={() => goto("documentos")} />
      </div>

      {/* PIN para entrar rápido (F4-06) */}
      {usuario.rol === "operativo" && <PinCard tienePin={!!usuario.tiene_pin} onCambio={onPinCambiado} demo={demo} />}

      {/* Salir, con confirmación (U-13): antes era un ícono suelto arriba del inicio */}
      <Button variant="outline" className="w-full mt-2" onClick={onSalir}>🚪 Cerrar sesión</Button>
    </div>
  );
}

export default function HomeEmp({ goto, usuario, ctx, logout, empresa, tareaActiva = null, etapas = [], reload, demo = false, onPinCambiado, onAbrirCarga }) {
  const misSols = ctx.misSolicitudes || [];
  // Lo que se muestra según los módulos de la empresa (ítem 36). El operario
  // ya no inicia tareas ni usa el asistente (2026-10): el avance sale de los
  // escaneos de piezas.
  const conTareas = tieneModulo(empresa, "actividad");
  const [formSolicitud, setFormSolicitud] = useState(false);
  const [elegirCarga, setElegirCarga] = useState(false);
  const [retirar, setRetirar] = useState(false);
  const [escanearPiezas, setEscanearPiezas] = useState(false);
  // Stock (ítem 40) va con las OT hasta que sea un módulo que se venda aparte
  const conStock = !demo && tieneModulo(empresa, "proyectos");
  const [vista, setVista] = useState("inicio"); // inicio | cuenta
  const [confirmar, ConfirmDialog] = useConfirm();
  // Lo fichado sin señal todavía no está en ctx: se suma para que el botón no ofrezca fichar de nuevo (ítem 21)
  const cola = useColaOffline(demo ? null : usuario.id, { alTerminar: reload });
  const fichadasSinEnviar = cola.pendientes.filter((op) => op.tipo === "fichar");
  const fichadaHoy = fichadaConPendientes(ctx.fichadaHoy, fichadasSinEnviar, hoyArg());
  const salidaSinEnviar = fichadasSinEnviar.some((op) => op.body?.accion === "egreso");
  const fichadaAbierta = salidaSinEnviar && !fichadaHoy?.ingreso ? null : ctx.fichadaAbierta;
  const dH = ahoraArg().diaKey;
  const diagH = usuario.diagrama?.[dH];

  const fichado = !!fichadaHoy?.ingreso;
  const adentro = fichado && !fichadaHoy?.egreso;

  const notisResolucion = (() => {
    const { fecha: hoy, hora: ahora } = ahoraArg();
    if (diagH) { const [hS, mS] = diagH.out.split(":").map(Number); const [hA, mA] = ahora.split(":").map(Number); if (hA * 60 + mA >= hS * 60 + mS) return []; }
    const todasResol = (ctx.notificaciones || []).filter(n => n.tipo === "aprobacion" && n.created_at?.startsWith(hoy));
    return todasResol.length > 0 ? [todasResol[0]] : [];
  })();

  const salir = async () => {
    if (await confirmar("Para volver a entrar vas a necesitar tu PIN o tu contraseña.", { title: "¿Cerrar la sesión?", confirmLabel: "Cerrar sesión" })) logout?.();
  };

  if (vista === "cuenta") {
    return (
      <>
        <MiCuenta usuario={usuario} ctx={ctx} goto={goto} onVolver={() => setVista("inicio")} onSalir={salir} onPinCambiado={onPinCambiado} demo={demo} />
        {ConfirmDialog}
      </>
    );
  }

  return (
    <div className="g-fade-in flex-1 overflow-y-auto px-4 pb-[110px]">
      {/* Saludo y estado */}
      <section aria-label="Tu día" className={`rounded-[22px] px-5 py-[22px] mb-[18px] border-[1.5px] bg-gypi-surface ${fichado ? "border-gypi-green/20" : "border-gypi-border"}`}>
        <div className="text-[13px] text-gypi-dim font-medium mb-1.5">{fmtDate(new Date())}</div>
        <h2 className="m-0 font-heading text-[26px] font-extrabold text-gypi-text tracking-tight leading-[1.1]">Hola, {usuario.apodo}</h2>
        {diagH && <div className="text-[14px] text-gypi-dim mt-1.5">Tu horario hoy: <span className="text-gypi-text font-bold">{diagH.in} a {diagH.out}</span></div>}
        {!diagH && usuario.diagrama && <div className="text-[14px] text-gypi-green-ink font-bold mt-1.5">Hoy es franco</div>}
        <div className={`mt-3.5 flex items-center gap-2 py-2 px-3 rounded-xl ${fichado ? "bg-gypi-green/10" : "bg-gypi-amber/10"}`}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${fichado ? "bg-gypi-green" : "bg-gypi-amber"}`} aria-hidden="true" />
          <span className={`text-[14px] font-bold ${fichado ? "text-gypi-green-ink" : "text-gypi-amber-ink"}`}>
            {fichado
              ? `Entrada ${fichadaHoy.ingreso.slice(0, 5)}${fichadaHoy?.egreso ? " · Salida " + fichadaHoy.egreso.slice(0, 5) : ""}`
              : "Todavía no fichaste"}
          </span>
        </div>
      </section>

      {/* Respuesta a un pedido de hoy */}
      {notisResolucion.length > 0 && (
        <div className="mb-[18px]" role="status">
          {notisResolucion.map(n => {
            const aprobada = notificacionAprobada(n.asunto);
            return (
              <div key={n.id} className={`rounded-[14px] px-4 py-3.5 mb-2 border-[1.5px] ${aprobada ? "bg-gypi-green/[0.06] border-gypi-green/20" : "bg-gypi-red/[0.06] border-gypi-red/20"}`}>
                <div className="text-[15px] font-bold text-gypi-text">{n.asunto}</div>
                <div className="text-[13px] text-gypi-dim mt-1 leading-[1.4]">{n.detalle}</div>
              </div>
            );
          })}
        </div>
      )}

      <EstadoConexion cola={cola} />

      {/* Botón grande de fichar (D6) */}
      <BotonFichar
        usuario={usuario}
        fichadaHoy={fichadaHoy}
        fichadaAbierta={fichadaAbierta}
        onFichado={reload}
        demo={demo}
      />

      {/* Pedidos */}
      <section aria-label="Mis pedidos" className="mb-[18px]">
        <Button size="planta" variant="secondary" className="w-full" onClick={() => setFormSolicitud(true)}>📝 Pedir permiso o vacaciones</Button>
        {formSolicitud && (
          <NuevaSolicitud
            usuario={usuario}
            empresa={empresa}
            demo={demo}
            onCerrar={() => setFormSolicitud(false)}
            onEnviada={() => { setFormSolicitud(false); reload?.(); }}
          />
        )}
        {misSols.length > 0 && (
          <div className="flex flex-col gap-2.5 mt-3">
            <h3 className="m-0 text-[14px] font-bold text-gypi-dim">Tus últimos pedidos</h3>
            {misSols.slice(0, 3).map(s => <SolCard key={s.id} s={s} />)}
            {misSols.length > 3 && (
              <button onClick={() => goto("mis-sols")} className="min-h-11 bg-transparent border-none text-[14px] font-semibold text-gypi-amber-ink cursor-pointer font-body">Ver todos mis pedidos ({misSols.length})</button>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-2">
        {/* Acopio y carga: el responsable elige la OT sin depender del QR de un rótulo */}
        {conTareas && onAbrirCarga && <ListItem icon="🚚" title="Carga de una OT" detail="Armar bultos, imprimir rótulos y cargar el camión" right={flecha} onClick={() => setElegirCarga(true)} />}
        {conTareas && !demo && <ListItem icon="🧩" title="Escanear piezas" detail="Marcá por qué etapa pasó cada pieza de la OT" right={flecha} onClick={() => setEscanearPiezas(true)} />}
        {conStock && <ListItem icon="📦" title="Retirar material" detail="Escaneá el QR del artículo y anotá cuánto sacás" right={flecha} onClick={() => setRetirar(true)} />}
        <ListItem icon="👤" title="Mi cuenta" detail="Horario, fichadas, documentos, PIN y salir" right={flecha} onClick={() => setVista("cuenta")} />
      </div>
      {escanearPiezas && <EscanearPiezas usuario={usuario} etapas={etapas} tareaActiva={tareaActiva} onClose={() => setEscanearPiezas(false)} />}
      {retirar && <RetirarMaterial empresaId={usuario.empresa_id || empresa?.id} usuario={usuario} onClose={() => setRetirar(false)} />}
      {elegirCarga && (
        <ElegirOtCarga empresaId={usuario.empresa_id || empresa?.id} onClose={() => setElegirCarga(false)}
          onElegir={(ot) => { setElegirCarga(false); onAbrirCarga(ot); }} />
      )}
    </div>
  );
}
