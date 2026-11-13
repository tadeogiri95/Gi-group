// /api/finanzas/historico — Finanzas: pasar el histórico del libro a Gypi
// (reglas en app/lib/finanzasHistorico.js). Sin migración.
//
//   GET → lo que la pantalla necesita para armar el plan en el navegador:
//       plan de cuentas, cajas y bancos, proveedores, clientes y lo que ya se
//       pasó (operaciones vivas de origen "libro" y "saldo_inicial"), y lo
//       que entró a las cajas por otro lado ("otras", para no repetirlo).
//   POST { accion: "anular", ids } → anula esas operaciones (solo de origen
//       libro o saldo_inicial). No se borran.
//   POST { accion: "cargar", operaciones } → carga hasta 400 por vez, ya
//       validadas una por una (solo origen libro o saldo_inicial).
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { LOTE_HISTORICO, ORIGEN_LIBRO, limpiarOperacionHistorico } from "../../../lib/finanzasHistorico";
import { ORIGEN_SALDO_INICIAL } from "../../../lib/finanzasProveedores";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const ORIGENES = `origen=in.(${ORIGEN_LIBRO},${ORIGEN_SALDO_INICIAL})`;

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const [cuentas, tesoreria, proveedores, clientes, existentes] = await Promise.all([
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre&order=codigo.asc`),
      leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa`),
      leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre&order=nombre.asc,id.asc`, 10000),
      leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=nombre.asc,id.asc`, 10000),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&${ORIGENES}&select=id,origen,origen_id,fecha`, 100000),
    ]);
    // 13/11: lo que entró por otro lado (extracto, plazos fijos, pagos…) a
    // una caja o banco, para no pasarlo dos veces
    const lista = tesoreria.map((t) => `"${String(t.cuenta).replace(/"/g, "")}"`).join(",");
    const otras = lista
      ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&origen=not.in.(${ORIGEN_LIBRO},${ORIGEN_SALDO_INICIAL})&or=(${encodeURIComponent(`cuenta_debe.in.(${lista}),cuenta_haber.in.(${lista})`)})&select=id,origen,fecha,total,cuenta_debe,cuenta_haber`, 100000)
      : [];
    return NextResponse.json({ cuentas, tesoreria, proveedores, clientes, existentes, otras });
  } catch (err) {
    return errorFinanzas(err, "historico GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  try {
    if (d?.accion === "anular") {
      const ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      if (!ids.length) return NextResponse.json({ ok: true, anuladas: 0 });
      if (ids.length > 2000) return NextResponse.json({ error: "Hasta 2000 por vez" }, { status: 400 });
      for (let i = 0; i < ids.length; i += 200) {
        await sbPatch(`fin_operaciones?empresa_id=eq.${e}&${ORIGENES}&anulada_at=is.null&id=in.(${ids.slice(i, i + 200).join(",")})`, {
          anulada_at: ahora, anulada_por_nombre: "Gypi (histórico del libro)", updated_at: ahora,
        }, { sesion });
      }
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true, anuladas: ids.length });
    }
    if (d?.accion === "cargar") {
      const lista = Array.isArray(d.operaciones) ? d.operaciones : [];
      if (!lista.length) return NextResponse.json({ error: "No vino ninguna operación" }, { status: 400 });
      if (lista.length > LOTE_HISTORICO) return NextResponse.json({ error: `Hasta ${LOTE_HISTORICO} por vez` }, { status: 400 });
      const [cuentas, proveedores, clientes] = await Promise.all([
        leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo`),
        leer(sesion, `proveedores?empresa_id=eq.${e}&select=id`, 10000),
        leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id`, 10000),
      ]);
      const ctx = { codigos: new Set(cuentas.map((c) => c.codigo)), proveedores: new Set(proveedores.map((p) => Number(p.id))), clientes: new Set(clientes.map((c) => Number(c.id))) };
      const filas = [];
      for (const [i, o] of lista.entries()) {
        const r = limpiarOperacionHistorico(o, ctx);
        if (r.error) return NextResponse.json({ error: `Operación ${i + 1}: ${r.error}` }, { status: 400 });
        filas.push({ ...r.fila, empresa_id: e, cargada_por_nombre: "Gypi (histórico del libro)", created_at: ahora, updated_at: ahora });
      }
      await sbPost("fin_operaciones", filas, { sesion });
      return NextResponse.json({ ok: true, cargadas: filas.length });
    }
    if (d?.accion === "terminar") {
      broadcastRefresh(e, "fin_operaciones");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err) {
    return errorFinanzas(err, "historico POST");
  }
}
