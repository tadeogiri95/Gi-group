// tests/auditoria-avisos.test.jsx — Arreglos del PR 2 de la auditoría del
// 22/10: el aviso de notificaciones se acuerda de que lo cerraste, "atrasada"
// se cuenta con el día de Argentina y Compras avisa si no pudo abrir.
import "./helpers/domSetup.js";
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* sin almacenamiento */ } });

mock.module("../app/lib/push.js", {
  namedExports: {
    requestPushPermission: async () => ({ ok: false, reason: "denied" }),
    onForegroundMessage: () => {},
    isPushSupported: () => true,
    getPushPermissionStatus: () => "denied",
    registerSW: () => {},
  },
});

const { default: PushManager, avisoCerradoHace, CLAVE_AVISO_CERRADO } = await import("../app/components/PushManager.jsx");
const { ocAtrasada } = await import("../app/lib/ordenesCompra.js");
const { ordenesAtrasadas } = await import("../app/lib/reportesCompras.js");
const { default: ComprasScreen } = await import("../app/components/ComprasScreen.jsx");

test("aviso de notificaciones bloqueadas: explica cómo desbloquear y la ✕ es grande", async () => {
  render(<PushManager legajo={7} empresaId="e1" />);
  assert.ok(await screen.findByText("Notificaciones bloqueadas"));
  assert.ok(screen.getByText(/candado.*Notificaciones.*Permitir/));
  assert.match(screen.getByRole("button", { name: "Cerrar aviso de notificaciones" }).className, /min-h-\[44px\]/);
});

test("aviso de notificaciones: al cerrarlo no vuelve a salir al abrir la app de nuevo", async () => {
  const { unmount } = render(<PushManager legajo={7} empresaId="e1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Cerrar aviso de notificaciones" }));
  assert.equal(screen.queryByText("Notificaciones bloqueadas"), null);
  assert.ok(Number(localStorage.getItem(CLAVE_AVISO_CERRADO)) > 0);
  unmount();
  // Otra vez la app: el aviso queda cerrado
  render(<PushManager legajo={7} empresaId="e1" />);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(screen.queryByText("Notificaciones bloqueadas"), null);
});

test("aviso de notificaciones: vuelve a salir pasados 30 días", () => {
  const ahora = Date.parse("2026-10-23T12:00:00Z");
  localStorage.setItem(CLAVE_AVISO_CERRADO, String(ahora - 29 * 86400000));
  assert.equal(avisoCerradoHace(ahora), true);
  localStorage.setItem(CLAVE_AVISO_CERRADO, String(ahora - 31 * 86400000));
  assert.equal(avisoCerradoHace(ahora), false);
  localStorage.removeItem(CLAVE_AVISO_CERRADO);
  assert.equal(avisoCerradoHace(ahora), false);
});

test("atrasada: a las 22 h de Argentina, la orden que vence hoy todavía no está atrasada", (t) => {
  // 23/10 01:30 UTC = 22/10 22:30 en Argentina (en Londres ya es 23/10)
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-23T01:30:00Z") });
  const vence22 = { id: 1, estado: "enviada", fecha_prometida: "2026-10-22" };
  const vence21 = { id: 2, estado: "enviada", fecha_prometida: "2026-10-21" };
  assert.equal(ocAtrasada(vence22), false);
  assert.equal(ocAtrasada(vence21), true);
  assert.deepEqual(ordenesAtrasadas([vence22, vence21]).map((o) => o.id), [2]);
});

test("Compras: si no se pudo leer quién puede comprar, avisa y deja reintentar", async () => {
  let llamadas = 0;
  global.fetch = async (url) => {
    if (String(url).includes("/api/compras")) {
      llamadas++;
      return llamadas === 1
        ? new Response(JSON.stringify({ error: "caído" }), { status: 500 })
        : new Response(JSON.stringify({ comprador: true, puede_pedir: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<ComprasScreen empresaId="e1" usuario={{ id: "u1", rol: "administrativo" }} />);
  assert.match((await screen.findByRole("alert")).textContent, /No se pudo abrir Compras/);
  fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
  assert.ok(await screen.findByRole("tab", { name: /A comprar/ }), "con permisos de comprador ve sus pestañas");
  assert.equal(llamadas, 2);
});
