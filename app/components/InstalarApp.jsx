"use client";
// Ofrecer instalar Gypi en el celular (app/lib/instalarApp.js).
// · tarjeta: aparece al pie al entrar desde un celular; "Ahora no" la esconde 7 días.
// · fijo: botón en Más / Mi cuenta, para quien cerró la tarjeta.
// No sale en la computadora, si ya está instalada ni dentro de la app de Google Play.
import { useEffect, useState } from "react";
import { Button } from "./ui";
import { esAppAndroid } from "../lib/appAndroid";
import {
  sistemaCelular, abiertaComoApp, hayAvisoAndroid, escucharAviso,
  pedirInstalacion, posponer, estaPospuesto, queOfrecer,
} from "../lib/instalarApp";

function useOferta(fijo) {
  const [estado, setEstado] = useState(null);
  useEffect(() => {
    const calcular = () => setEstado({
      oferta: queOfrecer({
        sistema: sistemaCelular(navigator.userAgent, navigator.platform, navigator.maxTouchPoints || 0),
        instalada: abiertaComoApp(),
        appPlay: esAppAndroid(),
        hayAviso: hayAvisoAndroid(),
        fijo,
      }),
      pospuesto: estaPospuesto(),
    });
    calcular();
    return escucharAviso(calcular);
  }, [fijo]);
  return estado;
}

function PasosIphone() {
  return (
    <ol className="m-0 mt-2 pl-5 text-[14px] text-gypi-text flex flex-col gap-1">
      <li>Tocá el botón <b>Compartir</b> (el cuadrado con la flecha <span aria-hidden="true">⬆</span>) abajo o arriba de la pantalla.</li>
      <li>Elegí <b>Agregar a inicio</b> y después <b>Agregar</b>.</li>
    </ol>
  );
}

function PasosMenuAndroid() {
  return (
    <ol className="m-0 mt-2 pl-5 text-[14px] text-gypi-text flex flex-col gap-1">
      <li>Tocá el menú <b>⋮</b> del navegador (arriba a la derecha).</li>
      <li>Elegí <b>Instalar aplicación</b> o <b>Agregar a pantalla principal</b>.</li>
    </ol>
  );
}

export function TarjetaInstalar() {
  const e = useOferta(false);
  const [cerrada, setCerrada] = useState(false);
  if (!e?.oferta || e.pospuesto || cerrada) return null;
  const ahoraNo = () => { posponer(); setCerrada(true); };
  return (
    <aside aria-label="Instalar Gypi" className="mx-3 mb-2 p-3.5 rounded-2xl bg-gypi-surface border border-gypi-border shadow-sm shrink-0">
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="m-0 text-[15px] font-bold text-gypi-text font-heading">📲 Instalá Gypi en tu celular</p>
          <p className="m-0 mt-0.5 text-[13px] text-gypi-dim">Queda como una app más: se abre con un toque, sin buscar el link.</p>
          {e.oferta === "ios" && <PasosIphone />}
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        {e.oferta === "android" && <Button className="flex-1" onClick={() => pedirInstalacion()}>Instalar</Button>}
        <Button variant="outline" className={e.oferta === "android" ? "" : "flex-1"} onClick={ahoraNo}>Ahora no</Button>
      </div>
    </aside>
  );
}

export function BotonInstalar() {
  const e = useOferta(true);
  const [pasos, setPasos] = useState(false);
  if (!e?.oferta) return null;
  const tocar = () => { if (e.oferta === "android") pedirInstalacion(); else setPasos((v) => !v); };
  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" className="w-full" onClick={tocar} aria-expanded={e.oferta === "android" ? undefined : pasos}>📲 Instalar en el celular</Button>
      {pasos && e.oferta === "ios" && <PasosIphone />}
      {pasos && e.oferta === "android-menu" && <PasosMenuAndroid />}
    </div>
  );
}
