// app/lib/finanzasPersonas.js — Finanzas, parte 4 del plan del 11/11: una
// sola agenda de clientes y proveedores (migración 180, fin_personas).
//
// La agenda junta tres listas sin repetir a nadie:
//   - las personas de la hoja PERSONAS del Plan de trabajo (se pegan una vez
//     y se pueden volver a pegar: lo que ya está no se duplica);
//   - los proveedores de Compras;
//   - los clientes de Finanzas.
// Alguien que es cliente y proveedor queda en un solo renglón con los dos.
//
// "Es el mismo" cuando el nombre tiene las mismas palabras en cualquier
// orden y sin S.A., S.R.L., S.A.S., puntos ni tildes: "GIRI EZEQUIEL" =
// "EZEQUIEL GIRI", "STOM" = "STOM SAS", "RITMA S.R.L" = "RITMA S.R.L.". Lo
// que se parece pero no es igual ("BUGLIOTTI" y "BUGLIOTTI JUAN") se muestra
// como posible repetido para que el dueño decida.

export const CAMPOS_PERSONA = ["cuit", "telefono", "email", "direccion", "contacto", "notas"];
export const NOMBRE_CAMPO = { cuit: "CUIT", telefono: "Teléfono", email: "Email", direccion: "Dirección", contacto: "Contacto", notas: "Notas" };
const LARGO = { nombre: 120, cuit: 20, telefono: 60, email: 160, direccion: 200, contacto: 200, notas: 500, id_planilla: 20 };
const SUFIJOS = new Set(["SA", "SRL", "SAS", "SAU", "SCS", "SH", "SACIF", "SAIC", "SACI", "LTDA", "LTDO", "COOP", "SC"]);

const txt = (v, n) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, n) : "";
};

/** Las palabras que cuentan de un nombre, sin tildes, puntos ni S.A./S.R.L. */
export function palabrasNombre(s) {
  const limpio = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/(\b[A-Z])\.(?=[A-Z]\b|[A-Z]\.)/g, "$1") // S.R.L. → SRL, A.G.A.F. → AGAF
    .replace(/\./g, "")
    .replace(/SOCIEDAD (DE RESPONSABILIDAD LIMITADA|ANONIMA|POR ACCIONES SIMPLIFICADA|DE HECHO|COLECTIVA)/g, " ")
    .replace(/[^A-Z0-9Ñ]+/g, " ");
  const ps = limpio.split(" ").filter(Boolean);
  // "INDUMAC  S. A." → letras sueltas al final que forman S.A., S.R.L.…
  for (let k = Math.min(4, ps.length - 1); k >= 2; k--) {
    const cola = ps.slice(-k);
    if (cola.every((x) => x.length === 1) && SUFIJOS.has(cola.join(""))) { ps.splice(-k, k); break; }
  }
  return ps.filter((p) => !SUFIJOS.has(p));
}

/** La clave para comparar: las palabras ordenadas ("EZEQUIEL GIRI" = "GIRI EZEQUIEL"). */
export function clavePersona(s) {
  return [...new Set(palabrasNombre(s))].sort().join(" ");
}

/** CUIT con solo números (11 dígitos) o vacío. */
export function cuitLimpio(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 11 ? d : "";
}

