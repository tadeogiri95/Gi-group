// tests/destinos-piezas.test.js — 📍 Destinos de una OT (Tadeo, 07/11;
// app/lib/destinosPiezas.js, migración 163): qué módulo se arma, qué pieza sin
// módulo va dentro de cuál o suelta, y qué herraje va suelto.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { armarDestinos, modulosACorregir, sueltosDeDestinos, textoDestinos, planBultos, moduloDeBulto, ARMADO, SUELTAS } from "../app/lib/destinosPiezas.js";
import { componentesPlanilla, esPlaca } from "../app/lib/sueltosPlanilla.js";
import { piezasBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

// Una fila por pieza física, como piezas_ot
const fila = (nombre, n = 1, extra = {}) => Array.from({ length: n }, () => ({ nombre, modulo: nombre.includes("-") ? nombre.split("-")[0] : null, material: "MELAMINA 18MM", l1: 500, l2: 300, ...extra }));
const PIEZAS = [
  ...fila("M1-11", 2), ...fila("M1-21"), ...fila("GB2P-11", 2),
  ...fila("AJ-1"), ...fila("AJ-2"),
  ...fila("ZOC1", 3), ...fila("TAPA"), ...fila("CENEFA"),
];

test("sin nada elegido: módulos armados por su código, piezas sin módulo sin definir", () => {
  const d = armarDestinos(PIEZAS, []);
  assert.deepEqual(d.modulos.map((m) => [m.modulo, m.destino, m.unidades]), [["AJ", ARMADO, 2], ["GB2P", ARMADO, 2], ["M1", ARMADO, 3]]);
  assert.deepEqual(d.sinModulo.map((p) => [p.nombre, p.destino, p.unidades]), [["CENEFA", null, 1], ["TAPA", null, 1], ["ZOC1", null, 3]]);
  assert.equal(d.sinDefinir, 3);
  assert.deepEqual(d.sueltas, []);
  assert.equal(textoDestinos(d), "3 módulos armados · 3 sin definir");
  assert.deepEqual(sueltosDeDestinos(PIEZAS, []), []);
});

test("módulo que va suelto, pieza a un módulo, pieza suelta, SUELTO de la planilla y herrajes", () => {
  const destinos = [
    { tipo: "modulo", clave: "AJ", suelto: true },
    { tipo: "pieza", clave: "ZOC1", modulo: "M1", suelto: null },
    { tipo: "pieza", clave: "TAPA", suelto: true },
    // La planilla marcó CENEFA y M1-21 como sueltas (columna SUELTO de DATOS)
    { tipo: "pieza", clave: "CENEFA", planilla_suelto: true, suelto: null },
    { tipo: "pieza", clave: "M1-21", planilla_suelto: true, suelto: null },
    { tipo: "herraje", clave: "|bisagra", en_planilla: true, planilla_suelto: false, suelto: null, datos: { tipo: "Herraje", codigo: null, descripcion: "BISAGRA", cantidad: 8 } },
    { tipo: "herraje", clave: "|perfil led", en_planilla: true, planilla_suelto: true, suelto: null, datos: { tipo: "Perfil", codigo: null, descripcion: "PERFIL LED", medida: "2MT", cantidad: 1 } },
    { tipo: "herraje", clave: "|manija", en_planilla: true, planilla_suelto: false, suelto: true, datos: { tipo: "Herraje", codigo: "MAN1", descripcion: "MANIJA", cantidad: 6 } },
    // Ya no está en la planilla y nadie lo eligió: no aparece
    { tipo: "herraje", clave: "|vieja", en_planilla: false, planilla_suelto: true, suelto: null, datos: { descripcion: "VIEJA" } },
  ];
  const d = armarDestinos(PIEZAS, destinos);
  assert.equal(d.sinDefinir, 0);
  const m1 = d.modulos.find((m) => m.modulo === "M1");
  assert.equal(m1.agregadas, 1);
  assert.equal(m1.sueltasPlanilla, 1);
  assert.equal(d.modulos.find((m) => m.modulo === "AJ").destino, SUELTAS);
  assert.deepEqual(d.sinModulo.map((p) => [p.nombre, p.destino, p.modulo]), [["CENEFA", "suelta", null], ["TAPA", "suelta", null], ["ZOC1", "modulo", "M1"]]);
  assert.deepEqual(d.herrajes.map((h) => [h.descripcion, h.suelto]), [["BISAGRA", false], ["MANIJA", true], ["PERFIL LED", true]]);
  assert.equal(textoDestinos(d), "2 módulos armados · 5 piezas sueltas · 2 herrajes sueltos");

  const items = sueltosDeDestinos(PIEZAS, destinos);
  assert.deepEqual(items.map((i) => [i.tipo, i.codigo || i.descripcion, i.cantidad, i.va_con]), [
    ["Madera", "M1-21", 1, "Módulo M1"],
    ["Madera", "AJ-1", 1, "Módulo AJ"],
    ["Madera", "AJ-2", 1, "Módulo AJ"],
    ["Madera", "TAPA", 1, null],
    ["Madera", "CENEFA", 1, null],
    ["Herraje", "MAN1", 6, null],
    ["Perfil", "PERFIL LED", 1, null],
  ]);
  assert.equal(items[0].medida, "500 × 300");

  // ZOC1 pasa a ser del módulo M1 en piezas_ot (etiqueta de módulo y Armado); el resto queda como está
  assert.deepEqual(modulosACorregir(PIEZAS, destinos), { ZOC1: "M1" });
  const corregidas = PIEZAS.map((p) => ({ ...p, modulo: p.nombre === "ZOC1" ? "M1" : p.modulo }));
  assert.deepEqual(modulosACorregir(corregidas, destinos), {});
  // Vuelve a sin definir: se le saca el módulo
  assert.deepEqual(modulosACorregir(corregidas, destinos.filter((x) => x.clave !== "ZOC1")), { ZOC1: null });
});

test("lo elegido a mano le gana a la planilla; un módulo asignado que ya no existe no vale", () => {
  const d = armarDestinos(PIEZAS, [
    { tipo: "pieza", clave: "CENEFA", planilla_suelto: true, modulo: "GB2P", suelto: null },
    { tipo: "pieza", clave: "TAPA", modulo: "NOEXISTE", suelto: null },
  ]);
  assert.deepEqual(d.sinModulo.find((p) => p.nombre === "CENEFA").destino, "modulo");
  assert.equal(d.sinModulo.find((p) => p.nombre === "TAPA").destino, null);
});

test("NECESIDADES — lista completa con SUELTO, sin placas ni cantos, repetidos suman", () => {
  const filas = [
    ["OT", "M-7961"],
    [],
    ["", "NOMBRE", "DESCRIPCIÓN", "CANTIDAD", "SUELTO"],
    ["", "-", "MELAMINA SOBRE MDF 18MM-Faplac-GRAFITO-4,7M2", 0.2, ""],
    ["", "-", "CANTO PVC 0,45-S/Marca-GRAFITO-22MM", 12, ""],
    ["", "B35", "BISAGRA 35 CODO 0-S/Marca-S/COLOR-1 PZ", 4, ""],
    ["", "B35", "BISAGRA 35 CODO 0-S/Marca-S/COLOR-1 PZ", 2, ""],
    ["", "-", "PERFIL LED DE EMBUTIR-S/Marca-2MT", 0.5, "SI"],
  ];
  assert.deepEqual(componentesPlanilla(filas), [
    { tipo: "Herraje", codigo: "B35", descripcion: "BISAGRA 35 CODO 0-S/Marca-S/COLOR-1 PZ", medida: "1 PZ", cantidad: 6, suelto: false },
    { tipo: "Perfil", codigo: null, descripcion: "PERFIL LED DE EMBUTIR-S/Marca-2MT", medida: "2MT", cantidad: 0.5, suelto: true },
  ]);
  // Planilla vieja sin la columna SUELTO: todos van dentro del mueble
  const sinColumna = componentesPlanilla(filas.map((f) => f.slice(0, 4)));
  assert.deepEqual(sinColumna.map((c) => c.suelto), [false, false]);
  assert.equal(componentesPlanilla([["nada"]]), null);
  assert.equal(esPlaca("Melamina 18"), true);
  assert.equal(esPlaca("MANIJA"), false);
});

test("planBultos — un bulto por módulo armado, sin huecos, sin tocar los cargados ni los armados a mano", () => {
  assert.deepEqual(planBultos([], ["GB2P", "M1"]), { crear: [{ numero: 1, contenido: "Módulo GB2P" }, { numero: 2, contenido: "Módulo M1" }], borrar: [], renumerar: [] });
  const bultos = [
    { id: 1, numero: 1, contenido: "Módulo AJ" },               // AJ pasó a "Van sueltas": se borra
    { id: 2, numero: 2, contenido: "Módulo GB2P" },
    { id: 3, numero: 3, contenido: "Módulo VIEJO", cargado: true }, // ya cargado: queda
  ];
  assert.deepEqual(planBultos(bultos, ["GB2P", "M1"]), {
    crear: [{ numero: 3, contenido: "Módulo M1" }],
    borrar: [1],
    renumerar: [{ id: 2, numero: 1 }, { id: 3, numero: 2 }],
  });
  assert.equal(planBultos([{ id: 9, numero: 1, contenido: "caja de herrajes" }], ["M1"]), null);
  assert.equal(moduloDeBulto("Módulo M.izq"), "M.izq");
  assert.equal(moduloDeBulto("M1"), null);
});

test("esquema y permisos", () => {
  assert.equal(piezasBody.safeParse({ accion: "destino", ot: "M-7961", cambios: [{ tipo: "modulo", clave: "AJ", suelto: true }] }).success, true);
  assert.equal(piezasBody.safeParse({ accion: "destino", ot: "M-7961", cambios: [] }).success, false);
  assert.equal(piezasBody.safeParse({ accion: "destino", ot: "M-7961", cambios: [{ tipo: "bulto", clave: "1", suelto: true }] }).success, false);
  assert.equal(autorizar("destinos_ot", "GET", { rol: "operativo", empresa_id: E }).ok, true);
  assert.equal(autorizar("destinos_ot", "POST", { rol: "gerencial", empresa_id: E }).ok, false);
});

/* ─── /api/piezas accion "destino" ─── */
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/piezas/route.js");
test("POST destino — valida contra las piezas, guarda, mueve la pieza al módulo y arma los sueltos", async () => {
  const piezas = PIEZAS.map((p, i) => ({ ...p, id: i + 1 }));
  const destinos = [];
  const escrito = [];
  const bultos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ body: [{ id: 1, ot: "M-7961" }] }) },
    { match: (u) => u.includes("/rest/v1/etapas?"), respond: () => ({ body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/piezas_ot") && (!o.method || o.method === "GET"), respond: () => ({ body: piezas }) },
    { match: (u, o) => u.includes("/rest/v1/piezas_ot") && o.method === "PATCH", respond: (u, o) => {
      escrito.push({ url: u, body: JSON.parse(o.body) });
      const nombre = decodeURIComponent(new URL(u).searchParams.get("nombre").slice(3));
      for (const p of piezas) if (p.nombre === nombre) p.modulo = JSON.parse(o.body).modulo;
      return { body: [] };
    } },
    { match: (u, o) => u.includes("/rest/v1/destinos_ot") && (!o.method || o.method === "GET"), respond: () => ({ body: destinos }) },
    { match: (u, o) => u.includes("/rest/v1/destinos_ot") && o.method === "POST", respond: (u, o) => {
      for (const n of JSON.parse(o.body)) {
        const f = destinos.find((x) => x.tipo === n.tipo && x.clave === n.clave);
        if (f) Object.assign(f, n); else destinos.push(n);
      }
      return { status: 201, body: "" };
    } },
    { match: (u, o) => u.includes("/rest/v1/sueltos_ot") && (!o.method || o.method === "GET"), respond: () => ({ body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/sueltos_ot") && o.method === "POST", respond: (u, o) => ({ status: 201, body: JSON.parse(o.body).map((f, i) => ({ ...f, id: 50 + i })) }) },
    { match: (u) => u.includes("/rest/v1/cargas_ot?"), respond: () => ({ body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/bultos_ot") && (!o.method || o.method === "GET"), respond: () => ({ body: bultos }) },
    { match: (u, o) => u.includes("/rest/v1/bultos_ot") && o.method === "POST", respond: (u, o) => { bultos.push(...JSON.parse(o.body)); return { status: 201, body: [] }; } },
  ]);
  const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
  const post = async (cambios, rol = "gerencial") => api.POST(new Request("http://localhost/api/piezas", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify({ accion: "destino", ot: "M-7961", cambios }),
  }));

  assert.equal((await post([{ tipo: "modulo", clave: "AJ", suelto: true }], "operativo")).status, 403);
  // Una pieza con módulo en su código no se mueve
  let r = await post([{ tipo: "pieza", clave: "M1-11", modulo: "GB2P", suelto: null }]);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /se corrige en la planilla/);
  r = await post([{ tipo: "pieza", clave: "ZOC1", modulo: "NOEXISTE", suelto: null }]);
  assert.equal(r.status, 400);
  r = await post([{ tipo: "herraje", clave: "|nada", suelto: true }]);
  assert.equal(r.status, 404);
  assert.equal(destinos.length, 0);

  r = await post([{ tipo: "modulo", clave: "AJ", suelto: true }, { tipo: "pieza", clave: "ZOC1", modulo: "M1", suelto: null }, { tipo: "pieza", clave: "TAPA", suelto: true }]);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.cambios, 3);
  assert.equal(body.sueltos, 3);
  assert.deepEqual(destinos.map((x) => [x.tipo, x.clave, x.suelto, x.modulo, x.actualizado_por]), [
    ["modulo", "AJ", true, null, EMP], ["pieza", "ZOC1", null, "M1", EMP], ["pieza", "TAPA", true, null, EMP],
  ]);
  assert.deepEqual(escrito.map((x) => [decodeURIComponent(x.url.split("nombre=eq.")[1]), x.body.modulo]), [["ZOC1", "M1"]]);
  // Un bulto por módulo armado (AJ va suelto)
  assert.deepEqual(bultos.map((b) => [b.numero, b.contenido]), [[1, "Módulo GB2P"], [2, "Módulo M1"]]);
});
