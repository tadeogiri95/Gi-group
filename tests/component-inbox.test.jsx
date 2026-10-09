// tests/component-inbox.test.jsx — Bandeja de solicitudes (F4-07): nombre del
// empleado, confirmación con comentario opcional y "Deshacer" antes de enviar.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const { default: InboxScreen, ESPERA_DESHACER_MS } = await import("../app/components/screens/InboxScreen.jsx");
const { default: SolCard, inicialNombre } = await import("../app/components/cards/SolCard.jsx");

afterEach(() => cleanup());

const GERENTE = { id: "g-1", legajo: 1, apodo: "Laura", rol: "gerencial", empresa_id: "e-1" };
const SOL = {
  id: 42, empleado_id: "emp-7", legajo: 7, nombre_empleado: "Juan Pérez", tipo: "permiso",
  motivo: "Turno médico", estado: "pendiente", fecha: "2026-10-08", created_at: "2026-10-07T12:00:00Z",
};

function servidor({ resolver = () => Response.json({ ok: true, push: { legajo: "7", titulo: "❌ Permiso rechazado", cuerpo: "Tu permiso fue rechazado por Laura" } }) } = {}) {
  const llamadas = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts?.body ? JSON.parse(opts.body) : null;
    llamadas.push({ url: u, body });
    if (u.includes("/api/data")) {
      if (body.method === "GET" && body.path.startsWith("solicitudes")) return Response.json({ data: [SOL], nextCursor: null });
      return Response.json({ data: [{ id: 1 }] });
    }
    if (u.includes("/api/solicitudes/resolver")) return resolver(body);
    if (u.includes("/api/send-push")) return Response.json({ ok: true });
    throw new Error("fetch inesperado " + u);
  };
  return llamadas;
}

// Aprobar/rechazar es un solo pedido al servidor (ítem 38)
const patches = (llamadas) => llamadas.filter((l) => l.url.includes("/api/solicitudes/resolver"));

// Acelera la espera de "Deshacer" sin tocar los timers de React/testing-library
function conEsperaCorta() {
  const original = global.setTimeout;
  global.setTimeout = (fn, ms, ...args) => original(fn, ms === ESPERA_DESHACER_MS ? 30 : ms, ...args);
  return () => { global.setTimeout = original; };
}

test("inicialNombre — inicial en mayúscula o # sin nombre", () => {
  assert.equal(inicialNombre("juan pérez"), "J");
  assert.equal(inicialNombre("  "), "#");
  assert.equal(inicialNombre(null), "#");
});

test("SolCard — en la bandeja muestra el nombre del empleado, no solo el legajo", () => {
  render(<SolCard s={SOL} showActions onResolve={() => {}} />);
  assert.ok(screen.getByText("Juan Pérez"));
  assert.ok(screen.getByRole("button", { name: "Aprobar solicitud de Juan Pérez" }));
});

test("SolCard — muestra el comentario de gerencia en una solicitud resuelta", () => {
  render(<SolCard s={{ ...SOL, estado: "rechazado", aprobador: "Laura", notas_gerencia: "Falta el certificado" }} />);
  assert.ok(screen.getByText(/Comentario de Laura: “Falta el certificado”/));
});

test("Rechazar pide confirmación; Cancelar no envía nada", async () => {
  const llamadas = servidor();
  render(<InboxScreen ctx={{ solicitudes: [SOL] }} reload={() => {}} usuario={GERENTE} />);
  fireEvent.click(await screen.findByRole("button", { name: "Rechazar solicitud de Juan Pérez" }));
  assert.ok(screen.getByText("¿Rechazar el pedido de Juan?"));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  assert.ok(screen.getByRole("button", { name: "Rechazar solicitud de Juan Pérez" }));
  assert.equal(patches(llamadas).length, 0);
});

