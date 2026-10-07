// app/lib/restaurarSesion.js — Restaura la sesión al abrir la app (F1-03).
//
// Las cookies httpOnly de sesión duran 30 días (y se renuevan con el uso),
// pero el usuario solo vivía en sessionStorage, que la app instalada borra al
// cerrarse: había que volver a escribir legajo y contraseña cada día. Ahora,
// si no hay usuario en memoria, se le pregunta al servidor quién es el dueño
// de las cookies (renovándolas si el acceso de 30 min venció).
import { refrescarSesion } from "./supabase";

/**
 * @param {string | undefined} slug empresa del link abierto
 * @returns {Promise<object | null>} el usuario, o null si no hay sesión válida
 *   para esa empresa (un link de otra empresa muestra su propio login).
 */
export async function restaurarSesion(slug) {
  try {
    const pedirMe = () => fetch("/api/me", { credentials: "include", cache: "no-store" });
    let r = await pedirMe();
    if (r.status === 401) {
      if (!(await refrescarSesion())) return null;
      r = await pedirMe();
    }
    if (!r.ok) return null;
    const { usuario } = await r.json();
    if (!usuario?.id) return null;
    if (slug && usuario.empresa?.slug && usuario.empresa.slug !== slug) return null;
    return usuario;
  } catch {
    return null;
  }
}
