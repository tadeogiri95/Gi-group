// Mensajes mostrados al volver de /api/auth/google/callback con
// ?oauth_error=<code>. Usado tanto en LoginScreen (intent=login) como en
// la landing (intent=registro, ver app/page.js) — un solo lugar para que
// ambas pantallas no diverjan en la redacción.
const MENSAJES = {
  cancelado: "Cancelaste el inicio de sesión con Google.",
  no_account: "No encontramos una cuenta con ese email. Si te invitaron a una empresa, pedile a un administrador que revise tu acceso. Si no tenés empresa todavía, podés registrar una nueva.",
  multiples_cuentas: "Tu cuenta de Google está vinculada a más de una empresa en Gypi. Ingresá desde el link específico de tu empresa (gypi.app/tu-empresa).",
  empresa_no_encontrada: "No se encontró la empresa.",
  email_no_verificado: "Tu cuenta de Google no tiene el email verificado.",
  email_en_uso: "Ya existe una empresa registrada con ese email.",
  slug_en_uso: "Ese nombre de empresa ya está en uso. Intentá de nuevo.",
  demasiados_intentos: "Demasiados intentos. Probá de nuevo en unos minutos.",
  state_invalido: "La sesión con Google expiró. Probá de nuevo.",
  solicitud_invalida: "Solicitud inválida.",
  no_configurado: "El inicio de sesión con Google no está disponible en este momento.",
};

export function getOauthErrorMessage(code) {
  return MENSAJES[code] || "No se pudo completar el inicio de sesión con Google. Intentá de nuevo.";
}
