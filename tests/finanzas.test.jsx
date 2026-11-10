// tests/finanzas.test.jsx — Finanzas, parte F1a (migración 171): copiar la
// configuración del libro contable (plan de cuentas, tipos de operación,
// cajas y bancos, centros de costo), cuentas sugeridas para los tipos que no
// tienen, y que solo el rol Dueño entre (ni el Supervisor).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  cuentasDeHoja, tiposDeHoja, tesoreriaDeHoja, centrosDeHoja, sugerirCuentas, leerLibro, limpiarFilas, limpiarFila, esDuenoFinanzas, tipoTesoreria,
} from "../app/lib/finanzas.js";
import { opcionesBoton, conBoton, seccionesMas } from "../app/lib/menuGestion.js";
import { modulosEfectivos } from "../app/lib/modulos.js";
import { gruposMenu } from "../app/components/nav/MenuLateral.jsx";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/route.js");
const { default: FinanzasConfig } = await import("../app/components/FinanzasConfig.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// Hojas del libro como las devuelve leerXlsx (texto por celda)
const PLAN = [
  ["codigo", "nombre", "tipo", "rubro", "imputable", "naturaleza"],
  ["01.01.01.001.001.01", "Caja Principal", "", "ACTIVO CORRIENTE", "", "D"],
  ["01.01.01.003.002", "Banco Credicoop CTA CTE", "", "ACTIVO CORRIENTE"],
  ["01.01.04.001.002", "Materias Primas", "", "ACTIVO CORRIENTE"],
  ["02.01.02.001.001", "Proveedores", "", "PASIVO CORRIENTE", "", "H"],
  ["03.01.01.002.001", "Ajuste De Capital", "", "PATRIMONIO NETO"],
  ["04.02.01.001.062", "Viáticos", "", "RESULTADO"],
  ["04.02.01.001.062", "Viáticos repetido", "", "RESULTADO"],
  ["", ""],
  ["Caja", "sin código"],
];
const TIPOS = [
  ["cod_tipo_op", "nombre", "grupo", "base_contable", "subcuenta_debe_default", "nombre_debe", "subcuenta_haber_default", "nombre_haber", "requiere_entidad", "requiere_proyecto", "afecta_cc", "descripcion_uso"],
  ["COMPRA MP", "Compra de materia prima", "COMPRAS", "DEVENGADO", "01.01.04.001.002", "Materias Primas", "02.01.02.001.001", "Proveedores", "SI", "NO", "SI", "Factura de proveedor"],
  ["PAGO VIATICOS"],
  ["PAGO EFECTIVO A PROVEEDORES M.P"],
  ["VENTA IVA", "", "", "", "01.01.02.001.001", "", "09.09.09.999.999"],
  ["PAGO VIATICOS "],
];
const TESORERIA = [
  ["cuenta", "nombre", "grupo", "moneda", "activa"],
  ["01.01.01.001.001.01", "Caja Principal", "CAJA", "ARS", "SI"],
  ["01.01.01.003.002", "Banco Credicoop CTA CTE", "BANCO", "ARS", "SI"],
  ["01.01.01.008.001", "USD Físico en caja", "CAJA USD", "USD", "SI"],
  ["01.01.01.006.001", "Plazo Fijo Credicoop", "PLAZO FIJO", "ARS", "NO"],
];
const CC = [
  ["id", "codigo_cc", "nombre", "division", "tipo", "cuenta_eerr", "activo"],
  ["1", "MADERA", "Fabricación Madera", "MADERA", "PRODUCCION", "04.02.01.007.001", "SI"],
  ["2", "HIERRO", "Herrería", "HIERRO", "PRODUCCION", "", "SI"],
];
const OPS = [
  ["C", "mes_cierre", "fecha_operación", "usuario", "cod_tipo_op", "id_entidad", "id_proyecto", "centro_costo", "banco_caja", "importe_neto", "Impuestos", "Total", "moneda", "cuenta_debe_override", "cuenta_haber_override", "nombre_debe_auto", "nombre_haber_auto", "descripcion", "referencia_externa", "estado", "cuenta_debe_final", "cuenta_haber_final"],
  // Pago a proveedores: 2 desde el banco, 3 contra Ajuste De Capital (no cuentan)
  ...[1, 2].map(() => ["", "", "", "Tadeo", "PAGO EFECTIVO A PROVEEDORES M.P", "ACERCO", "", "", "", "100", "", "100", "ARS", "", "", "", "", "", "", "CONFIRMADO", "02.01.02.001.001", "01.01.01.003.002"]),
  ...[1, 2, 3].map(() => ["", "", "", "Tadeo", "PAGO EFECTIVO A PROVEEDORES M.P", "ACERCO", "", "", "", "100", "", "100", "ARS", "", "", "", "", "", "", "CONFIRMADO", "02.01.02.001.001", "03.01.01.002.001"]),
  ["", "", "", "Tadeo", "PAGO VIATICOS", "", "", "", "", "50", "", "50", "ARS", "", "", "", "", "", "", "CONFIRMADO", "04.02.01.001.062", "01.01.01.001.001.01"],
  // Un tipo que ya tiene cuentas no lleva sugerencia
  ["", "", "", "Tadeo", "COMPRA MP", "ACERCO", "", "", "", "100", "21", "121", "ARS", "", "", "", "", "", "", "CONFIRMADO", "01.01.04.001.002", "03.01.01.002.001"],
];

test("plan de cuentas — códigos válidos, repetidos y nombres que el libro buscaría mal", () => {
  const r = cuentasDeHoja(PLAN);
  assert.deepEqual(r.filas.map((c) => c.codigo), ["01.01.01.001.001.01", "01.01.01.003.002", "01.01.04.001.002", "02.01.02.001.001", "03.01.01.002.001", "04.02.01.001.062"]);
  assert.equal(r.filas[0].naturaleza, "D");
  assert.equal(r.filas[1].naturaleza, null);
  assert.ok(r.avisos.some((a) => /04\.02\.01\.001\.062 está dos veces/.test(a)));
  assert.ok(r.avisos.some((a) => /el código "Caja" no es un código/.test(a)), r.avisos.join("\n"));
});

test("tipos de operación — SI/NO, cuentas que no existen quedan vacías, repetidos una vez", () => {
  const codigos = new Set(cuentasDeHoja(PLAN).filas.map((c) => c.codigo));
  const r = tiposDeHoja(TIPOS, codigos);
  assert.deepEqual(r.filas.map((t) => t.codigo), ["COMPRA MP", "PAGO VIATICOS", "PAGO EFECTIVO A PROVEEDORES M.P", "VENTA IVA"]);
  const compra = r.filas[0];
  assert.deepEqual([compra.cuenta_debe, compra.cuenta_haber, compra.pide_entidad, compra.pide_ot, compra.pide_cc], ["01.01.04.001.002", "02.01.02.001.001", true, false, true]);
  const venta = r.filas.find((t) => t.codigo === "VENTA IVA");
  assert.equal(venta.cuenta_debe, null, "01.01.02.001.001 no está en este plan");
  assert.ok(r.avisos.some((a) => /PAGO VIATICOS está dos veces/.test(a)));
  assert.ok(r.avisos.some((a) => /VENTA IVA: la cuenta del haber 09\.09/.test(a)));
});

test("cajas y bancos y centros de costo — tipo, moneda y activa", () => {
  assert.equal(tipoTesoreria("CAJA USD"), "caja");
  assert.equal(tipoTesoreria("PLAZO FIJO USD"), "plazo_fijo");
  assert.equal(tipoTesoreria("FCI"), "fci");
  const t = tesoreriaDeHoja(TESORERIA).filas;
  assert.deepEqual(t.map((x) => [x.tipo, x.moneda, x.activa]), [["caja", "ARS", true], ["banco", "ARS", true], ["caja", "USD", true], ["plazo_fijo", "ARS", false]]);
  const c = centrosDeHoja(CC).filas;
  assert.deepEqual(c.map((x) => [x.codigo, x.division]), [["MADERA", "MADERA"], ["HIERRO", "HIERRO"]]);
});

test("sugerencias — el par más usado, sin Ajuste De Capital, solo para los tipos sin cuentas", () => {
  const libro = leerLibro([
    { nombre: "dim_plan_cuentas", grilla: PLAN }, { nombre: "DIM_TIPOS_OP", grilla: TIPOS },
    { nombre: "dim_tesoreria", grilla: TESORERIA }, { nombre: "T-OPERACIONES", grilla: OPS },
  ]);
  assert.deepEqual(libro.faltan, ["dim_cc"]);
  const porTipo = Object.fromEntries(libro.sugerencias.map((s) => [s.codigo, s]));
  assert.deepEqual(Object.keys(porTipo).sort(), ["PAGO EFECTIVO A PROVEEDORES M.P", "PAGO VIATICOS"]);
  const pago = porTipo["PAGO EFECTIVO A PROVEEDORES M.P"];
  assert.deepEqual([pago.cuenta_debe, pago.cuenta_haber, pago.veces, pago.de], ["02.01.02.001.001", "01.01.01.003.002", 2, 5]);
  // Si no hay T-OPERACIONES no hay sugerencias, pero se copia lo demás
  assert.deepEqual(sugerirCuentas([], libro.tipos.filas), []);
});

test("libro de verdad (si está a mano) — se lee entero", async (t) => {
  const ruta = process.env.LIBRO_CONTABLE_XLSX;
  if (!ruta) { t.skip("sin LIBRO_CONTABLE_XLSX"); return; }
  const { hojasXlsx, leerHojaXlsx } = await import("../app/lib/leerXlsx.js");
  const bytes = new Uint8Array(readFileSync(ruta));
  const hojas = hojasXlsx(bytes).map((nombre) => ({ nombre, grilla: leerHojaXlsx(bytes, nombre, { maxFilas: 40000, maxCols: 30 }) }));
  const l = leerLibro(hojas);
  assert.ok(l.cuentas.filas.length > 500 && l.tipos.filas.length > 80 && l.sugerencias.length > 20);
});

test("el servidor valida — códigos, repetidos, límite y tabla", () => {
  assert.match(limpiarFila("cuentas", { codigo: "abc", nombre: "x" }).error, /no es un código/);
  assert.match(limpiarFila("tesoreria", { cuenta: "01.01", nombre: "" }).error, /no tiene nombre/);
  assert.equal(limpiarFila("tipos", { codigo: "X", cuenta_debe: "basura" }).fila.cuenta_debe, null);
  assert.equal(limpiarFila("tesoreria", { cuenta: "01.01", nombre: "Caja", tipo: "raro", moneda: "EUR" }).fila.tipo, "otro");
  assert.equal(limpiarFila("tesoreria", { cuenta: "01.01", nombre: "Caja", responsable_id: "no-uuid" }).fila.responsable_id, undefined);
  const r = limpiarFilas("centros", [{ codigo: "A" }, { codigo: "A", nombre: "otra" }, { codigo: "B" }]);
  assert.deepEqual(r.filas.map((f) => f.codigo), ["A", "B"]);
  assert.match(limpiarFilas("centros", []).error, /No hay filas/);
  assert.match(limpiarFilas("nada", [{}]).error, /Tabla/);
  assert.match(limpiarFilas("cuentas", [{ codigo: "01.01", nombre: "ok" }, { codigo: "x" }]).error, /^Fila 2/);
});

test("migración 171 — un bloque, RLS por empresa y solo gerencial, sin delete, módulo en el catálogo", () => {
  const sql = readFileSync(new URL("../supabase/migrations/171_finanzas_base.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  for (const t of ["fin_cuentas", "fin_tipos_operacion", "fin_tesoreria", "fin_centros_costo", "fin_operaciones"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`grant select, insert, update on public\\.${t} to authenticated`));
    assert.doesNotMatch(sql, new RegExp(`grant[^;]*delete[^;]*${t}`, "i"));
  }
  assert.equal((sql.match(/->>'rol'\) = 'gerencial'/g) || []).length, 10, "using y with check de las 5 tablas");
  assert.match(sql, /\('finanzas', 'Finanzas'/);
  assert.match(sql, /anulada_at/);
});

// ─── Quién lo ve ───

const empresa = { modulos: modulosEfectivos({ plan: "planta_40" }) };
const DUENO = { rol: "gerencial" };
const SUPERVISOR = { rol: "administrativo", solo_su_division: true };
const OFICINA = { rol: "administrativo" };

test("menú — Finanzas solo para el Dueño: ni el Supervisor ni la oficina", () => {
  assert.ok(empresa.modulos.includes("finanzas"), "viene con las OT");
  assert.equal(esDuenoFinanzas(DUENO), true);
  assert.equal(esDuenoFinanzas(SUPERVISOR), false);
  assert.deepEqual(opcionesBoton("finanzas", empresa, DUENO).map((o) => o.id), ["fin-movimientos", "fin-tesoreria", "fin-clientes", "fin-sueldos", "fin-proveedores", "fin-pagos", "fin-cheques", "fin-resultados", "fin-flujo", "fin-reporte", "fin-cierre", "fin-config"]);
  for (const u of [SUPERVISOR, OFICINA, null]) {
    assert.equal(conBoton("finanzas", empresa, u), false);
    assert.ok(!seccionesMas({ empresa, usuario: u }).some((s) => s.id === "finanzas"));
    assert.ok(!gruposMenu(empresa, u).some((g) => g.id === "finanzas"));
  }
  // Desde el 10/11 va en la barra de abajo, no en Más
  assert.equal(conBoton("finanzas", empresa, DUENO), true);
  assert.ok(!seccionesMas({ empresa, usuario: DUENO }).some((s) => s.id === "finanzas"));
  assert.ok(gruposMenu(empresa, DUENO).some((g) => g.id === "finanzas"));
  // Apagado en Más → Módulos: no se ve ni para el Dueño
  const apagada = { ...empresa, modulos_apagados: ["finanzas"] };
  assert.equal(conBoton("finanzas", apagada, DUENO), false);
  assert.ok(!seccionesMas({ empresa: apagada, usuario: DUENO }).some((s) => s.id === "finanzas"));
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body) => api[metodo](new Request("http://localhost/api/finanzas", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ falta = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Ana" }] }) },
    {
      match: (u) => /\/rest\/v1\/fin_/.test(u),
      respond: (u, o) => {
        if (falta) return { status: 404, body: { code: "42P01", message: 'relation "public.fin_cuentas" does not exist' } };
        if (o?.method === "POST") { escrito.push({ url: u, body: JSON.parse(o.body), prefer: o.headers?.Prefer }); return { status: 201 }; }
        if (u.includes("fin_cuentas")) return { status: 200, body: [{ codigo: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", activa: true }] };
        return { status: 200, body: [] };
      },
    },
  ]);
  return escrito;
}

test("/api/finanzas — la oficina y el operario no entran; el Supervisor tampoco", async () => {
  const escrito = mockApi();
  for (const rol of ["administrativo", "operativo"]) {
    assert.equal((await pedir(rol, "GET")).status, 403, rol);
    assert.equal((await pedir(rol, "POST", { accion: "importar", tabla: "cuentas", filas: [{ codigo: "01.01", nombre: "x" }] })).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
});

test("/api/finanzas — el Dueño ve la configuración", async () => {
  mockApi();
  const res = await pedir("gerencial", "GET");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(Object.keys(d).sort(), ["centros", "cuentas", "personal", "tesoreria", "tipos"]);
  assert.equal(d.cuentas[0].nombre, "Banco Credicoop CTA CTE");
});

test("/api/finanzas — importar hace alta o reemplazo por código, en la tabla de la empresa", async () => {
  const escrito = mockApi();
  const res = await pedir("gerencial", "POST", { accion: "importar", tabla: "tipos", filas: [
    { codigo: "COMPRA MP", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", pide_entidad: true },
    { codigo: "COMPRA MP", nombre: "repetido" },
  ] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, copiadas: 1 });
  assert.match(escrito[0].url, /fin_tipos_operacion\?on_conflict=empresa_id,codigo$/);
  assert.match(escrito[0].prefer, /resolution=merge-duplicates/);
  assert.equal(escrito[0].body[0].empresa_id, E);
  assert.equal(escrito[0].body[0].pide_entidad, true);

  assert.equal((await pedir("gerencial", "POST", { accion: "importar", tabla: "cuentas", filas: [{ codigo: "mal" }] })).status, 400);
  assert.equal((await pedir("gerencial", "POST", { accion: "borrar", tabla: "cuentas" })).status, 400);
});

test("/api/finanzas — guardar una caja con su responsable", async () => {
  const escrito = mockApi();
  const res = await pedir("gerencial", "POST", { accion: "guardar", tabla: "tesoreria", fila: { cuenta: "01.01.01.001.001.05", nombre: "Caja Manuel", tipo: "caja", moneda: "ARS", responsable_id: EMP, activa: true } });
  assert.equal(res.status, 200);
  assert.match(escrito[0].url, /fin_tesoreria\?on_conflict=empresa_id,cuenta$/);
  assert.equal(escrito[0].body[0].responsable_id, EMP);
});

test("/api/finanzas — sin la migración avisa cuál correr", async () => {
  mockApi({ falta: true });
  const res = await pedir("gerencial", "GET");
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 171/);
});

// ─── Pantalla ───

test("Configuración — sin nada copiado muestra cómo subir el libro; con datos, la lista", async () => {
  let datos = { cuentas: [], tipos: [], tesoreria: [], centros: [], personal: [] };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasConfig />);
  await waitFor(() => assert.ok(screen.getByLabelText("Subir el libro contable")));
  assert.ok(screen.getByText(/Archivo → Descargar → Microsoft Excel/));
  assert.equal(screen.queryByLabelText("Buscar"), null);
  cleanup();

  datos = {
    cuentas: [{ codigo: "02.01.02.001.001", nombre: "Proveedores" }],
    tipos: [{ codigo: "COMPRA MP", cuenta_debe: null, cuenta_haber: "02.01.02.001.001" }],
    tesoreria: [], centros: [], personal: [],
  };
  render(<FinanzasConfig />);
  await waitFor(() => assert.ok(screen.getByText("Proveedores")));
  screen.getByRole("button", { name: /Tipos de operación \(1\)/ }).click();
  await waitFor(() => assert.ok(screen.getByText("Sin cuentas por defecto")));
  assert.ok(screen.getByText(/Haber: 02\.01\.02\.001\.001 · Proveedores/));
});
