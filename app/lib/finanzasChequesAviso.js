// app/lib/finanzasChequesAviso.js — Finanzas, parte F2b (1): el aviso al
// celular del día anterior a cada vencimiento de cheque (migración 174). Lo
// corre el cron diario de las 7 (api/cron/flota-alertas). Solo a los Dueños
// (rol gerencial): Finanzas es solo de ellos. No repite: anota en cada cheque
// para qué fecha ya se avisó (fin_cheques.avisado_para).
import { sbGetAll, sbPatch } from "./sbHelpers";
import { enviarPushLegajos } from "./pushGerencia";
import { chequesParaAvisar, textoAviso } from "./finanzasCheques";

/**
 * @param {{ id: string }} empresa
 * @param {string} hoy YYYY-MM-DD
 * @param {{ messaging?: object }} [opts] para pruebas
 * @returns {Promise<{ cheques: number, push: number }>}
 */
export async function avisarCheques(empresa, hoy, { messaging } = {}) {
  const e = empresa.id;
  const manana = new Date(Date.parse(`${hoy}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const { data: vivos } = await sbGetAll(`fin_cheques?empresa_id=eq.${e}&estado=in.(pendiente,en_cartera)&fecha_pago=lte.${manana}&select=id,clase,estado,importe,fecha_pago,avisado_para&order=fecha_pago.asc`);
  const avisar = chequesParaAvisar(vivos, hoy);
  if (!avisar.length) return { cheques: 0, push: 0 };
  const mensaje = textoAviso(avisar);
  const { data: duenos } = await sbGetAll(`empleados?empresa_id=eq.${e}&rol=eq.gerencial&activo=eq.true&select=legajo&order=legajo.asc`);
  const push = await enviarPushLegajos(e, duenos.map((d) => d.legajo), { ...mensaje, data: { tipo: "fin_cheques" } }, { messaging });
  for (const ch of avisar) {
    await sbPatch(`fin_cheques?id=eq.${ch.id}&empresa_id=eq.${e}`, { avisado_para: ch.fecha_pago });
  }
  return { cheques: avisar.length, push };
}
