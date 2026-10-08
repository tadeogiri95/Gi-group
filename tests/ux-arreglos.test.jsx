// tests/ux-arreglos.test.jsx — Reforma UX, etapa R1: arreglos rápidos que
// confundían al usuario (evaluación de usabilidad U-02, U-04, U-09, U-10, U-11,
// U-19, U-21 y códigos crudos en el tablero).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { notificacionAprobada, mensajeErrorPago, mensajeErrorRed, bandejaVacia } = await import("../app/lib/textos.js");
const { nombreSolicitud } = await import("../app/lib/tiposSolicitud.js");
const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");
const { default: MisSolicitudesScreen } = await import("../app/components/screens/MisSolicitudesScreen.jsx");

afterEach(() => cleanup());
const fuente = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

test("U-09 — los avisos aprobados se ven como aprobados (antes 'APROBADO' salía en rojo)", () => {
  // Los asuntos reales que manda la Bandeja
  assert.equal(notificacionAprobada("✅ Ingreso APROBADO — Ya quedaste fichado"), true);
  assert.equal(notificacionAprobada("✅ Cambio de horario APROBADO"), true);
  assert.equal(notificacionAprobada("✅ Hora extra APROBADA"), true);
  assert.equal(notificacionAprobada("Solicitud APROBADA ✅"), true);
  assert.equal(notificacionAprobada("❌ Salida anticipada RECHAZADA"), false);
  assert.equal(notificacionAprobada("Solicitud RECHAZADA ❌"), false);
  assert.equal(notificacionAprobada(undefined), false);
  assert.match(fuente("app/components/screens/HomeEmp.jsx"), /notificacionAprobada\(n\.asunto\)/);
});

test("U-10 — el aviso de salida aprobada nombra el botón que existe", () => {
  const inbox = fuente("app/components/screens/InboxScreen.jsx");
  assert.doesNotMatch(inbox, /"Me voy"/);
  assert.match(inbox, /"Fichar salida"/);
});

