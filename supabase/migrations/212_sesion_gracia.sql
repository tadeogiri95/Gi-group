-- 212: No cerrar la sesión cuando dos pestañas renuevan juntas (pedido de Tadeo, 26/11)
--
-- CONTEXTO: cada 30 minutos Gypi renueva el pase de la sesión y el pase viejo
-- deja de valer al instante. Si dos pestañas (o la app instalada y el
-- navegador) renovaban al mismo tiempo, o la respuesta se perdía por un corte
-- de señal, el navegador quedaba con un pase ya usado y Gypi cerraba la sesión.
--
-- Esta migración guarda el pase anterior y cuándo se reemplazó: durante 2
-- minutos /api/refresh-token lo sigue aceptando y devuelve el pase vigente.
-- Una sesión revocada (cambio de contraseña) no tiene gracia.
--
-- ORDEN: se puede correr antes o después de unir el PR (sin ella, Gypi sigue
-- como antes, sin la gracia). Es idempotente y va en un solo bloque.
do $mig$
begin
  alter table public.sesiones add column if not exists refresh_jti_anterior text;
  alter table public.sesiones add column if not exists rotado_en timestamptz;
  create index if not exists sesiones_refresh_jti_anterior
    on public.sesiones (refresh_jti_anterior)
    where refresh_jti_anterior is not null;
end
$mig$;
