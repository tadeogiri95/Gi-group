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
import { cuentasPorOt } from "../../../lib/finanzasOtClientes";
import { materialesDeOts } from "../../../lib/finanzasMaterialesOt";

const COLUMNAS = "id,fecha,tipo,cliente_id,entidad,proyecto_id,total_ars,cuenta_debe,cuenta_haber,descripcion,anulada_at";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

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
    const materiales = await materialesDeOts(sesion, sinPresupuesto);
    const clientesOt = cuentasPorOt({ proyectos, precios, materiales, ops, cuentasDeu, clientes });
    return NextResponse.json({ clientes: clientesOt, sin_deudores: !deu.length });
  } catch (err) {
    return errorFinanzas(err, "ot-clientes GET");
  }
}
