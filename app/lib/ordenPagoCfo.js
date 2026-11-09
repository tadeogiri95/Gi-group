// app/lib/ordenPagoCfo.js — La página del CFO para aprobar una orden de pago
// (/op/<token>; Finanzas F2b, 2; migración 175). El CFO no tiene usuario en
// Gypi: entra con el link que le mandó el dueño por WhatsApp. El token es
// largo y al azar (24 bytes) y solo vale mientras la orden espera su
// decisión; al pagarla, anularla o mandarla de nuevo se cambia o se borra.
// Sin sesión: va con service_role, siempre buscando por ese token.
// Solo servidor.
import { sbGet, sbPatch, sbGetAll } from "./sbHelpers";
import { enviarPushLegajos } from "./pushGerencia";
import { getModulosEmpresa } from "./planEnforcement";
import { CLAVE_CFO, datosParaCfo } from "./finanzasPagos";
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
 * Aprobar o rechazar. Solo si la orden sigue esperando.
 * @returns {{ ok?: true, estado?: string, error?: string, status?: number }}
 */
export async function decidirOrden(token, decision, { nombre = "", nota = "" } = {}, { messaging } = {}) {
  if (!["aprobar", "rechazar"].includes(decision)) return { error: "Decisión desconocida", status: 400 };
  const o = await ordenDelToken(token);
  if (!o) return { error: "El link no es válido o la orden ya no está.", status: 404 };
  if (o.estado !== "para_aprobar") return { error: "Esta orden ya fue decidida.", status: 409 };
  const notaLimpia = String(nota ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (decision === "rechazar" && !notaLimpia) return { error: "Contá por qué la rechazás.", status: 400 };
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${o.empresa_id}&clave=eq.${CLAVE_CFO}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  const quien = String(nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || cfg?.valor?.nombre || "CFO";
  const ahora = new Date().toISOString();
  const estado = decision === "aprobar" ? "aprobada" : "rechazada";
  const [hecha] = (await sbPatch(`fin_ordenes_pago?id=eq.${o.id}&empresa_id=eq.${o.empresa_id}&estado=eq.para_aprobar&token=eq.${encodeURIComponent(token)}`, {
    estado, decidida_at: ahora, decidida_por_nombre: quien, decision_nota: notaLimpia || null, updated_at: ahora,
  }, { silent: true, fallback: [] })) || [];
  if (!hecha) return { error: "Esta orden ya fue decidida.", status: 409 };
  // Aviso a los dueños (solo el rol gerencial ve Finanzas)
  try {
    const { data: duenos } = await sbGetAll(`empleados?empresa_id=eq.${o.empresa_id}&rol=eq.gerencial&activo=eq.true&select=legajo&order=legajo.asc`);
    await enviarPushLegajos(o.empresa_id, (duenos || []).map((x) => x.legajo), {
      title: decision === "aprobar" ? `✅ Orden de pago N° ${o.numero} aprobada` : `❌ Orden de pago N° ${o.numero} rechazada`,
      body: `${o.proveedor_nombre} · ${plata(o.total, "ARS")}${decision === "aprobar" ? " · Ya la podés pagar" : ` · ${notaLimpia}`}`.slice(0, 180),
      data: { tipo: "orden_pago", id: o.id },
    }, { messaging });
  } catch { /* el aviso no frena la decisión */ }
  return { ok: true, estado };
}
