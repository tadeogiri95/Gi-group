// app/lib/pedidoProblema.js — De un problema a un pedido de compra (auditoría
// del 12/11, parte 8; migración 185). Un pendiente de obra, una falla de una
// máquina o un arreglo de un vehículo que necesita material se pide desde ahí
// mismo: el pedido va a Compras → A comprar con de dónde salió, y el problema
// muestra en qué está su pedido.

/** De dónde puede salir un pedido: tabla, texto y si lleva OT. */
export const ORIGENES_PEDIDO = {
  pendiente_obra: { tabla: "pendientes_obra", nombre: "Pendiente de obra", conOt: true },
  falla_maquina: { tabla: "maquina_fallas", nombre: "Falla de máquina", conOt: false },
  arreglo_vehiculo: { tabla: "vehiculo_arreglos", nombre: "Arreglo de vehículo", conOt: false },
};

const ESTADO = { pendiente: "por comprar", en_oc: "en orden de compra", recibido: "recibido", anulado: "anulado" };

/** La observación del pedido: para qué es (la ve el comprador en A comprar). */
export function notaDelProblema(origen, texto, extra = "") {
  const o = ORIGENES_PEDIDO[origen];
  const base = `${o ? o.nombre : "Problema"}: ${String(texto || "").replace(/\s+/g, " ").trim()}`;
  return [base, String(extra || "").trim()].filter(Boolean).join(" · ").slice(0, 300);
}

/** "🛒 2 pedidos: Correa A-42 (por comprar), Aceite (recibido)" — sin los anulados. */
export function textoPedidosProblema(pedidos = []) {
  const vivos = pedidos.filter((p) => p.estado !== "anulado");
  if (!vivos.length) return "";
  const partes = vivos.slice(0, 3).map((p) => `${p.descripcion} (${ESTADO[p.estado] || p.estado})`);
  return `🛒 ${vivos.length === 1 ? "1 pedido" : `${vivos.length} pedidos`}: ${partes.join(", ")}${vivos.length > 3 ? "…" : ""}`;
}

/** Los pedidos de cada problema: "origen:id" → pedidos. */
export function pedidosPorProblema(pedidos = []) {
  const out = new Map();
  for (const p of pedidos) {
    if (!p.origen || p.origen_id == null) continue;
    const k = `${p.origen}:${p.origen_id}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(p);
  }
  return out;
}
