-- 195: Borrar una caja que nunca se usó (15/11, pedido de Tadeo: "debe existir
-- la posibilidad de crear y eliminar cajas").
--
-- CONTEXTO: la 171 dejó fin_tesoreria sin permiso de borrar ("lo usado se
-- desactiva"). Gypi sigue cuidando eso: desde 💰 Tesorería → 🗑 Eliminar caja,
-- una caja con movimientos (aunque estén anulados), cheques o extractos se
-- archiva, y para archivarla el saldo tiene que estar en cero. Solo la que
-- nunca se usó (por ejemplo, una creada por error) se borra de verdad.
--
-- Esta migración solo da el permiso de borrar a los usuarios (la regla por
-- empresa y rol Dueño de la 171 ya vale para todo, también para borrar). No
-- crea tablas ni columnas. Sin correrla, "Eliminar" archiva la caja en vez de
-- borrarla y avisa que falta esta migración.
--
-- ORDEN: se puede correr antes o después de unir el PR. Es idempotente. Va en
-- un solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  grant delete on public.fin_tesoreria to authenticated;
end
$mig$;
