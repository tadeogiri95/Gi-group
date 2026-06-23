// tests/component-documentos-empleado.test.jsx — Test de componente (RTL)
// para DocumentosEmpleadoScreen: tab "Asignar" — precarga de quién ya tiene
// un tipo de documento asignado, y el diff (alta + baja) que aplica "Guardar"
// contra ese estado original.
import "./helpers/domSetup.js";
import { test, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";

const { default: DocumentosEmpleadoScreen } = await import("../app/documentos_empleado_screen.jsx");
const { setToken } = await import("../app/lib/supabase.js");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { ToastProvider } = await import("../app/components/ui/Toast.jsx");

before(() => setToken("fake-token-de-test"));
afterEach(() => cleanup());

const TIPO_DNI = { id: "tipo-dni", nombre: "DNI", activo: true, formatos_aceptados: ["pdf", "image"], tipo_carga: "puntual", admite_multiples: false, orden: 0 };
const TIPO_LICENCIA = { id: "tipo-lic", nombre: "Licencia de conducir", activo: true, formatos_aceptados: ["pdf"], tipo_carga: "puntual", admite_multiples: false, orden: 1 };

const EMP_ANA = { id: "emp-1", nombre: "Ana Gómez", apodo: "Ana", legajo: 1, division: "produccion" };
const EMP_LUIS = { id: "emp-2", nombre: "Luis Díaz", apodo: "Luis", legajo: 2, division: "produccion" };
const EMP_CARLA = { id: "emp-3", nombre: "Carla Ruiz", apodo: "Carla", legajo: 3, division: "administracion" };

// Estado inicial: Ana ya tiene el DNI asignado; Luis y Carla, no.
const EXIGIDOS_INICIALES = [{ empleado_id: EMP_ANA.id, tipo_documento_id: TIPO_DNI.id }];

function handlerData() {
  const tablas = {
    tipos_documento_requerido: [TIPO_DNI, TIPO_LICENCIA],
    empleados: [EMP_ANA, EMP_LUIS, EMP_CARLA],
    documentos_exigidos_empleado: EXIGIDOS_INICIALES,
    documentos_empleado: [],
  };
  return {
    match: (url, opts) => url.includes("/api/data") && opts.method === "POST",
    respond: (url, opts) => {
      const body = JSON.parse(opts.body);
      const tabla = (body.path || "").split("?")[0];
      return { status: 200, body: { data: tablas[tabla] ?? [] } };
    },
  };
}

function renderPantalla(extraHandlers) {
  global.fetch = createFetchMock([handlerData(), ...extraHandlers]);
  return render(
    <AuthContext.Provider value={{}}>
      <ToastProvider>
        <DocumentosEmpleadoScreen empresaId="emp-1" />
      </ToastProvider>
    </AuthContext.Provider>
  );
}

async function irATabAsignar(extraHandlers = []) {
  renderPantalla(extraHandlers);
  await waitFor(() => assert.ok(screen.queryByText("Asignar")));
  fireEvent.click(screen.getByText("Asignar"));
}

function filaEmpleado(nombre) {
  return screen.getByText(nombre).closest("button");
}

function elegirTipo(tipoId) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: tipoId } });
}

function handlersAsignar({ postStatus = 200, postBodyResp = { ok: true }, deleteStatus = 200, deleteBodyResp = { ok: true }, onPost, onDelete } = {}) {
  return [
    {
      match: (url, opts) => url.includes("/api/documentos/asignar") && opts.method === "POST",
      respond: (url, opts) => { onPost?.(JSON.parse(opts.body)); return { status: postStatus, body: postBodyResp }; },
    },
    {
      match: (url, opts) => url.includes("/api/documentos/asignar") && opts.method === "DELETE",
      respond: (url, opts) => { onDelete?.(JSON.parse(opts.body)); return { status: deleteStatus, body: deleteBodyResp }; },
    },
  ];
}

test("DocumentosEmpleadoScreen — al elegir un tipo, los empleados ya asignados aparecen pre-tildados", async () => {
  await irATabAsignar();
  elegirTipo(TIPO_DNI.id);

  await waitFor(() => assert.ok(filaEmpleado(EMP_ANA.nombre).textContent.includes("✓")));
  assert.equal(filaEmpleado(EMP_LUIS.nombre).textContent.includes("✓"), false);
  assert.equal(filaEmpleado(EMP_CARLA.nombre).textContent.includes("✓"), false);
});

