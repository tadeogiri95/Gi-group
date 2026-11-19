// app/lib/finanzasCuentasCorrientes.js — Finanzas → 📒 Cuentas corrientes
// (pedido de Tadeo del 19/11): clientes y proveedores en una sola lista,
// porque hay clientes que también son proveedores y al revés. Sin migración.
//
// Las cuentas siguen separadas en el libro (Deudores por Ventas y
// Proveedores); lo que se junta es la vista. Un cliente y un proveedor
// unidos (🔗 Cliente y proveedor, app/lib/finanzasUnificados.js) son un solo
// renglón con lo que nos debe, lo que le debemos y el neto.

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Los filtros de la lista, en el orden en que se muestran. */
export const FILTROS_CC = {
  saldo: "Con saldo",
  clientes: "Clientes",
  proveedores: "Proveedores",
  ambos: "Clientes y proveedores",
  todos: "Todos",
};

/**
 * Un renglón por persona: el cliente, el proveedor o los dos si están unidos.
 * @param {{ clientes?: object[], proveedores?: object[], pares?: { cliente_id: number, proveedor_id: number }[] }} d
 *   clientes = saldosClientes(...), proveedores = saldosProveedores(...)
 * @returns {{ clave: string, nombre: string, tipo: "cliente"|"proveedor"|"ambos", cliente: object|null, proveedor: object|null,
 *   nos_debe: number, le_debemos: number, neto: number, ultimo: string }[]}
 */
export function cuentasCorrientes({ clientes = [], proveedores = [], pares = [] } = {}) {
  const porCliente = new Map(clientes.map((c) => [c.clave, c]));
  const porProveedor = new Map(proveedores.map((p) => [p.clave, p]));
  const usados = new Set();
  const renglon = (cliente, proveedor) => {
    const nosDebe = centavos(cliente?.saldo);
    const leDebemos = centavos(proveedor?.deuda);
    return {
      clave: [cliente?.clave, proveedor?.clave].filter(Boolean).join("+"),
      nombre: cliente?.nombre || proveedor?.nombre || "",
      tipo: cliente && proveedor ? "ambos" : cliente ? "cliente" : "proveedor",
      cliente: cliente || null,
      proveedor: proveedor || null,
      nos_debe: nosDebe,
      le_debemos: leDebemos,
      neto: centavos(nosDebe - leDebemos),
      ultimo: [cliente?.ultimo, proveedor?.ultimo].filter(Boolean).sort().pop() || "",
    };
  };
  const out = [];
  for (const p of pares) {
    const c = porCliente.get(`c${p.cliente_id}`);
    const x = porProveedor.get(`p${p.proveedor_id}`);
    if (!c && !x) continue;
    // Un proveedor unido sin movimientos no está en la lista de saldos: igual va con el cliente
    const prov = x || { clave: `p${p.proveedor_id}`, proveedor_id: p.proveedor_id, nombre: p.proveedor || "", comprado: 0, pagado: 0, deuda: 0, ultimo: "" };
    const cli = c || { clave: `c${p.cliente_id}`, cliente_id: p.cliente_id, nombre: p.cliente || "", vendido: 0, cobrado: 0, saldo: 0, ultimo: "" };
    if (usados.has(cli.clave) || usados.has(prov.clave)) continue;
    usados.add(cli.clave);
    usados.add(prov.clave);
    out.push(renglon(cli, prov));
  }
  for (const c of clientes) if (!usados.has(c.clave)) out.push(renglon(c, null));
  for (const p of proveedores) if (!usados.has(p.clave)) out.push(renglon(null, p));
  return out.sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto) || a.nombre.localeCompare(b.nombre));
}

const conSaldo = (r) => Math.abs(r.nos_debe) >= 0.01 || Math.abs(r.le_debemos) >= 0.01;

/** ¿El renglón entra en el filtro? */
export function entraEnFiltro(r, filtro) {
  if (filtro === "clientes") return r.tipo !== "proveedor";
  if (filtro === "proveedores") return r.tipo !== "cliente";
  if (filtro === "ambos") return r.tipo === "ambos";
  if (filtro === "saldo") return conSaldo(r);
  return true;
}

/** Los totales de arriba: lo que nos deben, lo que debemos y el neto (los saldos a favor restan). */
export function totalesCc(renglones = []) {
  const nosDeben = centavos(renglones.reduce((s, r) => s + r.nos_debe, 0));
  const debemos = centavos(renglones.reduce((s, r) => s + r.le_debemos, 0));
  return { nos_deben: nosDeben, debemos, neto: centavos(nosDeben - debemos) };
}

/** El filtro con que se abre la pantalla: desde los links viejos de Clientes o Proveedores. */
export function filtroInicialCc(seccion) {
  if (seccion === "fin-clientes") return "clientes";
  if (seccion === "fin-proveedores") return "proveedores";
  return "saldo";
}
