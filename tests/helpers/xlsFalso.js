// tests/helpers/xlsFalso.js — arma un Excel viejo (.xls, BIFF8 dentro de un
// archivo compuesto) chico, para probar app/lib/leerXls.js sin subir al repo
// planillas reales del banco.
//
//   xlsFalso({ hoja: "Hoja1", celdas: [[fila, col, valor]], textosSueltos: true, chico: false })
//   - Los textos van en la tabla de textos compartidos (SST) salvo con
//     textosSueltos (registro LABEL). Los números enteros chicos van como RK,
//     los demás como NUMBER.
//   - Sin `chico`, el libro se rellena hasta 4096 bytes (sectores comunes); con
//     `chico` queda en el mini stream.
const FIN = 0xfffffffe;
const LIBRE = 0xffffffff;

function registro(tipo, datos) {
  const out = new Uint8Array(4 + datos.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, tipo, true);
  dv.setUint16(2, datos.length, true);
  out.set(datos, 4);
  return out;
}
function bytes(...partes) {
  const n = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}
const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const f64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); return b; };
const latin = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
const utf16 = (s) => { const b = new Uint8Array(s.length * 2); const dv = new DataView(b.buffer); [...s].forEach((c, i) => dv.setUint16(i * 2, c.charCodeAt(0), true)); return b; };
const esLatin = (s) => [...s].every((c) => c.charCodeAt(0) < 256);
const textoXl = (s, largo16) => bytes(largo16 ? u16(s.length) : Uint8Array.of(s.length), Uint8Array.of(esLatin(s) ? 0 : 1), esLatin(s) ? latin(s) : utf16(s));

function libro({ hoja, celdas, textosSueltos, chico }) {
  const textos = [...new Set(celdas.filter((c) => typeof c[2] === "string").map((c) => c[2]))];
  const bof = (tipo) => registro(0x0809, bytes(u16(0x0600), u16(tipo), new Uint8Array(12)));
  const sst = registro(0x00fc, bytes(u32(textos.length), u32(textos.length), ...textos.map((t) => textoXl(t, true))));
  const cuerpo = celdas.map(([f, c, v]) => {
    const base = bytes(u16(f), u16(c), u16(0));
    if (typeof v === "string") return textosSueltos ? registro(0x0204, bytes(base, textoXl(v, true))) : registro(0x00fd, bytes(base, u32(textos.indexOf(v))));
    if (Number.isInteger(v) && Math.abs(v) < 2 ** 29) return registro(0x027e, bytes(base, u32(((v << 2) | 2) >>> 0)));
    return registro(0x0203, bytes(base, f64(v)));
  });
  const hojaBytes = bytes(bof(0x0010), ...cuerpo, registro(0x000a, new Uint8Array()));
  const nombre = textoXl(hoja, false);
  const largoSheet = 4 + 6 + nombre.length;
  const armar = (relleno) => {
    const antes = bytes(bof(0x0005), relleno, sst);
    const pos = antes.length + largoSheet + 4; // + EOF de los globales
    return bytes(antes, registro(0x0085, bytes(u32(pos), u16(0), nombre)), registro(0x000a, new Uint8Array()), hojaBytes);
  };
  let w = armar(new Uint8Array());
  if (!chico && w.length < 4096) {
    // Relleno con un registro que el lector ignora (0x00e1 INTERFACEHDR)
    const falta = 4096 - w.length + 8;
    w = armar(registro(0x00e1, new Uint8Array(falta)));
  }
  return w;
}

export function xlsFalso({ hoja = "Hoja1", celdas = [], textosSueltos = false, chico = false } = {}) {
  const w = libro({ hoja, celdas, textosSueltos, chico });
  const T = 512;
  const sectoresDe = (n, tam = T) => Math.ceil(n / tam);
  const pad = (b, tam = T) => { const out = new Uint8Array(sectoresDe(b.length, tam) * tam || tam); out.set(b); return out; };
  const fat = new Array(T / 4).fill(LIBRE);
  fat[0] = 0xfffffffd; // el sector de la FAT
  fat[1] = FIN; // el directorio
  const cadena = (inicio, n, tabla) => { for (let i = 0; i < n; i++) tabla[inicio + i] = i === n - 1 ? FIN : inicio + i + 1; };
  const entrada = (nombre, tipo, inicio, tam) => {
    const e = new Uint8Array(128);
    const dv = new DataView(e.buffer);
    e.set(utf16(nombre), 0);
    dv.setUint16(64, (nombre.length + 1) * 2, true);
    e[66] = tipo;
    dv.setUint32(68, LIBRE, true); dv.setUint32(72, LIBRE, true); dv.setUint32(76, LIBRE, true);
    dv.setUint32(116, inicio, true);
    dv.setUint32(120, tam, true);
    return e;
  };
  let sectores;
  let raiz;
  let minifatInicio = FIN;
  if (!chico) {
    const n = sectoresDe(w.length);
    cadena(2, n, fat);
    raiz = entrada("Root Entry", 5, FIN, 0);
    sectores = [pad(bytes(raiz, entrada("Workbook", 2, 2, w.length))), pad(w)];
  } else {
    // Mini stream: sectores de 64 bytes dentro del de la raíz
    const nMini = sectoresDe(w.length, 64);
    const minifat = new Array(T / 4).fill(LIBRE);
    cadena(0, nMini, minifat);
    const contenedor = pad(w, 64);
    fat[2] = FIN; // la minifat
    cadena(3, sectoresDe(contenedor.length), fat);
    minifatInicio = 2;
    raiz = entrada("Root Entry", 5, 3, contenedor.length);
    sectores = [pad(bytes(raiz, entrada("Workbook", 2, 0, w.length))), bytes(...minifat.map(u32)), pad(contenedor)];
  }
  const cab = new Uint8Array(512);
  const dv = new DataView(cab.buffer);
  cab.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  dv.setUint16(24, 0x3e, true); dv.setUint16(26, 3, true); dv.setUint16(28, 0xfffe, true);
  dv.setUint16(30, 9, true); dv.setUint16(32, 6, true);
  dv.setUint32(44, 1, true); dv.setUint32(48, 1, true); dv.setUint32(56, 4096, true);
  dv.setUint32(60, minifatInicio, true); dv.setUint32(64, chico ? 1 : 0, true);
  dv.setUint32(68, FIN, true); dv.setUint32(72, 0, true);
  for (let i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i === 0 ? 0 : LIBRE, true);
  return bytes(cab, bytes(...fat.map(u32)), ...sectores);
}
