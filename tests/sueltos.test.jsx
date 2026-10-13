// tests/sueltos.test.jsx — Órdenes de Producción, parte 9 (ítem 39): hoja de
// sueltos y herrajes de cada OT, pegada desde Excel y tildada en acopio y carga.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { parsearPegado, filasTsv, leerCantidad, tipoNormal, resumenSueltos, nombreSuelto } from "../app/lib/sueltos.js";
import { sueltosBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: SueltosOt } = await import("../app/components/SueltosOt.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/sueltos/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// La hoja SUELTOS del mapa de procesos (OT 7038), copiada de Excel
const HOJA = [
  "Tipo\tCódigo\tDescripción\tMedida\tCant.\tVa con\tAcopio ✓\tCarga ✓",
  "Madera\tAJ.1\tAjuste grafito\t810 × 70\t1\tZona alacenas\t\t",
  "madera\tZOC.T1\tZócalo tapa 18 mm\t1654 × 71\t2\tIsla\t\t",
  "Perfil\t1\tJ mini aluminio\t2087\t1\t1.GB2P + GBHOR + 1.GB3C\t\t",
  "Herraje\t—\tPiso aluminio bajo bacha 1000 mm\t—\t1\t2.GB2P\t\t",
].join("\r\n");

// ─── Lo pegado desde Excel ───

test("pegar — con títulos: columnas por nombre, sin Acopio ni Carga, tipos y guiones", () => {
  const { items, errores, conTitulos } = parsearPegado(HOJA);
  assert.equal(conTitulos, true);
  assert.equal(errores.length, 0);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], { tipo: "Madera", codigo: "AJ.1", descripcion: "Ajuste grafito", medida: "810 × 70", cantidad: 1, va_con: "Zona alacenas" });
  assert.equal(items[1].tipo, "Madera", "el tipo se escribe como en la lista");
  assert.equal(items[1].cantidad, 2);
  assert.equal(items[3].codigo, null, "un guion es vacío");
  assert.equal(items[3].medida, null);
});

test("pegar — títulos en otro orden y sin títulos (orden de la hoja SUELTOS)", () => {
  const otroOrden = parsearPegado("Descripción\tCant\tCódigo\nBisagra cierre suave\t12\tB1");
  assert.deepEqual(otroOrden.items[0], { tipo: null, codigo: "B1", descripcion: "Bisagra cierre suave", medida: null, cantidad: 12, va_con: null });
  const sinTitulos = parsearPegado("Herraje\tM1\tManija barral\t160 mm\t1,5\tCocina\n\n");
  assert.equal(sinTitulos.conTitulos, false);
  assert.deepEqual(sinTitulos.items[0], { tipo: "Herraje", codigo: "M1", descripcion: "Manija barral", medida: "160 mm", cantidad: 1.5, va_con: "Cocina" });
  const unaColumna = parsearPegado("Tornillos de instalación\nTarugos 8 mm");
  assert.deepEqual(unaColumna.items.map((i) => [i.descripcion, i.cantidad]), [["Tornillos de instalación", 1], ["Tarugos 8 mm", 1]]);
});

test("pegar — filas sin código ni descripción o con cantidad rara no se agregan", () => {
  const { items, errores } = parsearPegado("Madera\t\t\t\t2\tIsla\nMadera\tAJ.2\tAjuste\t\tmuchos\t\nHerraje\tB1\tBisagra\t\t0\t");
  assert.equal(items.length, 0);
  assert.deepEqual(errores.map((e) => e.fila), [1, 2, 3]);
  assert.match(errores[0].motivo, /código ni descripción/);
  assert.match(errores[1].motivo, /muchos/);
});

test("pegar — celdas entre comillas con saltos de línea, como las copia Excel", () => {
  assert.deepEqual(filasTsv('a\t"línea 1\nlínea 2"\t"dice ""hola"""\nb\tc'), [["a", "línea 1\nlínea 2", 'dice "hola"'], ["b", "c"]]);
  const { items } = parsearPegado('Herraje\tL1\t"Tira LED\n3000K"\t\t2\t');
  assert.equal(items[0].descripcion, "Tira LED 3000K");
});

test("pegar — cantidades, tipos y resumen", () => {
  assert.equal(leerCantidad(""), 1);
  assert.equal(leerCantidad("2 u"), 2);
  assert.equal(leerCantidad("1,25"), 1.25);
  assert.equal(leerCantidad("1.234,5"), 1234.5);
  assert.equal(leerCantidad("-3"), null);
  assert.equal(tipoNormal("HERRAJE"), "Herraje");
  assert.equal(tipoNormal("Vidrio"), "Vidrio");
  assert.deepEqual(resumenSueltos([{ acopio: true, carga: true }, { acopio: true }, {}]), { total: 3, acopio: 2, carga: 1 });
  assert.equal(nombreSuelto({ codigo: "AJ.1", descripcion: "Ajuste" }), "AJ.1 · Ajuste");
  assert.equal(nombreSuelto({ descripcion: "Tarugos" }), "Tarugos");
});

