// ═══════════════════════════════════════════════════════════
// Helper para llamar a la API de Mercado Pago (Preapproval)
// Docs: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
// ═══════════════════════════════════════════════════════════

const MP_URL = "https://api.mercadopago.com";
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

async function mpFetch(path, opts = {}) {
  if (!MP_TOKEN) throw new Error("MERCADOPAGO_ACCESS_TOKEN no configurado");
  const res = await fetch(`${MP_URL}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
  if (!res.ok) {
    const err = new Error(data?.message || `MP ${res.status}: ${txt}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * Crea un preapproval (suscripción recurrente) en Mercado Pago.
 * El usuario va a la back_url devuelta y aprueba con su cuenta de MP.
 */
export async function crearPreapproval({ payerEmail, monto, plan, empresaId, externalReference, backUrl, periodo = "mensual" }) {
  const esAnual = periodo === "anual";
  return mpFetch("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `Gypi — Plan ${plan}${esAnual ? " (anual)" : ""}`,
      external_reference: externalReference,
      payer_email: payerEmail,
      back_url: backUrl,
      auto_recurring: {
        frequency: esAnual ? 12 : 1,
        frequency_type: "months",
        transaction_amount: esAnual ? Number(monto) * 12 : Number(monto),
        currency_id: "ARS",
      },
      status: "pending",
    }),
  });
}

/** Obtiene info de un preapproval por ID */
export async function getPreapproval(id) {
  return mpFetch(`/preapproval/${id}`);
}

/** Cancela un preapproval */
export async function cancelarPreapproval(id) {
  return mpFetch(`/preapproval/${id}`, {
    method: "PUT",
    body: JSON.stringify({ status: "cancelled" }),
  });
}

/** Obtiene info de un pago */
export async function getPago(id) {
  return mpFetch(`/v1/payments/${id}`);
}