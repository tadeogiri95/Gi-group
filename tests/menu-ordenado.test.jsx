// tests/menu-ordenado.test.jsx — Menú ordenado (auditoría 12/11, parte 13):
// Personal e Instalaciones con lugar propio, Finanzas por tema en vez de 14
// renglones, Flota con una sola pestaña de revisiones y el botón principal
// igual en todos lados.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, within } from "@testing-library/react";
import MenuLateral, { gruposMenu } from "../app/components/nav/MenuLateral.jsx";
import { pestanasCelular } from "../app/components/screens/BotonGestionScreen.jsx";
import { opcionesBoton, partirDestino } from "../app/lib/menuGestion.js";

afterEach(() => cleanup());
const leer = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");
const empresa = { nombre: "Acme", modulos: ["proyectos", "actividad", "finanzas"] };
const dueno = { rol: "gerencial" };

test("Finanzas: fuera de Finanzas un solo renglón; adentro, todo por tema", () => {
  const fuera = gruposMenu(empresa, dueno, 0, "home").find((g) => g.id === "finanzas").items;
  assert.deepEqual(fuera.map((i) => i.label), ["Inicio y todo Finanzas"]);
  const adentro = gruposMenu(empresa, dueno, 0, "finanzas").find((g) => g.id === "finanzas").items;
  assert.equal(adentro.length, 15, "15 con el Mayor de cuentas y Devengamiento (13/11)");
  assert.equal(adentro[0].tema, undefined, "Inicio va sin tema");
  assert.equal(adentro.find((i) => i.opcion === "fin-flujo").tema, "Cómo vamos");
});

test("Finanzas en la computadora: subtítulos por tema", () => {
  render(<MenuLateral empresa={empresa} usuario={dueno} screen="finanzas" seccion="fin-flujo" onIr={() => {}} />);
  const menu = screen.getByRole("complementary", { name: "Menú" });
  for (const t of ["Día a día", "Con quién trabajamos", "Cómo vamos", "Ajustes"]) assert.ok(within(menu).getByText(t));
  assert.equal(within(menu).getByRole("button", { name: /Flujo de caja/ }).getAttribute("aria-current"), "page");
});

test("Finanzas en el celular: sin pestañas en su Inicio; afuera, Inicio y las del mismo tema", () => {
  const ops = opcionesBoton("finanzas", empresa, dueno);
  assert.deepEqual(pestanasCelular("finanzas", ops, "fin-inicio"), []);
  assert.deepEqual(pestanasCelular("finanzas", ops, "fin-flujo").map((o) => o.label), ["Inicio", "Mayor de cuentas", "Devengamiento", "Resultados", "Flujo de caja", "Reporte financiero", "Cierre"]);
  const prod = opcionesBoton("proyectos", empresa, dueno);
  assert.equal(pestanasCelular("proyectos", prod, "ot"), prod, "los otros botones no cambian");
});

test("Personal con grupo propio e Instalaciones en Producción", () => {
  const g = gruposMenu(empresa, dueno, 4, "home");
  const personal = g.find((x) => x.id === "personal");
  assert.deepEqual(personal.items.map((i) => [i.label, i.destino]), [["Equipo y horarios", "equipo"], ["Permisos", "solicitudes"]]);
  assert.equal(personal.items[1].badge, 4);
  assert.ok(opcionesBoton("proyectos", empresa, { rol: "administrativo" }).some((o) => o.id === "instalaciones"));
  assert.deepEqual(partirDestino("planta:instalaciones"), { pantalla: "proyectos", seccion: "instalaciones" });
  const boton = leer("components/screens/BotonGestionScreen.jsx");
  assert.match(boton, /actual\.id === "instalaciones" && <ProyectosScreen [^>]*vistaInicial="gantt" ganttTipo="instalacion"/);
  assert.match(leer("components/GanttOt.jsx"), /if \(props\.tipoInicial\) return props\.tipoInicial;/);
});

test("Flota: una pestaña de revisiones con el ⚙ adentro, y el botón principal igual en todos lados", () => {
  const flota = leer("components/FlotaScreen.jsx");
  assert.ok(flota.includes("📋 Revisiones hechas"));
  assert.ok(!flota.includes("⚙ Checklist</Chip>"), "ya no hay una segunda pestaña casi igual");
  assert.ok(flota.includes("⚙ Editar los puntos a revisar"));
  assert.match(flota, /className="g-btn g-btn-primary mb-3">＋ Agregar vehículo/);
  assert.match(leer("proyectos_screen.jsx"), /className="g-btn g-btn-primary flex-1 min-h-\[48px\] text-\[15px\]">\+ Nueva OT/);
  assert.match(leer("components/StockScreen.jsx"), /className="g-btn g-btn-primary shrink-0">＋ Nuevo</);
});
