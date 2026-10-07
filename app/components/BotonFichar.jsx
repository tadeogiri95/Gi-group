"use client";
// BotonFichar — Botón grande de fichar en el inicio del operario (D6, F4-04).
// Antes fichar dependía del chat (2 toques y hasta 15 s de GPS sin aviso).
// Ahora: un toque → confirmación → GPS de hasta 8 s con contador → resultado.
// Los casos especiales (permiso de ingreso, tarea activa, salida anticipada,
// hora extra) se resuelven acá mismo, con las mismas reglas que el chat.
import { useEffect, useRef, useState } from "react";
import { ficharServer, obtenerGeo } from "../lib/fichar";
import { pedirPermisoIngreso, pedirSalidaAnticipada, pedirHoraExtra } from "../lib/pedidosOperario";
import { fmtTime } from "../lib/theme";

const GPS_SEGUNDOS = 8;

/**
 * Qué toca hacer ahora según las fichadas del operario.
 * @returns {"ingreso"|"egreso"|"cerrada"}
 */
export function accionFichaje(fichadaHoy, fichadaAbierta) {
  if (fichadaHoy?.ingreso && !fichadaHoy?.egreso) return "egreso";
  if (!fichadaHoy?.ingreso && fichadaAbierta?.ingreso && !fichadaAbierta?.egreso) return "egreso"; // turno noche: ingresó ayer
  if (fichadaHoy?.egreso) return "cerrada";
  return "ingreso";
}

