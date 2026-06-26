// app/lib/email.js — Email transaccional via Resend
// Requiere: RESEND_API_KEY y RESEND_FROM en env vars
//
// RESEND_FROM debe ser un dominio verificado en Resend, ej:
//   "Gypi <noreply@gypi.app>"

import { Resend } from "resend";
import { logger } from "./logger";

// El constructor de Resend tira si la key es falsy — instanciar solo cuando
// existe. Cada función de abajo ya hace `if (!RESEND_API_KEY) return;` antes
// de tocar `resend`, así que nunca se usa en null. Sin este guard, cualquier
// build/import de este módulo sin la key configurada (CI, builds locales sin
// .env) crashea en "Failed to collect page data" para toda ruta que importe
// email.js, aunque esa ruta nunca llegue a mandar un email.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM || "Gypi <noreply@gypi.app>";
const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(html) {
  return html
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, "$2: $1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    .replace("{{TITULO}}", escapeHtml(titulo))
    .replace("{{SUBTITULO}}", escapeHtml(subtitulo))
    .replace("{{CUERPO}}", cuerpo);
}

// Tags de Resend — permiten asociar eventos del webhook (open/click/bounce)
// de vuelta al tipo de email y a la empresa que lo recibió.
function buildTags(tipoEmail, empresaId) {
  const tags = [{ name: "tipo", value: tipoEmail }];
  if (empresaId) tags.push({ name: "empresa_id", value: String(empresaId) });
  return tags;
}

function btn(url, label) {
  return `<a href="${url}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#F97316;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px">${label}</a>`;
}

// ─── Email de bienvenida post-registro ───
export async function sendBienvenida({ to, nombre, empresa, slug, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      <strong>${escapeHtml(empresa)}</strong> ya está lista en Gypi, en el plan <strong>Free</strong>. Cuando quieras, podés iniciar una prueba de <strong>14 días de Pro</strong> sin cargo desde el dashboard.
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
    html: buildHtml("¡Ya estás en Gypi!", "Empezaste en el plan Free", cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("bienvenida", empresaId),
  }).catch((e) => logger.error("email sendBienvenida", e));
}

