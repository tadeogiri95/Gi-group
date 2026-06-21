-- 033: Eliminar tablas muertas
-- catalogo_etapas: reemplazada por `etapas` (config por empresa). Sin código
-- que la consulte fuera del allowlist de /api/data.
-- push_subscriptions: legacy Web Push, reemplazada por push_tokens (Firebase
-- FCM). Sin código que la consulte fuera del allowlist de /api/data.
-- Verificado: ningún componente ni API route hace sb.get/post/patch contra
-- estas tablas (grep sobre app/ sin resultados más allá del allowlist).

DROP TABLE IF EXISTS catalogo_etapas;
DROP TABLE IF EXISTS push_subscriptions;
