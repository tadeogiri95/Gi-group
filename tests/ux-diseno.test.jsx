// tests/ux-diseno.test.jsx — Reforma UX R4: piezas de diseño comunes.
// Las pantallas nuevas se arman con components/ui; los estilos sueltos y los
// colores escritos a mano solo pueden bajar (ver app/components/ui/LEEME.md).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { Button, Screen, ListItem, Field, Stat, Tag, tinta } = await import("../app/components/ui.jsx");
const { tintaLegible, contraste } = await import("../app/lib/theme.js");
const { default: MisSolicitudesScreen } = await import("../app/components/screens/MisSolicitudesScreen.jsx");

afterEach(() => cleanup());
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ─── Texto con el color de la empresa ───────────────────────────────────────

test("tintaLegible — el color de marca como letra se lee (naranja, amarillo, verde, en claro y oscuro)", () => {
  for (const [color, texto, fondo] of [
    ["#F97316", "#1A1A1A", "#F7F7F5"], ["#FACC15", "#1A1A1A", "#FFFFFF"], ["#16A34A", "#1A1A1A", "#FFFFFF"],
    ["#0891B2", "#1A1A1A", "#FFFFFF"], ["#F97316", "#F5F0E8", "#0C0A09"], ["#2563EB", "#1E293B", "#F0F4F8"],
  ]) {
    const t = tintaLegible(color, texto, fondo);
    assert.ok(contraste(rgb(t), rgb(fondo)) >= 4.5, `${color} sobre ${fondo} → ${t}`);
  }
  // Un color que ya se lee no se toca
  assert.equal(tintaLegible("#2563EB", "#1A1A1A", "#FFFFFF"), "#2563EB");
  // Las variables de la empresa usan su versión legible
  assert.equal(tinta("var(--color-empresa-primary)"), "var(--color-empresa-primary-ink)");
  assert.match(tinta("var(--color-green)"), /color-mix/);
});

test("ninguna pantalla usa el color de la empresa como letra sin ajustar", () => {
  const malos = [];
  for (const f of archivos()) if (/text-gypi-amber(?![-\w])/.test(readFileSync(f, "utf8"))) malos.push(f);
  assert.deepEqual(malos, []);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--color-gypi-amber-ink: var\(--color-empresa-primary-ink/);
});

// ─── Piezas ─────────────────────────────────────────────────────────────────

test("Button — tamaños para tocar con guantes y letra según el color de la empresa", () => {
  render(<><Button size="sm">Chico</Button><Button>Normal</Button><Button size="planta">Fichar</Button></>);
  assert.equal(screen.getByText("Chico").style.minHeight, "44px");
  assert.equal(screen.getByText("Normal").style.minHeight, "48px");
  assert.equal(screen.getByText("Fichar").style.minHeight, "64px");
  assert.match(screen.getByText("Normal").style.color, /empresa-primary-text/);
});

test("Screen — volver, título y acción principal abajo", () => {
  let volvio = 0;
  render(<Screen title="Stock" subtitle="Depósito central" onBack={() => volvio++} action={<Button>+ Movimiento</Button>}><p>contenido</p></Screen>);
  assert.ok(screen.getByRole("heading", { name: "Stock" }));
  fireEvent.click(screen.getByText("← Volver"));
  assert.equal(volvio, 1);
  assert.ok(screen.getByText("+ Movimiento"));
  assert.ok(screen.getByRole("region", { name: "Stock" }));
});

test("ListItem, Field y Stat — renglón tocable, etiqueta y error visibles, número con etiqueta completa", () => {
  let tocado = 0;
  render(<>
    <ListItem icon="📦" title="Tornillos M6" detail="120 unidades" onClick={() => tocado++} />
    <Field label="Cantidad" help="En unidades" error="Tiene que ser un número"><input /></Field>
    <Stat value="87%" label="Cumplimiento" tone="bien" />
  </>);
  fireEvent.click(screen.getByText("Tornillos M6"));
  assert.equal(tocado, 1);
  const input = screen.getByLabelText("Cantidad");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.match(input.getAttribute("aria-describedby"), /ayuda/);
  assert.ok(screen.getByRole("alert").textContent.includes("número"));
  assert.ok(screen.getByText("Cumplimiento"));
});