test("esquema y permisos — ítems con código o descripción; la tabla solo se lee por /api/data", () => {
  assert.ok(sueltosBody.safeParse({ accion: "agregar", ot: "7038", items: [{ descripcion: "Tarugos" }] }).success);
  assert.ok(!sueltosBody.safeParse({ accion: "agregar", ot: "7038", items: [{ tipo: "Madera", cantidad: 2 }] }).success);
  assert.ok(!sueltosBody.safeParse({ accion: "agregar", ot: "7038", items: [] }).success);
  assert.ok(!sueltosBody.safeParse({ accion: "tildar", id: 1, columna: "otra", valor: true }).success);
  assert.ok(!sueltosBody.safeParse({ accion: "agregar", ot: "7038", items: [{ descripcion: "x", empresa_id: E }] }).success);
  assert.equal(autorizar("sueltos_ot", "GET", { rol: "operativo" }).ok, true);
  for (const m of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar("sueltos_ot", m, { rol: "gerencial" }).ok, false, m);
});

test("migración 103 — tabla de sueltos con RLS por empresa", () => {
  const sql = readFileSync(new URL("../supabase/migrations/103_sueltos_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.sueltos_ot/);
  assert.match(sql, /cantidad\s+numeric\(10, 2\) not null default 1 check \(cantidad > 0 and cantidad <= 99999\)/);
  assert.match(sql, /check \(codigo is not null or descripcion is not null\)/);
  assert.match(sql, /alter table public\.sueltos_ot enable row level security/);
  assert.match(sql, /using \(empresa_id = \(current_setting\('request\.jwt\.claims', true\)::json->>'eid'\)::uuid\)/);
  assert.match(sql, /grant select, insert, update, delete on public\.sueltos_ot to authenticated/);
  assert.match(sql, /grant usage, select on sequence public\.sueltos_ot_id_seq to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function req(body, t) {
  return new Request("http://localhost/api/sueltos", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  });
}

function mock({ existe = true, ultimoOrden = null, falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: existe ? [{ id: 1, ot: "7038" }] : [] }) },
    {
      match: (u, o) => u.includes("/rest/v1/sueltos_ot") && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (falla) return { status: 404, body: { message: falla } };
        if (u.includes("order=orden.desc")) return { status: 200, body: ultimoOrden == null ? [] : [{ orden: ultimoOrden }] };
        return { status: 200, body: [{ id: 5 }] };
      },
    },
    {
      match: (u, o) => u.includes("/rest/v1/sueltos_ot") && ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        if (falla) return { status: 404, body: { message: falla } };
        const body = o.body ? JSON.parse(o.body) : null;
        escrito.push({ metodo: o.method, url: u, body });
        return { status: 200, body: Array.isArray(body) ? body : body ? [body] : [] };
      },
    },
  ]);
  return escrito;
}

