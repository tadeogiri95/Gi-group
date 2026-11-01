// app/lib/minutasPrecargaServidor.js — Consultas de lo que Gypi sugiere para
// la minuta (Minuta, parte M2). Lo usa GET /api/minutas?precarga=AAAA-MM-DD
// con el pase del usuario. Solo lee; si falta alguna migración (escaneo,
// plan, carga, acta, stock), esa sección sale sin sugerencias.
import { sbGetAll } from "./sbHelpers";
import { armarPrecarga, habilSiguiente, ventanaAyer } from "./minutasPrecarga";
import { porcentajeOt } from "./piezas";

// Para no armar consultas enormes: las OT con material que se miran
const MAX_OTS_MATERIAL = 150;

/** OT abiertas con avance por escaneo entre 0 y 100 %. */
function enCursoPorEscaneo(proyectos, avancePiezas) {
  const filas = new Map();
  for (const f of avancePiezas) {
    const ot = String(f.ot);
    if (!filas.has(ot)) filas.set(ot, []);
    filas.get(ot).push(f);
  }
  const abiertas = new Set(proyectos.filter((p) => p.estado !== "cerrado" && !p.terminado_planilla).map((p) => String(p.ot)));
  return [...filas].filter(([ot, fs]) => { const x = porcentajeOt(fs); return abiertas.has(ot) && x > 0 && x < 100; }).map(([ot]) => ot);
}

const vacio = () => ({ data: [] });
const lista = (vals) => vals.map((v) => `"${encodeURIComponent(String(v).replace(/"/g, ""))}"`).join(",");

/** De los planes confirmados, el último de cada división (como el Gantt). */
function planesVigentes(planes) {
  const ultimo = new Map();
  const clave = (x) => `${x.confirmado_at || ""}|${x.desde || ""}`;
  for (const p of planes) {
    const k = p.division_id || "";
    if (!ultimo.has(k) || clave(p) > clave(ultimo.get(k))) ultimo.set(k, p);
  }
  return [...ultimo.values()];
}

/**
 * @param {string} empresaId
 * @param {string} fecha YYYY-MM-DD
 * @param {{ sesion?: object }} [opts]
 */
export async function precargaMinuta(empresaId, fecha, { sesion } = {}) {
  const e = empresaId;
  const opts = { sesion };
  const { desde } = ventanaAyer(fecha);
  const manana = habilSiguiente(fecha);
  const [proyectos, avancePiezas, pasos, planes, actas, cargas, pendientes] = await Promise.all([
    sbGetAll(`proyectos?empresa_id=eq.${e}&select=ot,estado,terminado_planilla,fecha_entrega&order=id.asc`, opts),
    sbGetAll(`v_avance_piezas?empresa_id=eq.${e}&select=ot,etapa,total,pasaron`, opts).catch(vacio),
    sbGetAll(`pasos_pieza?empresa_id=eq.${e}&created_at=gte.${encodeURIComponent(desde)}&select=ot,created_at&order=id.asc`, { ...opts, maxFilas: 50000 }).catch(vacio),
    sbGetAll(`planes_produccion?empresa_id=eq.${e}&estado=eq.confirmado&hasta=gte.${fecha}&select=id,desde,division_id,confirmado_at&order=desde.asc`, opts).catch(vacio),
    sbGetAll(`actas_ot?empresa_id=eq.${e}&firmada_at=not.is.null&select=ot,firmada_at`, opts).catch(vacio),
    sbGetAll(`cargas_ot?empresa_id=eq.${e}&firma_carga_at=not.is.null&select=ot,firma_carga_at`, opts).catch(vacio),
    sbGetAll(`pendientes_obra?empresa_id=eq.${e}&resuelto=eq.false&select=id,ot,descripcion,fecha,resuelto,created_at&order=created_at.asc`, opts).catch(vacio),
  ]);

  // Lo que el plan confirmado pone hoy y el día hábil siguiente
  const vigentes = planesVigentes(planes.data);
  const planItems = vigentes.length
    ? (await sbGetAll(`plan_produccion_items?empresa_id=eq.${e}&plan_id=in.(${vigentes.map((p) => p.id).join(",")})&fecha=gte.${fecha}&fecha=lte.${manana}&select=ot,fecha&order=fecha.asc`, opts).catch(vacio)).data
    : [];

  // Material de las OT que arrancan y de las que están en curso: lo que les
  // falta retirar contra el stock (¿planilla y material? y compras a disparar)
  const enCurso = enCursoPorEscaneo(proyectos.data, avancePiezas.data);
  const ots = [...new Set([...planItems.map((i) => String(i.ot)), ...enCurso])].slice(0, MAX_OTS_MATERIAL);
  let necesidades = [], movimientos = [], articulos = [];
  if (ots.length) {
    const [n, m] = await Promise.all([
      sbGetAll(`necesidades_stock?empresa_id=eq.${e}&ot=in.(${lista(ots)})&select=ot,sku,cantidad`, opts).catch(vacio),
      sbGetAll(`movimientos_stock?empresa_id=eq.${e}&ot=in.(${lista(ots)})&tipo=in.(consumo,devolucion)&select=ot,sku,cantidad,tipo,anulado&order=id.asc`, opts).catch(vacio),
    ]);
    necesidades = n.data;
    movimientos = m.data;
    const skus = [...new Set(necesidades.map((x) => x.sku))];
    if (skus.length) articulos = (await sbGetAll(`articulos_stock?empresa_id=eq.${e}&sku=in.(${lista(skus)})&select=sku,nombre,unidad,stock,en_transito`, opts).catch(vacio)).data;
  }

  return armarPrecarga({
    fecha,
    proyectos: proyectos.data,
    avancePiezas: avancePiezas.data,
    pasos: pasos.data,
    planItems,
    actas: actas.data,
    cargas: cargas.data,
    pendientes: pendientes.data,
    necesidades,
    movimientos,
    articulos,
  });
}
