// tests/mas-tiempo.test.jsx — "⏱ Necesita más tiempo" en Diseño, Técnica e
// Instalación (Tadeo, 05/11; migración 162; app/lib/ajustesTiempo.js,
// app/components/MasTiempo.jsx).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { validarAjuste, motivosDe, unidadDe, textoValor, faltanManual } from "../app/lib/ajustesTiempo.js";
import { normalizarDisenoTecnica, normalizarParametros } from "../app/lib/planificacion.js";
import { planDisenoTecnica, planDeEmpresa, conCambio } from "../app/lib/planDisenoTecnica.js";
import { trabajosInstalacion } from "../app/lib/planInstalacion.js";
import { describirCambio } from "../app/lib/historialOt.js";

const { default: GanttDisenoTecnica } = await import("../app/components/GanttDisenoTecnica.jsx");
const { default: MasTiempo } = await import("../app/components/MasTiempo.jsx");

const sinRed = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; });

const LUNES = "2026-11-09";
const PERSONAL = [{ id: 12, nombre: "María José Torres" }];
const VALOR_DT = { dias_diseno: 4, horas_dia: 9, horas: { cocina: { B: 9 } }, arquitectas: [{ id: "12", pct_tecnica: 100 }] };
const DT = normalizarDisenoTecnica(VALOR_DT);
const falta = { e: "falta" };
const hecho = (q) => ({ e: "hecho", q });
const TODO_FALTA = { dis: falta, skp: falta, info: falta, relev: falta, np: falta, nf: falta, excel: falta, pdf: falta };
const SOLO_TECNICA = { dis: hecho("GR"), np: hecho("GR"), nf: falta, excel: falta, pdf: falta };
const OT = (ot, extra = {}) => ({ id: ot, ot, descripcion: "COCINA", clase_auto: "B", estado: "activo", etapas_diseno: TODO_FALTA, ...extra });
const aj = (ot, etapa, horas, pendiente = 1) => ({ ot, etapa, tipo: "faltan", horas, pendiente, created_at: "2026-11-05T10:00:00Z" });

test("validarAjuste — Diseño, Técnica e Instalación con sus motivos, solo 'faltan', de a medio", () => {
  const base = { ot: "M-1", tipo: "faltan", horas: 3, motivo: "cambios_cliente" };
  assert.equal(validarAjuste({ ...base, etapa: "diseno" }), null);
  assert.equal(validarAjuste({ ...base, etapa: "tecnica", motivo: "espera_cliente" }), null);
  assert.equal(validarAjuste({ ...base, etapa: "instalacion", motivo: "obra_no_lista" }), null);
  assert.equal(validarAjuste({ ...base, etapa: "diseno", motivo: "falla_maquina" }), "Elegí el motivo");
  assert.equal(validarAjuste({ ...base, etapa: "instalacion", motivo: "clima" }), null);
  assert.equal(validarAjuste({ ...base, etapa: "tecnica", tipo: "corrimiento" }), "Tipo inválido");
  assert.equal(validarAjuste({ ...base, etapa: "diseno", horas: 0.2 }), "Tiene que ser medio día o más");
  assert.equal(validarAjuste({ ...base, etapa: "corte", motivo: "falla_maquina", horas: 0 }), null, "Producción sigue igual");
  assert.equal(validarAjuste({ ...base, etapa: "corte" }), "Elegí el motivo", "los motivos de cliente no son de planta");
  assert.equal(unidadDe("diseno"), "dias");
  assert.equal(unidadDe("tecnica"), "h");
  assert.equal(textoValor(2.5, "instalacion"), "2,5 días");
  assert.equal(textoValor(0.5, "diseno"), "medio día");
  assert.equal(textoValor(12, "tecnica"), "12 h");
  assert.ok(motivosDe("instalacion").some((m) => m.id === "obra_no_lista"));
});

test("plan 📐 — el más tiempo manda en Diseño (días) y Técnica (horas) y baja con el avance", () => {
  const proyectos = [OT("M-1"), OT("M-2", { etapas_diseno: SOLO_TECNICA })];
  const sin = planDisenoTecnica({ proyectos, dt: DT, personal: PERSONAL, hoy: LUNES });
  assert.equal(sin.renglones[0].diseno.dias, 4);
  const manual = faltanManual([aj("M-1", "diseno", 7), aj("M-2", "tecnica", 18)]);
  const con = planDisenoTecnica({ proyectos, dt: DT, personal: PERSONAL, hoy: LUNES, manual });
  const [m1, m2] = con.renglones;
  assert.equal(m1.diseno.dias, 7);
  assert.equal(m1.disenoManual, true);
  assert.equal(m2.tecnica.horas, 18);
  assert.equal(m2.tecnicaManual, true);
  // Cargado con todo por hacer; después el Plan marca N.F hecha (1/3): baja en la misma proporción
  const avanzado = planDisenoTecnica({ proyectos: [OT("M-2", { etapas_diseno: { ...SOLO_TECNICA, nf: hecho("MJT") } })], dt: DT, personal: PERSONAL, hoy: LUNES, manual });
  assert.equal(avanzado.renglones[0].tecnica.horas, 12);
  // planDeEmpresa toma los ajustes
  const emp = planDeEmpresa({ proyectos, cfgValor: { diseno_tecnica: VALOR_DT }, personal: PERSONAL, hoy: LUNES, ajustes: [aj("M-1", "diseno", 6)] });
  assert.equal(emp.renglones[0].diseno.dias, 6);
});