test("U-19 — un error de pago se explica sin códigos técnicos", () => {
  assert.equal(mensajeErrorPago({ status: 500, error: "TypeError: x is undefined" }), "No pudimos conectar con Mercado Pago. Probá de nuevo en unos minutos.");
  assert.equal(mensajeErrorPago({ status: 502 }), "No pudimos conectar con Mercado Pago. Probá de nuevo en unos minutos.");
  assert.equal(mensajeErrorPago({ status: 400, error: "Completá tus datos de facturación" }), "Completá tus datos de facturación");
  assert.equal(mensajeErrorPago({ status: 0 }), "No hay conexión. Revisá internet y probá de nuevo.");
  assert.equal(mensajeErrorRed(new TypeError("Failed to fetch")), "No hay conexión. Revisá internet y probá de nuevo.");
  assert.equal(mensajeErrorRed(new Error("Sin sesión")), "Sin sesión");
  assert.doesNotMatch(fuente("app/components/BillingScreen.jsx"), /`Error \$\{r\.status\}/);
});

test("U-21 — la bandeja vacía dice algo distinto según el filtro", () => {
  assert.equal(bandejaVacia("pendiente").titulo, "Todo al día");
  assert.equal(bandejaVacia("aprobado").titulo, "Sin pedidos aprobados");
  assert.equal(bandejaVacia("rechazado").titulo, "Sin pedidos rechazados");
  assert.equal(bandejaVacia("todas").titulo, "Sin pedidos");
});

test("tablero — los pedidos se nombran en castellano, nunca con el código interno", () => {
  assert.equal(nombreSolicitud({ tipo: "hora_extra" }), "Hora extra");
  assert.equal(nombreSolicitud({ tipo: "cambio_turno" }), "Cambio de turno");
  assert.equal(nombreSolicitud({ tipo: "salida_anticipada" }), "Salida anticipada");
  assert.equal(nombreSolicitud({ tipo: "algo_nuevo" }), "Algo nuevo");
  const tablero = fuente("app/dashboard_gerencia.jsx");
  assert.match(tablero, /<Tag color=\{AMBER\}>\{nombreSolicitud\(s\)\}<\/Tag>/);
  for (const viejo of ["Cumplim.", "Tardes sem.", "T. productivo", "Produccion en vivo", "Ultimo refresh", "Sin division"]) {
    assert.ok(!tablero.includes(viejo), `queda "${viejo}"`);
  }
});

const ETAPAS = [{ codigo: 1, nombre: "Corte", icon: "✂️", color: "#F00" }];
function actividad(props = {}) {
  let alInicio = 0;
  render(
    <ActividadScreen
      tareaActiva={null} historial={[]} etapas={ETAPAS} proyectos={[]} loading={false}
      usuario={{ id: "emp-1" }} empresa={{}} fichadaHoy={{ ingreso: "08:00:00" }}
      iniciarTarea={async () => {}} finalizarTarea={async () => {}} cambiarTarea={async () => {}}
      onIrAInicio={() => alInicio++}
      {...props}
    />
  );
  return () => alInicio;
}

test("U-02 — 'Terminar tarea' no promete fichar la salida, y se recuerda cómo fichar", async () => {
  actividad({ tareaActiva: { id: 9, etapa: 1, codigo_proyecto: "1001", hora_inicio: new Date(Date.now() - 600000).toISOString(), tipo: "N" } });
  assert.ok(await screen.findByText(/Terminar tarea/));
  assert.equal(screen.queryByText(/Finalizar jornada/), null);
  assert.ok(screen.getByText("Terminar la tarea no ficha tu salida."));
  cleanup();

  // Sin tarea, con entrada y sin salida: botón para ir a fichar la salida
  const veces = actividad();
  fireEvent.click(await screen.findByText(/¿Terminaste el día\? Fichá tu salida en Inicio/));
  assert.equal(veces(), 1);
  cleanup();

  // Ya fichó la salida: no se le insiste
  actividad({ fichadaHoy: { ingreso: "08:00:00", egreso: "17:00:00" } });
  await screen.findByText(/Iniciar tarea/);
  assert.equal(screen.queryByText(/¿Terminaste el día/), null);
});

test("sin fichar la entrada, el aviso trae el botón para ir a fichar", async () => {
  const veces = actividad({ fichadaHoy: null });
  fireEvent.click(await screen.findByText(/Iniciar tarea/i));
  assert.ok(screen.getByText("Primero fichá tu entrada en Inicio."));
  fireEvent.click(screen.getByText("Ir a fichar"));
  assert.equal(veces(), 1);
});

test("U-04 — Solicitudes del operario: botón para pedir y explicación cuando está vacía", () => {
  render(<MisSolicitudesScreen solicitudes={[]} usuario={{ legajo: 1 }} empresa={{}} demo />);
  assert.ok(screen.getByText("Todavía no pediste nada"));
  fireEvent.click(screen.getByText(/Pedir permiso, vacaciones o avisar una falta/));
  assert.equal(screen.queryByText("Todavía no pediste nada"), null, "se abre el formulario");
  cleanup();
  render(<MisSolicitudesScreen solicitudes={[{ id: 1, tipo: "vacaciones", estado: "pendiente", motivo: "Viaje", fecha: "2026-10-20" }]} usuario={{}} empresa={{}} />);
  assert.equal(screen.queryByText("Todavía no pediste nada"), null);
  assert.ok(screen.getByText(/Pedir permiso/));
});

test("U-11 — 'Producción en vivo' tiene botón para volver y su título correcto", () => {
  const home = fuente("app/[slug]/HomeContent.jsx");
  assert.match(home, /screen === "ger-actividad" && \(\s*<button onClick=\{\(\) => setScreen\("home"\)\}/);
  assert.doesNotMatch(home, /if \(showBack\) return "Configuración"/);
  assert.match(home, /<MisSolicitudesScreen /);
});
