// app/lib/linkClienteOt.js — Link de la OT para el cliente (Tadeo, 04/11;
// notes/diseno-pagina-cliente-ot.md). El cliente escanea el QR con la cámara
// común y ve en /ot/<código> su OT, el estado, el avance y el PDF, sin usuario
// de Gypi.
//
// El código lleva la empresa y la OT y una firma (HMAC con JWT_SECRET y un
// prefijo propio): sin la firma no se abre nada y no se puede adivinar la OT
// de otro cliente cambiando el número. Sin migración: el código se calcula,
// no se guarda (contra: no se apaga el link de una sola OT; cambiando la
// clave OT_CLIENTE_SECRET dejan de andar todos).
// Solo servidor (crypto).
import crypto from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OT_VALIDA = /^[\w.-]{1,40}$/;
const CONTEXTO = "gypi:ot-cliente:v1:";

function secreto() {
  const s = process.env.OT_CLIENTE_SECRET || process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error("Falta la clave para firmar el link del cliente");
  return s;
}

const firma = (datos) => crypto.createHmac("sha256", secreto()).update(CONTEXTO + datos).digest("base64url").slice(0, 22);

/** Código del link de una OT: "<empresa|ot en base64url>.<firma>". Null si la OT no es válida. */
export function codigoClienteOt(empresaId, ot) {
  const o = String(ot ?? "").trim();
  if (!UUID.test(String(empresaId ?? "")) || !OT_VALIDA.test(o)) return null;
  const datos = `${String(empresaId).toLowerCase()}|${o}`;
  return `${Buffer.from(datos, "utf8").toString("base64url")}.${firma(datos)}`;
}

/** Código → { empresaId, ot }, o null si no tiene la forma o la firma no coincide. */
export function leerCodigoClienteOt(codigo) {
  const s = String(codigo ?? "").trim();
  if (s.length > 200) return null;
  const m = s.match(/^([A-Za-z0-9_-]{10,160})\.([A-Za-z0-9_-]{22})$/);
  if (!m) return null;
  const datos = Buffer.from(m[1], "base64url").toString("utf8");
  const [empresaId, ot, ...resto] = datos.split("|");
  if (resto.length || !UUID.test(empresaId || "") || !OT_VALIDA.test(ot || "")) return null;
  const esperada = Buffer.from(firma(datos));
  const recibida = Buffer.from(m[2]);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  return { empresaId: empresaId.toLowerCase(), ot };
}

/** Link completo para el QR del cliente. */
export function linkClienteOt(origen, empresaId, ot) {
  const c = codigoClienteOt(empresaId, ot);
  return c ? `${String(origen).replace(/\/+$/, "")}/ot/${c}` : null;
}
