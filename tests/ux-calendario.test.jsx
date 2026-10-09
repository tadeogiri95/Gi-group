// tests/ux-calendario.test.jsx — Reforma UX R11 (5/8): Calendario y Horarios.
// El color de las notas se guarda de verdad, los interruptores se pueden tocar
// y los modos se llaman "De a uno" y "Varios a la vez".
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { default: CalendarioScreen, colorNota } = await import("../app/calendario_screen.jsx");
const { default: GrillaHorarioScreen } = await import("../app/grilla_horario_screen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { CAMPOS_PERMITIDOS } = await import("../app/lib/schemas.ts");

afterEach(() => cleanup());

const LV = Object.fromEntries(["lun", "mar", "mie", "jue", "vie"].map((d) => [d, { in: "08:00", out: "17:00" }]));
const EMPS = [{ id: "e1", nombre: "Ana Gómez", apodo: "Ana", legajo: 7, division: "produccion", rol: "operativo", activo: true, diagrama: LV }];

function servidor() {
  const posts = [];
  global.fetch = async (_url, opts) => {
    const b = JSON.parse(opts?.body || "{}");
    if (b.method === "POST") { posts.push(b); return Response.json({ ok: true, data: [{}] }); }
    if ((b.path || "").startsWith("empleados")) return Response.json({ ok: true, data: EMPS });
    return Response.json({ ok: true, data: [] });
  };
  return posts;
}
const conAuth = (ui) => <AuthContext.Provider value={{ divisiones: [], usuario: { rol: "gerencial" } }}>{ui}</AuthContext.Provider>;

test("notas — el color elegido se guarda (antes el servidor lo descartaba y quedaban todas naranjas)", async () => {
  assert.ok(CAMPOS_PERMITIDOS.notas_calendario.POST.includes("color"));
  const posts = servidor();
  render(conAuth(<CalendarioScreen empresaId="emp-1" />));
  fireEvent.click(await screen.findByRole("button", { name: /^15 de / }));
  fireEvent.click(screen.getByRole("button", { name: "+ Nota" }));
  fireEvent.change(screen.getByLabelText("Nota o tarea"), { target: { value: "Instalar mueble" } });
  const verde = screen.getByRole("radio", { name: "Verde" });
  assert.match(verde.className, /w-11 h-11/, "44 px para tocar");
  fireEvent.click(verde);
  assert.equal(verde.getAttribute("aria-checked"), "true");
  fireEvent.click(screen.getByRole("button", { name: "Agregar nota" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].body.color, "verde");
  assert.equal(posts[0].body.texto, "Instalar mueble");
});

test("notas — las viejas, con el color escrito, se siguen viendo con su color", () => {
  assert.equal(colorNota("#16A34A").punto, "bg-gypi-green");
  assert.equal(colorNota("#0891b2").punto, "bg-gypi-cyan");
  assert.equal(colorNota("var(--color-empresa-primary, #F97316)").punto, "bg-gypi-amber");
  assert.equal(colorNota("rojo").punto, "bg-gypi-red");
  assert.equal(colorNota(null).punto, "bg-gypi-amber");
});

test("calendario — cada día dice cuántos trabajan y hay una explicación de cómo usarlo", async () => {
  servidor();
  render(conAuth(<CalendarioScreen empresaId="emp-1" />));
  assert.ok(await screen.findByText(/Tocá un día para ver quién trabaja/));
  assert.match(screen.getByRole("button", { name: /^1 de / }).getAttribute("aria-label"), /trabajan/);
  assert.equal(screen.getByRole("button", { name: "Mes anterior" }).className.includes("w-12 h-12"), true);
});

test("horarios — modos 'De a uno' / 'Varios a la vez' e interruptores de 48 px que dicen qué hacen", async () => {
  servidor();
  render(conAuth(<GrillaHorarioScreen empresaId="emp-1" />));
  fireEvent.click(await screen.findByRole("button", { name: /Ana Gómez/ }));
  assert.equal(screen.getByRole("button", { name: /De a uno/ }).getAttribute("aria-pressed"), "true");
  const lunes = screen.getByRole("button", { name: /Lun: trabaja/ });
  assert.match(lunes.className, /w-12 h-7/);
  fireEvent.click(lunes);
  assert.ok(screen.getByRole("button", { name: /Lun: franco/ }));
  assert.ok(screen.getByRole("button", { name: /Lunes a viernes, 08:30 a 17:30/ }));
  assert.ok(screen.getByRole("button", { name: /Guardar y notificar 1 empleado/ }));
  fireEvent.click(screen.getByRole("button", { name: /Varios a la vez/ }));
  assert.ok(screen.getByText(/Definí el horario/));
});
