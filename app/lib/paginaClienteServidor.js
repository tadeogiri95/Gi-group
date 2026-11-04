// app/lib/paginaClienteServidor.js — Lee lo de la página del cliente
// (/ot/<código>, 04/11). Sin sesión: va con service_role, siempre filtrado por
// la empresa y la OT del código firmado (linkClienteOt.js). Cada consulta que
// falla (una migración que no se corrió) deja ese dato vacío; la página sale
// igual. Lo que se muestra lo arma datosClienteOt, campo por campo.
import { sbGet } from "./sbHelpers";
import { datosClienteOt } from "./paginaClienteOt";
import { CLAVE_PDF_OT } from "./pdfOt";
import { CLAVE_FECHA_OBJETIVO, normalizarModo } from "./semanaObjetivo";

const silencio = { silent: true, fallback: [] };

/** Datos de la página, o null si la OT no existe (o la empresa no tiene OT). */
export async function datosPaginaCliente({ empresaId, ot }) {
  const e = encodeURIComponent(empresaId);
  const o = encodeURIComponent(ot);
  const [empresas, proyectos] = await Promise.all([
    sbGet(`empresa?id=eq.${e}&select=nombre,logo_url,color_primario&limit=1`, silencio),
    sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${o}&select=*&limit=1`, silencio),
  ]);
  const proyecto = proyectos?.[0];
  if (!empresas?.[0] || !proyecto) return null;
  const [avance, reportes, actas, pausas, cfgPdf, cfgModo] = await Promise.all([
    sbGet(`v_avance_piezas?empresa_id=eq.${e}&ot=eq.${o}&select=ot,etapa,total,pasaron`, silencio),
    sbGet(`reportes_instalacion?empresa_id=eq.${e}&ot=eq.${o}&avance=not.is.null&select=avance&order=created_at.desc&limit=1`, silencio),
    sbGet(`actas_ot?empresa_id=eq.${e}&ot=eq.${o}&firmada_at=not.is.null&select=firmada_at&order=firmada_at.desc&limit=1`, silencio),
    sbGet(`pausas_ot?empresa_id=eq.${e}&ot=eq.${o}&hasta=is.null&select=id&limit=1`, silencio),
    sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PDF_OT}&select=valor&limit=1`, silencio),
    sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_FECHA_OBJETIVO}&select=valor&limit=1`, silencio),
  ]);
  return datosClienteOt({
    proyecto,
    avance: Array.isArray(avance) ? avance : [],
    instalacion: reportes?.[0]?.avance ?? null,
    acta: actas?.[0] || null,
    pausa: pausas?.[0] || null,
    archivos: cfgPdf?.[0]?.valor?.hash ? cfgPdf[0].valor.archivos || [] : null,
    modo: normalizarModo(cfgModo?.[0]?.valor?.modo),
    empresa: empresas[0],
  });
}
