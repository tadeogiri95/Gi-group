// app/lib/leerXls.js — Lee un Excel del formato viejo (.xls, BIFF8 de Excel
// 97-2003) sin librerías nuevas: lo exportan los bancos (por ejemplo los plazos
// fijos vigentes del Credicoop, parte 8 del plan del 11/11 de Finanzas).
//
// El .xls es un "archivo compuesto" (como un disco chico con carpetas): adentro
// está el libro ("Workbook") como una lista de registros. Se toman los valores
// guardados en cada celda (textos, números y el resultado de las fórmulas), no
// el formato: una fecha llega como su número de serie de Excel (fechaDeSerie).
// Devuelve la misma grilla que leerHojaXlsx: filas de textos.

const FIN = 0xfffffffe;
const LIBRE = 0xffffffff;

/** Los bytes de un stream del archivo compuesto, siguiendo su cadena de sectores. */
function cadena(inicio, tabla, leerSector, max) {
  const partes = [];
  const vistos = new Set();
  for (let s = inicio; s !== FIN && s !== LIBRE && s < tabla.length; s = tabla[s]) {
    if (vistos.has(s)) throw new Error("El archivo .xls está dañado");
    vistos.add(s);
    partes.push(leerSector(s));
    if (partes.length > max) throw new Error("El archivo .xls es demasiado grande");
  }
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}

/** El stream "Workbook" (o "Book") de un archivo compuesto. */
export function streamLibro(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const firma = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (b.length < 512 || firma.some((x, i) => b[i] !== x)) throw new Error("No es un Excel .xls");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (o) => dv.getUint32(o, true);
  const tam = 1 << dv.getUint16(30, true);
  const tamMini = 1 << dv.getUint16(32, true);
  const sectores = Math.floor((b.length - 512) / tam);
  const sector = (s) => {
    if (s >= sectores) throw new Error("El archivo .xls está cortado");
    return b.subarray(512 + s * tam, 512 + (s + 1) * tam);
  };
  // La tabla de sectores (FAT): sus sectores están en el encabezado y en la DIFAT
  const sectoresFat = [];
  for (let i = 0; i < 109; i++) { const s = u32(76 + i * 4); if (s !== LIBRE && s !== FIN) sectoresFat.push(s); }
  for (let d = u32(68), n = 0; d !== FIN && d !== LIBRE && n < 1000; n++) {
    const sd = new DataView(sector(d).buffer, sector(d).byteOffset, tam);
    for (let i = 0; i < tam / 4 - 1; i++) { const s = sd.getUint32(i * 4, true); if (s !== LIBRE && s !== FIN) sectoresFat.push(s); }
    d = sd.getUint32(tam - 4, true);
  }
  const fat = [];
  for (const s of sectoresFat) {
    const sd = new DataView(sector(s).buffer, sector(s).byteOffset, tam);
    for (let i = 0; i < tam / 4; i++) fat.push(sd.getUint32(i * 4, true));
  }
  const dir = cadena(u32(48), fat, sector, sectores);
  const entradas = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const dd = new DataView(dir.buffer, dir.byteOffset + o, 128);
    const largo = dd.getUint16(64, true);
    let nombre = "";
    for (let i = 0; i < Math.max(0, largo / 2 - 1); i++) nombre += String.fromCharCode(dd.getUint16(i * 2, true));
    entradas.push({ nombre, tipo: dir[o + 66], inicio: dd.getUint32(116, true), tam: dd.getUint32(120, true) });
  }
  const raiz = entradas.find((e) => e.tipo === 5);
  const libro = entradas.find((e) => e.tipo === 2 && /^(workbook|book)$/i.test(e.nombre));
  if (!libro) throw new Error("No encontré la hoja de cálculo dentro del .xls");
  if (libro.tam >= u32(56)) return cadena(libro.inicio, fat, sector, sectores).subarray(0, libro.tam);
  // Stream chico: va en el mini stream (sectores de 64 bytes dentro del de la raíz)
  const mini = cadena(raiz.inicio, fat, sector, sectores);
  const minifatBytes = cadena(u32(60), fat, sector, sectores);
  const mdv = new DataView(minifatBytes.buffer, minifatBytes.byteOffset, minifatBytes.byteLength);
  const minifat = Array.from({ length: minifatBytes.length / 4 }, (_, i) => mdv.getUint32(i * 4, true));
  const miniSector = (s) => mini.subarray(s * tamMini, (s + 1) * tamMini);
  return cadena(libro.inicio, minifat, miniSector, mini.length / tamMini + 1).subarray(0, libro.tam);
}

/** Número RK de Excel → número. */
function rk(v) {
  const entero = (v & 2) !== 0;
  const div = (v & 1) !== 0;
  let n;
  if (entero) n = v >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, v & 0xfffffffc, true);
    buf.setUint32(0, 0, true);
    n = buf.getFloat64(0, true);
  }
  return div ? n / 100 : n;
}

const numeroTexto = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10));

/**
 * Los registros del libro, con los CONTINUE pegados al registro anterior (y
 * dónde empieza cada parte, para los textos que cruzan de un registro a otro).
 */
