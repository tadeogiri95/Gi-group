'use client';
// app/components/RecortarFoto.jsx — Ventana para recortar la foto de un
// artículo antes de guardarla (27/11, pedido de Tadeo): el marco es cuadrado
// como en el rótulo; se arrastra para centrar el artículo, se hace zoom con
// la barra (o pellizcando, o con la ruedita) y se gira si salió de costado.
// Sirve para una foto recién sacada (un archivo) o para una ya guardada (link).
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./ui/Modal";
import { Button } from "./ui";
import {
  ZOOM_MAX, ajustarVista, cargarImagen, dibujarRecorte, exportarRecorte, fotoGirada, moverVista, vistaInicial, zoomMinimo, zoomVista,
} from "../lib/recorte";

/**
 * @param {{ fuente: File|Blob|string, onListo: (img: { base64: string, tipo: string }) => (void|Promise<void>), onCancelar: () => void }} props
 */
export default function RecortarFoto({ fuente, onListo, onCancelar }) {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);
  const [giro, setGiro] = useState(0);
  const [girada, setGirada] = useState(null);
  const [vista, setVista] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const punteros = useRef(new Map());
  const pellizco = useRef(null);

  useEffect(() => {
    let vivo = true;
    setImg(null);
    setError(null);
    cargarImagen(fuente).then((i) => { if (vivo) setImg(i); }).catch((e) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, [fuente]);

  // Al girar se arranca de nuevo con el cuadrado del medio
  useEffect(() => {
    if (!img) return;
    const g = fotoGirada(img, giro);
    setGirada(g);
    setVista(vistaInicial(g.width, g.height));
  }, [img, giro]);

  const dibujar = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !girada || !vista) return;
    const lado = Math.max(1, Math.round(c.clientWidth * (window.devicePixelRatio || 1)));
    if (c.width !== lado) { c.width = lado; c.height = lado; }
    dibujarRecorte(c.getContext("2d"), girada, vista, lado);
  }, [girada, vista]);

  useEffect(() => { dibujar(); }, [dibujar]);
  useEffect(() => {
    window.addEventListener("resize", dibujar);
    return () => window.removeEventListener("resize", dibujar);
  }, [dibujar]);

  const cambiar = useCallback((f) => setVista((v) => (v && girada ? f(v, girada.width, girada.height) : v)), [girada]);

  // Ruedita del mouse: zoom (sin mover la página)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const h = (e) => {
      e.preventDefault();
      cambiar((v, w, hh) => zoomVista(v, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), w, hh));
    };
    c.addEventListener("wheel", h, { passive: false });
    return () => c.removeEventListener("wheel", h);
  }, [cambiar, girada]);

  const distancia = () => {
    const [a, b] = [...punteros.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const abajo = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 2) pellizco.current = { d: distancia(), zoom: vista?.zoom || 1 };
  };
  const mover = (e) => {
    const antes = punteros.current.get(e.pointerId);
    if (!antes) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size >= 2 && pellizco.current) {
      const p = pellizco.current;
      const d = distancia();
      if (p.d > 0) cambiar((v, w, h) => zoomVista(v, (p.zoom * d) / p.d, w, h));
      return;
    }
    const ladoPantalla = canvasRef.current?.clientWidth || 1;
    cambiar((v, w, h) => moverVista(v, e.clientX - antes.x, e.clientY - antes.y, ladoPantalla, w, h));
  };
  const arriba = (e) => {
    punteros.current.delete(e.pointerId);
    if (punteros.current.size < 2) pellizco.current = null;
  };

  const guardar = async () => {
    if (!girada || !vista) return;
    setGuardando(true);
    setError(null);
    try {
      await onListo(exportarRecorte(girada, ajustarVista(vista, girada.width, girada.height)));
    } catch (e) {
      setError(e.message || "No se pudo guardar la foto");
      setGuardando(false);
    }
  };

  const zMin = girada ? zoomMinimo(girada.width, girada.height) : 1;
  const listo = Boolean(girada && vista);
  return (
    <Modal open onClose={guardando ? undefined : onCancelar} closable={!guardando} title="Recortar la foto">
      <p className="m-0 mb-3 text-[13px] text-gypi-dim">
        Arrastrá la foto para centrar el artículo y acercala para que llene el cuadrado. Así sale en el rótulo.
      </p>
      <div className="relative w-full max-w-[min(420px,46dvh)] mx-auto aspect-square rounded-[10px] overflow-hidden border border-gypi-border bg-white">
        <canvas ref={canvasRef} aria-label="Foto a recortar: arrastrá para moverla"
          className="w-full h-full block touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={abajo} onPointerMove={mover} onPointerUp={arriba} onPointerCancel={arriba} />
        {!listo && !error && <div role="status" className="absolute inset-0 flex items-center justify-center text-[13px] text-gypi-dim">Abriendo la foto…</div>}
      </div>
      <div className="flex items-center gap-3 mt-3 max-w-[min(420px,46dvh)] mx-auto">
        <span aria-hidden="true" className="text-[13px] text-gypi-dim">−</span>
        <input type="range" aria-label="Acercar o alejar" className="flex-1 min-w-0 min-h-[44px] accent-gypi-amber"
          min={zMin} max={ZOOM_MAX} step="0.01" value={vista?.zoom ?? 1} disabled={!listo || guardando}
          onChange={(e) => cambiar((v, w, h) => zoomVista(v, Number(e.target.value), w, h))} />
        <span aria-hidden="true" className="text-[13px] text-gypi-dim">+</span>
        <Button variant="secondary" size="sm" disabled={!listo || guardando} onClick={() => setGiro((g) => (g + 90) % 360)}
          aria-label="Girar la foto">↻ Girar</Button>
      </div>
      {error && <div role="alert" className="mt-2 text-[13px] text-gypi-red">{error}</div>}
      <div className="flex gap-2 mt-4">
        <Button variant="secondary" className="flex-1" disabled={guardando} onClick={onCancelar}>Cancelar</Button>
        <Button className="flex-1" disabled={!listo} loading={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</Button>
      </div>
    </Modal>
  );
}