test("Deshacer dentro de la espera: no se envía la respuesta", async () => {
  const restaurar = conEsperaCorta();
  try {
    const llamadas = servidor();
    render(<InboxScreen ctx={{ solicitudes: [SOL] }} reload={() => {}} usuario={GERENTE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar solicitud de Juan Pérez" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aprobar" }));
    assert.ok(screen.getByRole("status").textContent.includes("Aprobada"));
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await act(() => new Promise((r) => setTimeout(r, 80)));
    assert.equal(patches(llamadas).length, 0);
    assert.ok(screen.getByRole("button", { name: "Aprobar solicitud de Juan Pérez" }), "vuelve a mostrar las opciones");
  } finally {
    restaurar();
  }
});

test("Confirmar con motivo: pasada la espera, guarda el motivo y se lo avisa al empleado", async () => {
  const restaurar = conEsperaCorta();
  try {
    const llamadas = servidor();
    let recargas = 0;
    render(<InboxScreen ctx={{ solicitudes: [SOL] }} reload={() => recargas++} usuario={GERENTE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar solicitud de Juan Pérez" }));
    fireEvent.change(screen.getByLabelText(/Motivo del rechazo/), { target: { value: "  Falta el certificado " } });
    fireEvent.click(screen.getByRole("button", { name: "Sí, rechazar" }));
    assert.equal(patches(llamadas).length, 0, "no se envía antes de la espera");
    await waitFor(() => assert.equal(recargas, 1));
    const [p] = patches(llamadas);
    assert.deepEqual(p.body, { id: 42, estado: "rechazado", nota: "Falta el certificado" });
    assert.equal(llamadas.filter((l) => l.body?.method === "PATCH" || l.body?.method === "POST").length, 0, "el celular ya no escribe tablas sueltas");
    const push = llamadas.find((l) => l.url.includes("/api/send-push"));
    assert.deepEqual(push.body, { legajo: "7", title: "❌ Permiso rechazado", body: "Tu permiso fue rechazado por Laura", data: { empresa_id: "e-1" } });
  } finally {
    restaurar();
  }
});

test("Salir de la pantalla durante la espera envía la respuesta igual", async () => {
  const llamadas = servidor();
  const { unmount } = render(<InboxScreen ctx={{ solicitudes: [SOL] }} reload={() => {}} usuario={GERENTE} />);
  fireEvent.click(await screen.findByRole("button", { name: "Aprobar solicitud de Juan Pérez" }));
  fireEvent.click(screen.getByRole("button", { name: "Sí, aprobar" }));
  unmount();
  await waitFor(() => assert.equal(patches(llamadas).length, 1));
  assert.deepEqual(patches(llamadas)[0].body, { id: 42, estado: "aprobado", nota: null });
  // Espera el aviso al celular para que no caiga en la prueba siguiente
  await waitFor(() => assert.equal(llamadas.filter((l) => l.url.includes("/api/send-push")).length, 1));
});

test("Si otra persona ya lo respondió, lo dice y no manda aviso al celular", async () => {
  const restaurar = conEsperaCorta();
  try {
    const llamadas = servidor({ resolver: () => Response.json({ ok: false, tipo: "ya_resuelta", error: "Otra persona ya respondió este pedido." }, { status: 409 }) });
    render(<InboxScreen ctx={{ solicitudes: [SOL] }} reload={() => {}} usuario={GERENTE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar solicitud de Juan Pérez" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aprobar" }));
    assert.ok(await screen.findByText("Otra persona ya respondió este pedido.", {}, { timeout: 2000 }));
    assert.equal(llamadas.filter((l) => l.url.includes("/api/send-push")).length, 0);
  } finally {
    restaurar();
  }
});

test("Si falla la conexión, avisa que no se pudo", async () => {
  const restaurar = conEsperaCorta();
  try {
    servidor({ resolver: () => Response.json({ ok: false, error: "caído" }, { status: 500 }) });
    render(<InboxScreen ctx={{ solicitudes: [SOL] }} reload={() => {}} usuario={GERENTE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar solicitud de Juan Pérez" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aprobar" }));
    assert.ok(await screen.findByText(/No se pudo responder el pedido/, {}, { timeout: 2000 }));
  } finally {
    restaurar();
  }
});
