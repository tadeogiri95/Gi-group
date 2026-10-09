// Descargas de Reportes: planilla (CSV que abre Excel) e imagen del resumen.
// La imagen se dibuja en un canvas, por eso los colores van escritos acá.

/** Descarga filas como CSV con BOM, para que Excel respete los acentos. */
export function exportCSV(rows, filename) {
  const BOM = "\uFEFF";
  const csv = BOM + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

/** Imagen PNG del resumen (antes se llamaba "PDF", pero siempre bajó una imagen). */
export function exportImagen(title, headers, rows, meta = "") {
  const W = 842, H = 595;
  const canvas = document.createElement("canvas"); canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d"); ctx.scale(2, 2);
  ctx.fillStyle = "#0C0A09"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#1C1917"; ctx.fillRect(0, 0, W, 56);
  ctx.fillStyle = "#F5F0E8"; ctx.font = "bold 18px system-ui, sans-serif"; ctx.fillText(title, 24, 36);
  ctx.fillStyle = "#8B8680"; ctx.font = "12px system-ui, sans-serif"; ctx.fillText(meta, W - ctx.measureText(meta).width - 24, 36);
  const startY = 76, rowH = 22, colW = Math.min(Math.floor((W - 48) / headers.length), 140), startX = 24;
  ctx.fillStyle = "#292524"; ctx.fillRect(startX, startY, colW * headers.length, rowH + 4);
  ctx.fillStyle = "#D4A843"; ctx.font = "bold 10px system-ui, sans-serif";
  headers.forEach((h, i) => { ctx.fillText(String(h).slice(0, 18), startX + i * colW + 6, startY + 15); });
  const maxRows = Math.floor((H - startY - rowH - 40) / rowH);
  rows.slice(0, maxRows).forEach((row, ri) => {
    const y = startY + rowH + 4 + ri * rowH;
    if (ri % 2 === 0) { ctx.fillStyle = "#1C191710"; ctx.fillRect(startX, y, colW * headers.length, rowH); }
    ctx.strokeStyle = "#292524"; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(startX, y + rowH); ctx.lineTo(startX + colW * headers.length, y + rowH); ctx.stroke();
    ctx.font = "11px system-ui, sans-serif";
    row.forEach((cell, ci) => {
      const val = String(cell ?? "—");
      if (val.includes("✓") || val.includes("100%")) ctx.fillStyle = "#4ADE80";
      else if (val.includes("✗") || val.includes("Ausente")) ctx.fillStyle = "#F87171";
      else if (val.includes("⏰") || val.includes("Tardanza")) ctx.fillStyle = "#D4A843";
      else ctx.fillStyle = "#D6D0C4";
      ctx.fillText(val.slice(0, 20), startX + ci * colW + 6, y + 15);
    });
  });
  if (rows.length > maxRows) { ctx.fillStyle = "#8B8680"; ctx.font = "italic 10px system-ui, sans-serif"; ctx.fillText(`... y ${rows.length - maxRows} filas más (ver Excel para reporte completo)`, startX, H - 20); }
  ctx.fillStyle = "#44403C"; ctx.font = "9px system-ui, sans-serif"; ctx.fillText(`Gypi · Generado ${new Date().toLocaleString("es-AR")}`, startX, H - 8);
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = title.replace(/[^a-zA-Z0-9áéíóúñ ]/g, "").replace(/ /g, "_") + ".png"; a.click(); URL.revokeObjectURL(url);
  }, "image/png");
}