// ─── Alerta de trial próximo a vencer ───
// diasRestantes: 11 (día 3 del trial), 7 (día 7), 4 (día 10), 1 (día 13 / último)
export async function sendTrialVencimiento({ to, nombre, empresa, slug, diasRestantes, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const urgente = diasRestantes === 1;
  const temprano = diasRestantes >= 10; // 11 o más días restantes → tono informativo

  const mensajePrincipal = urgente
    ? `El trial Pro de <strong>${escapeHtml(empresa)}</strong> vence <strong>mañana</strong>. Después pasará al plan gratuito.`
    : temprano
      ? `Comenzaste tu trial Pro de <strong>${escapeHtml(empresa)}</strong>. Tenés <strong>${diasRestantes} días</strong> para explorar todas las funciones.`
      : `El trial Pro de <strong>${escapeHtml(empresa)}</strong> vence en <strong>${diasRestantes} días</strong>. Aprovechá para suscribirte y mantener el acceso.`;

  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">${mensajePrincipal}</p>
    <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#9A3412">
      ${urgente ? "⚠️ <strong>Último día:</strong>" : "📅 <strong>En tu trial tenés:</strong>"}
      acceso a reportes, grilla de horarios, proyectos, geolocalización y más.
    </div>
    ${btn(`${url}?screen=config`, urgente ? "Suscribirme ahora →" : "Ver mi empresa →")}
  `;

  const subject = urgente
    ? `⚠️ Último día de tu trial en Gypi — ${empresa}`
    : temprano
      ? `Tu trial Pro de Gypi comenzó — ${empresa}`
      : `Tu trial de Gypi vence en ${diasRestantes} días — ${empresa}`;

  return resend.emails.send({
    from: FROM,
    to,
    subject,
    html: buildHtml(
      urgente ? "Tu trial vence mañana" : temprano ? "¡Bienvenido a tu trial Pro!" : `Quedan ${diasRestantes} días de trial`,
      empresa,
      cuerpo
    ),
    text: stripHtml(cuerpo),
    tags: buildTags("trial_vencimiento", empresaId),
  }).catch((e) => logger.error("email sendTrialVencimiento", e));
}

// ─── Recuperación de contraseña ───
export async function sendRecuperarPassword({ to, nombre, empresa, resetUrl, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>${escapeHtml(empresa)}</strong>.
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
    text: stripHtml(cuerpo),
    tags: buildTags("recuperar_password", empresaId),
  }).catch((e) => logger.error("email sendRecuperarPassword", e));
}

// ─── Verificación de email post-registro ───
export async function sendVerificacionEmail({ to, nombre, empresa, verifyUrl, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      Gracias por registrar <strong>${escapeHtml(empresa)}</strong> en Gypi. Para activar tu cuenta, confirmá tu dirección de email haciendo clic en el botón.
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
    text: stripHtml(cuerpo),
    tags: buildTags("verificacion_email", empresaId),
  }).catch((e) => logger.error("email sendVerificacionEmail", e));
}

// ─── Recordatorio de onboarding incompleto (día 3 / 7 / 14 post-registro) ───
export async function sendOnboardingRecordatorio({ to, nombre, empresa, slug, dias, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const urgente = dias >= 14;

  const mensajePrincipal = urgente
    ? `Notamos que <strong>${escapeHtml(empresa)}</strong> todavía no terminó de configurarse en Gypi. Sin la configuración inicial no podés invitar empleados ni empezar a fichar.`
    : `Hace ${dias} días creaste <strong>${escapeHtml(empresa)}</strong> en Gypi, pero todavía no completaste la configuración inicial. Te toma menos de 5 minutos.`;

  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">${mensajePrincipal}</p>
    <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#9A3412">
      📋 Faltan: rubro, divisiones, etapas de trabajo y tu primer empleado.
    </div>
    ${btn(url, "Terminar configuración →")}
  `;

  return resend.emails.send({
    from: FROM,
    to,
    subject: urgente
      ? `Último recordatorio: terminá de configurar Gypi — ${empresa}`
      : `¿Necesitás ayuda para terminar de configurar Gypi?`,
    html: buildHtml("Terminá tu configuración", empresa, cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("onboarding_recordatorio", empresaId),
  }).catch((e) => logger.error("email sendOnboardingRecordatorio", e));
}

// ─── Trial expirado (downgrade automático a free) ───
export async function sendTrialExpirado({ to, nombre, empresa, slug, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      El trial Pro de <strong>${escapeHtml(empresa)}</strong> ha finalizado. Tu cuenta pasó automáticamente al plan gratuito.
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
    text: stripHtml(cuerpo),
    tags: buildTags("trial_expirado", empresaId),
  }).catch((e) => logger.error("email sendTrialExpirado", e));
}

// ─── Plan suspendido por impago / cancelación ───
export async function sendPlanSuspendido({ to, nombre, empresa, slug, motivo = "cancelación", empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      La suscripción de <strong>${escapeHtml(empresa)}</strong> fue ${motivo === "impago" ? "suspendida por falta de pago" : "cancelada"}.
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
    text: stripHtml(cuerpo),
    tags: buildTags("plan_suspendido", empresaId),
  }).catch((e) => logger.error("email sendPlanSuspendido", e));
}

// ─── Confirmación de pago exitoso ───
export async function sendPagoConfirmado({ to, nombre, empresa, slug, monto, plan, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
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
    text: stripHtml(cuerpo),
    tags: buildTags("pago_confirmado", empresaId),
  }).catch((e) => logger.error("email sendPagoConfirmado", e));
}

// ─── Invitación a empleado ───
export async function sendInvitacionEmpleado({ to, nombre, empresa, slug, legajo, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      <strong>${escapeHtml(empresa)}</strong> te sumó a Gypi. Para activar tu cuenta
      ingresá con tu legajo y creá tu contraseña.
    </p>
    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:14px 18px;margin:0 0 20px;font-size:14px;color:#0C4A6E">
      Tu legajo: <strong>${escapeHtml(String(legajo))}</strong>
    </div>
    ${btn(`${url}?screen=unirse`, "Activar mi cuenta →")}
    <p style="margin:20px 0 0;font-size:12px;color:#9B9B9B">Si no esperabas este mensaje, podés ignorarlo.</p>
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `${empresa} te invitó a Gypi`,
    html: buildHtml("Activá tu cuenta en Gypi", empresa, cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("invitacion_empleado", empresaId),
  }).catch((e) => logger.error("email sendInvitacionEmpleado", e));
}

