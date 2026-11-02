'use client';
// app/hooks/useOts.js — Datos de las OT (cliente, proyecto y descripción) para
// las pantallas que guardan solo el número de la OT: pedidos, órdenes de
// compra, recepciones, movimientos de stock… Así cada OT se ve completa
// (Código · Cliente · Proyecto · Descripción, Tadeo 02/11). Se lee una vez
// por sesión de la pantalla y se comparte entre los componentes.
import { useEffect, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { mapaOts } from "../lib/nombreOt";

const VACIO = new Map();
const VIGENCIA_MS = 5 * 60 * 1000;
let enCurso = null;
let leidoEn = 0;

/** Para los tests: olvida lo leído. */
export function olvidarOts() { enCurso = null; }

function leer() {
  if (!enCurso || Date.now() - leidoEn > VIGENCIA_MS) {
    leidoEn = Date.now();
    enCurso = sbGetAll("proyectos?select=ot,cliente,obra,descripcion,estado&order=id.desc", { maxFilas: 20000 })
      .then(({ data }) => mapaOts(Array.isArray(data) ? data : []))
      .catch(() => { enCurso = null; return VACIO; });
  }
  return enCurso;
}

/** Mapa ot → { ot, cliente, obra, descripcion, estado } (vacío hasta que llega). */
export function useOts(activo = true) {
  const [mapa, setMapa] = useState(VACIO);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    leer().then((m) => { if (vivo) setMapa(m); });
    return () => { vivo = false; };
  }, [activo]);
  return mapa;
}