test("/api/sueltos — técnica agrega lo pegado, después de lo que ya había", async () => {
  const escrito = mock({ ultimoOrden: 3 });
  const { items } = parsearPegado(HOJA);
  const res = await api.POST(req({ accion: "agregar", ot: "7038", items }, await token("administrativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "POST");
  assert.equal(escrito[0].body.length, 4);
  assert.deepEqual(escrito[0].body.map((f) => f.orden), [4, 5, 6, 7]);
  assert.ok(escrito[0].body.every((f) => f.empresa_id === E && f.ot === "7038" && f.creado_por === EMP));
  const claves = escrito[0].body.map((f) => Object.keys(f).sort().join());
  assert.equal(new Set(claves).size, 1, "mismas claves en todas las filas del lote");
  assert.equal(escrito[0].body[3].codigo, null);
});

test("/api/sueltos — el operario solo tilda; cargar, sacar y vaciar son de gestión", async () => {
  let escrito = mock();
  for (const body of [{ accion: "agregar", ot: "7038", items: [{ descripcion: "x" }] }, { accion: "borrar", id: 5 }, { accion: "vaciar", ot: "7038" }]) {
    const res = await api.POST(req(body, await token("operativo")));
    assert.equal(res.status, 403, body.accion);
  }
  assert.equal(escrito.length, 0);

  let res = await api.POST(req({ accion: "tildar", id: 5, columna: "acopio", valor: true }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, new RegExp(`id=eq\\.5&empresa_id=eq\\.${E}`));
  assert.equal(escrito[0].body.acopio, true);
  assert.equal(escrito[0].body.acopio_por, EMP);
  assert.ok(escrito[0].body.acopio_at);

  escrito = mock();
  res = await api.POST(req({ accion: "tildar", id: 5, columna: "carga", valor: false }, await token("operativo")));
  assert.deepEqual(escrito[0].body, { carga: false, carga_por: null, carga_at: null });

  escrito = mock();
  res = await api.POST(req({ accion: "vaciar", ot: "7038" }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "DELETE");
  assert.match(escrito[0].url, new RegExp(`empresa_id=eq\\.${E}&ot=eq\\.7038`));
});

test("/api/sueltos — OT que no existe y falta de la migración 103", async () => {
  let escrito = mock({ existe: false });
  let res = await api.POST(req({ accion: "agregar", ot: "9999", items: [{ descripcion: "x" }] }, await token("gerencial")));
  assert.equal(res.status, 404);
  assert.equal(escrito.length, 0);

  mock({ falla: 'relation "public.sueltos_ot" does not exist' });
  res = await api.POST(req({ accion: "agregar", ot: "7038", items: [{ descripcion: "x" }] }, await token("gerencial")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 103/);
});

// ─── Pantalla ───

function mockPantalla(filas = []) {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/sueltos")) {
      const body = JSON.parse(opts.body);
      pedidos.push(body);
      if (body.accion === "agregar") return new Response(JSON.stringify({ ok: true, sueltos: body.items.map((i, n) => ({ ...i, id: 100 + n, acopio: false, carga: false })) }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, suelto: { id: body.id, [body.columna]: body.valor } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: filas }), { status: 200 });
  };
  return pedidos;
}

const PROYECTO = { ot: "7038", cliente: "Depto 05" };

test("pantalla — técnica pega desde Excel, revisa la tabla y agrega", async () => {
  const pedidos = mockPantalla([]);
  render(<SueltosOt proyecto={PROYECTO} empresaId={E} esGestion onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Esta OT todavía no tiene sueltos cargados.")));
  fireEvent.click(screen.getByText("📋 Pegar desde Excel"));
  fireEvent.change(screen.getByRole("textbox", { name: "Pegar desde Excel" }), { target: { value: `${HOJA}\nMadera\t\t\t\t1\t` } });
  assert.ok(screen.getByText("4 ítems para agregar (con títulos)"));
  assert.ok(screen.getByText("J mini aluminio"));
  assert.ok(screen.getByText(/Fila 6: No tiene código ni descripción/));
  fireEvent.click(screen.getByText("Agregar 4"));
  await waitFor(() => assert.ok(screen.getByText("AJ.1 · Ajuste grafito")));
  assert.equal(pedidos[0].accion, "agregar");
  assert.equal(pedidos[0].items.length, 4);
  assert.ok(screen.getByText("4 ítems · Acopio 0 de 4 · Carga 0 de 4"));
});

test("pantalla — en acopio se tilda; el operario no ve cómo cargar ni sacar", async () => {
  const pedidos = mockPantalla([{ id: 7, codigo: "ZOC.T1", descripcion: "Zócalo", cantidad: 2, tipo: "Madera", va_con: "Isla", acopio: false, carga: false }]);
  render(<SueltosOt proyecto={PROYECTO} empresaId={E} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("ZOC.T1 · Zócalo")));
  assert.ok(screen.getByText("Madera · Cant. 2 · Va con Isla"));
  assert.equal(screen.queryAllByText("📋 Pegar desde Excel").length, 0);
  assert.equal(screen.queryAllByLabelText(/Sacar/).length, 0);
  const acopio = screen.getByLabelText("Acopio ZOC.T1 · Zócalo");
  assert.equal(acopio.getAttribute("aria-pressed"), "false");
  fireEvent.click(acopio);
  await waitFor(() => assert.equal(screen.getByLabelText("Acopio ZOC.T1 · Zócalo").getAttribute("aria-pressed"), "true"));
  assert.deepEqual(pedidos[0], { accion: "tildar", id: 7, columna: "acopio", valor: true });
  assert.ok(screen.getByText("1 ítem · Acopio 1 de 1 · Carga 0 de 1"));
});

test("pantalla — agregar uno a mano", async () => {
  const pedidos = mockPantalla([]);
  render(<SueltosOt proyecto={PROYECTO} empresaId={E} esGestion onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("＋ Agregar uno")));
  fireEvent.click(screen.getByText("＋ Agregar uno"));
  fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: "Caja de herrajes de instalación" } });
  fireEvent.change(screen.getByLabelText("Cant."), { target: { value: "1,5" } });
  fireEvent.click(screen.getByText("Agregar"));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual(pedidos[0].items, [{ tipo: null, codigo: null, descripcion: "Caja de herrajes de instalación", medida: null, cantidad: 1.5, va_con: null }]);
});
