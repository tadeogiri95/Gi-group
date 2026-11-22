// /api/finanzas/estado-cuenta — Finanzas → 📒 Cuentas corrientes: los datos
// del 📄 Estado de cuenta en PDF para mandarle al cliente o al proveedor
// (20/11, reglas en app/lib/finanzasEstadoCuenta.js). Sin migración.
//
//   GET ?cliente=c12&proveedor=p5 (uno o los dos) → la empresa (nombre,
//       CUIT, domicilio, logo, color), y de cada lado solo lo que puede salir
//       de la empresa: del cliente sus OT (código, obra, descripción, fecha y
//       PRECIO del Plan; sin precio quedan "a confirmar", nunca el estimado
//       por materiales) y sus cobros (fecha, importe, OT); del proveedor sus
//       movimientos (fecha, importe, número de comprobante). Desde el 22/11
//       también el medio de cada cobro y pago, y si cada OT ya se entregó. Nada de cuentas
//       contables, descripciones internas ni quién cargó.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll } from "../../../lib/sbHelpers";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { cuentasDeudores } from "../../../lib/finanzasClientes";
import { CLASES_COMPRA, ORIGEN_COMPRA_MANUAL, cuentasProveedores, movimientosProveedor } from "../../../lib/finanzasProveedores";
import { cuentasPorOt } from "../../../lib/finanzasOtClientes";
import { leerEntregasOt, leerPreciosOt } from "../../../lib/finanzasMaterialesOt";
import { medioDePago } from "../../../lib/finanzasTipos";

const COLS_CLI = "id,fecha,tipo,cliente_id,entidad,proyecto_id,total_ars,cuenta_debe,cuenta_haber,descripcion,origen,anulada_at";
const COLS_PROV = "id,fecha,tipo,proveedor_id,entidad,total_ars,cuenta_debe,cuenta_haber,descripcion,referencia,origen,anulada_at";
const CLAVE = /^[ce][A-Za-z0-9]{1,200}$/;
const CLAVE_PROV = /^[pe][A-Za-z0-9]{1,200}$/;
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const leerTesoreria = (sesion) => leer(sesion, `fin_tesoreria?empresa_id=eq.${sesion.empresa_id}&select=cuenta,nombre,tipo,moneda`).catch(() => []);
const texto = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function datosCliente(sesion, clave) {
  const e = sesion.empresa_id;
  const [cuentas, clientes, proyectos, precios, entregas, tesoreria] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
    leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id,nombre,cuit,alias,activo,unido_a&order=id.asc`, 10000),
    leer(sesion, `proyectos?empresa_id=eq.${e}&select=id,ot,cliente,cliente_id,obra,descripcion,estado,created_at&order=id.desc`, 20000)
      .catch(() => leer(sesion, `proyectos?empresa_id=eq.${e}&select=id,ot,cliente,obra,descripcion,estado,created_at&order=id.desc`, 20000)),
    leerPreciosOt(sesion, e),
    leerEntregasOt(sesion, e),
    leerTesoreria(sesion),
  ]);
  const cuentasDeu = cuentasDeudores(cuentas);
  const deu = [...cuentasDeu];
  const ops = deu.length
    ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${deu.join(",")}),cuenta_haber.in.(${deu.join(",")}))&select=${COLS_CLI}&order=fecha.asc,id.asc`, 60000)
    : [];
  // Sin materiales: una OT sin PRECIO queda sin valor (nunca se manda el estimado)
  const c = cuentasPorOt({
    proyectos, precios, materiales: new Map(), ops, cuentasDeu, clientes, entregas, medioDe: (op) => medioDePago(op, { tesoreria, cuentas }),
  }).find((x) => x.clave === clave);
  const fila = clave.startsWith("c") ? clientes.find((x) => `c${x.id}` === clave) : null;
  return {
    nombre: texto(fila?.nombre || c?.nombre, 120),
    cuit: texto(fila?.cuit, 20),
    ots: (c?.ots || []).map((o) => ({
      proyecto_id: o.proyecto_id, ot: texto(o.ot, 40), obra: texto(o.obra, 120), descripcion: texto(o.descripcion, 160), fecha: o.fecha || "",
      valor: o.estimado ? 0 : o.valor, sin_valor: Boolean(o.estimado || o.sin_valor), entregada: Boolean(o.entregada), entrega: o.entrega || "",
    })),
    cobros: (c?.cobros || []).map((x) => ({ fecha: x.fecha, importe: x.importe, proyecto_id: x.proyecto_id || null, medio: texto(x.medio, 60) })),
  };
}

async function datosProveedor(sesion, clave) {
  const e = sesion.empresa_id;
  const [cuentas, proveedores, tesoreria] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,cuit&order=id.asc`, 10000),
    leerTesoreria(sesion),
  ]);
  const cuentasProv = cuentasProveedores(cuentas);
  const prov = [...cuentasProv];
  const ops = prov.length
    ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${prov.join(",")}),cuenta_haber.in.(${prov.join(",")}))&select=${COLS_PROV}&order=fecha.asc,id.asc`, 50000)
    : [];
  const movs = movimientosProveedor(ops, clave, cuentasProv);
  const fila = clave.startsWith("p") ? proveedores.find((x) => `p${x.id}` === clave) : null;
  return {
    nombre: texto(fila?.nombre || movs[0]?.op.entidad, 120),
    cuit: texto(fila?.cuit, 20),
    movimientos: movs.map((m) => ({
      // Solo se dice si es nota de crédito; la descripción interna no sale
      op: {
        fecha: m.op.fecha, referencia: texto(m.op.referencia, 60) || null, origen: m.op.origen || null,
        descripcion: m.op.origen === ORIGEN_COMPRA_MANUAL && String(m.op.descripcion || "").startsWith(CLASES_COMPRA.nota_credito) ? CLASES_COMPRA.nota_credito : "",
      },
      compra: m.compra, pago: m.pago,
      // Cómo se pagó (22/11): "Transferencia · Galicia", "Cheque o e-cheq"…
      medio: m.pago > 0 ? texto(medioDePago(m.op, { tesoreria, cuentas }), 60) : "",
    })),
  };
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const { searchParams } = new URL(request.url);
  const cliente = String(searchParams.get("cliente") || "");
  const proveedor = String(searchParams.get("proveedor") || "");
  if ((cliente && !CLAVE.test(cliente)) || (proveedor && !CLAVE_PROV.test(proveedor)) || (!cliente && !proveedor)) {
    return NextResponse.json({ error: "Elegí un cliente o un proveedor" }, { status: 400 });
  }
  const e = sesion.empresa_id;
  try {
    const [empresas, cli, prov] = await Promise.all([
      sbGet(`empresa?id=eq.${e}&select=nombre,razon_social,cuit,domicilio_fiscal,logo_url,color_primario&limit=1`, { silent: true, fallback: [] }),
      cliente ? datosCliente(sesion, cliente) : null,
      proveedor ? datosProveedor(sesion, proveedor) : null,
    ]);
    const emp = empresas?.[0] || {};
    return NextResponse.json({
      empresa: {
        nombre: texto(emp.razon_social || emp.nombre, 120), cuit: texto(emp.cuit, 20), domicilio: texto(emp.domicilio_fiscal, 160),
        logo: emp.logo_url || null, color: emp.color_primario || null,
      },
      cliente: cli,
      proveedor: prov,
    });
  } catch (err) {
    return errorFinanzas(err, "estado-cuenta GET");
  }
}
