// app/lib/valorOtServidor.js — El valor de cada OT, igual en toda la app
// (Tadeo, 23/11): primero el PRECIO del Plan de trabajo (sin IVA, precios_ot,
// 142) y, si no tiene, una estimación por los materiales cargados como
// necesidad de la OT (costo de materiales ÷ el % de materiales de Finanzas →
// Configuración, 30 % por defecto). Es el mismo cálculo que la cuenta
// corriente de clientes y el Estado de Resultados (valorOt). Solo servidor.
import { sbGetAll } from "./sbHelpers";
import { leerPreciosOt, materialesDeOts } from "./finanzasMaterialesOt";
import { factorMateriales } from "./finanzasPctMateriales";
import { combinarValores } from "./finanzasOtClientes";

const lista = (xs) => xs.map((s) => `%22${encodeURIComponent(s)}%22`).join(",");

/**
 * Valor de las OT de la empresa (o solo de `ots`).
 * @param {object|null} sesion la del usuario (con RLS_RUTAS, sus permisos)
 * @param {string} empresaId
 * @param {{ ots?: string[] }} [opts] solo esas OT (sin `ots`, todas)
 * @returns {Promise<Map<string, { valor: number, estimado: boolean }>>} solo las OT con valor
 */
export async function valoresDeOts(sesion, empresaId, { ots = null } = {}) {
  const e = empresaId;
  const pedidas = ots ? [...new Set(ots.map(String))].filter(Boolean) : null;
  if (pedidas && !pedidas.length) return new Map();
  const leerProyectos = async () => {
    const opts = { sesion, maxFilas: 20000 };
    if (!pedidas) return (await sbGetAll(`proyectos?empresa_id=eq.${e}&select=ot,created_at&order=id.asc`, opts)).data || [];
    const out = [];
    for (let i = 0; i < pedidas.length; i += 80) {
      out.push(...((await sbGetAll(`proyectos?empresa_id=eq.${e}&ot=in.(${lista(pedidas.slice(i, i + 80))})&select=ot,created_at`, opts)).data || []));
    }
    return out;
  };
  const [precios, proyectos] = await Promise.all([leerPreciosOt(sesion, e), leerProyectos().catch(() => [])]);
  const sinPrecio = proyectos.filter((p) => p.ot && !(precios.get(String(p.ot)) > 0));
  const [materiales, factor] = await Promise.all([
    sinPrecio.length ? materialesDeOts(sesion, sinPrecio, e).catch(() => new Map()) : new Map(),
    factorMateriales(e).catch(() => undefined),
  ]);
  const todos = combinarValores({ precios, materiales, factor });
  if (!pedidas) return todos;
  const quedan = new Set(pedidas);
  return new Map([...todos].filter(([ot]) => quedan.has(ot)));
}
