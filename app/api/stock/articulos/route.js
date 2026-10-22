// /api/stock/articulos — Artículo nuevo que no está en la planilla MRP
// (Stock, ítem 40; migración 124; diseño en notes/diseno-articulos-nuevos.md).
//
// GET  → las listas de la hoja TABLAS para el formulario (las copia la
//        sincronización de Stock) y si el usuario puede cargar.
// POST → dueños y administradores dan de alta un artículo con los campos de
//        ARTICULOS. Gypi le arma un SKU provisorio como la fórmula de la
//        planilla y queda en el stock para usarlo en el momento; el script de
//        la planilla lo anota al final de ARTICULOS (/api/stock/planilla).
// Con RLS_RUTAS=on va con el pase del usuario ({ sesion }).
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { validateBody, safeErrorMessage } from "../../../lib/validate";
import { articuloNuevoBody } from "../../../lib/schemas";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { sbGet, sbGetAll, sbPost } from "../../../lib/sbHelpers";
import { broadcastRefresh } from "../../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../../lib/planEnforcement";
import { CLAVE_TABLAS_MRP, armarSku, nombreNormalizado, siguienteNumero } from "../../../lib/articulosNuevos";
import { logger } from "../../../lib/logger";

const AVISO_MIGRACION = "Para cargar artículos nuevos falta correr la migración 124 en Supabase.";
const AVISO_TABLAS = "Falta conectar la hoja TABLAS de la planilla MRP: pegá su link en Stock → Planilla MRP y tocá Sincronizar.";

const faltaMigracion = (err) => /articulos_alta|'origen'|'pack'/.test(String(err?.message));
const esDuplicado = (err) => /23505|duplicate key/.test(String(err?.message));

async function leerListas(e, opts) {
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_TABLAS_MRP}&select=valor&limit=1`, { ...opts, silent: true, fallback: [] })) || [];
  return cfg?.valor?.listas || null;
}

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const listas = await leerListas(sesion.empresa_id, { sesion });
    return NextResponse.json({ puede: ROLES_GESTION.has(sesion.rol), listas });
  } catch (err) {
    logger.error("[stock/articulos] GET error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Los artículos nuevos los cargan los dueños y administradores" }, { status: 403 });
    }
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(articuloNuevoBody, raw);
    if (parsed.response) return parsed.response;
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "proyectos");
    if (sinModulo) return sinModulo;

    const e = sesion.empresa_id;
    const opts = { sesion };
    const datos = parsed.data;
    const listas = await leerListas(e, opts);
    if (!listas) return NextResponse.json({ error: AVISO_TABLAS }, { status: 409 });

    try {
      const [{ data: articulos }, { data: altas }] = await Promise.all([
        sbGetAll(`articulos_stock?empresa_id=eq.${e}&select=sku&order=sku.asc`, { sesion, maxFilas: 50000 }),
        sbGetAll(`articulos_alta?empresa_id=eq.${e}&select=sku&order=id.asc`, { sesion, maxFilas: 50000 }),
      ]);
      const [empleado] = sesion.empleado_id
        ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] })) || []
        : [];

      let numero = siguienteNumero([...articulos, ...altas].map((a) => a.sku));
      // Si otro cargó uno en el mismo momento, el número ya está usado: el siguiente
      for (let intento = 0; intento < 3; intento++, numero++) {
        const armado = armarSku(datos, listas, numero);
        if ("error" in armado) return NextResponse.json({ error: armado.error }, { status: 400 });
        const v = { ...datos, ...armado.valores };
        const alta = {
          empresa_id: e,
          sku: armado.sku,
          numero,
          id_planilla: randomBytes(6).toString("hex"),
          nombre: nombreNormalizado(v),
          nombre_articulo: datos.nombre_articulo,
          division: v.division,
          familia: v.familia,
          tipo: v.tipo,
          marca: v.marca,
          color: v.color,
          unidad: v.unidad,
          pack: v.pack,
          categoria: datos.categoria,
          stock_seguridad: datos.stock_seguridad,
          factor_tiempo: datos.factor_tiempo,
          proveedor_principal: datos.proveedor_principal,
          lote_minimo: datos.lote_minimo,
          empleado_id: sesion.empleado_id || null,
          empleado_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : null,
        };
        let creada;
        try {
          [creada] = (await sbPost("articulos_alta", alta, opts)) || [];
        } catch (err) {
          if (esDuplicado(err)) continue;
          throw err;
        }
        const articulo = {
          empresa_id: e,
          sku: alta.sku,
          nombre: alta.nombre,
          division: alta.division,
          familia: alta.familia,
          tipo: alta.tipo,
          unidad: alta.unidad,
          marca: alta.marca,
          color: alta.color,
          pack: alta.pack,
          proveedor_principal: alta.proveedor_principal,
          multiplo: alta.lote_minimo,
          plazo_dias: alta.factor_tiempo,
          origen: "gypi",
          activo: true,
          sincronizado_at: new Date().toISOString(),
        };
        const [guardado] = (await sbPost("articulos_stock", articulo, opts)) || [];
        broadcastRefresh(e, "articulos_stock");
        return NextResponse.json({ ok: true, articulo: guardado || articulo, alta: creada || alta });
      }
      return NextResponse.json({ error: "No pude darle un número al artículo. Probá de nuevo." }, { status: 409 });
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ error: AVISO_MIGRACION }, { status: 409 });
      throw err;
    }
  } catch (err) {
    logger.error("[stock/articulos] POST error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
