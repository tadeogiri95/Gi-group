// app/lib/pdfDeHtml.js — PDF a color, descargado directo, de una hoja HTML
// (antes solo en el informe de minutas; desde el 11/11 también el reporte
// financiero). "Guardar como PDF" desde imprimir puede salir en blanco y
// negro (según la impresora o si "Gráficos de fondo" está apagado): acá se
// dibuja la hoja como imagen y se arma el PDF en el navegador.

const ANCHO_PX = 718; // 190 mm de ancho útil (A4 con 10 mm de margen)
const MM = { ancho: 210, alto: 297, margen: 10 };
const ALTO_PAGINA_PX = Math.floor(ANCHO_PX * (MM.alto - 2 * MM.margen) / (MM.ancho - 2 * MM.margen));

/**
 * Dónde cortar las páginas: entre secciones, sin partir una que entre entera.
 * @param {{ top: number, bottom: number }[]} bloques  posición de cada sección (px)
 * @param {number} alto  alto total
 * @param {number} pagina  alto de una página
 * @returns {number[]} el comienzo de cada página
 */
export function cortesDePagina(bloques, alto, pagina = ALTO_PAGINA_PX) {
  const cortes = [0];
  let inicio = 0;
  for (const b of bloques) {
    if (b.bottom - inicio <= pagina) continue;
    // No entra: la página nueva empieza donde arranca la sección (si eso avanza)
    let corte = b.top > inicio ? b.top : inicio + pagina;
    while (b.bottom - corte > pagina) { cortes.push(corte); inicio = corte; corte += pagina; }
    cortes.push(corte);
    inicio = corte;
  }
  while (alto - inicio > pagina) { inicio += pagina; cortes.push(inicio); }
  return [...new Set(cortes)].filter((c) => c < alto);
}

/**
 * Una hoja por bloque (26/11): la primera arranca arriba de todo (con la
 * cabecera) y cada bloque siguiente empieza una hoja nueva.
 * @param {number[]} tops  dónde empieza cada bloque (px)
 * @param {number} alto  alto total
 * @returns {number[]} el comienzo de cada hoja
 */
export function cortesPorBloque(tops, alto) {
  const cortes = [0, ...tops.slice(1).filter((t) => t > 0 && t < alto)];
  return [...new Set(cortes)].sort((a, b) => a - b);
}

/**
 * Arma el PDF a color de una hoja HTML (A4, cortes entre secciones) y lo descarga.
 * @param {string} html  la hoja completa
 * @param {{ archivo: string, bloques?: string, apaisado?: boolean, comoArchivo?: boolean }} opciones  nombre del .pdf, qué no partir entre
 *   páginas y si va con la hoja acostada (el extracto de cajas y bancos, 13/11: tablas anchas). Con
 *   comoArchivo no se descarga: devuelve el File (para compartirlo desde el celular; remito, 24/11)
 *   paginaPorBloque (26/11, Estado de Resultados): selector de los bloques que van cada uno entero en su
 *   propia hoja; si uno no entra en una A4, esa hoja se alarga en vez de cortarlo. Con esto, si el
 *   contenido es más ancho que la hoja, se achica todo para que entre de costado.
 * @returns {Promise<File|undefined>}
 */
