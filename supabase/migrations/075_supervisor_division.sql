-- 075: Supervisor limitado a su división (decisión D2, ítem 22 del plan)
--
-- Un administrativo con solo_su_division = true es SUPERVISOR: ve y gestiona
-- solo a los empleados de su división (empleados.division). Con false (el
-- valor por defecto) sigue siendo administrador y ve toda la empresa, como
-- hasta ahora. Solo el dueño (gerencial) puede marcarlo.
--
-- Conviene correrla ANTES de aprobar el PR (sin ella nadie queda limitado y la
-- casilla no se puede guardar). Es idempotente.

alter table public.empleados
  add column if not exists solo_su_division boolean not null default false;

comment on column public.empleados.solo_su_division is
  'Supervisor: el administrativo solo ve y gestiona a los empleados de su división (D2).';
