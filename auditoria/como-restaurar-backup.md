# Backups de la base: cómo activarlos y cómo restaurar

Mientras Gypi siga en Supabase Free (sin backups descargables), una tarea de GitHub hace **todos los días a las 03:17** una copia de la base:

- encriptada: sin la frase secreta no se puede abrir, aunque el repositorio sea público;
- verificada: cada copia se restaura de prueba y se controla que tenga datos;
- guardada **30 días** en GitHub: **Actions → Backup diario de la base →** una corrida **→ Artifacts**.

Si una copia falla, GitHub te manda un email (revisá que en GitHub → Settings → Notifications → Actions esté activado "Send notifications for failed workflows only").

## Activarlo (una vez, ~10 min). No me pases ninguno de estos datos

1. **La dirección de la base.** En Supabase: botón **Connect** (arriba) → **Session pooler** → copiá la URI (empieza con `postgresql://postgres.` y tiene el puerto `5432`). Reemplazá `[YOUR-PASSWORD]` por la contraseña de la base. Si no la recordás: Project Settings → Database → Reset database password. Ojo: si la cambiás, después hay que actualizar esta URI.
2. **La frase secreta.** Inventá una frase larga (por ejemplo, 5 o 6 palabras al azar) y **guardala en un lugar seguro** (gestor de contraseñas o papel). Si se pierde, los backups no se pueden abrir.
3. En GitHub: repositorio → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_URL` = la URI del paso 1
   - `BACKUP_PASSPHRASE` = la frase del paso 2
4. Probalo: **Actions → Backup diario de la base → Run workflow**. En unos minutos tiene que quedar en verde, con un archivo en *Artifacts*.

Nota: GitHub pausa las tareas programadas de un repositorio público si pasan 60 días sin cambios en el código. Si eso pasa, te avisa por email y se reactiva con un clic en Actions.

## Qué incluye y qué no

- **Incluye:** todas las tablas de la app (empresas, empleados, fichadas, actividades, solicitudes, pagos, etc.), con su estructura.
- **No incluye:** los archivos subidos (logos, fotos de obra, documentos de empleados), que viven en Storage, ni la configuración propia de Supabase. Eso queda cubierto al pasar a Supabase Pro.

## Restaurar (con ayuda: avisame y lo hacemos juntos)

1. Descargá el archivo `gypi-AAAA-MM-DD.dump.gpg` desde *Artifacts* (viene dentro de un .zip).
2. Desencriptalo (pide la frase secreta):
   ```
   gpg --output gypi.dump --decrypt gypi-AAAA-MM-DD.dump.gpg
   ```
3. Cargalo en una base **nueva o vacía**: nunca directo sobre producción sin antes comparar.
   ```
   pg_restore --no-owner --no-privileges --dbname "URI-DE-LA-BASE-DESTINO" gypi.dump
   ```
4. Comparar con producción y recién ahí copiar lo que haga falta.