test("plan 🔧 — el más tiempo de Instalación cambia los días de la OT con su gente", () => {
  const params = normalizarParametros(null);
  const p = { ot: "M-1", obra: "Torre", estado: "activo", dias_instalacion: 4, personas_instalacion: 2 };
  const args = { proyectos: [p], finProduccion: new Map([["M-1", { fin: "2026-11-10" }]]), params, inst: params.instalacion, hoy: LUNES };
  assert.equal(trabajosInstalacion(args).trabajos[0].dias, 4);
  const con = trabajosInstalacion({ ...args, manual: faltanManual([aj("M-1", "instalacion", 6)]) });
  assert.equal(con.trabajos[0].dias, 6);
  assert.equal(con.trabajos[0].ots[0].masTiempo, true);
  assert.equal(con.trabajos[0].ots[0].faltanDias, 6);
  // Con 50 % instalado según el reporte, baja a la mitad
  const mitad = trabajosInstalacion({ ...args, manual: faltanManual([aj("M-1", "instalacion", 6)]), avance: new Map([["M-1", 50]]) });
  assert.equal(mitad.trabajos[0].dias, 3);
});

const calculoDe = (proyectos, agregados = []) => {
  const armar = (lista) => planDeEmpresa({ proyectos: lista, cfgValor: { diseno_tecnica: VALOR_DT }, personal: PERSONAL, hoy: LUNES });
  return { ...armar(proyectos), rehacer: (c) => armar(conCambio(proyectos, c)), agregarAjuste: (f) => agregados.push(f) };
};

test("Gantt 📐 — ⏱ abre Más tiempo con Diseño y Técnica y guarda con el motivo", async () => {
  const posts = [];
  global.fetch = async (url, opts = {}) => {
    const b = JSON.parse(opts.body || "{}");
    if (b.method === "POST") posts.push(b);
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const agregados = [];
  render(<GanttDisenoTecnica calculo={calculoDe([OT("M-1")], agregados)} puedeAjustar usuarioNombre="Tadeo" />);
  fireEvent.click(screen.getByRole("button", { name: "⏱ La OT M-1 necesita más tiempo" }));
  assert.ok(screen.getByRole("group", { name: "Qué necesita más tiempo" }));
  assert.match(screen.getByText(/según el plan le faltan/).textContent, /Diseño: según el plan le faltan 4 días/);
  fireEvent.click(screen.getByRole("button", { name: "Técnica" }));
  assert.equal(screen.getByLabelText("Faltan (horas)").value, "9");
  fireEvent.change(screen.getByLabelText("Faltan (horas)"), { target: { value: "20,5" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  assert.equal(screen.getByRole("alert").textContent, "Elegí el motivo");
  fireEvent.click(screen.getByRole("radio", { name: "Cambios del cliente" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].path, "ajustes_tiempo_ot");
  assert.deepEqual({ ...posts[0].body, created_at: undefined }, { ot: "M-1", etapa: "tecnica", tipo: "faltan", motivo: "cambios_cliente", detalle: null, horas: 20.5, pendiente: 1, dias: 0, creado_nombre: "Tadeo", created_at: undefined });
  await waitFor(() => assert.match(screen.getByRole("status").textContent, /⏱ Anotado: a la OT M-1 le faltan 20,5 h de Técnica/));
  assert.equal(agregados.length, 1);
});

test("Gantt 📐 — sin permiso no hay ⏱; la barra de Diseño abre Diseño primero", () => {
  render(<GanttDisenoTecnica calculo={calculoDe([OT("M-1")])} />);
  assert.equal(document.querySelector("[data-mas-tiempo]"), null);
  cleanup();
  render(<GanttDisenoTecnica calculo={calculoDe([OT("M-1")])} puedeAjustar />);
  fireEvent.click(document.querySelector('[data-barra="tecnica-M-1"]'));
  assert.equal(screen.getByLabelText("Faltan (horas)").value, "9", "la barra de Técnica abre Técnica");
});

test("Más tiempo de Instalación — una opción por OT de la obra, en días, con sus motivos", () => {
  render(<MasTiempo opciones={[
    { ot: "M-1", etapa: "instalacion", nombre: "Instalación de la OT M-1", valor: 3, pendiente: 1 },
    { ot: "M-2", etapa: "instalacion", nombre: "Instalación de la OT M-2", valor: 1.5, pendiente: 0.5 },
  ]} onClose={() => {}} />);
  assert.equal(screen.getByLabelText("Faltan (días hábiles)").value, "3");
  fireEvent.click(screen.getByRole("button", { name: "Instalación de la OT M-2" }));
  assert.equal(screen.getByLabelText("Faltan (días hábiles)").value, "1,5");
  assert.ok(screen.getByRole("radio", { name: "La obra no estaba lista" }));
  assert.ok(screen.getByRole("radio", { name: "Clima" }));
  const gantt = readFileSync(new URL("../app/components/GanttInstalacion.jsx", import.meta.url), "utf8");
  assert.match(gantt, /manual: faltanManual\(datos\.ajustes/);
  assert.match(gantt, /data-mas-tiempo=\{o\.clave\}/);
});

test("Migración 162, historial y lugares que arman el plan con los ajustes", () => {
  const sql = readFileSync(new URL("../supabase/migrations/162_mas_tiempo_diseno_instalacion.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /'diseno', 'tecnica', 'instalacion'/);
  assert.match(sql, /'obra_no_lista', 'clima'/);
  assert.equal(describirCambio({ tabla: "ajustes_tiempo_ot", metodo: "POST", campos: { etapa: "diseno", tipo: "faltan", horas: 3, motivo: "espera_cliente" } }),
    "Cargó demora en Diseño: Faltan 3 días · Espera de aprobación o respuesta del cliente");
  for (const f of ["../app/lib/informeProduccionServidor.js", "../app/api/diseno-tecnica/route.js", "../app/dashboard_gerencia.jsx"]) {
    assert.match(readFileSync(new URL(f, import.meta.url), "utf8"), /ajustes: (ajustes|ajus\?)\.data/, f);
  }
});
