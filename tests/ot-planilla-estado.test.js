// tests/ot-planilla-estado.test.js — Órdenes de Producción, parte 1 (ítem 39)
// La planilla no reabre las OT cerradas en la app, y trae fecha de entrega,
// cantidad y TERMINADO.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { parseCsvProyectos, fechaPlanilla } from "../app/lib/csvProyectos.js";

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const CSV_URL = "https://files.example.com/ot.csv";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const PLANILLA = [
  "OT,DIVISIÓN,PROYECTO / OBRA,CLIENTE ,OBRA,DESCRIPCION,CANT,PPTO,ENTREGA,SEMANA,TERMINADO",
  "M-7100,MUEBLES,7100,BCG,HOTEL,P1 - PUERTA,107,,1/05/2026,6,SI",
  "M-7100,MUEBLES,7100,BCG,HOTEL,P3 - PUERTA,17,,15/06/2026,8,",
  "M-7495,MUEBLES,7495,SICILIANO,CASA,MUEBLE TV,1,,1/05/26,6,SI",
  "A-200,ALUMINIO,200,LUIS,LOCAL,VENTANA,\"2,5\",,sin fecha,,no",
].join("\n");

test("fechaPlanilla — día/mes/año de la planilla", () => {
  assert.equal(fechaPlanilla("1/05/2026"), "2026-05-01");
  assert.equal(fechaPlanilla("1/5/26"), "2026-05-01");
  assert.equal(fechaPlanilla("2026-05-01"), "2026-05-01");
  assert.equal(fechaPlanilla("31/02/2026"), null);
  assert.equal(fechaPlanilla("a confirmar"), null);
  assert.equal(fechaPlanilla(""), null);
});

test("planilla — fecha más tardía, cantidad sumada y terminada solo si todos sus ítems dicen SI", () => {
  const { filas } = parseCsvProyectos(PLANILLA);
  const ot = (n) => filas.find((f) => f.ot === n);
  assert.equal(ot("M-7100").fecha_entrega, "2026-06-15");
  assert.equal(ot("M-7100").cantidad, 124);
  assert.equal(ot("M-7100").terminado_planilla, false);
  assert.equal(ot("M-7495").fecha_entrega, "2026-05-01");
  assert.equal(ot("M-7495").terminado_planilla, true);
  assert.equal(ot("A-200").fecha_entrega, null);
  assert.equal(ot("A-200").cantidad, 2.5);
  assert.equal(ot("A-200").terminado_planilla, false);
});

test("planilla sin columna TERMINADO — queda sin dato, no como 'no terminada'", () => {
  const { filas } = parseCsvProyectos("OT,CLIENTE\nM-1,Ana\n");
  assert.equal(filas[0].terminado_planilla, null);
  assert.equal(filas[0].fecha_entrega, null);
  assert.equal(filas[0].cantidad, null);
});

async function sincronizar(handlerUpsert) {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: CSV_URL } }] }) },
    { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: PLANILLA }) },
    {
      match: (u) => u.includes("/rest/v1/proyectos?"),
      respond: (u, o) => {
        pedidos.push({ url: u, method: o.method, body: JSON.parse(o.body) });
        return o.method === "POST" && handlerUpsert ? handlerUpsert(JSON.parse(o.body)) : { status: 200, body: null };
      },
    },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
  ]);
  const { signAccessToken } = await import("../app/lib/jwt.ts");
  const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  const res = await POST(new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
  return { json: await res.json(), pedidos };
}

test("sync — no manda el estado, así una OT cerrada en la app sigue cerrada", async () => {
  const { json, pedidos } = await sincronizar();
  assert.equal(json.procesados, 3);
  assert.deepEqual(json.errores, []);
  const subidas = pedidos.filter((p) => p.method === "POST").flatMap((p) => p.body);
  assert.ok(subidas.every((r) => !("estado" in r)), "el upsert no toca el estado");
  const m7100 = subidas.find((r) => r.ot === "M-7100");
  assert.equal(m7100.fecha_entrega, "2026-06-15");
  assert.equal(m7100.cantidad, 124);
  assert.equal(m7100.terminado_planilla, false);
  // Las OT nuevas (sin estado) quedan activas, sin tocar las demás
  const activar = pedidos.find((p) => p.method === "PATCH");
  assert.ok(activar.url.includes(`empresa_id=eq.${EMPRESA_ID}`));
  assert.ok(activar.url.includes("estado=is.null"));
  assert.deepEqual(activar.body, { estado: "activo" });
});

test("sync — sin la migración 097 en la base igual sincroniza", async () => {
  const NUEVAS = ["fecha_entrega", "cantidad", "terminado_planilla"];
  const { json, pedidos } = await sincronizar((lote) => {
    const falta = NUEVAS.find((c) => c in lote[0]);
    return falta
      ? { status: 400, body: { code: "PGRST204", message: `Could not find the '${falta}' column of 'proyectos' in the schema cache` } }
      : { status: 200, body: null };
  });
  assert.equal(json.procesados, 3);
  assert.deepEqual(json.errores, []);
  const ultimo = pedidos.filter((p) => p.method === "POST").at(-1).body;
  assert.equal(ultimo[0].descripcion, "P1 - PUERTA / P3 - PUERTA");
  for (const c of NUEVAS) assert.ok(!(c in ultimo[0]));
});

test("lista de OT — muestra la fecha de entrega como día/mes/año", async () => {
  const { fechaCorta } = await import("../app/lib/ot.js");
  assert.equal(fechaCorta("2026-05-01"), "1/5/2026");
  assert.equal(fechaCorta("2026-12-31"), "31/12/2026");
});
