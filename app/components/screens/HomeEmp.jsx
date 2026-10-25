"use client";
// Inicio del operario (R8): solo lo de todos los días — cómo está, fichar y
// los botones grandes del trabajo (escanear piezas, retirar material, carga y,
// para el responsable de mantenimiento, 🔧 Mi mantenimiento con sus vehículos y
// máquinas; parte 34, migración 133).
// Pedir permiso está en la pestaña "Permisos" y horario, fichadas, documentos,
// PIN y salir en la pestaña "Mi cuenta" (revisión de la interfaz, 2026-10).
// Sin estilos sueltos (R11).
import { useEffect, useState } from "react";
import { fmtDate } from "../../lib/theme";
import { hoyArg, ahoraArg } from "../../lib/dates";
import BotonFichar from "../BotonFichar";
import { notificacionAprobada } from "../../lib/textos";
import EstadoConexion from "../EstadoConexion";
import { useColaOffline } from "../../hooks/useColaOffline";
import { fichadaConPendientes } from "../../lib/colaOffline";
import { tieneModulo } from "../../lib/modulos";
import ElegirOtCarga from "../ElegirOtCarga";
import RetirarMaterial from "../RetirarMaterial";
import EscanearPiezas from "../EscanearPiezas";
import ChecklistVehiculo from "../ChecklistVehiculo";
import MiMantenimiento, { useMiMantenimiento } from "../MiMantenimiento";
import AvisarFalla from "../AvisarFalla";
import { CAMPOS_VEHICULO, conResponsables, detalleMiMantenimiento, resumenMiMantenimiento } from "../../lib/mantenimiento";
import { sb } from "../../lib/supabase";

