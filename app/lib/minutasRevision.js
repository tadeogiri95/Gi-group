// app/lib/minutasRevision.js — Revisión del día anterior al empezar la minuta
// (Tadeo, 02/11; migración 155). Gypi trae de la minuta anterior:
//   · alerta: lo que estaba en amarillo o rojo (en curso, pendientes,
//     post-venta) → "¿Se mitigó?"
//   · fecha: lo que tenía fecha objetivo desde ese día hasta ayer → "¿Se cumplió?"
//   · compra: las compras a disparar → "¿Se hizo?", con el estado del pedido
//     en Compras si se creó desde la minuta (si ya hay pedido, queda en Sí).
// Cada pregunta es un renglón de la sección 'revision'; el renglón de origen
// va en datos.de (no en viene_de, que es la cadena del seguimiento).
import { idRenglon } from "./minutas";

export const SECCION_REVISION = "revision";
const ALERTAS = ["prod_en_curso", "inst_en_curso", "inst_pendiente", "postventa"];
const CON_FECHA = ["prod_en_curso", "inst_en_curso", "inst_pendiente", "postventa", "estacionamiento"];

export const TIPOS_REVISION = [
  { id: "alerta", titulo: "Alertas amarillas y rojas", pregunta: "¿Se mitigó?", si: "✓ Se mitigó", no: "✗ Sigue" },
  { id: "fecha", titulo: "Fechas objetivo que vencían", pregunta: "¿Se cumplió?", si: "✓ Se cumplió", no: "✗ No se cumplió" },
  { id: "compra", titulo: "Compras a disparar", pregunta: "¿Se hizo?", si: "✓ Se hizo", no: "✗ No se hizo" },
];
export const tipoRevision = (id) => TIPOS_REVISION.find((t) => t.id === id) || TIPOS_REVISION[0];

export const ESTADO_PEDIDO = {
  pendiente: "pedido creado, falta la orden de compra",
  en_oc: "ya está en una orden de compra",
  recibido: "ya se recibió",
  anulado: "el pedido se anuló",
};

const NOMBRE_SECCION = {
  prod_en_curso: "Producción en curso", inst_en_curso: "Instalación en curso", inst_pendiente: "Pendiente de instalación",
  postventa: "Post-venta", estacionamiento: "Estacionamiento", compra: "Compra",
};

/**
 * Las preguntas de la revisión, armadas con los renglones de la minuta anterior.
 * @param {{ anterior: string|null, items: object[], pedidos?: { id, estado }[], hoy: string, ya?: object[] }} p
 *   items: renglones de la minuta anterior; ya: los renglones de hoy (para no repetir)
 * @returns {object[]} renglones nuevos de la sección 'revision'
 */
export function armarRevision({ anterior, items = [], pedidos = [], hoy, ya = [] }) {
  if (!anterior) return [];
  const hechos = new Set(ya.filter((it) => it.seccion === SECCION_REVISION).map((it) => `${it.tipo}|${it.datos?.de}`));
  const estadoPedido = new Map(pedidos.map((p) => [String(p.id), p.estado]));
  const base = (it, tipo, extra = {}) => ({
    id: idRenglon(), seccion: SECCION_REVISION, tipo,
    ot: it.ot || null, division: it.division || null, proyecto: it.proyecto || null, cliente: it.cliente || null,
    semaforo: it.semaforo || null, texto: it.texto || "", responsable: it.responsable || "", fecha_objetivo: it.fecha_objetivo || null,
    datos: { de: it.id, seccion_ayer: it.seccion, fecha_ayer: anterior, ...extra },
  });
  const out = [];
  for (const it of items) {
    if (it.resuelto_at) continue;
    if (ALERTAS.includes(it.seccion) && (it.semaforo === "amarillo" || it.semaforo === "rojo")) out.push(base(it, "alerta"));
    if (CON_FECHA.includes(it.seccion) && it.fecha_objetivo && it.fecha_objetivo >= anterior && it.fecha_objetivo < hoy) out.push(base(it, "fecha"));
    if (it.seccion === "compra") {
      const pid = it.datos?.pedido_id != null ? String(it.datos.pedido_id) : null;
      const estado = pid ? estadoPedido.get(pid) || "pendiente" : null;
      out.push(base(it, "compra", {
        ...(pid ? { pedido_id: pid, pedido_estado: estado } : {}),
        ...(estado && estado !== "anulado" ? { resultado: "si" } : {}),
      }));
    }
  }
  return out.filter((r) => !hechos.has(`${r.tipo}|${r.datos.de}`));
}

/** Qué se está revisando, en una línea: "OT 7751 · Producción en curso · Falta herraje". */
export function textoRevision(it) {
  const d = it.datos || {};
  return [it.ot ? `OT ${it.ot}` : it.proyecto, NOMBRE_SECCION[d.seccion_ayer], it.texto].filter(Boolean).join(" · ");
}

/**
 * Lo que dio la revisión en un período (para el informe).
 * @returns {{ total, porTipo: { id, titulo, total, si, no, sinRespuesta, pct }[], no: object[] }}
 */
export function resumenRevision(items = []) {
  const rev = items.filter((it) => it.seccion === SECCION_REVISION);
  const porTipo = TIPOS_REVISION.map((t) => {
    const l = rev.filter((it) => it.tipo === t.id);
    const si = l.filter((it) => it.datos?.resultado === "si").length;
    const no = l.filter((it) => it.datos?.resultado === "no").length;
    return { id: t.id, titulo: t.titulo, total: l.length, si, no, sinRespuesta: l.length - si - no, pct: si + no ? Math.round((si / (si + no)) * 100) : null };
  });
  return { total: rev.length, porTipo, no: rev.filter((it) => it.datos?.resultado === "no") };
}