// ─── Fallo de pago ───
export async function sendFalloPago({ to, nombre, empresa, slug, monto, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      No pudimos procesar el pago de <strong>$${monto?.toLocaleString("es-AR") || "—"}</strong> para la suscripción de <strong>${escapeHtml(empresa)}</strong>.
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
    text: stripHtml(cuerpo),
    tags: buildTags("fallo_pago", empresaId),
  }).catch((e) => logger.error("email sendFalloPago", e));
}

// ─── Alerta interna: discrepancias entre suscripciones locales y Mercado Pago ───
// Disparada por el cron de reconciliación (dry-run: solo avisa, no corrige).
export async function sendReconciliacionAlerta({ discrepancias }) {
  if (!process.env.RESEND_API_KEY) return;
  const destino = process.env.ENTERPRISE_CONTACT_EMAIL || "contacto@gypi.app";
  const filas = discrepancias.map((d) => `
    <tr>
      <td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #E5E5E3">${escapeHtml(String(d.suscripcion_id))}</td>
      <td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #E5E5E3">${escapeHtml(d.empresa_id)}</td>
      <td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #E5E5E3">${escapeHtml(d.plan)}</td>
      <td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #E5E5E3">${escapeHtml(d.estado_local)}</td>
      <td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #E5E5E3">${escapeHtml(d.estado_mp)} <span style="color:#9B9B9B">(${escapeHtml(d.mp_status_raw)})</span></td>
    </tr>
  `).join("");
  const cuerpo = `
    <p style="margin:0 0 12px">El cron de reconciliación encontró <strong>${discrepancias.length}</strong> suscripción(es) cuyo estado local no coincide con Mercado Pago.</p>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px;margin:0 0 20px;font-size:13px;color:#991B1B">
      Modo dry-run: no se corrigió nada automáticamente. Revisar manualmente.
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 10px;font-size:12px;color:#9B9B9B">Susc. ID</th>
          <th style="text-align:left;padding:6px 10px;font-size:12px;color:#9B9B9B">Empresa</th>
          <th style="text-align:left;padding:6px 10px;font-size:12px;color:#9B9B9B">Plan</th>
          <th style="text-align:left;padding:6px 10px;font-size:12px;color:#9B9B9B">Local</th>
          <th style="text-align:left;padding:6px 10px;font-size:12px;color:#9B9B9B">Mercado Pago</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  `;
  return resend.emails.send({
    from: FROM,
    to: destino,
    subject: `⚠️ ${discrepancias.length} discrepancia(s) de suscripción vs Mercado Pago`,
    html: buildHtml("Reconciliación de suscripciones", "Mercado Pago vs base local", cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("reconciliacion_alerta"),
  }).catch((e) => logger.error("email sendReconciliacionAlerta", e));
}

// ─── Consulta de plan Enterprise (notificación interna al equipo de Gypi) ───
export async function sendConsultaEnterprise({ nombre, email, empresa, telefono, mensaje }) {
  if (!process.env.RESEND_API_KEY) return;
  const destino = process.env.ENTERPRISE_CONTACT_EMAIL || "contacto@gypi.app";
  const cuerpo = `
    <p style="margin:0 0 12px">Nueva consulta de plan <strong>Enterprise</strong> desde la web.</p>
    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#0C4A6E">
      <p style="margin:0 0 6px"><strong>Nombre:</strong> ${escapeHtml(nombre)}</p>
      <p style="margin:0 0 6px"><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p style="margin:0 0 6px"><strong>Empresa:</strong> ${escapeHtml(empresa)}</p>
      ${telefono ? `<p style="margin:0 0 6px"><strong>Teléfono:</strong> ${escapeHtml(telefono)}</p>` : ""}
      ${mensaje ? `<p style="margin:0"><strong>Mensaje:</strong> ${escapeHtml(mensaje)}</p>` : ""}
    </div>
    <p style="margin:0;font-size:12px;color:#9B9B9B">Respondé directamente a este email — el reply-to apunta al contacto.</p>
  `;
  return resend.emails.send({
    from: FROM,
    to: destino,
    replyTo: email,
    subject: `Nueva consulta Enterprise — ${empresa}`,
    html: buildHtml("Consulta Enterprise", empresa, cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("consulta_enterprise"),
  }).catch((e) => logger.error("email sendConsultaEnterprise", e));
}
