// app/lib/ordenPagoCfo.js — La página del CFO para ver una orden de pago
// (/op/<token>; Finanzas F2b, 2; migración 175). Desde el 13/11 es solo
// informativa: el CFO ve lo que tiene preparado para firmar en el banco y
// puede apretar 👍 Visto. El CFO no tiene usuario en Gypi: entra con el link
// que le mandó el dueño por WhatsApp. El token es largo y al azar (24 bytes);
// sigue sirviendo después de pagarla y se borra al anularla.
// Sin sesión: va con service_role, siempre buscando por ese token.
// Solo servidor.
import { sbGet, sbPatch, sbGetAll } from "./sbHelpers";
import { enviarPushLegajos } from "./pushGerencia";
import { getModulosEmpresa } from "./planEnforcement";
import { CLAVE_CFO, datosParaCfo, vistaPorCfo } from "./finanzasPagos";
import { plata } from "./finanzasOperaciones";

export const TOKEN_VALIDO = /^[A-Za-z0-9_-]{20,80}$/;

async function ordenDelToken(token) {
  if (!TOKEN_VALIDO.test(String(token || ""))) return null;
  const [o] = (await sbGet(`fin_ordenes_pago?token=eq.${encodeURIComponent(token)}&select=*&limit=1`, { silent: true, fallback: [] })) || [];
  if (!o) return null;
  const { modulos } = await getModulosEmpresa(o.empresa_id).catch(() => ({ modulos: null }));
  if (Array.isArray(modulos) && !modulos.includes("finanzas")) return null;
  return o;
}

/** Lo que ve el CFO, o null si el link no sirve. */
export async function datosOrdenCfo(token) {
  const o = await ordenDelToken(token);
  if (!o) return null;
  const [[empresa], [cfg]] = await Promise.all([
    sbGet(`empresa?id=eq.${o.empresa_id}&select=nombre,logo_url&limit=1`, { silent: true, fallback: [] }).then((r) => r || []),
    sbGet(`config_sistema?empresa_id=eq.${o.empresa_id}&clave=eq.${CLAVE_CFO}&select=valor&limit=1`, { silent: true, fallback: [] }).then((r) => r || []),
  ]);
  return { ...datosParaCfo(o, empresa || {}), cfo: cfg?.valor?.nombre || "" };
}

/**
 * 👍 Visto: el CFO avisa que vio la orden (13/11: ya no aprueba ni rechaza;
 * el dueño la paga sin esperarlo). Sirve antes o después de pagarla. Si ya
 * la había visto, no cambia nada.
 * @returns {{ ok?: true, estado?: string, visto?: object, error?: string, status?: number }}
 */
export async function marcarVisto(token, { nombre = "" } = {}, { messaging } = {}) {
  const o = await ordenDelToken(token);
  if (!o || o.estado === "anulada") return { error: "El link no es válido o la orden ya no está.", status: 404 };
  if (vistaPorCfo(o)) return { ok: true, estado: o.estado, visto: { por: o.decidida_por_nombre || null, at: o.decidida_at } };
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${o.empresa_id}&clave=eq.${CLAVE_CFO}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  const quien = String(nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || cfg?.valor?.nombre || "CFO";
  const ahora = new Date().toISOString();
  // Las mandadas pasan a "vista"; una pagada sigue pagada (solo se anota que la vio)
  const estado = o.estado === "pagada" ? "pagada" : "aprobada";
  const [hecha] = (await sbPatch(`fin_ordenes_pago?id=eq.${o.id}&empresa_id=eq.${o.empresa_id}&estado=eq.${o.estado}&token=eq.${encodeURIComponent(token)}`, {
    estado, decidida_at: ahora, decidida_por_nombre: quien, decision_nota: null, updated_at: ahora,
  }, { silent: true, fallback: [] })) || [];
  if (!hecha) return { error: "La orden cambió mientras tanto. Volvé a abrir el link.", status: 409 };
  // Aviso a los dueños (solo el rol gerencial ve Finanzas)
  try {
    const { data: duenos } = await sbGetAll(`empleados?empresa_id=eq.${o.empresa_id}&rol=eq.gerencial&activo=eq.true&select=legajo&order=legajo.asc`);
    await enviarPushLegajos(o.empresa_id, (duenos || []).map((x) => x.legajo), {
      title: `👍 ${quien} vio la orden de pago N° ${o.numero}`,
      body: `${o.proveedor_nombre} · ${plata(o.total, "ARS")}`.slice(0, 180),
      data: { tipo: "orden_pago", id: o.id },
    }, { messaging });
  } catch { /* el aviso no frena el visto */ }
  return { ok: true, estado, visto: { por: quien, at: ahora } };
}