export default function BotonFichar({ usuario, fichadaHoy, fichadaAbierta, onFichado, irAlChat, demo = false }) {
  const accion = accionFichaje(fichadaHoy, fichadaAbierta);
  // fase: inicio | confirmar | ubicando | enviando | resultado
  const [fase, setFase] = useState("inicio");
  const [segundos, setSegundos] = useState(0);
  const [resultado, setResultado] = useState(null); // { tono, texto, acciones: [{ etiqueta, hacer }] }
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const terminar = (tono, texto, acciones = []) => { setResultado({ tono, texto, acciones }); setFase("resultado"); };

  const fichar = async ({ forzarCierreTarea = false } = {}) => {
    const tipo = accion === "egreso" ? "egreso" : "ingreso";
    if (demo) { terminar("ok", `Modo demo: en tu empresa, acá queda registrado tu ${tipo} con la hora y la ubicación.`); return; }
    setFase("ubicando"); setSegundos(0);
    timer.current = setInterval(() => setSegundos((s) => Math.min(s + 1, GPS_SEGUNDOS)), 1000);
    const geo = await obtenerGeo(usuario, { timeoutMs: GPS_SEGUNDOS * 1000 });
    clearInterval(timer.current);
    setFase("enviando");
    try {
      const res = await ficharServer(tipo, {
        geo_lat: geo.lat, geo_lng: geo.lng, geo_precision: geo.precision,
        ...(forzarCierreTarea ? { forzar_cierre_tarea: true } : {}),
        empleadoId: usuario.id, // sin señal se guarda en el celular (ítem 21)
      });
      const hora = res.hora || fmtTime(new Date());
      if (res.encolado) {
        terminar("aviso", `Sin señal: guardamos tu ${tipo === "ingreso" ? "entrada" : "salida"} de las ${hora}. Se envía sola cuando vuelva la conexión, con esa hora.`);
      } else if (tipo === "ingreso") {
        const trd = res.tardanza;
        if (trd?.estado === "tarde") terminar("aviso", `Ingreso fichado a las ${hora}, con ${trd.minutos} min de tarde (tardanza #${trd.llegadasTarde} del mes).`);
        else terminar("ok", `¡Listo! Ingreso fichado a las ${hora}. Buen día, ${usuario.apodo}.`);
      } else if (res.solicitar_hora_extra) {
        const dj = res.datos_jornada;
        terminar("ok", `Salida fichada a las ${hora}. Trabajaste ${Math.round(dj.excedente_min)} min más que tu jornada: ¿pedís que te aprueben la hora extra?`, [
          { etiqueta: "Pedir hora extra", hacer: async () => { await pedirHoraExtra(usuario); terminar("ok", "Listo: le pediste a gerencia que apruebe la hora extra."); } },
        ]);
      } else {
        terminar("ok", `¡Listo! Salida fichada a las ${hora}.${res.horas_extra > 0 ? ` Horas extra: ${res.horas_extra} h.` : ""} Hasta mañana, ${usuario.apodo}.`);
      }
      onFichado?.();
    } catch (e) {
      if (e.tipo === "bloqueado_tardanza" || e.tipo === "bloqueado_3ra_tarde") {
        terminar("error", e.message, [
          { etiqueta: "Pedir permiso de ingreso", hacer: async () => { await pedirPermisoIngreso(usuario); terminar("ok", "Listo: le pediste permiso a gerencia. Te avisamos cuando lo resuelvan."); onFichado?.(); } },
        ]);
      } else if (e.tipo === "salida_anticipada") {
        terminar("aviso", e.message, e.pendiente ? [] : [
          { etiqueta: "Pedir permiso para salir antes", hacer: async () => { await pedirSalidaAnticipada(usuario); terminar("ok", "Listo: le pediste permiso a gerencia. Cuando lo aprueben, volvé a tocar \"Fichar salida\"."); onFichado?.(); } },
        ]);
      } else if (e.tipo === "tarea_activa") {
        terminar("aviso", "Tenés una tarea en curso. ¿La finalizamos y fichamos tu salida?", [
          { etiqueta: "Finalizar tarea y fichar salida", hacer: () => fichar({ forzarCierreTarea: true }) },
        ]);
      } else {
        terminar("error", e.message || "No se pudo fichar. Probá de nuevo.");
      }
    }
  };

  const ejecutarAccion = async (hacer) => {
    setFase("enviando");
    try { await hacer(); } catch (e) { terminar("error", e?.message || "No se pudo enviar. Probá de nuevo."); }
  };

  if (accion === "cerrada" && fase === "inicio") {
    return (
      <div className="w-full rounded-[22px] p-5 mb-[18px] text-center border border-gypi-border bg-gypi-surface" role="status">
        <div className="text-[15px] font-extrabold text-gypi-text">Jornada cerrada</div>
        <div className="text-[13px] text-gypi-dim mt-1">
          Ingreso {fichadaHoy.ingreso.slice(0, 5)} · Salida {fichadaHoy.egreso.slice(0, 5)}
        </div>
      </div>
    );
  }

  const esIngreso = accion === "ingreso";
  const color = esIngreso ? "var(--color-green)" : "var(--color-empresa-primary)";
  const etiqueta = esIngreso ? "Fichar ingreso" : "Fichar salida";
  const tonoColor = { ok: "var(--color-green)", aviso: "var(--color-empresa-primary)", error: "var(--color-red)" };

  return (
    <div className="mb-[18px]">
      {fase === "inicio" && (
        <button
          onClick={() => setFase("confirmar")}
          className="w-full rounded-[22px] border-none cursor-pointer font-body text-white flex flex-col items-center justify-center gap-1"
          style={{ minHeight: 112, background: color, boxShadow: `0 8px 24px color-mix(in srgb, ${color} 30%, transparent)` }}
        >
          <span className="text-[24px] font-extrabold tracking-tight leading-none">{etiqueta}</span>
          <span className="text-[13px] font-semibold opacity-90">Son las {fmtTime(new Date())}</span>
        </button>
      )}

      {fase === "confirmar" && (
        <div className="rounded-[22px] p-5 border border-gypi-border bg-gypi-surface" role="dialog" aria-label={`Confirmar: ${etiqueta}`}>
          <div className="text-[16px] font-extrabold text-gypi-text text-center">¿{etiqueta} ahora ({fmtTime(new Date())})?</div>
          <div className="flex gap-2.5 mt-4">
            <button onClick={() => setFase("inicio")} className="flex-1 py-3.5 rounded-[14px] border border-gypi-border bg-transparent text-gypi-text font-bold text-[15px] cursor-pointer" style={{ minHeight: 52 }}>
              Cancelar
            </button>
            <button onClick={() => fichar()} className="flex-1 py-3.5 rounded-[14px] border-none text-white font-extrabold text-[15px] cursor-pointer" style={{ minHeight: 52, background: color }}>
              Confirmar
            </button>
          </div>
        </div>
      )}

      {(fase === "ubicando" || fase === "enviando") && (
        <div className="rounded-[22px] p-5 border border-gypi-border bg-gypi-surface text-center" role="status" aria-live="polite">
          <div className="text-[16px] font-extrabold text-gypi-text">
            {fase === "ubicando" ? "Buscando tu ubicación…" : "Registrando…"}
          </div>
          {fase === "ubicando" && (
            <>
              <div className="h-2 rounded-full bg-gypi-surf-hi mt-3 overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-1000" style={{ width: `${(segundos / GPS_SEGUNDOS) * 100}%`, background: color }} />
              </div>
              <div className="text-[12px] text-gypi-dim mt-2">{segundos} de {GPS_SEGUNDOS} segundos · mantené el celular a cielo abierto si podés</div>
            </>
          )}
        </div>
      )}

      {fase === "resultado" && resultado && (
        <div
          className="rounded-[22px] p-5 text-center"
          role="status"
          aria-live="polite"
          style={{ background: `color-mix(in srgb, ${tonoColor[resultado.tono]} 6%, var(--color-surface))`, border: `1.5px solid color-mix(in srgb, ${tonoColor[resultado.tono]} 25%, transparent)` }}
        >
          <div className="text-[15px] font-bold text-gypi-text leading-[1.4]">{resultado.texto}</div>
          <div className="flex flex-col gap-2 mt-4">
            {resultado.acciones.map((a) => (
              <button key={a.etiqueta} onClick={() => ejecutarAccion(a.hacer)} className="w-full py-3.5 rounded-[14px] border-none text-white font-extrabold text-[15px] cursor-pointer" style={{ minHeight: 52, background: tonoColor[resultado.tono] }}>
                {a.etiqueta}
              </button>
            ))}
            <button onClick={() => { setResultado(null); setFase("inicio"); }} className="w-full py-3 rounded-[14px] border border-gypi-border bg-transparent text-gypi-text font-bold text-[14px] cursor-pointer" style={{ minHeight: 48 }}>
              {resultado.acciones.length ? "Ahora no" : "Listo"}
            </button>
            {resultado.tono === "error" && irAlChat && (
              <button onClick={irAlChat} className="text-[13px] text-gypi-dim underline bg-transparent border-none cursor-pointer mt-1">
                Hablar con el asistente
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
