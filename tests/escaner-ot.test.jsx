// tests/escaner-ot.test.jsx — Escáner de OT y OTs recientes (F4-11, D8, ítem 20).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { otDesdeCodigo, recordarOT, otsRecientes } = await import("../app/lib/ot.js");
const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET, PATCH } = await import("../app/api/empresa/route.js");

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete window.BarcodeDetector;
});

const PROYECTOS = [
  { ot: "1234", cliente: "Acme", proyecto: "Portón" },
  { ot: "00077", cliente: "Beta", proyecto: "Reja" },
  { ot: "A-15", cliente: "Gama", proyecto: "Escalera" },
];

// ── Reconocer el código ──

test("otDesdeCodigo — acepta el código tal cual, con prefijo OT, con ceros o en un link", () => {
  assert.equal(otDesdeCodigo("1234", PROYECTOS)?.cliente, "Acme");
  assert.equal(otDesdeCodigo("OT-1234", PROYECTOS)?.cliente, "Acme");
  assert.equal(otDesdeCodigo("ot 001234", PROYECTOS)?.cliente, "Acme");
  assert.equal(otDesdeCodigo("77", PROYECTOS)?.cliente, "Beta", "ceros a la izquierda");
  assert.equal(otDesdeCodigo("https://erp.x/orden?ot=1234", PROYECTOS)?.cliente, "Acme");
  assert.equal(otDesdeCodigo("a-15", PROYECTOS)?.cliente, "Gama", "OT con letras, sin distinguir mayúsculas");
});

test("otDesdeCodigo — no inventa coincidencias", () => {
  assert.equal(otDesdeCodigo("9999", PROYECTOS), null);
  assert.equal(otDesdeCodigo("12-34-x", PROYECTOS), null, "texto con números sueltos no es una OT");
  assert.equal(otDesdeCodigo("", PROYECTOS), null);
});

test("recordarOT / otsRecientes — las últimas 5 por empleado, sin repetir, solo las que siguen en la lista", () => {
  for (const ot of ["1", "2", "3", "4", "5", "6", "1234"]) recordarOT("emp-1", ot);
  recordarOT("emp-1", "00077");
  recordarOT("emp-2", "A-15");
  const lista = [...PROYECTOS, ...["1", "2", "3", "4", "5", "6"].map(ot => ({ ot }))];
  assert.deepEqual(otsRecientes("emp-1", lista).map(p => p.ot), ["00077", "1234", "6", "5", "4"]);
  assert.deepEqual(otsRecientes("emp-1", PROYECTOS).map(p => p.ot), ["00077", "1234"]);
  assert.deepEqual(otsRecientes("emp-2", PROYECTOS).map(p => p.ot), ["A-15"]);
});

// ── Pantalla de iniciar tarea ──

const ETAPAS = [{ codigo: 1, nombre: "Corte", icon: "✂️", color: "#F00" }];

const iniciadas = [];
function pantalla(empresa) {
  iniciadas.length = 0;
  return render(
    <ActividadScreen
      tareaActiva={null} historial={[]} etapas={ETAPAS} proyectos={PROYECTOS}
      loading={false} usuario={{ id: "emp-1" }} empresa={empresa} fichadaHoy={{ ingreso: "08:00:00" }}
      iniciarTarea={async (t) => { iniciadas.push(t); }} finalizarTarea={async () => {}} cambiarTarea={async () => {}}
    />
  );
}

async function irAElegirOT() {
  fireEvent.click(await screen.findByText(/Iniciar tarea/i));
  fireEvent.click(screen.getByText("Corte"));
}

test("Iniciar tarea — sin el escáner activado por la empresa no aparece el botón", async () => {
  window.BarcodeDetector = class {};
  pantalla({ escaner_ot: false });
  await irAElegirOT();
  assert.equal(screen.queryByText(/Escanear código de la OT/), null);
});

test("Iniciar tarea — con el escáner activado, escanear la OT ya inicia la tarea (R7)", async () => {
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ["qr_code", "code_128"]; }
    async detect() { return [{ rawValue: "OT-1234" }]; }
  };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } });
  pantalla({ escaner_ot: true });
  await irAElegirOT();
  fireEvent.click(screen.getByText(/Escanear código de la OT/));
  await waitFor(() => assert.equal(iniciadas.length, 1), { timeout: 2000 });
  assert.equal(String(iniciadas[0].codigo_proyecto), "1234");
  assert.equal(iniciadas[0].tipo, "N");
});

test("Iniciar tarea — muestra las OT recientes de este empleado", async () => {
  recordarOT("emp-1", "00077");
  pantalla({ escaner_ot: false });
  await irAElegirOT();
  assert.ok(screen.getByText("Recientes"));
  fireEvent.click(screen.getByRole("button", { name: /OT 00077/ }));
  await waitFor(() => assert.equal(iniciadas.length, 1), "tocar una OT reciente inicia la tarea");
  assert.equal(String(iniciadas[0].codigo_proyecto), "77");
});

// ── /api/empresa ──

async function token(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: "11111111-1111-1111-1111-111111111111", legajo: 7, rol })).token;
}

test("PATCH /api/empresa — gestión activa el escáner de OT", async () => {
  let cambios = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH", respond: (url, opts) => { cambios = JSON.parse(opts.body); return { status: 200, body: [cambios] }; } },
  ]);
  const res = await PATCH(new Request("http://localhost/api/empresa", {
    method: "PATCH", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ escaner_ot: true }),
  }));
  assert.equal(res.status, 200);
  assert.equal(cambios.escaner_ot, true);
});

test("GET /api/empresa — si falta la columna (migración 074 sin correr) sigue funcionando sin ella", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empresa?id=eq.") && !url.includes("email_verificado"),
      respond: (url) => {
        pedidos.push(url);
        return url.includes("escaner_ot")
          ? { status: 400, body: { message: "column empresa.escaner_ot does not exist" } }
          : { status: 200, body: [{ id: "e", nombre: "Gi" }] };
      },
    },
  ]);
  const res = await GET(new Request("http://localhost/api/empresa", { headers: { Authorization: `Bearer ${await token()}` } }));
  const json = await res.json();
  assert.equal(json.nombre, "Gi");
  assert.ok(!pedidos.at(-1).includes("escaner_ot"), "el último pedido va sin las columnas nuevas");
});
