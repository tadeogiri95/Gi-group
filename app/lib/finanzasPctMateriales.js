// app/lib/finanzasPctMateriales.js — El % de materiales de la empresa (19/11,
// punto 9: uno solo para toda Finanzas). Se guarda en config_sistema
// "finanzas_resultados" (materiales_pct; 30 % si no se cambió). Solo servidor.
import { sbGet } from "./sbHelpers";
import { CLAVE_RESULTADOS, configResultados } from "./finanzasResultados";
import { factorDePct } from "./finanzasOtClientes";

/** { materiales_pct, materiales_real?, ponderador } de la empresa. */
export async function configMateriales(empresaId) {
  const [fila] = (await sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_RESULTADOS}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  return configResultados(fila?.valor);
}

/** El factor para las OT sin precio (0,3 = 30 %). */
export async function factorMateriales(empresaId) {
  return factorDePct((await configMateriales(empresaId)).materiales_pct);
}
