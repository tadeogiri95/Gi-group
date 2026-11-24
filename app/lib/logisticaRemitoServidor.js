// app/lib/logisticaRemitoServidor.js — El remito de una parada por su link
// (/remito/<token>; Logística, parte 4; migración 206). Quien recibió no tiene
// usuario de Gypi: abre el link que le mandaron por WhatsApp o mail, ve el
// remito, lo baja en PDF y, si cuando se entregó no había nadie para firmar,
// firma ahí con el dedo. El token es largo y al azar (24 bytes).
// Sin sesión: va con service_role, siempre buscando por ese token.
// Solo servidor.
import { randomUUID, randomBytes } from "node:crypto";
import { sbGet, sbPatch } from "./sbHelpers";
import { getModulosEmpresa } from "./planEnforcement";
import { contenidoCoincide } from "./fileSignature";
import { broadcastRefresh } from "./broadcast";
import { puedeFirmarPorLink, tieneRemito } from "./logistica";

export const TOKEN_REMITO = /^[A-Za-z0-9_-]{20,80}$/;

/** Un token nuevo para el link del remito. */
export const tokenRemito = () => randomBytes(24).toString("base64url");

const opts = { silent: true, fallback: [] };
const limpio = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;

async function paradaDelToken(token) {
  if (!TOKEN_REMITO.test(String(token || ""))) return null;
  const [p] = (await sbGet(`logistica_paradas?token=eq.${encodeURIComponent(token)}&select=*&limit=1`, opts)) || [];
  if (!p || !tieneRemito(p) || !p.remito_numero) return null;
  const { modulos } = await getModulosEmpresa(p.empresa_id).catch(() => ({ modulos: null }));
  if (Array.isArray(modulos) && !modulos.includes("logistica")) return null;
  return p;
}

/** Lo que muestra la página del remito, o null si el link no sirve. */
export async function datosRemito(token) {
  const p = await paradaDelToken(token);
  if (!p) return null;
  const e = p.empresa_id;
  const [[empresa], [viaje]] = await Promise.all([
    sbGet(`empresa?id=eq.${e}&select=nombre,logo_url&limit=1`, opts).then((r) => r || []),
    sbGet(`logistica_viajes?id=eq.${p.viaje_id}&empresa_id=eq.${e}&select=numero,tipo,fecha,estado,origen_id,chofer_id,vehiculo_id&limit=1`, opts).then((r) => r || []),
  ]);
  const v = viaje || {};
  const [[origen], [chofer], [vehiculo]] = await Promise.all([
    v.origen_id ? sbGet(`logistica_lugares?id=eq.${v.origen_id}&empresa_id=eq.${e}&select=nombre,direccion&limit=1`, opts).then((r) => r || []) : [],
    v.chofer_id ? sbGet(`empleados?id=eq.${v.chofer_id}&empresa_id=eq.${e}&select=nombre&limit=1`, opts).then((r) => r || []) : [],
    v.vehiculo_id ? sbGet(`vehiculos?id=eq.${v.vehiculo_id}&empresa_id=eq.${e}&select=patente,marca,modelo&limit=1`, opts).then((r) => r || []) : [],
  ]);
  // Lo que ve quien recibió: sin ids internos, sin quién la cargó ni la ubicación del celular
  const parada = {
    nombre: p.nombre, cliente: p.cliente, direccion: p.direccion, ots: p.ots || [], accion: p.accion, estado: p.estado,
    renglones: Array.isArray(p.renglones) ? p.renglones.map(({ texto, cantidad, hecha }) => ({ texto, cantidad, hecha })) : [],
    fotos: p.fotos || [], firma_url: p.firma_url, firma_nombre: p.firma_nombre, firma_dni: p.firma_dni, sin_firma: !!p.sin_firma,
    motivo: p.motivo, hecha_at: p.hecha_at, remito_numero: p.remito_numero, remito_oficial: p.remito_oficial, cot: p.cot,
    firmada_link_at: p.firmada_link_at,
  };
  return {
    empresa: { nombre: empresa?.nombre || "", logo: empresa?.logo_url || null },
    viaje: { numero: v.numero, tipo: v.tipo, fecha: v.fecha },
    parada,
    origen: origen?.nombre ? origen : null,
    chofer: chofer?.nombre || "",
    vehiculo: vehiculo?.patente ? [vehiculo.patente, [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "",
    puedeFirmar: puedeFirmarPorLink(p),
  };
}

/**
 * Quien recibió firma desde el link (cuando al entregar no había nadie).
 * La firma llega como PNG en base64 y se sube al storage de la empresa.
 * @returns {{ ok?: true, firma_url?: string, error?: string, status?: number }}
 */
export async function firmarRemito(token, { png = "", nombre = "", dni = "" } = {}) {
  const p = await paradaDelToken(token);
  if (!p) return { error: "El link no es válido o el remito ya no está.", status: 404 };
  if (!puedeFirmarPorLink(p)) return { error: p.firma_url ? "El remito ya está firmado." : "Este remito no se firma.", status: 409 };
  const quien = limpio(nombre, 120);
  if (!quien) return { error: "Poné tu nombre.", status: 400 };
  const buffer = Buffer.from(String(png || ""), "base64");
  if (!buffer.length || buffer.length > 1024 * 1024 || !contenidoCoincide(buffer, "image/png")) return { error: "Falta la firma.", status: 400 };
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const ruta = `${p.empresa_id}/${randomUUID()}.png`;
  const r = await fetch(`${SB}/storage/v1/object/reportes-obra/${ruta}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "image/png", "x-upsert": "false" },
    body: buffer,
  });
  if (!r.ok) throw new Error(`No se pudo guardar la firma (HTTP ${r.status})`);
  const firma_url = `${SB}/storage/v1/object/public/reportes-obra/${ruta}`;
  const ahora = new Date().toISOString();
  // Solo si sigue sin firma (si dos firman a la vez, queda la primera)
  const [hecha] = (await sbPatch(`logistica_paradas?id=eq.${p.id}&empresa_id=eq.${p.empresa_id}&token=eq.${encodeURIComponent(token)}&firma_url=is.null`, {
    firma_url, firma_nombre: quien, firma_dni: limpio(dni, 20), sin_firma: false, firmada_link_at: ahora,
  }, opts)) || [];
  if (!hecha) return { error: "El remito ya está firmado.", status: 409 };
  broadcastRefresh(p.empresa_id, "logistica_viajes");
  return { ok: true, firma_url };
}