export async function descargarPdfDeHtml(html, { archivo, bloques: selector = "section, .cabecera", apaisado = false, comoArchivo = false, paginaPorBloque = "" }) {
  const hoja = apaisado ? { ancho: MM.alto, alto: MM.ancho, margen: MM.margen } : MM;
  let anchoPx = apaisado ? Math.round(ANCHO_PX * (hoja.ancho - 2 * hoja.margen) / (MM.ancho - 2 * MM.margen)) : ANCHO_PX;
  let altoPaginaPx = Math.floor(anchoPx * (hoja.alto - 2 * hoja.margen) / (hoja.ancho - 2 * hoja.margen));
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
  const marco = document.createElement("iframe");
  marco.setAttribute("aria-hidden", "true");
  marco.style.cssText = `position:fixed;left:-10000px;top:0;width:${anchoPx}px;height:2000px;border:0;visibility:hidden`;
  document.body.appendChild(marco);
  try {
    const doc = marco.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((ok) => (doc.readyState === "complete" ? ok() : marco.addEventListener("load", ok, { once: true })));
    if (doc.fonts?.ready) await doc.fonts.ready;
    const cuerpo = doc.body;
    cuerpo.style.width = `${anchoPx}px`;
    if (paginaPorBloque) {
      // Una tabla con muchos meses puede ser más ancha que la hoja: se dibuja más ancha y se achica
      const ancho = Math.ceil(Math.max(cuerpo.scrollWidth, doc.documentElement.scrollWidth));
      if (ancho > anchoPx) {
        altoPaginaPx = Math.floor(altoPaginaPx * ancho / anchoPx);
        anchoPx = ancho;
        marco.style.width = `${anchoPx}px`;
        cuerpo.style.width = `${anchoPx}px`;
      }
    }
    const alto = Math.ceil(cuerpo.scrollHeight);
    marco.style.height = `${alto}px`;
    // Posición contra la hoja (no contra el padre: un renglón de tabla mide desde su tabla)
    const base = cuerpo.getBoundingClientRect().top;
    const bloques = [...cuerpo.querySelectorAll(selector)].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top - base), bottom: Math.round(r.bottom - base) };
    });
    const escala = 2;
    const lienzo = await html2canvas(cuerpo, { scale: escala, backgroundColor: "white", width: anchoPx, windowWidth: anchoPx, height: alto, useCORS: true, logging: false });
    const mmPorPx = (hoja.ancho - 2 * hoja.margen) / anchoPx;
    const porBloque = paginaPorBloque ? cortesPorBloque([...cuerpo.querySelectorAll(paginaPorBloque)].map((el) => Math.round(el.getBoundingClientRect().top - base)), alto) : null;
    const cortes = porBloque || cortesDePagina(bloques, alto, altoPaginaPx);
    // Alto de cada hoja en mm: A4, o más si el bloque no entra (solo con paginaPorBloque)
    const altoHoja = (desde, hasta) => (porBloque ? Math.max(hoja.alto, (hasta - desde) * mmPorPx + 2 * hoja.margen) : hoja.alto);
    // jsPDF da vuelta una hoja a medida si la orientación no coincide con sus medidas
    const orientacion = (alto_) => (porBloque ? (hoja.ancho > alto_ ? "landscape" : "portrait") : apaisado ? "landscape" : "portrait");
    const primera = porBloque ? altoHoja(0, cortes[1] ?? alto) : hoja.alto;
    const pdf = new jsPDF({ unit: "mm", format: porBloque ? [hoja.ancho, primera] : "a4", orientation: orientacion(primera), compress: true });
    cortes.forEach((desde, i) => {
      const hasta = porBloque ? (cortes[i + 1] ?? alto) : Math.min(cortes[i + 1] ?? alto, desde + altoPaginaPx);
      const altoMm = altoHoja(desde, hasta);
      const trozo = document.createElement("canvas");
      trozo.width = lienzo.width;
      trozo.height = Math.max(1, Math.round((hasta - desde) * escala));
      const ctx = trozo.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, trozo.width, trozo.height);
      ctx.drawImage(lienzo, 0, Math.round(desde * escala), lienzo.width, trozo.height, 0, 0, trozo.width, trozo.height);
      if (i > 0) {
        if (porBloque) pdf.addPage([hoja.ancho, altoMm], orientacion(altoMm));
        else pdf.addPage();
      }
      pdf.addImage(trozo.toDataURL("image/jpeg", 0.92), "JPEG", hoja.margen, hoja.margen, hoja.ancho - 2 * hoja.margen, (hasta - desde) * mmPorPx);
      pdf.setFontSize(7);
      pdf.setTextColor(120);
      pdf.text(`Página ${i + 1} de ${cortes.length}`, hoja.ancho - hoja.margen, altoMm - 4, { align: "right" });
    });
    if (comoArchivo) return new File([pdf.output("blob")], archivo, { type: "application/pdf" });
    pdf.save(archivo);
  } finally {
    marco.remove();
  }
}
