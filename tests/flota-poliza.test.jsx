// tests/flota-poliza.test.jsx — Flota con varias fotos y la póliza del seguro
// en PDF (Tadeo, 03/11; migración 156). Gypi lee el texto de la póliza sin IA
// (app/lib/polizaTexto.js), completa el alta del vehículo y del seguro en
// amarillo para revisar, y el PDF queda guardado para descargarlo.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { jsPDF } from "jspdf";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { fechaISO, leerPoliza } from "../app/lib/polizaTexto.js";
import { esRutaDeLaEmpresa, nombrePdf, rutaPoliza } from "../app/lib/flotaArchivos.js";
import { flotaBody } from "../app/lib/schemas.ts";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/flota/route.js");
const apiPoliza = await import("../app/api/flota/poliza/route.js");
const { default: FlotaScreen } = await import("../app/components/FlotaScreen.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const RUTA = `${E}/polizas/1762100000000-0123456789ab.pdf`;

const POLIZA_1 = [
  "SANCOR SEGUROS - Póliza N° 12345678",
  "Vigencia: desde 01/10/2026 hasta 01/04/2027",
  "Dominio: AF 123 BC Marca: TOYOTA Modelo: HILUX 2.8 SRX 4x4 Pick-Up",
  "Año: 2021 Motor: 1GD-1234567 Chasis: 8AJBA3CD1M1234567",
  "Cobertura: C - Terceros Completo",
].join("\n");

// Títulos solos en una línea y el valor abajo, como en las tablas
const POLIZA_2 = [
  "Póliza de Seguro de Automotores", "La Segunda Cooperativa", "Póliza Nro.: 40.123.456",
  "Vigencia desde las 12 hs del 15/03/2026 hasta las 12 hs del 15/03/2027", "Datos del vehículo",
  "Marca/Modelo", "FIAT FIORINO 1.4 FURGON", "Patente", "AB123CD", "Año", "2019", "N° de Motor", "310A20111234567",
  "N° de Chasis", "9BD25521AK8912345", "Color: Blanco", "Nafta", "Todo Riesgo con franquicia",
].join("\n");

// ─── Lectura del texto ───

test("leerPoliza — datos del vehículo y del seguro en los formatos de siempre", () => {
  const a = leerPoliza(POLIZA_1);
  assert.deepEqual(a.vehiculo, { patente: "AF123BC", marca: "TOYOTA", modelo: "HILUX 2.8 SRX 4x4 Pick-Up", anio: 2021, motor: "1GD-1234567", chasis: "8AJBA3CD1M1234567", tipo: "camioneta" });
  assert.deepEqual(a.seguro, { numero: "12345678", fecha: "2026-10-01", vencimiento: "2027-04-01", compania: "Sancor Seguros", cobertura: "Terceros completo" });
  assert.ok(a.encontrados.includes("patente") && a.encontrados.includes("seguro.vencimiento"));

  const b = leerPoliza(POLIZA_2);
  assert.deepEqual(b.vehiculo, { patente: "AB123CD", marca: "FIAT", modelo: "FIORINO 1.4 FURGON", anio: 2019, motor: "310A20111234567", chasis: "9BD25521AK8912345", color: "Blanco", tipo: "utilitario", combustible: "nafta" });
  assert.deepEqual(b.seguro, { numero: "40.123.456", fecha: "2026-03-15", vencimiento: "2027-03-15", compania: "La Segunda", cobertura: "Todo riesgo" });

  // "Modelo: 2020" es el año; patente vieja; vigencia con "al"; fechas sueltas
  const c = leerPoliza("Patente: ABC-123\nMarca: Ford\nModelo: 2020\nVigencia 10/05/26 al 10/11/26\nCertificado N°: 99-1234");
  assert.deepEqual([c.vehiculo.patente, c.vehiculo.marca, c.vehiculo.anio, c.vehiculo.modelo], ["ABC123", "Ford", 2020, undefined]);
  assert.deepEqual([c.seguro.fecha, c.seguro.vencimiento, c.seguro.numero], ["2026-05-10", "2026-11-10", "99-1234"]);

  // Un título que aparece en otra frase no se confunde con el dato
  const d = leerPoliza("Cuadro de coberturas\nAnotaciones del productor\nMotor: 1GD-7654321");
  assert.deepEqual(d.vehiculo, { motor: "1GD-7654321" });

  assert.deepEqual(leerPoliza(""), { vehiculo: {}, seguro: {}, encontrados: [] });
  assert.equal(fechaISO("31/02/2026"), null);
  assert.equal(fechaISO("5-3-2027"), "2027-03-05");
});

test("validación, archivos y migración 156", () => {
  const ok = (b) => flotaBody.safeParse(b).success;
  const foto = "https://x.test/a.jpg";
  assert.equal(ok({ accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto", fotos: Array(6).fill(foto) }), true);
  assert.equal(ok({ accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto", fotos: Array(7).fill(foto) }), false, "hasta 6 fotos");
  assert.equal(ok({ accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto", seguro: { compania: "Sancor", vencimiento: "2027-01-01", archivo_path: RUTA, archivo_nombre: "p.pdf" } }), true);
  assert.equal(ok({ accion: "papel_guardar", vehiculo_id: 1, tipo: "seguro", archivo_path: RUTA, archivo_nombre: "p.pdf" }), true);
  assert.equal(ok({ accion: "papel_archivo", id: 1 }), true);

  assert.equal(esRutaDeLaEmpresa(rutaPoliza(E), E), true);
  assert.equal(esRutaDeLaEmpresa(RUTA.replace(E, "99999999-1111-1111-1111-111111111111"), E), false, "de otra empresa no");
  assert.equal(esRutaDeLaEmpresa(`${E}/polizas/../otra.pdf`, E), false);
  assert.equal(nombrePdf("C:\\fakepath\\Póliza Hilux"), "Pliza Hilux.pdf");
  assert.equal(nombrePdf(""), "poliza.pdf");

  const sql = readFileSync(new URL("../supabase/migrations/156_flota_fotos_poliza.sql", import.meta.url), "utf8");
  assert.match(sql, /^do \$mig\$/m);
  assert.match(sql, /add column if not exists fotos jsonb/);
  assert.match(sql, /jsonb_array_length\(fotos\) <= 6/);
  assert.match(sql, /add column if not exists archivo_path text/);
  assert.match(sql, /'flota-documentos', 'flota-documentos', false/);
});

// ─── Rutas ───

async function token(rol = "administrativo") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function pdfDePrueba(lineas) {
  const d = new jsPDF();
  lineas.split("\n").forEach((l, i) => d.text(l, 10, 10 + i * 8));
  return new Uint8Array(d.output("arraybuffer"));
}

function mockStorage({ sinBucket = false, esMant = false } = {}) {
  const subidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("select=es_mantenimiento&limit=1"), respond: () => ({ status: 200, body: esMant ? [{ es_mantenimiento: true }] : [] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/storage/v1/object/flota-documentos/"),
      respond: (u, o) => {
        if (sinBucket) return { status: 404, body: { error: "Bucket not found" } };
        subidos.push({ url: u, tipo: o.headers["Content-Type"] });
        return { status: 200, body: { Key: "x" } };
      },
    },
  ]);
  return subidos;
}

const reqPoliza = async (t, archivo, nombre = "Póliza Hilux.pdf") => {
  const body = new FormData();
  body.append("file", new File([archivo], nombre, { type: "application/pdf" }));
  return new Request("http://localhost/api/flota/poliza", { method: "POST", headers: { Authorization: `Bearer ${t}` }, body });
};

test("/api/flota/poliza — guarda el PDF en el bucket privado y devuelve lo que leyó", async () => {
  let subidos = mockStorage();
  let res = await apiPoliza.POST(await reqPoliza(await token(), pdfDePrueba(POLIZA_1)));
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.sin_texto, false);
  assert.equal(r.datos.vehiculo.patente, "AF123BC");
  assert.equal(r.datos.seguro.vencimiento, "2027-04-01");
  assert.equal(r.archivo.nombre, "Pliza Hilux.pdf");
  assert.ok(esRutaDeLaEmpresa(r.archivo.path, E));
  assert.equal(subidos.length, 1);
  assert.match(subidos[0].url, new RegExp(`flota-documentos/${E}/polizas/`));
  assert.equal(subidos[0].tipo, "application/pdf");

  // PDF sin texto (escaneado): se guarda igual y avisa
  subidos = mockStorage();
  res = await apiPoliza.POST(await reqPoliza(await token(), new Uint8Array(new jsPDF().output("arraybuffer"))));
  const vacio = await res.json();
  assert.deepEqual([res.status, vacio.sin_texto, vacio.datos.encontrados.length, subidos.length], [200, true, 0, 1]);

  // No es un PDF
  mockStorage();
  res = await apiPoliza.POST(await reqPoliza(await token(), new TextEncoder().encode("hola, no soy un pdf")));
  assert.equal(res.status, 400);

  // Sin la 156 no hay bucket
  mockStorage({ sinBucket: true });
  res = await apiPoliza.POST(await reqPoliza(await token(), pdfDePrueba(POLIZA_1)));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 156/);

  // Un operario no; el responsable de mantenimiento sí
  mockStorage();
  assert.equal((await apiPoliza.POST(await reqPoliza(await token("operativo"), pdfDePrueba(POLIZA_1)))).status, 403);
  mockStorage({ esMant: true });
  assert.equal((await apiPoliza.POST(await reqPoliza(await token("operativo"), pdfDePrueba(POLIZA_1)))).status, 200);
});

function mockFlota({ papel = { id: 5, archivo_path: RUTA, archivo_nombre: "poliza.pdf" }, sin156 = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("select=es_mantenimiento&limit=1"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/storage/v1/object/sign/flota-documentos/"),
      respond: (u) => { escrito.push({ tabla: "sign", url: u }); return { status: 200, body: { signedURL: `/object/sign/flota-documentos/${RUTA}?token=abc` } }; },
    },
    {
      match: (u) => u.includes("/rest/v1/vehiculo_papeles"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: papel && u.includes(`id=eq.${papel.id}&`) ? [papel] : [] };
        const body = JSON.parse(o.body);
        escrito.push({ tabla: "vehiculo_papeles", metodo: o.method, body });
        return { status: 201, body: [{ id: 51, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/vehiculos"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: [{ id: 9 }] };
        const body = JSON.parse(o.body);
        if (sin156) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'fotos' column of 'vehiculos' in the schema cache" } };
        escrito.push({ tabla: "vehiculos", metodo: o.method, body });
        return { status: 201, body: [{ id: 9, ...body }] };
      },
    },
  ]);
  return escrito;
}
const req = (t, body) => new Request("http://localhost/api/flota", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/flota — alta con fotos y el seguro de la póliza; descargar el PDF", async () => {
  const fotos = ["https://x.test/1.jpg", "https://x.test/2.jpg"];
  let escrito = mockFlota();
  let res = await api.POST(req(await token(), {
    accion: "vehiculo_guardar", patente: "AF123BC", tipo: "camioneta", fotos,
    seguro: { compania: "Sancor Seguros", numero: "12345678", fecha: "2026-10-01", vencimiento: "2027-04-01", archivo_path: RUTA, archivo_nombre: "poliza.pdf" },
  }));
  assert.equal(res.status, 200);
  const v = escrito.find((x) => x.tabla === "vehiculos");
  assert.deepEqual([v.body.fotos, v.body.foto_url], [fotos, fotos[0]], "la primera foto es la de la lista");
  const p = escrito.find((x) => x.tabla === "vehiculo_papeles");
  assert.deepEqual([p.body.tipo, p.body.vehiculo_id, p.body.compania, p.body.vencimiento, p.body.archivo_path, p.body.cargado_por], ["seguro", 9, "Sancor Seguros", "2027-04-01", RUTA, EMP]);

  // Un PDF que no es de la empresa no se acepta
  mockFlota();
  res = await api.POST(req(await token(), { accion: "vehiculo_guardar", patente: "AF123BC", tipo: "auto", seguro: { archivo_path: RUTA.replace(E, EMP) } }));
  assert.equal(res.status, 400);
  mockFlota();
  res = await api.POST(req(await token(), { accion: "papel_guardar", vehiculo_id: 9, tipo: "seguro", archivo_path: "otra/cosa.pdf" }));
  assert.equal(res.status, 400);

  // Descargar: link firmado que baja con el nombre del archivo; cualquiera que ve la flota
  escrito = mockFlota();
  res = await api.POST(req(await token("operativo"), { accion: "papel_archivo", id: 5 }));
  assert.equal(res.status, 200);
  const { url } = await res.json();
  assert.equal(url, `https://test.supabase.co/storage/v1/object/sign/flota-documentos/${RUTA}?token=abc&download=poliza.pdf`);
  assert.ok(escrito.some((x) => x.tabla === "sign"));

  mockFlota({ papel: { id: 5, archivo_path: null } });
  assert.equal((await api.POST(req(await token(), { accion: "papel_archivo", id: 5 }))).status, 404);

  mockFlota({ sin156: true });
  res = await api.POST(req(await token(), { accion: "vehiculo_guardar", patente: "AF123BC", tipo: "auto", fotos }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 156/);
});

// ─── Pantalla ───

function mockPantalla({ papeles = [] } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/flota/poliza")) {
      enviados.push({ poliza: opts.body instanceof FormData });
      const datos = leerPoliza(POLIZA_1);
      return new Response(JSON.stringify({ ok: true, archivo: { path: RUTA, nombre: "poliza.pdf" }, datos, sin_texto: false }), { status: 200 });
    }
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.includes("/api/flota")) {
      enviados.push(body);
      if (body?.accion === "papel_archivo") return new Response(JSON.stringify({ ok: true, url: "https://test.supabase.co/firmado.pdf" }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, vehiculo: { id: 9 } }), { status: 200 });
    }
    const path = body?.path || "";
    const data = path.startsWith("vehiculo_papeles") ? papeles
      : path.startsWith("vehiculos") ? [{ id: 7, patente: "AB123CD", tipo: "camioneta", activo: true, fotos: ["https://x.test/1.jpg", "https://x.test/2.jpg"], foto_url: "https://x.test/1.jpg" }]
        : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("Flota — alta desde la póliza: completa en amarillo, se puede corregir y guarda el seguro", async () => {
  const enviados = mockPantalla();
  render(<FlotaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  fireEvent.click(await screen.findByText("＋ Agregar vehículo"));
  const archivo = new File([pdfDePrueba(POLIZA_1)], "poliza.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("📄 Cargar desde la póliza (PDF)"), { target: { files: [archivo] } });
  assert.match((await screen.findByRole("status")).textContent, /Gypi completó 12 datos de la póliza/);
  assert.equal(screen.getByLabelText("Patente").value, "AF123BC");
  assert.equal(screen.getByLabelText("Marca").value, "TOYOTA");
  assert.equal(screen.getByLabelText("Tipo").value, "camioneta");
  assert.equal(screen.getByLabelText("Compañía").value, "Sancor Seguros");
  assert.equal(screen.getByLabelText("Vence").value, "2027-04-01");
  assert.match(screen.getByLabelText("Marca").className, /bg-gypi-amber/, "lo leído va en amarillo");
  fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "Toyota" } });
  assert.doesNotMatch(screen.getByLabelText("Marca").className, /bg-gypi-amber/, "al corregirlo deja de estar en amarillo");

  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.equal(enviados[0].poliza, true);
  const g = enviados[1];
  assert.deepEqual([g.accion, g.patente, g.marca, g.anio, g.chasis], ["vehiculo_guardar", "AF123BC", "Toyota", 2021, "8AJBA3CD1M1234567"]);
  assert.deepEqual(g.seguro, { numero: "12345678", fecha: "2026-10-01", vencimiento: "2027-04-01", compania: "Sancor Seguros", cobertura: "Terceros completo", archivo_path: RUTA, archivo_nombre: "poliza.pdf" });
  assert.deepEqual(g.fotos, []);
});

test("Flota — ficha con todas las fotos y la póliza para descargar", async () => {
  const enviados = mockPantalla({ papeles: [{ id: 5, vehiculo_id: 7, tipo: "seguro", compania: "Sancor Seguros", vencimiento: "2099-01-01", fotos: [], archivo_path: RUTA, archivo_nombre: "poliza.pdf", created_at: "2026-01-01T00:00:00Z" }] });
  const abiertas = [];
  window.open = () => { const w = { location: { href: "" }, close() {} }; abiertas.push(w); return w; };
  render(<FlotaScreen empresaId={E} usuario={{ rol: "administrativo" }} />);
  await screen.findByRole("list", { name: "Vehículos" });
  fireEvent.click(screen.getByLabelText("Ver AB123CD"));
  assert.equal((await screen.findByRole("list", { name: "Fotos del vehículo" })).querySelectorAll("img").length, 1, "la primera arriba, el resto abajo");
  fireEvent.click(screen.getByText("⬇ Descargar póliza (PDF)"));
  await waitFor(() => assert.equal(abiertas[0]?.location.href, "https://test.supabase.co/firmado.pdf"));
  assert.deepEqual(enviados.at(-1), { accion: "papel_archivo", id: 5 });

  // Editar: aparecen las dos fotos para sacar o sumar
  fireEvent.click(screen.getByText("✏ Editar datos"));
  assert.ok(screen.getByLabelText("Sacar la foto 2"));
  assert.match(screen.getByText(/Fotos \(2 de 6\)/).textContent, /La primera es la que se ve en la lista/);
});