test("Tag — la letra de un color claro se oscurece para leerse", () => {
  render(<Tag color="#FACC15">Pendiente</Tag>);
  const color = screen.getByText("Pendiente").style.color;
  assert.notEqual(color.toLowerCase(), "rgb(250, 204, 21)");
});

test("pantallas de muestra — Pedidos del operario usa el botón de planta", () => {
  render(<MisSolicitudesScreen solicitudes={[]} usuario={{}} empresa={{}} demo />);
  assert.equal(screen.getByText(/Pedir permiso, vacaciones/).style.minHeight, "64px");
  const inbox = readFileSync(new URL("../app/components/screens/InboxScreen.jsx", import.meta.url), "utf8");
  assert.match(inbox, /<EmptyState icon="inbox"/);
  assert.match(inbox, /<Button variant="secondary" size="sm"/);
});

test("R11 — pantallas ya pasadas al diseño nuevo no vuelven a tener estilos sueltos", () => {
  for (const ruta of ["app/[slug]/unirse/page.js", "app/components/screens/ChatScreen.jsx", "app/geolocalizacion_screen.jsx"]) {
    const src = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
    assert.equal((src.match(/style=\{\{/g) || []).length, 0, ruta);
    assert.doesNotMatch(src, /["'`]#[0-9A-Fa-f]{6}\b/, `${ruta}: colores a mano`);
  }
});

test("R11 — Asistente: botones de respuesta rápida tocables y tu mensaje con letra legible sobre el color de la empresa", async () => {
  const { default: ChatScreen } = await import("../app/components/screens/ChatScreen.jsx");
  global.fetch = async () => Response.json({ ok: true });
  render(<ChatScreen usuario={{ id: "e", apodo: "Ana", empresa_id: "x" }} ctx={{}} reload={() => {}} onBack={() => {}} />);
  const rapido = screen.getByRole("button", { name: "Necesito un permiso" });
  assert.match(rapido.className, /min-h-11/);
  assert.match(screen.getByRole("button", { name: "Enviar mensaje" }).className, /w-12 h-12/);
  fireEvent.change(screen.getByLabelText("Mensaje para el asistente"), { target: { value: "hola" } });
  assert.match(screen.getByRole("button", { name: "Enviar mensaje" }).className, /text-gypi-on-amber/);
  assert.ok(screen.getByRole("button", { name: "Volver al inicio" }));
});

// ─── Los estilos sueltos solo pueden bajar ──────────────────────────────────

function archivos(dir = new URL("../app", import.meta.url).pathname) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "superadmin" ? [] : archivos(p);
    return /\.(jsx?)$/.test(n) ? [p] : [];
  });
}
const cuenta = (re) => archivos().reduce((n, f) => n + (readFileSync(f, "utf8").match(re) || []).length, 0);

// Al migrar una pantalla a components/ui, bajá estos números.
const MAX_STYLE_SUELTOS = 710;
const MAX_COLORES_A_MANO = 363;

test("estilos sueltos y colores escritos a mano: no aparecen nuevos", () => {
  const estilos = cuenta(/style=\{\{/g);
  const colores = cuenta(/["'`]#[0-9A-Fa-f]{6}\b/g);
  assert.ok(estilos <= MAX_STYLE_SUELTOS, `hay ${estilos} style={{…}} (máximo ${MAX_STYLE_SUELTOS}): usá components/ui`);
  assert.ok(colores <= MAX_COLORES_A_MANO, `hay ${colores} colores a mano (máximo ${MAX_COLORES_A_MANO}): usá los tokens`);
});