/** Una persona lista para guardar, con lo que falta como error. */
export function validarPersona(p = {}) {
  const errores = [];
  const nombre = txt(p.nombre, LARGO.nombre);
  if (!nombre) errores.push("Falta el nombre.");
  const out = { nombre };
  for (const c of CAMPOS_PERSONA) out[c] = txt(p[c], LARGO[c]) || null;
  if (out.cuit) {
    const d = cuitLimpio(out.cuit);
    if (!d) errores.push("El CUIT tiene que tener 11 números.");
    else out.cuit = `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) errores.push("El email no parece válido.");
  return { persona: errores.length ? null : out, errores };
}

/** Qué datos le faltan (para el aviso "Faltan datos"). */
export function datosFaltantes(p) {
  return ["cuit", "telefono", "email", "direccion"].filter((c) => !txt(p?.[c], 500));
}

/**
 * La agenda: personas, proveedores y clientes juntos, sin repetir.
 * @param {{ personas?: object[], proveedores?: object[], clientes?: object[], pares?: { cliente_id, proveedor_id }[] }} d
 * @returns {{ clave: string, nombre: string, persona_id: number|null, proveedor_id: number|null, cliente_id: number|null, cuit, telefono, email, direccion, contacto, notas, id_planilla, alias: string[] }[]}
 */
export function armarAgenda({ personas = [], proveedores = [], clientes = [], pares = [] } = {}) {
  const lista = [];
  const porClave = new Map();
  const porProveedor = new Map();
  const porCliente = new Map();
  const registrar = (e, nombres) => {
    for (const n of nombres) {
      const k = clavePersona(n);
      if (k && !porClave.has(k)) porClave.set(k, e);
    }
  };
  const completar = (e, datos) => {
    for (const c of [...CAMPOS_PERSONA, "id_planilla"]) if (!e[c] && txt(datos?.[c], 500)) e[c] = txt(datos[c], LARGO[c] || 500);
  };
  for (const p of personas) {
    if (p.activo === false || p.unido_a) continue;
    const e = {
      clave: `a${p.id}`, nombre: p.nombre, persona_id: Number(p.id), proveedor_id: p.proveedor_id ? Number(p.proveedor_id) : null,
      cliente_id: p.cliente_id ? Number(p.cliente_id) : null, alias: Array.isArray(p.alias) ? p.alias : [],
    };
    completar(e, p);
    lista.push(e);
    registrar(e, [p.nombre, ...e.alias]);
    if (e.proveedor_id) porProveedor.set(e.proveedor_id, e);
    if (e.cliente_id) porCliente.set(e.cliente_id, e);
  }
  const parDe = new Map(pares.map((x) => [Number(x.cliente_id), Number(x.proveedor_id)]));
  for (const p of proveedores) {
    if (p.activo === false) continue;
    const id = Number(p.id);
    let e = porProveedor.get(id) || porClave.get(clavePersona(p.nombre));
    if (e && e.proveedor_id && e.proveedor_id !== id) e = null; // otro proveedor con nombre parecido
    if (!e) {
      e = { clave: `p${id}`, nombre: p.nombre, persona_id: null, proveedor_id: id, cliente_id: null, alias: [] };
      lista.push(e);
      registrar(e, [p.nombre]);
    }
    e.proveedor_id = id;
    porProveedor.set(id, e);
    completar(e, { cuit: p.cuit, telefono: p.whatsapp, email: p.email, contacto: p.contacto, notas: p.notas });
  }
  for (const c of clientes) {
    if (c.activo === false || c.unido_a) continue;
    const id = Number(c.id);
    const alias = Array.isArray(c.alias) ? c.alias : [];
    let e = porCliente.get(id) || porProveedor.get(parDe.get(id)) || porClave.get(clavePersona(c.nombre)) || alias.map((a) => porClave.get(clavePersona(a))).find(Boolean);
    if (e && e.cliente_id && e.cliente_id !== id) e = null;
    if (!e) {
      e = { clave: `c${id}`, nombre: c.nombre, persona_id: null, proveedor_id: null, cliente_id: id, alias: [] };
      lista.push(e);
    }
    registrar(e, [c.nombre, ...alias]);
    e.cliente_id = id;
    porCliente.set(id, e);
    completar(e, c);
  }
  return lista.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
}

/** "Proveedor y cliente", "Proveedor", "Cliente" o "Agenda". */
export function rolPersona(e) {
  if (e.proveedor_id && e.cliente_id) return "Proveedor y cliente";
  if (e.proveedor_id) return "Proveedor";
  if (e.cliente_id) return "Cliente";
  return "Agenda";
}

/**
 * Los que parecen la misma persona pero no tienen exactamente las mismas
 * palabras: todas las palabras de uno están en el otro ("BUGLIOTTI" y
 * "BUGLIOTTI JUAN"). Solo nombres con alguna palabra de 4 letras o más.
 */
export function posiblesRepetidos(agenda = [], max = 200) {
  const porPalabra = new Map();
  const palabras = agenda.map((e) => new Set(clavePersona(e.nombre).split(" ").filter(Boolean)));
  palabras.forEach((ps, i) => ps.forEach((p) => { if (p.length >= 4) porPalabra.set(p, [...(porPalabra.get(p) || []), i]); }));
  const vistos = new Set();
  const out = [];
  for (let i = 0; i < agenda.length && out.length < max; i++) {
    const a = palabras[i];
    if (!a.size || ![...a].some((p) => p.length >= 4)) continue;
    const larga = [...a].sort((x, y) => y.length - x.length)[0];
    const candidatos = (porPalabra.get(larga) || []).filter((j) => {
      if (j === i) return false;
      const b = palabras[j];
      return b.size > a.size && [...a].every((p) => b.has(p));
    });
    // Un nombre de pila suelto ("CESAR", "FLORENCIA") está en muchos: no es un repetido
    if (a.size === 1 && candidatos.length > 2) continue;
    for (const j of candidatos) {
      const k = `${Math.min(i, j)}|${Math.max(i, j)}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push({ a: agenda[i], b: agenda[j] });
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Un renglón pegado de la hoja PERSONAS (con o sin los títulos). */
const TITULOS = { ID: "id_planilla", NOMBRE: "nombre", TELEFONO: "telefono", EMAIL: "email", DIRECCION: "direccion", "CONTACTO 2": "contacto", "CONTACTO 3": "contacto", EMPRESA: "contacto", CUIT: "cuit" };
const tituloDe = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

/**
 * Lee lo pegado desde la hoja PERSONAS: columnas separadas por tabulador.
 * Con títulos usa ID, NOMBRE, TELEFONO, EMAIL, DIRECCION, CONTACTO 2/3 (y su
 * teléfono), EMPRESA, CUIT; sin títulos toma el orden de la hoja.
 * @returns {{ id_planilla, nombre, telefono, email, direccion, contacto, cuit }[]}
 */
export function leerPersonasPegadas(texto) {
  const filas = String(texto || "").split(/\r?\n/).map((l) => l.split("\t")).filter((f) => f.some((c) => c.trim()));
  if (!filas.length) return [];
  const cab = filas[0].map(tituloDe);
  const conTitulos = cab.includes("NOMBRE");
  const columnas = conTitulos ? cab : ["ID", "NOMBRE", "TELEFONO", "EMAIL", "DIRECCION", "CONTACTO 2", "TELEFONO", "CONTACTO 3", "TELEFONO", "EMPRESA", "DIRECCION"];
  const out = [];
  for (const f of conTitulos ? filas.slice(1) : filas) {
    const p = { id_planilla: "", nombre: "", telefono: "", email: "", direccion: "", contacto: "", cuit: "" };
    const contactos = [];
    const telefonos = [];
    const direcciones = [];
    let nTel = 0;
    columnas.forEach((t, i) => {
      const v = txt(f[i], 200);
      const primerTel = t === "TELEFONO" && nTel++ === 0;
      if (!v) return;
      // La primera columna TELEFONO es la de la persona; las otras, de sus contactos
      if (primerTel) p.telefono = v;
      else if (t === "TELEFONO") telefonos.push(v);
      else if (t === "DIRECCION") direcciones.push(v);
      else if (t === "CONTACTO 2" || t === "CONTACTO 3" || t === "EMPRESA") contactos.push(v);
      else if (TITULOS[t] && !p[TITULOS[t]]) p[TITULOS[t]] = v;
    });
    p.direccion = direcciones.join(" · ");
    p.contacto = [...contactos, ...telefonos].join(" · ");
    if (/@/.test(p.telefono) && !p.email) { p.email = p.telefono; p.telefono = ""; }
    if (!p.nombre) continue;
    out.push(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, txt(v, LARGO[k] || 200)])));
  }
  return out;
}

