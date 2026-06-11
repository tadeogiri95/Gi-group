// app/lib/email.js — Email transaccional via Resend
// Requiere: RESEND_API_KEY y RESEND_FROM en env vars
//
// RESEND_FROM debe ser un dominio verificado en Resend, ej:
//   "Gypi <noreply@gypi.app>"

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM || "Gypi <noreply@gypi.app>";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Estilos base compartidos ───
const BASE = `
  <div style="font-family:'Segoe UI',system-ui,sans-serif;max-width:520px;margin:0 auto;background:#FAFAF8;border-radius:16px;overflow:hidden;border:1px solid #E5E5E3">
    <div style="background:linear-gradient(135deg,#F97316,#E85D04);padding:32px 36px">
      <img src="https://gypi.app/icons/icon-192.png" alt="Gypi" style="width:48px;height:48px;border-radius:12px;margin-bottom:12px;display:block" />
      <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.02em">{{TITULO}}</div>
      <div style="color:rgba(255,255,255,0.75);font-size:14px;margin-top:4px">{{SUBTITULO}}</div>
    </div>
    <div style="padding:32px 36px;color:#1A1A1A">
      {{CUERPO}}
    </div>
    <div style="padding:20px 36px;border-top:1px solid #E5E5E3;color:#9B9B9B;font-size:12px">
      Gypi · HR tech para equipos reales · <a href="https://gypi.app" style="color:#F97316;text-decoration:none">gypi.app</a>
    </div>
  </div>
`;

function buildHtml(titulo, subtitulo, cuerpo) {
  return BASE
    .replace("{{TITULO}}", titulo)
    .replace("{{SUBTITULO}}", subtitulo)
    .replace("{{CUERPO}}", cuerpo);
}

function btn(url, label) {
  return `<a href="${url}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#F97316;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px">${label}</a>`;
}

// ─── Email de bienvenida post-registro ───
export async function sendBienvenida({ to, nombre, empresa, slug }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `https://gypi.app/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      <strong>${empresa}</strong> ya está lista en Gypi. Tenés <strong>14 días de trial Pro</strong> para explorar todas las funciones sin límites.
    </p>
    <p style="margin:0 0 8px;color:#444;font-size:14px">¿Por dónde empezar?</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#555;font-size:14px;line-height:1.8">
      <li>Completá el onboarding para configurar tu empresa</li>
      <li>Invitá empleados con su legajo y contraseña</li>
      <li>Configurá divisiones y etapas de producción</li>
    </ul>
    ${btn(url, "Ir a mi empresa →")}
    <p style="margin:20px 0 0;font-size:12px;color:#9B9B9B">Tu URL: <code>${url}</code></p>
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `¡Bienvenido a Gypi, ${empresa}! 🚀`,
    html: buildHtml("¡Ya estás en Gypi!", "Tu trial Pro de 14 días comenzó", cuerpo),
  }).catch((e) => console.error("[email] sendBienvenida error:", e.message));
}

// ─── Alerta de trial próximo a vencer ───
export async function sendTrialVencimiento({ to, nombre, empresa, slug, diasRestantes }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `https://gypi.app/${slug}`;
  const urgente = diasRestantes === 1;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      El trial Pro de <strong>${empresa}</strong> ${urgente ? "vence <strong>mañana</strong>" : `vence en <strong>${diasRestantes} días</strong>`}.
      ${urgente ? "Después de mañana, la cuenta pasará al plan gratuito." : "Aprovechá para suscribirte y mantener el acceso completo."}
    </p>
    <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#9A3412">
      ${urgente ? "⚠️ <strong>Último día:</strong>" : "📅 <strong>En tu trial tenés:"}
      acceso a reportes, grilla de horarios, proyectos, geolocalización y más.
    </div>
    ${btn(`${url}?screen=config`, "Suscribirme ahora →")}
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: urgente
      ? `⚠️ Último día de tu trial en Gypi — ${empresa}`
      : `Tu trial de Gypi vence en ${diasRestantes} días — ${empresa}`,
    html: buildHtml(
      urgente ? "Tu trial vence mañana" : `Quedan ${diasRestantes} días de trial`,
      empresa,
      cuerpo
    ),
  }).catch((e) => console.error("[email] sendTrialVencimiento error:", e.message));
}

