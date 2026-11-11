// /api/finanzas/sos — Finanzas, parte 4: importar el CSV de compras del S.O.S
// Contador sin duplicar (reglas en app/lib/finanzasSos.js). Sin migración.
//
//   POST { accion: "ver", texto } → cada comprobante con lo que pasa: ya
//       importado, ya está (el libro, una factura de OC o una compra a mano),
//       ¿ya está? (mismo importe y fecha, otro nombre) o nuevo; con la cuenta
//       que va a llevar y el proveedor de la lista.
//   POST { accion: "importar", texto, claves: [...] } → carga los elegidos
//       (solo nuevos o "¿ya está?"); los proveedores que no están en la lista
//       se suman con su CUIT.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import {
  CLAVE_CUENTAS_PROV, CUENTA_AJUSTE_CAPITAL, ORIGEN_SALDO_INICIAL, claveNombre, cuentaDeProveedor, cuentasAprendidas, cuentasProveedores, leerCuentasProveedores,
} from "../../../lib/finanzasProveedores";
import { TIPO_COMPRA_SOS, compararSos, leerCsvSos, operacionSos } from "../../../lib/finanzasSos";

const MAX_TEXTO = 3_000_000;
const COLUMNAS = "id,fecha,tipo,proveedor_id,entidad,total_ars,cuenta_debe,cuenta_haber,referencia,origen,origen_id,anulada_at";
// Las que tienen número de comprobante aunque no toquen Proveedores (un ticket de Mi caja, un gasto pagado)
const CON_NUMERO = "mi_caja,gasto,compra_manual,factura_oc,factura_oc_otra,factura_suelta";
const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const sinAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

