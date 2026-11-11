// app/lib/agendaCache.js — la agenda de personas leída una vez por pantalla
// abierta (la usan FinanzasElegirProveedor y Nueva operación). Se olvida
// después de cambiar algo en 📇 Personas o de dar de alta con ➕ Nuevo.
import { apiFetch } from "./supabase";

let agendaGuardada = null;
let pedido = null;

/** Se olvida la agenda leída: la próxima pantalla la vuelve a pedir. */
export function olvidarAgenda() {
  agendaGuardada = null;
  pedido = null;
}

/** La agenda ya leída, o null. */
export const agendaLeida = () => agendaGuardada;

/** Pide la agenda (una sola vez aunque la pidan varios a la vez). */
export function leerAgenda() {
  pedido = pedido || apiFetch("/api/finanzas/personas")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (Array.isArray(d?.agenda) ? d.agenda : []))
    .catch(() => []);
  const este = pedido;
  return este.then((a) => { if (pedido === este) agendaGuardada = a; return a; });
}