// ─── Recuperación de contraseña ───
export async function sendRecuperarPassword({ to, nombre, empresa, resetUrl }) {
  if (!process.env.RESEND_API_KEY) return;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>${empresa}</strong>.
      Si no fuiste vos, ignorá este mensaje — tu contraseña no cambiará.
    </p>
    <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:14px 18px;margin:0 0 20px;font-size:14px;color:#9A3412">
      🔐 Este link es válido por <strong>1 hora</strong> y solo puede usarse una vez.
    </div>
    ${btn(resetUrl, "Restablecer contraseña →")}
    <p style="margin:20px 0 0;font-size:12px;color:#9B9B9B">Si no solicitaste este cambio, podés ignorar este email.</p>
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Restablecer contraseña — Gypi`,
    html: buildHtml("Restablecer contraseña", empresa, cuerpo),
  }).catch((e) => console.error("[email] sendRecuperarPassword error:", e.message));
}

// ─── Verificación de email post-registro ───
export async function sendVerificacionEmail({ to, nombre, empresa, verifyUrl }) {
  if (!process.env.RESEND_API_KEY) return;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      Gracias por registrar <strong>${empresa}</strong> en Gypi. Para activar tu cuenta, confirmá tu dirección de email haciendo clic en el botón.
    </p>
    <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:14px 18px;margin:0 0 20px;font-size:14px;color:#9A3412">
      📧 Este link es válido por <strong>72 horas</strong>.
    </div>
    ${btn(verifyUrl, "Confirmar mi email →")}
    <p style="margin:20px 0 0;font-size:12px;color:#9B9B9B">Si no registraste una empresa en Gypi, ignorá este email.</p>
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Confirmá tu email — Gypi`,
    html: buildHtml("Confirmá tu email", empresa, cuerpo),
  }).catch((e) => console.error("[email] sendVerificacionEmail error:", e.message));
}

// ─── Trial expirado (downgrade automático a free) ───
export async function sendTrialExpirado({ to, nombre, empresa, slug }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `https://gypi.app/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      El trial Pro de <strong>${empresa}</strong> ha finalizado. Tu cuenta pasó automáticamente al plan gratuito.
    </p>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#991B1B">
      🔒 Las funciones Pro (reportes, proyectos, geolocalización, grilla de horarios) ya no están disponibles.
      Suscribite para recuperar el acceso completo.
    </div>
    ${btn(`${url}?screen=config`, "Ver planes y suscribirme →")}
    <p style="margin:20px 0 0;font-size:12px;color:#9B9B9B">Tus datos están seguros — podés suscribirte en cualquier momento y retomar donde dejaste.</p>
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Tu trial de Gypi finalizó — ${empresa}`,
    html: buildHtml("Tu trial finalizó", empresa, cuerpo),
  }).catch((e) => console.error("[email] sendTrialExpirado error:", e.message));
}

// ─── Plan suspendido por impago / cancelación ───
export async function sendPlanSuspendido({ to, nombre, empresa, slug, motivo = "cancelación" }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `https://gypi.app/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      La suscripción de <strong>${empresa}</strong> fue ${motivo === "impago" ? "suspendida por falta de pago" : "cancelada"}.
      Tu cuenta pasó automáticamente al plan gratuito.
    </p>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#991B1B">
      🔒 Las funciones de tu plan anterior ya no están disponibles.
      ${motivo === "impago" ? "Actualizá tu método de pago para reactivar." : "Podés suscribirte nuevamente en cualquier momento."}
    </div>
    ${btn(`${url}?screen=config`, "Reactivar suscripción →")}
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Suscripción ${motivo === "impago" ? "suspendida" : "cancelada"} — ${empresa}`,
    html: buildHtml(motivo === "impago" ? "Suscripción suspendida" : "Suscripción cancelada", empresa, cuerpo),
  }).catch((e) => console.error("[email] sendPlanSuspendido error:", e.message));
}

// ─── Confirmación de pago exitoso ───
export async function sendPagoConfirmado({ to, nombre, empresa, slug, monto, plan }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `https://gypi.app/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      Tu pago de <strong>$${monto?.toLocaleString("es-AR") || "—"}</strong> para el plan
      <strong>${escapeHtml(plan)}</strong> de <strong>${escapeHtml(empresa)}</strong>
      fue procesado exitosamente.
    </p>
    <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#14532D">
      Tu suscripción está activa. Podés acceder a todas las funciones de tu plan.
    </div>
    ${btn(url, "Ir a mi empresa →")}
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Pago confirmado — ${empresa}`,
    html: buildHtml("Pago confirmado", empresa, cuerpo),
  }).catch((e) => console.error("[email] sendPagoConfirmado error:", e.message));
}

// ─── Fallo de pago ───
export async function sendFalloPago({ to, nombre, empresa, slug, monto }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `https://gypi.app/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      No pudimos procesar el pago de <strong>$${monto?.toLocaleString("es-AR") || "—"}</strong> para la suscripción de <strong>${empresa}</strong>.
    </p>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#991B1B">
      🔴 Tu suscripción puede verse afectada si el pago no se regulariza.
      MercadoPago reintentará el cobro automáticamente.
    </div>
    <p style="margin:0 0 16px;color:#555;font-size:14px">Si querés actualizar tu método de pago o tenés alguna duda, comunicate por la app.</p>
    ${btn(url, "Ir a mi empresa")}
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Problema con tu pago en Gypi — ${empresa}`,
    html: buildHtml("Problema con tu pago", empresa, cuerpo),
  }).catch((e) => console.error("[email] sendFalloPago error:", e.message));
}