async function leerTodo(sesion) {
  const e = sesion.empresa_id;
  const [cuentas, proveedores, tesoreria, tipos, cfg] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
    leer(sesion, `proveedores?empresa_id=eq.${e}&select=id,nombre,cuit,activo&order=id.asc`, 10000),
    leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta`),
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&codigo=eq.${encodeURIComponent(TIPO_COMPRA_SOS)}&select=codigo,cuenta_debe`),
    sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CUENTAS_PROV}&select=valor&limit=1`, { silent: true, fallback: [] }),
  ]);
  const prov = [...cuentasProveedores(cuentas)];
  const [operaciones, conComprobante] = await Promise.all([
    prov.length
      ? leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${prov.join(",")}),cuenta_haber.in.(${prov.join(",")}))&select=${COLUMNAS}&order=fecha.asc,id.asc`, 100000)
      : [],
    leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&referencia=not.is.null&origen=in.(${CON_NUMERO})&select=${COLUMNAS}&order=fecha.asc,id.asc`, 100000),
  ]);
  return { cuentas, proveedores, tesoreria, tipos, guardadas: leerCuentasProveedores(cfg?.[0]?.valor), prov, operaciones, conComprobante };
}

/** Los renglones del CSV con su estado y la cuenta que van a llevar. */
function plan(texto, datos) {
  const { filas, errores } = leerCsvSos(texto);
  const cuentasProv = new Set(datos.prov);
  const comparadas = compararSos(filas, {
    operaciones: datos.operaciones, proveedores: datos.proveedores, cuentasProv, conComprobante: datos.conComprobante,
    cajas: new Set(datos.tesoreria.map((t) => t.cuenta)),
  });
  const ajuste = new Set(datos.cuentas.filter((c) => CUENTA_AJUSTE_CAPITAL.test(String(c.nombre || "").trim())).map((c) => c.codigo));
  const aprendidas = cuentasAprendidas(datos.operaciones.filter((o) => o.origen !== ORIGEN_SALDO_INICIAL), cuentasProv, { excluir: ajuste });
  const activas = datos.cuentas.filter((c) => c.activa !== false && !cuentasProv.has(c.codigo));
  const porNombre = new Map(activas.map((c) => [sinAcentos(c.nombre), c.codigo]));
  const nombreDe = new Map(datos.cuentas.map((c) => [c.codigo, c.nombre]));
  const defecto = datos.tipos[0]?.cuenta_debe || null;
  const conCuenta = comparadas.map((f) => {
    const clave = f.proveedor_id ? `p${f.proveedor_id}` : `e${claveNombre(f.nombre)}`;
    const delProveedor = cuentaDeProveedor(clave, datos.guardadas, aprendidas);
    const cuenta = delProveedor || porNombre.get(sinAcentos(f.cuenta_sos)) || defecto;
    return { ...f, cuenta, cuenta_nombre: cuenta ? nombreDe.get(cuenta) || cuenta : null, de_proveedor: Boolean(delProveedor) };
  });
  return { filas: conCuenta, errores, cuentaProveedores: datos.prov[0] || null };
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (!["ver", "importar"].includes(d?.accion)) return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const texto = typeof d.texto === "string" ? d.texto : "";
  if (!texto.trim()) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  if (texto.length > MAX_TEXTO) return NextResponse.json({ error: "El archivo es demasiado grande" }, { status: 400 });
  const e = sesion.empresa_id;
  try {
    const datos = await leerTodo(sesion);
    if (!datos.prov.length) return NextResponse.json({ error: "Falta la cuenta \"Proveedores\" en el plan de cuentas" }, { status: 400 });
    const p = plan(texto, datos);
    if (!p.filas.length) return NextResponse.json({ error: p.errores[0] || "El archivo no tiene comprobantes" }, { status: 400 });
    if (d.accion === "ver") return NextResponse.json(p);

    // ─── Importar los elegidos ───
    const claves = new Set(Array.isArray(d.claves) ? d.claves.map(String).slice(0, 5000) : []);
    const elegidas = p.filas.filter((f) => claves.has(f.clave) && (f.estado === "nueva" || f.estado === "dudosa"));
    if (!elegidas.length) return NextResponse.json({ error: "No elegiste comprobantes nuevos" }, { status: 400 });
    if (elegidas.some((f) => !f.cuenta)) return NextResponse.json({ error: "Hay comprobantes sin cuenta: elegí la cuenta de esos proveedores en 📚 Cuenta de cada proveedor" }, { status: 400 });

    // Los proveedores que faltan, una vez cada uno
    const faltan = new Map();
    for (const f of elegidas) if (!f.proveedor_id && f.nombre && !faltan.has(claveNombre(f.nombre))) faltan.set(claveNombre(f.nombre), f);
    let creados = 0;
    if (faltan.size) {
      const nuevos = (await sbPost("proveedores", [...faltan.values()].map((f) => ({
        empresa_id: e, nombre: f.nombre, cuit: f.cuit || null, activo: true,
      })), { sesion })) || [];
      creados = nuevos.length;
      const idDe = new Map(nuevos.map((x) => [claveNombre(x.nombre), Number(x.id)]));
      for (const f of elegidas) if (!f.proveedor_id) f.proveedor_id = idDe.get(claveNombre(f.nombre)) || null;
    }

    const ahora = new Date().toISOString();
    const filas = elegidas.map((f) => ({
      ...operacionSos(f, { cuentaProveedores: p.cuentaProveedores, cuenta: f.cuenta, deProveedor: f.de_proveedor }),
      empresa_id: e, cargada_por_nombre: "Gypi (CSV del S.O.S)", created_at: ahora, updated_at: ahora,
    }));
    for (let i = 0; i < filas.length; i += 200) await sbPost("fin_operaciones", filas.slice(i, i + 200), { sesion });
    broadcastRefresh(e, "fin_operaciones");
    return NextResponse.json({
      ok: true, cargadas: filas.length, proveedores_nuevos: creados,
      para_revisar: filas.filter((f) => f.estado === "para_revisar").length,
    });
  } catch (err) {
    return errorFinanzas(err, `sos ${d.accion}`);
  }
}
