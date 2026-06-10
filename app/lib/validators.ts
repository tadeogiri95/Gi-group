import type { ValidacionPassword } from "../types";

export function validarPassword(pw: unknown): ValidacionPassword {
  if (!pw || typeof pw !== "string") {
    return { valido: false, error: "La contraseña es requerida" };
  }
  if (pw.length < 8) {
    return { valido: false, error: "La contraseña debe tener al menos 8 caracteres" };
  }
  if (!/[A-Z]/.test(pw)) {
    return { valido: false, error: "Debe contener al menos una letra mayúscula" };
  }
  if (!/[a-z]/.test(pw)) {
    return { valido: false, error: "Debe contener al menos una letra minúscula" };
  }
  if (!/[0-9]/.test(pw)) {
    return { valido: false, error: "Debe contener al menos un número" };
  }
  return { valido: true };
}
