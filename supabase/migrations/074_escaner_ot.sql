-- 074: Escáner de OT con la cámara, opcional por empresa (D8, F4-11, ítem 20)
--
-- Si está activado, el operario puede escanear el código (QR o código de
-- barras) de la orden de trabajo al iniciar una tarea, en vez de buscarla.
-- Por defecto está apagado: cada empresa lo activa en Configuración → Proyectos.
--
-- Hay que correrla ANTES de aprobar el PR: la app pide esta columna al cargar
-- los datos de la empresa. Es idempotente.

alter table public.empresa
  add column if not exists escaner_ot boolean not null default false;
