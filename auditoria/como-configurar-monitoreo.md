# Cómo configurar el monitoreo (gratis)

Dos servicios gratuitos, ~15 minutos en total. **No me pases ninguna clave:** todo se pega directo en Vercel o en cada servicio.

## 1. Sentry — te avisa por email cuando la app tira un error

1. Entrá a <https://sentry.io/signup/> y creá una cuenta (plan **Developer**, gratis).
2. Cuando pregunte la plataforma, elegí **Next.js** y poné de nombre `gypi`.
3. Sentry te muestra un **DSN** (una dirección que empieza con `https://` y termina en `.ingest.sentry.io/...`). Copialo.
4. En Vercel: proyecto **gi-group-app → Settings → Environment Variables → Add**:
   - Nombre: `NEXT_PUBLIC_SENTRY_DSN`
   - Valor: el DSN que copiaste
   - Ambientes: **Production** y **Preview**
5. **Deployments →** último deploy de producción → **⋯ → Redeploy** (la variable se toma al construir la app).
6. Listo: Sentry crea solo la alerta "nuevo error → email". Los errores de las vistas previas aparecen con el ambiente `preview` y los reales con `production`.

## 2. UptimeRobot — te avisa si la app se cae o si un proceso automático dejó de correr

1. Entrá a <https://uptimerobot.com/> y creá una cuenta gratis.
2. **Add New Monitor**:
   - Tipo: **HTTP(s)**
   - Nombre: `Gypi`
   - URL: `https://TU-DOMINIO/api/health` (el dominio con el que entran los clientes)
   - Intervalo: **5 minutos**
   - Alerta: tu email
3. Guardar. El monitor tiene que quedar en verde ("Up").

`/api/health` responde con error (y UptimeRobot te avisa) si: la base no responde, falta una variable de entorno obligatoria, o **alguno de los procesos automáticos (crons) no corrió bien dentro de su horario**. Para saber cuál, mirá en Sentry el error `[cron/...]`, o corré en Supabase:

```sql
select nombre, ultima_corrida, ultima_ok, ultimo_error from public.cron_ejecuciones order by nombre;
```

## 3. Revisar una variable en Vercel

En **Settings → Environment Variables** tiene que existir `NEXT_PUBLIC_APP_URL` con tu dominio (por ejemplo `https://gypi.app`): el chequeo diario de salud la usa para llamarse a sí mismo.
