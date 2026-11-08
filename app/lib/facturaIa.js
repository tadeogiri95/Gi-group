// app/lib/facturaIa.js — Lee una factura (PDF o foto) con la IA de Gypi
// (Anthropic API, la misma clave que el Asistente) y devuelve sus datos con el
// esquema de app/lib/facturasSueltas.js (costo de OT, parte D). Solo servidor.
import { MODELO_IA } from "./iaPrompts";
import { ESQUEMA_FACTURA, PROMPT_FACTURA } from "./facturasSueltas";

export class ErrorIa extends Error {}

/**
 * @param {{ base64: string, tipo: string }} archivo
 * @returns {Promise<{ lectura: object, uso: object, modelo: string }>}
 */
export async function leerFacturaIa({ base64, tipo }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new ErrorIa("La IA no está configurada");
  const adjunto = tipo === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: tipo, data: base64 } };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELO_IA,
      max_tokens: 16000,
      system: PROMPT_FACTURA,
      output_config: { format: { type: "json_schema", schema: ESQUEMA_FACTURA } },
      messages: [{ role: "user", content: [adjunto, { type: "text", text: "Leé esta factura." }] }],
    }),
    signal: AbortSignal.timeout(55000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorIa(res.status === 400 ? "La IA no pudo abrir el archivo. Probá con otro PDF o una foto más nítida." : "La IA no está disponible en este momento. Intentá de nuevo en unos segundos.");
  if (data.stop_reason === "refusal") throw new ErrorIa("La IA no quiso leer este archivo.");
  if (data.stop_reason === "max_tokens") throw new ErrorIa("La factura es demasiado larga para leerla de una vez. Cargala a mano o en partes.");
  const textoIa = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return { lectura: JSON.parse(textoIa), uso: data.usage || {}, modelo: data.model || MODELO_IA };
  } catch {
    throw new ErrorIa("La IA no devolvió los datos de la factura. Cargala a mano.");
  }
}
