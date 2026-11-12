// /api/finanzas/ot-clientes — Finanzas, parte 6: cuenta corriente de clientes
// por OT (reglas en app/lib/finanzasOtClientes.js). Sin migración.
//
//   GET → cada cliente con sus OT (valor sin IVA: presupuesto o materiales ÷
//       0,3 estimado) y sus cobros. El IVA y el "desde" se aplican en la
//       pantalla. No guarda nada: el costo de materiales se calcula sin fijar
//       precios (eso lo sigue haciendo el Costo de la OT).
//
// Solo el rol Dueño (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll } from "../../../lib/sbHelpers";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { cuentasDeudores } from "../../../lib/finanzasClientes";
import { fechaCargaOt } from "../../../lib/costoMateriales";
import { cuentasPorOt, materialesOt } from "../../../lib/finanzasOtClientes";

const COLUMNAS = "id,fecha,tipo,cliente_id,entidad,proyecto_id,total_ars,cuenta_debe,cuenta_haber,descripcion,anulada_at";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const lista = (xs) => xs.map((s) => `%22${encodeURIComponent(s)}%22`).join(",");
const enTandas = async (xs, n, fn) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await fn(xs.slice(i, i + n))));
  return out;
};

/** Costo de materiales de las OT sin presupuesto (de a tandas, sin guardar). */
async function materialesDe(sesion, proyectos) {
  const e = sesion.empresa_id;
  const ots = proyectos.map((p) => String(p.ot));
  if (!ots.length) return new Map();
  const [necesidades, fijos] = await Promise.all([
    enTandas(ots, 80, (t) => leer(sesion, `necesidades_stock?empresa_id=eq.${e}&ot=in.(${lista(t)})&select=ot,sku,cantidad`, 100000).catch(() => [])),
    enTandas(ots, 80, (t) => leer(sesion, `precios_fijos_ot?empresa_id=eq.${e}&ot=in.(${lista(t)})&select=ot,sku,precio_ars`, 100000).catch(() => [])),
  ]);
  const fijosDe = new Map();
  for (const f of fijos) {
    if (!fijosDe.has(f.ot)) fijosDe.set(f.ot, new Map());
    fijosDe.get(f.ot).set(f.sku, f);
  }
  const necDe = new Map();
  for (const n of necesidades) {
    if (!necDe.has(n.ot)) necDe.set(n.ot, []);
    necDe.get(n.ot).push(n);
  }
  const faltan = [...new Set(necesidades.filter((n) => !fijosDe.get(n.ot)?.has(n.sku)).map((n) => n.sku))];
  const filas = await enTandas(faltan, 150, (t) => leer(sesion,
    `v_precios_articulos?empresa_id=eq.${e}&sku=in.(${lista(t)})&precio_ars=not.is.null&select=sku,fecha,precio_ars&order=sku.asc,fecha.asc`, 100000).catch(() => []));
  const precios = new Map();
  for (const p of filas) {
    if (!precios.has(p.sku)) precios.set(p.sku, []);
    precios.get(p.sku).push(p);
  }
  const out = new Map();
  for (const p of proyectos) {
    const ot = String(p.ot);
    out.set(ot, materialesOt({ necesidades: necDe.get(ot) || [], fijos: fijosDe.get(ot) || new Map(), precios, fechaOt: fechaCargaOt(p) }));
  }
  return out;
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const [cuentas, clientes, proyectos, preciosFilas] = await Promise.all([
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
      leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=id.asc`, 10000),
      // Con el cliente unido a la OT (184); sin la migración, solo el nombre
      leer(sesion, `proyectos?empresa_id=eq.${e}&select=id,ot,cliente,cliente_id,obra,descripcion,estado,created_at&order=id.desc`, 20000)
        .catch(() => leer(sesion, `proyectos?empresa_id=eq.${e}&select=id,ot,cliente,obra,descripcion,estado,created_at&order=id.desc`, 20000)),
      sbGet(`precios_ot?empresa_id=eq.${e}&select=ot,precio`, { sesion, silent: true, fallback: [] }),
    ]);
    const cuentasDeu = cuentasDeudores(cuentas);
    const deu = [...cuentasDeu];
    const ops = deu.length
      ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${deu.join(",")}),cuenta_haber.in.(${deu.join(",")}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, 60000)
      : [];
    const precios = new Map((preciosFilas || []).map((f) => [String(f.ot), Number(f.precio) || 0]));
    const sinPresupuesto = proyectos.filter((p) => !(precios.get(String(p.ot)) > 0) && (String(p.cliente || "").trim() || p.cliente_id));
    const materiales = await materialesDe(sesion, sinPresupuesto);
    const clientesOt = cuentasPorOt({ proyectos, precios, materiales, ops, cuentasDeu, clientes });
    return NextResponse.json({ clientes: clientesOt, sin_deudores: !deu.length });
  } catch (err) {
    return errorFinanzas(err, "ot-clientes GET");
  }
}
