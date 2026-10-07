-- 073: PIN de 4 números para que el operario entre rápido (F4-06, D7)
--
-- El PIN se guarda solo como hash bcrypt (nunca el número). Después de 5
-- intentos fallidos queda bloqueado 15 minutos (pin_bloqueado_hasta); la
-- contraseña sigue funcionando siempre.
--
-- Hay que correrla ANTES de aprobar el PR: el código nuevo lee estas columnas
-- al iniciar sesión. Es idempotente (se puede correr dos veces sin problema).

alter table public.empleados
  add column if not exists pin_hash text,
  add column if not exists pin_intentos integer not null default 0,
  add column if not exists pin_bloqueado_hasta timestamptz;

comment on column public.empleados.pin_hash is 'Hash bcrypt del PIN de 4 números (F4-06). Nunca se expone al navegador.';