function registros(w) {
  const dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
  const out = [];
  for (let o = 0; o + 4 <= w.length;) {
    const tipo = dv.getUint16(o, true);
    const largo = dv.getUint16(o + 2, true);
    const datos = w.subarray(o + 4, o + 4 + largo);
    if (tipo === 0x003c && out.length) {
      const prev = out[out.length - 1];
      const junto = new Uint8Array(prev.datos.length + datos.length);
      junto.set(prev.datos);
      junto.set(datos, prev.datos.length);
      prev.cortes.push(prev.datos.length);
      prev.datos = junto;
    } else out.push({ tipo, datos, pos: o, cortes: [] });
    o += 4 + largo;
  }
  return out;
}

/** Un texto Unicode de Excel desde `o`: { texto, fin }. Respeta los cortes de CONTINUE (cada uno trae su byte de opciones). */
function textoUnicode(d, o, largoBytes, cortes = []) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const cch = largoBytes === 1 ? d[o] : dv.getUint16(o, true);
  o += largoBytes;
  let flags = d[o++];
  let runs = 0;
  let ext = 0;
  if (flags & 0x08) { runs = dv.getUint16(o, true); o += 2; }
  if (flags & 0x04) { ext = dv.getUint32(o, true); o += 4; }
  let texto = "";
  for (let i = 0; i < cch; i++) {
    if (cortes.includes(o)) flags = d[o++];
    if (o >= d.length) break;
    if (flags & 0x01) { texto += String.fromCharCode(dv.getUint16(o, true)); o += 2; } else texto += String.fromCharCode(d[o++]);
  }
  return { texto, fin: o + runs * 4 + ext };
}

/** Los nombres de las hojas de un .xls. */
export function hojasXls(bytes) {
  return registros(streamLibro(bytes)).filter((r) => r.tipo === 0x0085).map((r) => textoUnicode(r.datos, 6, 1).texto);
}

/**
 * Una hoja del .xls como grilla de textos (la primera si no se dice cuál).
 * @returns {string[][] | null}
 */
export function leerHojaXls(bytes, nombreHoja = null, { maxFilas = 5000, maxCols = 120 } = {}) {
  const w = streamLibro(bytes);
  const regs = registros(w);
  const hojas = regs.filter((r) => r.tipo === 0x0085).map((r) => ({
    nombre: textoUnicode(r.datos, 6, 1).texto,
    pos: new DataView(r.datos.buffer, r.datos.byteOffset, 4).getUint32(0, true),
  }));
  const hoja = nombreHoja ? hojas.find((h) => h.nombre === nombreHoja) : hojas[0];
  if (!hoja) return null;
  // Los textos compartidos (SST)
  const sst = [];
  const regSst = regs.find((r) => r.tipo === 0x00fc);
  if (regSst) {
    const d = regSst.datos;
    const n = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(4, true);
    let o = 8;
    for (let i = 0; i < n && o < d.length; i++) {
      const t = textoUnicode(d, o, 2, regSst.cortes);
      sst.push(t.texto);
      o = t.fin;
    }
  }
  const grilla = [];
  const poner = (fila, col, v) => {
    if (fila >= maxFilas || col >= maxCols) return;
    while (grilla.length <= fila) grilla.push([]);
    const f = grilla[fila];
    while (f.length < col) f.push("");
    f[col] = v;
  };
  const desde = regs.findIndex((r) => r.pos === hoja.pos);
  let pendiente = null; // fórmula que devuelve texto: el texto viene en el registro STRING siguiente
  for (let i = desde + 1; i >= 1 && i < regs.length; i++) {
    const { tipo, datos: d, cortes } = regs[i];
    if (tipo === 0x000a) break;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const fila = d.length >= 4 ? dv.getUint16(0, true) : 0;
    const col = d.length >= 4 ? dv.getUint16(2, true) : 0;
    if (tipo === 0x00fd && d.length >= 10) poner(fila, col, sst[dv.getUint32(6, true)] ?? "");
    else if (tipo === 0x0203 && d.length >= 14) poner(fila, col, numeroTexto(dv.getFloat64(6, true)));
    else if (tipo === 0x027e && d.length >= 10) poner(fila, col, numeroTexto(rk(dv.getInt32(6, true))));
    else if (tipo === 0x00bd && d.length >= 6) {
      const ultima = dv.getUint16(d.length - 2, true);
      for (let c = col, o = 4; c <= ultima && o + 6 <= d.length - 2; c++, o += 6) poner(fila, c, numeroTexto(rk(dv.getInt32(o + 2, true))));
    } else if ((tipo === 0x0204 || tipo === 0x00d6) && d.length >= 8) poner(fila, col, textoUnicode(d, 6, 2, cortes).texto);
    else if (tipo === 0x0006 && d.length >= 14) {
      if (dv.getUint16(12, true) === 0xffff) {
        const t = d[6];
        if (t === 0) pendiente = { fila, col };
        else if (t === 1) poner(fila, col, d[8] ? "TRUE" : "FALSE");
        else poner(fila, col, "");
      } else poner(fila, col, numeroTexto(dv.getFloat64(6, true)));
    } else if (tipo === 0x0207 && pendiente) {
      poner(pendiente.fila, pendiente.col, textoUnicode(d, 0, 2, cortes).texto);
      pendiente = null;
    }
  }
  return grilla.map((f) => f.map((v) => String(v ?? "")));
}

/** Número de serie de Excel (45962) → "AAAA-MM-DD". */
export function fechaDeSerie(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1 || v > 2958465) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
}