// Botón grande de una acción del trabajo: se toca fácil con guantes o apurado.
function BotonAccion({ icono, titulo, detalle, destacado = false, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full min-h-[80px] flex items-center gap-4 px-4 py-3 rounded-[18px] border-[1.5px] cursor-pointer font-body text-left ${destacado ? "bg-gypi-amber/10 border-gypi-amber/40" : "bg-gypi-surface border-gypi-border"}`}>
      <span aria-hidden="true" className="w-12 h-12 rounded-2xl flex items-center justify-center text-[26px] bg-gypi-surf-hi shrink-0">{icono}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[18px] font-bold text-gypi-text font-heading">{titulo}</span>
        <span className="block text-[14px] text-gypi-dim mt-0.5">{detalle}</span>
      </span>
    </button>
  );
}

export default function HomeEmp({ usuario, ctx, empresa, tareaActiva = null, etapas = [], reload, demo = false, onAbrirCarga }) {
  // Lo que se muestra según los módulos de la empresa (ítem 36). El operario
  // ya no inicia tareas ni usa el asistente (2026-10): el avance sale de los
  // escaneos de piezas.
  const conTareas = tieneModulo(empresa, "actividad");
  const conFichaje = tieneModulo(empresa, "fichaje");
  const [elegirCarga, setElegirCarga] = useState(false);
  const [retirar, setRetirar] = useState(false);
  const [escanearPiezas, setEscanearPiezas] = useState(false);
  const [misVehiculos, setMisVehiculos] = useState([]);
  const [checklist, setChecklist] = useState(false);
  const [sinCircular, setSinCircular] = useState([]);
  // Stock y Flota son módulos propios (131): apagados no aparecen sus botones
  const conStock = !demo && tieneModulo(empresa, "stock");
  const conFlota = !demo && tieneModulo(empresa, "flota");
  const conMaquinaria = !demo && tieneModulo(empresa, "maquinaria");
  // Parte 34 (133): lo que tiene a cargo como responsable de mantenimiento o suplente
  const mant = useMiMantenimiento(demo ? null : usuario?.id, { conFlota, conMaquinaria });
  const [verMant, setVerMant] = useState(false);
  const [avisarFalla, setAvisarFalla] = useState(false);
  const conMiMant = !mant.cargando && (usuario?.es_mantenimiento || mant.items.length > 0);
  const resumenMant = resumenMiMantenimiento(mant.items);
  // Los vehículos de los que es chofer (Mantenimiento, parte 29). Sin la
  // migración 126 o sin vehículos, no aparece el botón. Con la 133 el
  // checklist pasa al responsable de mantenimiento: al chofer le queda solo el
  // aviso de que su vehículo no puede circular.
  useEffect(() => {
    if (!conFlota || !usuario?.id) return;
    let vivo = true;
    sb.get(`vehiculos?responsable_id=eq.${usuario.id}&activo=eq.true&select=*&order=patente.asc`)
      .then(async (v) => {
        if (!vivo) return;
        setMisVehiculos((v || []).filter((x) => !conResponsables(x, CAMPOS_VEHICULO)));
        // Parte 31 (129): lo que deja su vehículo sin poder circular
        if (!v?.length) return;
        const arr = await sb.get(`vehiculo_arreglos?vehiculo_id=in.(${v.map((x) => x.id).join(",")})&estado=eq.pendiente&prioridad=eq.no_circula&select=id,vehiculo_id,descripcion&order=id.asc`).catch(() => []);
        if (vivo) setSinCircular((arr || []).map((a) => ({ ...a, patente: v.find((x) => x.id === a.vehiculo_id)?.patente })));
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [conFlota, usuario?.id]);
  // Lo fichado sin señal todavía no está en ctx: se suma para que el botón no ofrezca fichar de nuevo (ítem 21)
  const cola = useColaOffline(demo ? null : usuario.id, { alTerminar: reload });
  const fichadasSinEnviar = cola.pendientes.filter((op) => op.tipo === "fichar");
  const fichadaHoy = fichadaConPendientes(ctx.fichadaHoy, fichadasSinEnviar, hoyArg());
  const salidaSinEnviar = fichadasSinEnviar.some((op) => op.body?.accion === "egreso");
  const fichadaAbierta = salidaSinEnviar && !fichadaHoy?.ingreso ? null : ctx.fichadaAbierta;
  const dH = ahoraArg().diaKey;
  const diagH = usuario.diagrama?.[dH];

  const fichado = !!fichadaHoy?.ingreso;

  const notisResolucion = (() => {
    const { fecha: hoy, hora: ahora } = ahoraArg();
    if (diagH) { const [hS, mS] = diagH.out.split(":").map(Number); const [hA, mA] = ahora.split(":").map(Number); if (hA * 60 + mA >= hS * 60 + mS) return []; }
    const todasResol = (ctx.notificaciones || []).filter(n => n.tipo === "aprobacion" && n.created_at?.startsWith(hoy));
    return todasResol.length > 0 ? [todasResol[0]] : [];
  })();

  return (
    <div className="g-fade-in flex-1 overflow-y-auto px-4 pb-[120px]">
      {/* Saludo y estado */}
      <section aria-label="Tu día" className={`rounded-[22px] px-5 py-[22px] mb-[18px] border-[1.5px] bg-gypi-surface ${fichado ? "border-gypi-green/20" : "border-gypi-border"}`}>
        <div className="text-[14px] text-gypi-dim font-medium mb-1.5">{fmtDate(new Date())}</div>
        <h2 className="m-0 font-heading text-[26px] font-extrabold text-gypi-text tracking-tight leading-[1.1]">Hola, {usuario.apodo}</h2>
        {diagH && <div className="text-[15px] text-gypi-dim mt-1.5">Tu horario hoy: <span className="text-gypi-text font-bold">{diagH.in} a {diagH.out}</span></div>}
        {!diagH && usuario.diagrama && <div className="text-[15px] text-gypi-green-ink font-bold mt-1.5">Hoy es franco</div>}
        <div className={`mt-3.5 flex items-center gap-2 py-2 px-3 rounded-xl ${fichado ? "bg-gypi-green/10" : "bg-gypi-amber/10"}`}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${fichado ? "bg-gypi-green" : "bg-gypi-amber"}`} aria-hidden="true" />
          <span className={`text-[15px] font-bold ${fichado ? "text-gypi-green-ink" : "text-gypi-amber-ink"}`}>
            {fichado
              ? `Entrada ${fichadaHoy.ingreso.slice(0, 5)}${fichadaHoy?.egreso ? " · Salida " + fichadaHoy.egreso.slice(0, 5) : ""}`
              : "Todavía no fichaste"}
          </span>
        </div>
      </section>

      {/* Respuesta a un permiso pedido hoy */}
      {notisResolucion.length > 0 && (
        <div className="mb-[18px]" role="status">
          {notisResolucion.map(n => {
            const aprobada = notificacionAprobada(n.asunto);
            return (
              <div key={n.id} className={`rounded-[14px] px-4 py-3.5 mb-2 border-[1.5px] ${aprobada ? "bg-gypi-green/[0.06] border-gypi-green/20" : "bg-gypi-red/[0.06] border-gypi-red/20"}`}>
                <div className="text-[15px] font-bold text-gypi-text">{n.asunto}</div>
                <div className="text-[14px] text-gypi-dim mt-1 leading-[1.4]">{n.detalle}</div>
              </div>
            );
          })}
        </div>
      )}

      <EstadoConexion cola={cola} />

      {/* Botón grande de fichar (D6). Sin él si la empresa apagó el fichaje
          (usa su propio control de acceso), para que nadie dude si fichar acá */}
      {conFichaje && (
        <BotonFichar
          usuario={usuario}
          fichadaHoy={fichadaHoy}
          fichadaAbierta={fichadaAbierta}
          onFichado={reload}
          demo={demo}
        />
      )}

      {/* El trabajo del día: botones grandes, lo más usado primero */}
      <section aria-label="Trabajo" className="flex flex-col gap-2.5 mb-[18px]">
        {conTareas && !demo && <BotonAccion icono="🧩" titulo="Escanear piezas" detalle="Marcá por qué etapa pasó cada pieza" destacado onClick={() => setEscanearPiezas(true)} />}
        {conStock && <BotonAccion icono="📦" titulo="Retirar material" detalle="Escaneá el QR del artículo y anotá cuánto sacás" onClick={() => setRetirar(true)} />}
        {/* Acopio y carga: el responsable elige la OT sin depender del QR de un rótulo */}
        {conTareas && onAbrirCarga && <BotonAccion icono="🚚" titulo="Carga de una OT" detalle="Armar bultos, imprimir rótulos y cargar el camión" onClick={() => setElegirCarga(true)} />}
        {conMiMant && (
          <BotonAccion icono="🔧" titulo="Mi mantenimiento" detalle={detalleMiMantenimiento(mant.items)} destacado={resumenMant.vencidas > 0} onClick={() => setVerMant(true)} />
        )}
        {/* Parte 35 (134): cualquiera avisa que una máquina tiene un problema */}
        {conMaquinaria && <BotonAccion icono="⚠️" titulo="Avisar una falla" detalle="Una máquina anda mal o se paró: avisá con foto" onClick={() => setAvisarFalla(true)} />}
        {misVehiculos.length > 0 && (
          <BotonAccion icono="🚚" titulo="Checklist de mi vehículo" detalle={`Revisá ${misVehiculos.map((v) => v.patente).join(", ")}: fluidos, neumáticos, luces y papeles`} onClick={() => setChecklist(true)} />
        )}
        {sinCircular.length > 0 && (
          <div className="p-3 rounded-[14px] bg-gypi-red/10 text-[14px] font-semibold text-gypi-red">
            {sinCircular.map((a) => <div key={a.id}>🔴 {a.patente} no puede circular: {a.descripcion}</div>)}
          </div>
        )}
      </section>
      {escanearPiezas && <EscanearPiezas usuario={usuario} etapas={etapas} tareaActiva={tareaActiva} onClose={() => setEscanearPiezas(false)} />}
      {avisarFalla && <AvisarFalla onClose={() => { setAvisarFalla(false); mant.cargar(); }} />}
      {verMant && <MiMantenimiento items={mant.items} empresaNombre={empresa?.nombre || ""} onClose={() => setVerMant(false)} onCambio={mant.cargar} />}
      {checklist && <ChecklistVehiculo vehiculos={misVehiculos} empresaNombre={empresa?.nombre || ""} onClose={() => setChecklist(false)} />}
      {retirar && <RetirarMaterial empresaId={usuario.empresa_id || empresa?.id} usuario={usuario} onClose={() => setRetirar(false)} />}
      {elegirCarga && (
        <ElegirOtCarga empresaId={usuario.empresa_id || empresa?.id} onClose={() => setElegirCarga(false)}
          onElegir={(ot) => { setElegirCarga(false); onAbrirCarga(ot); }} />
      )}
    </div>
  );
}