/**
 * Qué hacer con lo pegado: quién es nuevo, a quién se le completan datos y
 * qué repetidos de la hoja se juntan.
 * @param {object[]} filas leerPersonasPegadas(...)
 * @param {object[]} agenda armarAgenda(...)
 * @returns {{ nuevas: object[], completar: { entrada: object, datos: object }[], iguales: number, juntadas: number }}
 */
export function planImportarPersonas(filas = [], agenda = []) {
  const porClave = new Map();
  for (const e of agenda) for (const n of [e.nombre, ...(e.alias || [])]) {
    const k = clavePersona(n);
    if (k && !porClave.has(k)) porClave.set(k, e);
  }
  // Primero se juntan los repetidos de la misma hoja
  const juntas = new Map();
  let juntadas = 0;
  for (const f of filas) {
    const k = clavePersona(f.nombre);
    if (!k) continue;
    const ya = juntas.get(k);
    if (!ya) { juntas.set(k, { ...f, alias: [] }); continue; }
    juntadas++;
    if (ya.nombre !== f.nombre && !ya.alias.includes(f.nombre)) ya.alias.push(f.nombre);
    for (const c of ["id_planilla", ...CAMPOS_PERSONA]) if (!ya[c] && f[c]) ya[c] = f[c];
  }
  const nuevas = [];
  const completar = [];
  let iguales = 0;
  for (const [k, f] of juntas) {
    const e = porClave.get(k);
    if (!e) { nuevas.push(f); continue; }
    const datos = {};
    for (const c of ["id_planilla", ...CAMPOS_PERSONA]) if (f[c] && !e[c]) datos[c] = f[c];
    const alias = [f.nombre, ...f.alias].filter((n) => n !== e.nombre && !(e.alias || []).includes(n));
    if (alias.length) datos.alias = alias;
    if (Object.keys(datos).length || !e.persona_id) completar.push({ entrada: e, datos });
    else iguales++;
  }
  return { nuevas, completar, iguales, juntadas };
}

/**
 * Las opciones del desplegable "Proveedor o cliente": cada renglón de la
 * agenda una sola vez. value "p<id>" si es proveedor (la operación queda con
 * proveedor_id) y "n<nombre>" si no (queda con el nombre escrito).
 */
export function opcionesAgenda(agenda = []) {
  return agenda.map((e) => ({
    value: e.proveedor_id ? `p${e.proveedor_id}` : `n${e.nombre}`,
    label: `${e.nombre}${e.proveedor_id && e.cliente_id ? " (proveedor y cliente)" : e.proveedor_id ? " (proveedor)" : e.cliente_id ? " (cliente)" : ""}`,
    nombre: e.nombre,
    proveedor_id: e.proveedor_id,
  }));
}
