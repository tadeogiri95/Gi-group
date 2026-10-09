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
      <img src="${APP_BASE}/icons/icon-192.png" alt="Gypi" style="width:48px;height:48px;border-radius:12px;margin-bottom:12px;display:block" />
      <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.02em">{{TITULO}}</div>
      <div style="color:rgba(255,255,255,0.75);font-size:14px;margin-top:4px">{{SUBTITULO}}</div>
    </div>
    <div style="padding:32px 36px;color:#1A1A1A">
      {{CUERPO}}
    </div>
    <div style="padding:20px 36px;border-top:1px solid #E5E5E3;color:#9B9B9B;font-size:12px">
      Gypi · HR tech para equipos reales · <a href="${APP_BASE}" style="color:#F97316;text-decoration:none">gypi.app</a>
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
      <strong>${escapeHtml(empresa)}</strong> ya está lista en Gypi. Tenés <strong>30 días de prueba gratuita</strong> con todas las funciones, sin tarjeta.
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
    html: buildHtml("¡Ya estás en Gypi!", "30 días de prueba gratuita", cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("bienvenida", empresaId),
  }).catch((e) => logger.error("email sendBienvenida", e));
}

// ─── Alerta de trial próximo a vencer ───
// diasRestantes: 27 (día 3 de la prueba), 7, 3 y 1 (último día)
export async function sendTrialVencimiento({ to, nombre, empresa, slug, diasRestantes, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const urgente = diasRestantes === 1;
  const temprano = diasRestantes >= 10; // al principio de la prueba → tono informativo

  const mensajePrincipal = urgente
    ? `La prueba gratuita de <strong>${escapeHtml(empresa)}</strong> termina <strong>mañana</strong>. Después la cuenta queda en pausa hasta que elijas un plan.`
    : temprano
      ? `Comenzaste la prueba gratuita de <strong>${escapeHtml(empresa)}</strong>. Tenés <strong>${diasRestantes} días</strong> para usar todas las funciones con tu equipo.`
      : `La prueba gratuita de <strong>${escapeHtml(empresa)}</strong> termina en <strong>${diasRestantes} días</strong>. Elegí un plan para que tu equipo siga fichando sin cortes.`;

  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">${mensajePrincipal}</p>
    <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#9A3412">
      ${urgente ? "⚠️ <strong>Último día:</strong>" : "📅 <strong>En la prueba tenés:</strong>"}
      fichaje con GPS y QR, horarios, OT y tareas, reportes y más.
    </div>
    ${btn(`${url}?screen=config`, urgente ? "Suscribirme ahora →" : "Ver mi empresa →")}
  `;

  const subject = urgente
    ? `⚠️ Último día de tu prueba en Gypi — ${empresa}`
    : temprano
      ? `Tu prueba de Gypi comenzó — ${empresa}`
      : `Tu prueba de Gypi termina en ${diasRestantes} días — ${empresa}`;

  return resend.emails.send({
    from: FROM,
    to,
    subject,
    html: buildHtml(
      urgente ? "Tu prueba termina mañana" : temprano ? "¡Bienvenido a Gypi!" : `Quedan ${diasRestantes} días de prueba`,
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

// ─── Prueba terminada: la cuenta queda en pausa (D20) ───
export async function sendTrialExpirado({ to, nombre, empresa, slug, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      Terminó la prueba gratuita de <strong>${escapeHtml(empresa)}</strong>. La cuenta quedó en pausa: tu equipo no puede fichar ni cargar tareas hasta que elijas un plan.
    </p>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#991B1B">
      ⏸️ Elegí un plan y todo vuelve a funcionar al instante, con la misma configuración.
    </div>
    ${btn(`${url}?screen=config`, "Ver planes y suscribirme →")}
    <p style="margin:20px 0 0;font-size:12px;color:#9B9B9B">Tus datos están seguros — podés suscribirte en cualquier momento y retomar donde dejaste.</p>
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Terminó tu prueba de Gypi — ${empresa}`,
    html: buildHtml("Terminó tu prueba", empresa, cuerpo),
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
      La cuenta quedó en pausa: tu equipo no puede fichar ni cargar tareas. Tus datos siguen guardados.
    </p>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#991B1B">
      ⏸️
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

// ─── Aviso de cambio de precio en pesos (ítem 25, D18) ───
export async function sendAvisoPrecio({ to, nombre, empresa, slug, precioActual, precioNuevo, desde, precioUsd, cotizacion, periodo = "mensual", empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const url = `${APP_BASE}/${slug}`;
  const pesos = (n) => `$${Number(n).toLocaleString("es-AR")}`;
  const fecha = new Date(desde).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });
  const sube = Number(precioNuevo) > Number(precioActual);
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      El plan de <strong>${escapeHtml(empresa)}</strong> cuesta USD ${escapeHtml(String(precioUsd))} por mes y se cobra en pesos al dólar oficial.
      Como el dólar cambió, a partir del <strong>${escapeHtml(fecha)}</strong> el cobro ${sube ? "sube" : "baja"}:
    </p>
    <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#9A3412">
      Hoy: <strong>${pesos(precioActual)}</strong> por mes · Desde el ${escapeHtml(fecha)}: <strong>${pesos(precioNuevo)}</strong> por mes
      <br/><span style="font-size:12px">Dólar oficial usado: ${pesos(cotizacion)}${periodo === "anual" ? " · Tu plan es anual: se cobran 12 meses juntos al renovar." : ""}</span>
    </div>
    <p style="margin:0 0 16px;color:#444;font-size:14px">No tenés que hacer nada. Si querés cambiar de plan o darlo de baja, podés hacerlo antes de esa fecha.</p>
    ${btn(`${url}?screen=config`, "Ver mi plan →")}
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Cambio en el precio de tu plan desde el ${fecha} — ${empresa}`,
    html: buildHtml("Cambio de precio", empresa, cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("aviso_precio", empresaId),
  }).catch((e) => logger.error("email sendAvisoPrecio", e));
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
export async function sendInvitacionEmpleado({ to, nombre, empresa, codigo, link, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const cuerpo = `
    <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      <strong>${escapeHtml(empresa)}</strong> te sumó a Gypi. Para activar tu cuenta
      tocá el botón y creá tu contraseña.
    </p>
    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:14px 18px;margin:0 0 20px;font-size:14px;color:#0C4A6E">
      Tu código de activación: <strong style="font-family:monospace;letter-spacing:1px">${escapeHtml(String(codigo))}</strong><br>
      <span style="font-size:12px">Vale por 14 días y se usa una sola vez.</span>
    </div>
    ${btn(link, "Activar mi cuenta →")}
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

// ─── Tarjetas con QR del equipo recién cargado (R10) ───
// Van al email del dueño con las tarjetas listas para imprimir como adjunto:
// así no las pierde si cierra la pantalla del alta. Devuelve true si salió.
export async function sendTarjetasQR({ to, empresa, tarjetas, htmlImprimible, empresaId }) {
  if (!process.env.RESEND_API_KEY) return false;
  const filas = tarjetas.map((t) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #E5E5E3">${escapeHtml(t.nombre)}<br><a href="${escapeHtml(t.link)}" style="font-size:12px;color:#F97316">Link para activar</a></td>
        <td style="padding:8px 0;border-bottom:1px solid #E5E5E3;font-family:monospace;text-align:right">${escapeHtml(t.codigo)}</td>
      </tr>`).join("");
  const cuerpo = `
    <p style="margin:0 0 16px;color:#444;line-height:1.6">
      Te mandamos las tarjetas de acceso de tu equipo. Abrí el archivo adjunto
      (mejor desde la computadora), imprimilo y dale a cada persona la suya: escanean
      el QR con el celular y crean su contraseña. Si alguien está lejos, reenviale su link.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">${filas}</table>
    <p style="margin:0;font-size:12px;color:#9B9B9B">Cada código sirve una sola vez y vence a los 14 días. Si alguno se pierde, generás uno nuevo desde Personal.</p>
  `;
  try {
    const r = await resend.emails.send({
      from: FROM,
      to,
      subject: `Tarjetas de acceso para tu equipo — ${empresa}`,
      html: buildHtml("Tarjetas de acceso", empresa, cuerpo),
      text: stripHtml(cuerpo),
      attachments: [{ filename: "tarjetas-gypi.html", content: Buffer.from(htmlImprimible).toString("base64") }],
      tags: buildTags("tarjetas_qr", empresaId),
    });
    if (r?.error) { logger.error("email sendTarjetasQR", r.error); return false; }
    return true;
  } catch (e) {
    logger.error("email sendTarjetasQR", e);
    return false;
  }
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

// ─── Consulta general desde /contacto (notificación interna al equipo de Gypi) ───
export async function sendConsultaContacto({ nombre, email, telefono, mensaje }) {
  if (!process.env.RESEND_API_KEY) return;
  const destino = process.env.ENTERPRISE_CONTACT_EMAIL || "contacto@gypi.app";
  const cuerpo = `
    <p style="margin:0 0 12px">Nuevo mensaje desde el formulario de contacto de la web.</p>
    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#0C4A6E">
      <p style="margin:0 0 6px"><strong>Nombre:</strong> ${escapeHtml(nombre)}</p>
      <p style="margin:0 0 6px"><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${telefono ? `<p style="margin:0 0 6px"><strong>Teléfono:</strong> ${escapeHtml(telefono)}</p>` : ""}
      <p style="margin:0"><strong>Mensaje:</strong> ${escapeHtml(mensaje)}</p>
    </div>
    <p style="margin:0;font-size:12px;color:#9B9B9B">Respondé directamente a este email — el reply-to apunta al contacto.</p>
  `;
  return resend.emails.send({
    from: FROM,
    to: destino,
    replyTo: email,
    subject: `Nuevo mensaje de contacto — ${nombre}`,
    html: buildHtml("Contacto", nombre, cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("consulta_contacto"),
  }).catch((e) => logger.error("email sendConsultaContacto", e));
}

// ─── Baja de cuenta (F6-01, ítem 28) ───
export async function sendBajaProgramada({ to, empresa, borradoEl, linkReactivar, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const fecha = new Date(borradoEl).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });
  const cuerpo = `
    <p style="margin:0 0 16px;color:#444;line-height:1.6">Dimos de baja la cuenta de <strong>${escapeHtml(empresa)}</strong> en Gypi. Nadie puede entrar y no se te va a cobrar más.</p>
    <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:16px;margin:0 0 20px;font-size:14px;color:#9A3412">
      El <strong>${escapeHtml(fecha)}</strong> borramos de forma definitiva todos los datos: empleados, fichadas, tareas, documentos y fotos.
    </div>
    <p style="margin:0 0 8px;color:#444;font-size:14px">¿Fue un error o cambiaste de idea? Hasta esa fecha podés recuperar la cuenta tal como estaba:</p>
    ${btn(linkReactivar, "Recuperar mi cuenta")}
    <p style="margin:20px 0 0;font-size:12px;color:#9B9B9B">Si necesitás una copia de los datos y no la descargaste, escribinos a contacto@gypi.app antes de esa fecha.</p>
  `;
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Diste de baja ${empresa} en Gypi`,
    html: buildHtml("Cuenta dada de baja", empresa, cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("baja_programada", empresaId),
  });
}

// ─── Resumen semanal para el dueño (D10, ítem 31) ───
function fmtFecha(f) {
  const [, m, d] = String(f).split("-");
  return `${Number(d)}/${Number(m)}`;
}

export function htmlResumenSemanal({ empresa, slug, resumen: r }) {
  const fila = (izq, der, color = "#1A1A1A") =>
    `<tr><td style="padding:6px 0;color:#555;font-size:14px">${izq}</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:14px;color:${color}">${der}</td></tr>`;
  const titulo = (t) => `<p style="margin:24px 0 6px;font-size:13px;font-weight:800;color:#9A3412;text-transform:uppercase;letter-spacing:.04em">${t}</p>`;
  const tabla = (filas) => `<table style="width:100%;border-collapse:collapse">${filas}</table>`;

  const ots = r.ots.length
    ? tabla(r.ots.map((o) => fila(`OT ${escapeHtml(o.ot)}${o.detalle ? ` <span style="color:#9B9B9B">· ${escapeHtml(o.detalle)}</span>` : ""}`, `${o.horas} h`)).join(""))
      + (r.otrasOTs ? `<p style="margin:4px 0 0;font-size:12px;color:#9B9B9B">Y ${r.otrasOTs} OT más.</p>` : "")
    : `<p style="margin:0;color:#9B9B9B;font-size:14px">No se cargaron tareas sobre OT.</p>`;

  const muerto = r.tiempoMuerto.horas > 0
    ? `<p style="margin:0 0 6px;font-size:14px;color:#444"><strong>${r.tiempoMuerto.horas} h</strong> (${r.tiempoMuerto.porcentaje}% del tiempo cargado)</p>`
      + tabla(r.tiempoMuerto.causas.map((c) => fila(escapeHtml(c.causa), `${c.horas} h`, "#DC2626")).join(""))
    : `<p style="margin:0;color:#9B9B9B;font-size:14px">Sin tiempo muerto registrado.</p>`;

  const faltas = r.faltasSinAviso.length
    ? tabla(r.faltasSinAviso.slice(0, 10).map((f) => fila(escapeHtml(f.nombre || `Legajo ${f.legajo}`), `${f.dias} día${f.dias > 1 ? "s" : ""}`, "#DC2626")).join(""))
      + (r.faltasSinAviso.length > 10 ? `<p style="margin:4px 0 0;font-size:12px;color:#9B9B9B">Y ${r.faltasSinAviso.length - 10} persona(s) más.</p>` : "")
    : `<p style="margin:0;color:#9B9B9B;font-size:14px">Nadie faltó sin aviso.</p>`;

  const cuerpo = `
    <p style="margin:0 0 16px;color:#444;line-height:1.6">Esto pasó en <strong>${escapeHtml(empresa)}</strong> del ${fmtFecha(r.desde)} al ${fmtFecha(r.hasta)}.</p>
    ${tabla(
      fila("Horas fichadas", `${r.horasFichadas} h`)
      + fila("Horas cargadas en OT", `${r.horasEnOTs} h`)
      + fila("Llegadas tarde", String(r.tardanzas), r.tardanzas ? "#DC2626" : "#1A1A1A")
      + fila("Días con ausencia justificada", String(r.diasJustificados))
    )}
    ${titulo("Horas por OT")}${ots}
    ${titulo("Tiempo muerto")}${muerto}
    ${titulo("Faltas sin aviso")}${faltas}
    ${btn(`${APP_BASE}/${slug}`, "Ver el detalle en Gypi →")}
    <p style="margin:20px 0 0;font-size:12px;color:#9B9B9B">¿No querés recibirlo? Desactivalo en Gestión → Configuración → Empresa.</p>
  `;
  return cuerpo;
}

export async function sendResumenSemanal({ to, empresa, slug, resumen, empresaId }) {
  if (!process.env.RESEND_API_KEY) return;
  const cuerpo = htmlResumenSemanal({ empresa, slug, resumen });
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Tu semana en ${empresa}: ${resumen.horasFichadas} h fichadas`,
    html: buildHtml("Resumen semanal", `${fmtFecha(resumen.desde)} al ${fmtFecha(resumen.hasta)}`, cuerpo),
    text: stripHtml(cuerpo),
    tags: buildTags("resumen_semanal", empresaId),
  });
}