test("DocumentosEmpleadoScreen — destildar uno asignado y tildar uno nuevo: Guardar llama DELETE y POST con los empleado_id correctos", async () => {
  let postBody = null;
  let deleteBody = null;
  await irATabAsignar(handlersAsignar({ onPost: (b) => (postBody = b), onDelete: (b) => (deleteBody = b) }));

  elegirTipo(TIPO_DNI.id);
  await waitFor(() => assert.ok(filaEmpleado(EMP_ANA.nombre).textContent.includes("✓")));

  fireEvent.click(filaEmpleado(EMP_ANA.nombre)); // destildar la ya asignada
  fireEvent.click(filaEmpleado(EMP_LUIS.nombre)); // tildar una nueva
  await waitFor(() => assert.ok(screen.queryByText("💾 Guardar cambios (+1 / -1)")));

  fireEvent.click(screen.getByText("💾 Guardar cambios (+1 / -1)"));

  await waitFor(() => assert.notEqual(postBody, null));
  await waitFor(() => assert.notEqual(deleteBody, null));

  assert.deepEqual(postBody, { tipo_documento_id: TIPO_DNI.id, empleado_ids: [EMP_LUIS.id] });
  assert.deepEqual(deleteBody, { tipo_documento_id: TIPO_DNI.id, empleado_ids: [EMP_ANA.id] });
  await waitFor(() => assert.ok(screen.queryByText(/✅ Guardado/)));
});

test("DocumentosEmpleadoScreen — sin cambios respecto al estado original, el botón Guardar queda deshabilitado y no llama a ningún endpoint", async () => {
  let asignarLlamado = false;
  await irATabAsignar([
    { match: (url) => url.includes("/api/documentos/asignar"), respond: () => { asignarLlamado = true; return { status: 200, body: { ok: true } }; } },
  ]);

  elegirTipo(TIPO_DNI.id);
  await waitFor(() => assert.ok(filaEmpleado(EMP_ANA.nombre).textContent.includes("✓")));

  const boton = screen.getByText("Sin cambios");
  assert.equal(boton.disabled, true);

  fireEvent.click(boton);
  assert.equal(asignarLlamado, false);
});

test("DocumentosEmpleadoScreen — error en el POST de asignación muestra el toast de error y no llega a llamar al DELETE", async () => {
  let deleteCalled = false;
  await irATabAsignar(handlersAsignar({
    postStatus: 400,
    postBodyResp: { error: "Fallo al asignar documento" },
    onDelete: () => { deleteCalled = true; },
  }));

  elegirTipo(TIPO_DNI.id);
  await waitFor(() => assert.ok(filaEmpleado(EMP_ANA.nombre).textContent.includes("✓")));

  fireEvent.click(filaEmpleado(EMP_ANA.nombre));
  fireEvent.click(filaEmpleado(EMP_LUIS.nombre));
  await waitFor(() => assert.ok(screen.queryByText("💾 Guardar cambios (+1 / -1)")));

  fireEvent.click(screen.getByText("💾 Guardar cambios (+1 / -1)"));

  await waitFor(() => assert.ok(screen.queryByText("Error: Fallo al asignar documento")));
  assert.equal(deleteCalled, false);

  // La UI vuelve a un estado consistente: mismo diff pendiente, botón habilitado de nuevo.
  await waitFor(() => assert.ok(screen.queryByText("💾 Guardar cambios (+1 / -1)")));
  assert.equal(screen.getByText("💾 Guardar cambios (+1 / -1)").disabled, false);
});

test("DocumentosEmpleadoScreen — error en el DELETE de desasignación muestra el toast de error sin perder la selección pendiente", async () => {
  let postCalled = false;
  await irATabAsignar(handlersAsignar({
    onPost: () => { postCalled = true; },
    deleteStatus: 400,
    deleteBodyResp: { error: "Fallo al desasignar documento" },
  }));

  elegirTipo(TIPO_DNI.id);
  await waitFor(() => assert.ok(filaEmpleado(EMP_ANA.nombre).textContent.includes("✓")));

  fireEvent.click(filaEmpleado(EMP_ANA.nombre));
  fireEvent.click(filaEmpleado(EMP_LUIS.nombre));
  await waitFor(() => assert.ok(screen.queryByText("💾 Guardar cambios (+1 / -1)")));

  fireEvent.click(screen.getByText("💾 Guardar cambios (+1 / -1)"));

  await waitFor(() => assert.ok(screen.queryByText("Error: Fallo al desasignar documento")));
  assert.equal(postCalled, true);

  // El diff pendiente se mantiene visible (no se perdió la selección) y el botón vuelve a estar habilitado.
  await waitFor(() => assert.ok(screen.queryByText("💾 Guardar cambios (+1 / -1)")));
  assert.equal(screen.getByText("💾 Guardar cambios (+1 / -1)").disabled, false);
  assert.ok(filaEmpleado(EMP_LUIS.nombre).textContent.includes("✓"));
  assert.equal(filaEmpleado(EMP_ANA.nombre).textContent.includes("✓"), false);
});
