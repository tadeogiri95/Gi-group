"use client";
// ═══════════════════════════════════════════════════════════
// DataTable — Tabla reutilizable con sort
//
// ENTREGA 2B: Componente genérico para reemplazar los múltiples
// <div> grids ad-hoc usados en gestion_personal, reportes, etc.
//
// Uso:
//   <DataTable
//     columns={[
//       { key: "nombre", label: "Nombre", sortable: true },
//       { key: "legajo", label: "Legajo" },
//       { key: "estado", label: "Estado", render: (val) => <Tag>{val}</Tag> },
//     ]}
//     data={empleados}
//     onRowClick={(row) => setSelected(row)}
//     emptyMessage="Sin empleados cargados"
//   />
// ═══════════════════════════════════════════════════════════

import { useState, useMemo } from "react";

export default function DataTable({ columns = [], data = [], onRowClick, emptyMessage = "Sin datos" }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const va = a[sortKey] ?? "";
      const vb = b[sortKey] ?? "";
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "es");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  if (data.length === 0) {
    return (
      <div className="py-10 text-center text-gypi-dim text-sm">{emptyMessage}</div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-gypi-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gypi-border">
            {columns.map(col => (
              <th
                key={col.key}
                className={`text-left px-3 py-2.5 text-[11px] font-bold text-gypi-dim uppercase tracking-wider font-body ${col.sortable ? "cursor-pointer select-none hover:text-gypi-text" : ""}`}
                onClick={() => col.sortable && toggleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    <span className="text-gypi-amber">{sortDir === "asc" ? "↑" : "↓"}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={row.id || i}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-gypi-border last:border-b-0 ${onRowClick ? "cursor-pointer hover:bg-gypi-surface-hi" : ""}`}
            >
              {columns.map(col => (
                <td key={col.key} className="px-3 py-2.5 text-gypi-text">
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
