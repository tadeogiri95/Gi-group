"use client";
// KioscoScreen — Modo kiosco (D7, D11, ítem 19): tablet o celular fijo en la
// entrada de la planta. Cada operario escanea su tarjeta QR (o escribe su
// legajo), pone su PIN y ficha. El servidor decide si es entrada o salida.
// Después de cada fichaje vuelve solo al inicio: no queda ninguna sesión abierta.
import { useState, useEffect, useCallback } from "react";
import EscanerCodigo from "../EscanerCodigo";
import { legajoDesdeQR, ubicacionKiosco, ficharEnKiosco, desactivarKiosco } from "../../lib/kioscoCliente";

export const VOLVER_AL_INICIO_MS = 6000;

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "borrar", "0", "ok"];

function Teclado({ onTecla, okHabilitado, okTexto = "Seguir" }) {
  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-[340px] mx-auto">
      {TECLAS.map((t) => (
        <button
          key={t}
          onClick={() => onTecla(t)}
          disabled={t === "ok" && !okHabilitado}
          aria-label={t === "borrar" ? "Borrar" : t === "ok" ? okTexto : t}
          className={`h-[68px] rounded-2xl border text-2xl font-bold cursor-pointer disabled:opacity-40 ${
            t === "ok" ? "bg-gypi-amber text-white border-transparent text-base" : "bg-gypi-surface border-gypi-border text-gypi-text"
          }`}
        >
          {t === "borrar" ? "⌫" : t === "ok" ? okTexto : t}
        </button>
      ))}
    </div>
  );
}

