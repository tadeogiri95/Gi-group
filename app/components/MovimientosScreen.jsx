'use client';
// app/components/MovimientosScreen.jsx — Materiales → 📥 Movimientos (17/11,
// pedido de Tadeo: cargar ingresos y consumos a la vista, no escondido dentro
// de Stock). Trae los artículos y muestra MovimientosStock; con el tipo pedido
// (desde 📥 Cargar ingreso / 📤 Cargar consumo) abre el formulario directo.
import { useEffect, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import MovimientosStock from "./MovimientosStock";

// El tipo pedido desde 📥/📤 en Stock o Inventario. Queda acá (y no en el
// estado de la pantalla) porque al cambiar de pestaña cambia la dirección y la
// pantalla se arma de nuevo. Se usa una sola vez.
let tipoPendiente = null;
export function pedirCarga(tipo) { tipoPendiente = tipo; }

export default function MovimientosScreen({ usuario = null }) {
  const [tipoInicial] = useState(() => tipoPendiente);
  useEffect(() => { tipoPendiente = null; }, []);
  const [articulos, setArticulos] = useState([]);
  useEffect(() => {
    sbGetAll("articulos_stock?activo=eq.true&order=sku.asc", { maxFilas: 20000 }).then((r) => setArticulos(r.data || [])).catch(() => {});
  }, []);
  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-28 text-gypi-text">
      <MovimientosStock usuario={usuario} articulos={articulos} tipoInicial={tipoInicial}
        onArticuloNuevo={(n) => setArticulos((prev) => [...prev.filter((x) => x.sku !== n.sku), n])} />
    </div>
  );
}
