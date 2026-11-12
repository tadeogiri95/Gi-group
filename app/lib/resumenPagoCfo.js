// app/lib/resumenPagoCfo.js — La página del CFO para ver un resumen de
// órdenes de pago (/op/resumen/<token>; 12/11, migración 186). Igual que la
// de una orden (app/lib/ordenPagoCfo.js): sin usuario de Gypi, el token del
// link es la llave y deja de servir cuando el resumen se anula. Desde ahí el
// CFO aprueba todas las órdenes que esperan, o abre cada una para decidirla.
// Sin sesión: va con service_role, siempre buscando por ese token.
// Solo servidor.
import { sbGet, sbPatch, sbGetAll } from "./sbHelpers";
import { enviarPushLegajos } from "./pushGerencia";
import { getModulosEmpresa } from "./planEnforcement";
import { CLAVE_CFO } from "./finanzasPagos";
import { plata } from "./finanzasOperaciones";
import { TOKEN_VALIDO } from "./ordenPagoCfo";
import { datosResumenParaCfo } from "./finanzasResumenPago";

async function resumenDelToken(token) {
  if (!TOKEN_VALIDO.test(String(token || ""))) return null;
  const [r] = (await sbGet(`fin_resumenes_pago?token=eq.${encodeURIComponent(token)}&estado=neq.anulado&select=*&limit=1`, { silent: true, fallback: [] })) || [];
  if (!r) return null;
  const { modulos } = await getModulosEmpresa(r.empresa_id).catch(() => ({ modulos: null }));
  if (Array.isArray(modulos) && !modulos.includes("finanzas")) return null;
  return r;
}

const ordenesDe = (r) => sbGet(`fin_ordenes_pago?empresa_id=eq.${r.empresa_id}&resumen_id=eq.${r.id}&select=*&order=fecha.asc,numero.asc`, { silent: true, fallback: [] }).then((x) => x || []);

/** Lo que ve el CFO, o null si el link no sirve. */
export async function datosResumenCfo(token) {
  const r = await resumenDelToken(token);
  if (!r) return null;
  const [ordenes, [empresa], [cfg]] = await Promise.all([
    ordenesDe(r),
    sbGet(`empresa?id=eq.${r.empresa_id}&select=nombre,logo_url&limit=1`, { silent: true, fallback: [] }).then((x) => x || []),
    sbGet(`config_sistema?empresa_id=eq.${r.empresa_id}&clave=eq.${CLAVE_CFO}&select=valor&limit=1`, { silent: true, fallback: [] }).then((x) => x || []),
  ]);
  return { ...datosResumenParaCfo(r, ordenes, empresa || {}), cfo: cfg?.valor?.nombre || "" };
}

/**
 * Aprueba todas las órdenes del resumen que esperan al CFO.
 * @returns {{ ok?: true, aprobadas?: number, error?: string, status?: number }}
 */
export async function aprobarResumen(token, { nombre = "" } = {}, { messaging } = {}) {
  const r = await resumenDelToken(token);
  if (!r) return { error: "El link no es válido o el resumen ya no está.", status: 404 };
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${r.empresa_id}&clave=eq.${CLAVE_CFO}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  const quien = String(nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || cfg?.valor?.nombre || "CFO";
  const ahora = new Date().toISOString();
  const hechas = (await sbPatch(`fin_ordenes_pago?empresa_id=eq.${r.empresa_id}&resumen_id=eq.${r.id}&estado=eq.para_aprobar&token=not.is.null`, {
    estado: "aprobada", decidida_at: ahora, decidida_por_nombre: quien, decision_nota: `Aprobada con el resumen N° ${r.numero}`, updated_at: ahora,
  }, { silent: true, fallback: [] })) || [];
  if (!hechas.length) return { error: "No queda ninguna orden esperando tu aprobación.", status: 409 };
  // Un solo aviso a los dueños
  try {
    const total = hechas.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const { data: duenos } = await sbGetAll(`empleados?empresa_id=eq.${r.empresa_id}&rol=eq.gerencial&activo=eq.true&select=legajo&order=legajo.asc`);
    await enviarPushLegajos(r.empresa_id, (duenos || []).map((x) => x.legajo), {
      title: `✅ Resumen de pagos N° ${r.numero} aprobado`,
      body: `${hechas.length} ${hechas.length === 1 ? "orden" : "órdenes"} · ${plata(total, "ARS")} · Ya las podés pagar`.slice(0, 180),
      data: { tipo: "orden_pago", resumen: r.id },
    }, { messaging });
  } catch { /* el aviso no frena la aprobación */ }
  return { ok: true, aprobadas: hechas.length };
}