export default function KioscoScreen({ empresa, slug }) {
  const [paso, setPaso] = useState("legajo"); // legajo → pin → enviando → resultado
  const [legajo, setLegajo] = useState("");
  const [pin, setPin] = useState("");
  const [resultado, setResultado] = useState(null);
  const [hora, setHora] = useState(() => new Date());
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  const reiniciar = useCallback(() => {
    setPaso("legajo");
    setLegajo("");
    setPin("");
    setResultado(null);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // Vuelve solo al inicio: tras el resultado o si alguien deja el PIN a medias
  useEffect(() => {
    if (paso === "legajo" && !legajo) return;
    if (paso === "enviando") return;
    const t = setTimeout(reiniciar, paso === "resultado" ? VOLVER_AL_INICIO_MS : 30000);
    return () => clearTimeout(t);
  }, [paso, legajo, pin, reiniciar]);

  const enviar = async (pinFinal, extra = {}) => {
    setPaso("enviando");
    const geo = await ubicacionKiosco();
    const r = await ficharEnKiosco({ legajo, pin: pinFinal, ...geo, ...extra });
    setResultado(r);
    setPaso("resultado");
  };

  const conLegajo = useCallback((l) => {
    setLegajo(l);
    setPaso("pin");
  }, []);

  const teclaLegajo = (t) => {
    if (t === "borrar") return setLegajo((v) => v.slice(0, -1));
    if (t === "ok") return legajo && setPaso("pin");
    setLegajo((v) => (v + t).slice(0, 9));
  };

  const teclaPin = (t) => {
    if (t === "borrar") return setPin((v) => v.slice(0, -1));
    if (t === "ok") return;
    const nuevo = (pin + t).slice(0, 4);
    setPin(nuevo);
    if (nuevo.length === 4) enviar(nuevo);
  };

  const salirDelKiosco = async () => {
    await desactivarKiosco();
    window.location.href = `/${slug}`;
  };

  const hhmm = hora.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <main className="min-h-dvh flex flex-col items-center px-4 py-6 bg-gypi-bg">
      <header className="text-center mb-5">
        <div className="text-sm text-gypi-dim uppercase tracking-wide">{empresa?.nombre_corto || empresa?.nombre}</div>
        <div className="text-5xl font-heading font-extrabold text-gypi-text tabular-nums">{hhmm}</div>
      </header>

      {paso === "legajo" && (
        <>
          <h1 className="text-2xl font-bold text-gypi-text mb-4 text-center">Fichá tu entrada o salida</h1>
          <EscanerCodigo
            camara="user"
            ayuda="Mostrá el QR de tu tarjeta a la cámara"
            onCodigo={(texto) => { const l = legajoDesdeQR(texto, slug); if (l) conLegajo(l); }}
          />
          <div className="text-sm text-gypi-dim mb-2">o escribí tu legajo</div>
          <div aria-label="Legajo" className="text-4xl font-bold tracking-widest text-gypi-text h-12 mb-3">{legajo || "—"}</div>
          <Teclado onTecla={teclaLegajo} okHabilitado={!!legajo} />
        </>
      )}

      {paso === "pin" && (
        <>
          <h1 className="text-2xl font-bold text-gypi-text mb-1 text-center">Legajo {legajo}</h1>
          <div className="text-base text-gypi-dim mb-4">Poné tu PIN</div>
          <div aria-label="PIN" className="flex gap-3 mb-5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`w-5 h-5 rounded-full border-2 border-gypi-text ${i < pin.length ? "bg-gypi-text" : ""}`} />
            ))}
          </div>
          <Teclado onTecla={teclaPin} okHabilitado={false} okTexto="—" />
          <button onClick={reiniciar} className="mt-5 min-h-[48px] px-6 rounded-xl border border-gypi-border bg-transparent text-gypi-dim font-bold cursor-pointer">No soy yo</button>
        </>
      )}

      {paso === "enviando" && <div role="status" className="text-xl text-gypi-dim mt-16">Fichando…</div>}

      {paso === "resultado" && resultado && (
        <div role="status" className="text-center mt-8 max-w-[420px]">
          {resultado.ok ? (
            <>
              <div className="text-6xl mb-3" aria-hidden="true">✅</div>
              <div className="text-3xl font-bold text-gypi-text">¡Hola, {resultado.apodo}!</div>
              <div className="text-xl text-gypi-text mt-2">
                {resultado.accion === "ingreso" ? "Entrada" : "Salida"} registrada a las {String(resultado.hora || "").slice(0, 5)}
              </div>
              {resultado.tardanza?.estado === "tarde" && <div className="text-base text-gypi-amber mt-2">Llegaste {resultado.tardanza.minutos} min tarde.</div>}
              {resultado.solicitar_hora_extra && <div className="text-base text-gypi-dim mt-2">Si hiciste hora extra, pedila desde tu celular.</div>}
            </>
          ) : (
            <>
              <div className="text-6xl mb-3" aria-hidden="true">{resultado.tipo === "cerrada" ? "👋" : "⚠️"}</div>
              {resultado.apodo && <div className="text-2xl font-bold text-gypi-text mb-1">{resultado.apodo}</div>}
              <div className="text-lg text-gypi-text">{resultado.error || "No se pudo fichar."}</div>
              {resultado.tipo === "tarea_activa" && (
                <button onClick={() => enviar(pin, { forzar_cierre_tarea: true })} className="mt-4 min-h-[56px] px-6 rounded-xl border-none bg-gypi-amber text-white font-bold cursor-pointer">
                  Finalizar tarea y fichar salida
                </button>
              )}
              {["bloqueado_tardanza", "bloqueado_3ra_tarde", "salida_anticipada"].includes(resultado.tipo) && (
                <div className="text-base text-gypi-dim mt-2">Pedí el permiso desde tu celular o avisale a tu supervisor.</div>
              )}
            </>
          )}
          <button onClick={reiniciar} className="mt-6 min-h-[56px] px-8 rounded-xl border border-gypi-border bg-gypi-surface text-gypi-text font-bold cursor-pointer">Listo</button>
        </div>
      )}

      <footer className="mt-auto pt-8">
        {confirmarSalida ? (
          <div className="flex items-center gap-2 text-xs text-gypi-dim">
            ¿Desactivar este kiosco?
            <button onClick={salirDelKiosco} className="px-3 py-2 rounded-lg border border-gypi-border bg-transparent text-gypi-red font-bold cursor-pointer">Sí, desactivar</button>
            <button onClick={() => setConfirmarSalida(false)} className="px-3 py-2 rounded-lg border border-gypi-border bg-transparent text-gypi-dim cursor-pointer">No</button>
          </div>
        ) : (
          <button onClick={() => setConfirmarSalida(true)} className="text-xs text-gypi-mute bg-transparent border-none cursor-pointer">Salir del modo kiosco</button>
        )}
      </footer>
    </main>
  );
}
