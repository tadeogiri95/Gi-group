// app/lib/recorte.js — Cuentas del recorte de la foto de un artículo (27/11,
// pedido de Tadeo): el rótulo imprime la foto en un cuadrado, así que se
// recorta en cuadrado. Todo en píxeles de la foto ya girada.
//
// La vista es { zoom, cx, cy }: zoom 1 = el cuadrado más grande que entra en
// la foto (la llena); menos de 1 = se ve la foto entera con blanco al costado.
// (cx, cy) es el centro del cuadrado.

export const ZOOM_MAX = 6;
/** Lado de la foto recortada que se guarda (px). Sobra para un rótulo de 105 mm. */
export const LADO_SALIDA = 1000;

/** Ancho y alto de la foto después de girarla (90 o 270 dan vuelta los lados). */
export function medidasGiradas(ancho, alto, giro = 0) {
  return giro % 180 === 0 ? { ancho, alto } : { ancho: alto, alto: ancho };
}

/** El zoom más chico: la foto entera adentro del cuadrado. */
export const zoomMinimo = (ancho, alto) => Math.min(ancho, alto) / Math.max(ancho, alto);

/** Lado del cuadrado, en píxeles de la foto, para un zoom. */
export const ladoRecorte = (ancho, alto, zoom) => Math.min(ancho, alto) / zoom;

const entre = (v, min, max) => Math.min(max, Math.max(min, v));

/** Deja la vista dentro de lo posible: zoom entre el mínimo y ZOOM_MAX, y el cuadrado sin salirse de la foto. */
export function ajustarVista(vista, ancho, alto) {
  const zoom = entre(Number(vista.zoom) || 1, zoomMinimo(ancho, alto), ZOOM_MAX);
  const lado = ladoRecorte(ancho, alto, zoom);
  // Si el cuadrado es más grande que la foto en un sentido, queda centrado en ese sentido
  const limite = (c, total) => (lado >= total ? total / 2 : entre(c, lado / 2, total - lado / 2));
  return { zoom, cx: limite(Number(vista.cx), ancho), cy: limite(Number(vista.cy), alto) };
}

/** La vista con la que arranca: el cuadrado del medio, llenando. */
export const vistaInicial = (ancho, alto) => ({ zoom: 1, cx: ancho / 2, cy: alto / 2 });

/** Mueve la vista: dx, dy en píxeles de la pantalla; ladoPantalla es el lado del cuadrado que se ve. */
export function moverVista(vista, dx, dy, ladoPantalla, ancho, alto) {
  const escala = ladoRecorte(ancho, alto, vista.zoom) / ladoPantalla;
  return ajustarVista({ ...vista, cx: vista.cx - dx * escala, cy: vista.cy - dy * escala }, ancho, alto);
}

/** Cambia el zoom dejando quieto el centro. */
export const zoomVista = (vista, zoom, ancho, alto) => ajustarVista({ ...vista, zoom }, ancho, alto);

/** El cuadrado a copiar de la foto girada: { x, y, lado }. Puede salirse de la foto (ahí va blanco). */
export function areaRecorte(vista, ancho, alto) {
  const lado = ladoRecorte(ancho, alto, vista.zoom);
  return { x: vista.cx - lado / 2, y: vista.cy - lado / 2, lado };
}

/** Un canvas con la foto girada (giro 0, 90, 180 o 270). */
export function fotoGirada(img, giro = 0) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const m = medidasGiradas(w, h, giro);
  const c = document.createElement("canvas");
  c.width = m.ancho;
  c.height = m.alto;
  const ctx = c.getContext("2d");
  ctx.translate(m.ancho / 2, m.alto / 2);
  ctx.rotate((giro * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return c;
}

/** Dibuja el cuadrado elegido en un canvas de lado × lado, con fondo blanco. */
export function dibujarRecorte(ctx, girada, vista, lado) {
  const a = areaRecorte(vista, girada.width, girada.height);
  const k = lado / a.lado;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, lado, lado);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(girada, -a.x * k, -a.y * k, girada.width * k, girada.height * k);
}

/** La foto recortada lista para subir: { base64 (sin prefijo), tipo }. */
export function exportarRecorte(girada, vista, lado = LADO_SALIDA) {
  const a = areaRecorte(vista, girada.width, girada.height);
  // Si la foto es chica no se agranda de más
  const salida = Math.round(Math.max(300, Math.min(lado, a.lado)));
  const c = document.createElement("canvas");
  c.width = salida;
  c.height = salida;
  dibujarRecorte(c.getContext("2d"), girada, vista, salida);
  return { base64: c.toDataURL("image/jpeg", 0.88).split(",")[1], tipo: "image/jpeg" };
}

/** Carga la foto (un archivo o el link de una ya guardada) como imagen que se puede recortar. */
export async function cargarImagen(fuente) {
  let archivo = fuente;
  if (typeof fuente === "string") {
    // Se baja como archivo: así el canvas la puede exportar (si no, el navegador la bloquea)
    const r = await fetch(fuente, { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) throw new Error("No se pudo abrir la foto guardada");
    archivo = await r.blob();
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("No se pudo leer la foto"));
      i.src = url;
    });
    if (typeof img.decode === "function") await img.decode().catch(() => {});
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
