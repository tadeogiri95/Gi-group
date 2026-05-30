// ═══════════════════════════════════════════════════════════
// app/lib/passwords.js — Contraseñas iniciales seguras
//
// PROBLEMA QUE RESUELVE:
// Antes todos los empleados nuevos se creaban con la misma clave fija
// "gigroup2025", escrita en el código a la vista de cualquiera. Ahora
// cada empleado nuevo recibe una clave inicial aleatoria distinta, que
// igualmente debe cambiar en su primer ingreso (debe_cambiar_password).
//
// USO en gestion_personal_screen.jsx:
//   import { passwordInicial } from "./lib/passwords";
//   ...
//   password: passwordInicial(),
//   debe_cambiar_password: true,
// ═══════════════════════════════════════════════════════════

export function passwordInicial() {
  // 10 caracteres alfanuméricos aleatorios. El empleado igual la cambia
  // en el primer login, así que no hace falta que sea memorizable.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const arr = new Uint32Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
    for (let i = 0; i < 10; i++) out += chars[arr[i] % chars.length];
  } else {
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
