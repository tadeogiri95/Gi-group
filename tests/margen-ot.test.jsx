// tests/margen-ot.test.jsx — Auditoría 12/11, parte 4: margen por OT (precio
// del Plan sin IVA contra el costo real), por cliente y por división, con
// aviso bajo el mínimo (10 % si no se cambió). Sin migración.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { MARGEN_MINIMO, margen, margenMinimoDe, margenPor, minimoValido, textoPct } from "../app/lib/margenOt.js";
import { filaReporte, planillaReporte, totalesReporte } from "../app/lib/costoReporte.js";
import { costoPrevistoReal } from "../app/lib/costoReal.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const reporte = await import("../app/api/costo-reporte/route.js");
const { _limpiarCacheAlcance } = await import("../app/lib/alcance.js");
const { default: CostoOtTab } = await import("../app/components/CostoOtTab.jsx");
const { default: CostoRealOt } = await import("../app/components/CostoRealOt.jsx");
const { ToastProvider } = await import("../app/components/ui/Toast.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

test("margen — ganancia y % sobre el precio; bajo el mínimo avisa; sin precio no hay margen", () => {
  assert.equal(MARGEN_MINIMO, 10);
  assert.deepEqual(margen({ precio: 1000000, costo: 850000 }), { precio: 1000000, costo: 850000, ganancia: 150000, pct: 15, bajo: false });
  assert.equal(margen({ precio: 1000000, costo: 920000 }).bajo, true);
  assert.equal(margen({ precio: 1000000, costo: 920000, minimo: 5 }).bajo, false);
  assert.deepEqual(margen({ precio: 100, costo: 130 }), { precio: 100, costo: 130, ganancia: -30, pct: -30, bajo: true });
  assert.equal(margen({ precio: null, costo: 10 }), null);
  assert.equal(margen({ precio: 0, costo: 10 }), null);
  assert.equal(margenMinimoDe(null), 10);
  assert.equal(margenMinimoDe({ minimo: 25 }), 25);
  assert.equal(margenMinimoDe({ minimo: 120 }), 10);
  assert.deepEqual([minimoValido(0), minimoValido("12,5"), minimoValido(12.5), minimoValido(-1), minimoValido(101)], [true, false, true, false, false]);
  assert.equal(textoPct(12.5), "12,5 %");
});

const fila = (ot, cliente, division, precio, total) => filaReporte({ proyecto: { ot, cliente, division }, precio, final: { total, materiales: total, mano_obra: 0, detalle: {} } });

test("reporte — margen por OT, totales y agrupado por cliente y división, el peor primero", () => {
  const filas = [fila("1", "CEVT", "MADERA", 1000, 800), fila("2", "CEVT", "MADERA", 1000, 950), fila("3", "RIOFRIO", "METAL", 2000, 1500), fila("4", "RIOFRIO", "METAL", null, 999)];
  assert.deepEqual(filas.map((f) => [f.margen, f.margen_bajo, f.ganancia]), [[20, false, 200], [5, true, 50], [25, false, 500], [null, false, null]]);
  const t = totalesReporte(filas);
  assert.deepEqual([t.precio, t.ganancia, t.margen, t.con_precio, t.margen_bajo], [4000, 750, 18.8, 3, 1]);
  const porCliente = margenPor(filas, (f) => f.cliente);
  assert.deepEqual(porCliente.map((g) => [g.clave, g.ots, g.pct, g.bajas, g.bajo]), [["CEVT", 2, 12.5, 1, false], ["RIOFRIO", 1, 25, 0, false]]);
  assert.deepEqual(margenPor(filas, (f) => f.division, 15).map((g) => [g.clave, g.bajo]), [["MADERA", true], ["METAL", false]]);
  const planilla = planillaReporte(filas);
  assert.deepEqual(planilla[0].slice(-4), ["Precio sin IVA", "Ganancia", "Margen %", "Bajo el mínimo"]);
  assert.deepEqual(planilla[2].slice(-4), ["1000", "50", "5", "Sí"]);
  assert.deepEqual(planilla.at(-1).slice(-4), ["4000", "750", "18,8", 1]);
});

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 1, rol })).token;
}
const post = async (rol, body) => reporte.POST(new Request("http://localhost/api/costo-reporte", { method: "POST", headers: { Authorization: `Bearer ${await token(rol)}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));

test("/api/costo-reporte — el dueño guarda el margen mínimo; otro rol o un número fuera de 0 a 100 no", async () => {
  _limpiarCacheAlcance();
  const escrito = [];
  let guardado = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("select=id,solo_su_division"), respond: () => ({ status: 200, body: [{ id: EMP, solo_su_division: false }] }) },
    ...authPassHandlers(),
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (!o?.method || o.method === "GET") return { status: 200, body: guardado };
        escrito.push({ metodo: o.method, url: decodeURIComponent(u), body: JSON.parse(o.body) });
        guardado = [{ clave: "costos_margen" }];
        return { status: o.method === "POST" ? 201 : 200, body: [{}] };
      },
    },
  ]);
  assert.equal((await post("operativo", { accion: "margen_minimo", minimo: 15 })).status, 403);
  assert.equal((await post("gerencial", { accion: "margen_minimo", minimo: 150 })).status, 400);
  let r = await post("gerencial", { accion: "margen_minimo", minimo: 12.55 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).margen_minimo, 12.6);
  r = await post("gerencial", { accion: "margen_minimo", minimo: 15 });
  assert.equal(r.status, 200);
  assert.deepEqual(escrito.map((x) => [x.metodo, x.body.valor?.minimo ?? x.body.minimo ?? x.body.valor]), [["POST", 12.6], ["PATCH", 15]]);
  assert.equal(escrito[0].body.empresa_id, E);
  assert.match(escrito[1].url, new RegExp(`empresa_id=eq\\.${E}&clave=eq\\.costos_margen`));
});

test("💲 Costo por OT — margen de cada OT, aviso de las bajas, por cliente y cambiar el mínimo", async () => {
  const filas = [fila("7961", "RIOFRIO", "MADERA", 1000000, 950000), fila("7942", "CEVT", "MADERA", 2000000, 1500000)];
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    if (opts.method === "POST") {
      enviados.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ ok: true, margen_minimo: 30 }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, filas, margen_minimo: 10 }), { status: 200 });
  };
  render(<ToastProvider><CostoOtTab fechaDesde="2026-11-01" fechaHasta="2026-11-30" /></ToastProvider>);
  await screen.findByText(/1 OT tiene el margen por debajo del mínimo de 10 %/);
  assert.ok(screen.getByText(/⚠ Margen 5 % · ganancia/));
  assert.ok(screen.getByText(/^Margen 25 % · ganancia/));
  fireEvent.click(screen.getByText("Solo bajo el mínimo"));
  assert.equal(screen.queryByText(/^Margen 25 %/), null);
  fireEvent.click(screen.getByText("Por cliente"));
  const lista = screen.getByRole("list", { name: "Margen por cliente" });
  assert.match(lista.textContent, /RIOFRIO.*5 %.*CEVT.*25 %/);
  fireEvent.change(screen.getByLabelText("Margen mínimo"), { target: { value: "30" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.deepEqual(enviados, [{ accion: "margen_minimo", minimo: 30 }]));
  await screen.findByText(/2 OT tienen el margen por debajo del mínimo de 30 %/);
});

test("💲 Costo previsto y real — precio, ganancia y margen; bajo el mínimo en rojo; sin precio lo dice", async () => {
  const comparativa = costoPrevistoReal({ materiales: { total: 900000, sinPrecio: 0 }, costoHora: 5000, horas: null });
  const respuesta = (extra) => async () => new Response(JSON.stringify({ ok: true, ...comparativa, fuera: [], compras: [], gastos: [], margen_minimo: 10, ...extra }), { status: 200 });
  global.fetch = respuesta({ precio: 1000000, margen: margen({ precio: 1000000, costo: 950000 }), margen_previsto: margen({ precio: 1000000, costo: 900000 }) });
  render(<CostoRealOt ot="M-1" />);
  const alerta = await screen.findByRole("alert");
  assert.match(alerta.textContent, /Precio sin IVA.*\$.*1\.000\.000.*Ganancia.*50\.000.*Margen5 %/);
  assert.match(alerta.textContent, /Por debajo del mínimo de 10 % · con el costo previsto era 10 %/);
  cleanup();
  global.fetch = respuesta({ precio: null, margen: null, margen_previsto: null });
  render(<CostoRealOt ot="M-2" />);
  await screen.findByText(/Sin PRECIO en el Plan de trabajo/);
});

test("Resultados — con el costo real, cada entrega lleva los materiales de su OT; las demás, el %", async () => {
  const { estadoResultados, configResultados } = await import("../app/lib/finanzasResultados.js");
  const cuentas = [
    { codigo: "ENT", nombre: "Entregas", linea_eerr: "ING_ENT" },
    { codigo: "DEU", nombre: "Deudores", rubro: "ACTIVO CORRIENTE" },
  ];
  const op = (fecha, pid, neto) => ({ id: Math.random(), fecha, cuenta_debe: "DEU", cuenta_haber: "ENT", neto, total: neto, total_ars: neto, proyecto_id: pid });
  const ops = [op("2026-09-10", 1, 600000), op("2026-10-10", 1, 400000), op("2026-10-12", 2, 500000), op("2026-10-15", null, 100000)];
  const mat = (r) => r.filas.filter((f) => f.tipo !== "pct" && /Costo de materiales/.test(f.nombre || ""));
  // Sin costo real: el 40 % de todo
  const antes = estadoResultados({ ops, cuentas, hasta: "2026-10", materialesPct: 40 });
  assert.deepEqual(mat(antes).map((f) => [f.nombre, f.valores.slice(-2)]), [["Costo de materiales (estimado 40 % de las entregas)", [240000, 400000]]]);
  // La OT 1 costó 300.000 de materiales (se reparte 60/40 entre sus dos entregas); la 2 no tiene materiales en Gypi
  const r = estadoResultados({ ops, cuentas, hasta: "2026-10", materialesPct: 40, materialesOt: new Map([[1, 300000], [2, 0]]) });
  assert.deepEqual(mat(r).map((f) => [f.nombre, f.valores.slice(-2)]), [
    ["Costo de materiales (real de cada OT entregada)", [180000, 120000]],
    ["Costo de materiales (estimado 40 % de las entregas sin costo en Gypi)", [0, 240000]],
  ]);
  assert.equal(configResultados({ materiales_real: true }).materiales_real, true);
  assert.equal(configResultados({ materiales_real: "si" }).materiales_real, undefined);
});
