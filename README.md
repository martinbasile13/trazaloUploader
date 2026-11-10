# trazaloUploader

Servicio chico que le da a [trazaloApp](https://github.com/martinbasile13/trazaloApp) dos cosas que el navegador no puede hacer solo:

1. **Emitir URLs prefirmadas** para que el cliente suba fotos/video directo a Cloudflare R2 (sin pasar los bytes por acá).
2. **Transcodificar video con ffmpeg nativo**, async, sin bloquear al usuario — reemplaza al `ffmpeg.wasm` que corría en el navegador.

Repo separado y público a propósito: EasyPanel solo admite un token de GitHub global, y un repo público no necesita token para clonarse. No hay ningún secreto acá adentro — todo lo sensible va como variable de entorno en el deploy.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/health` | 200 si el servicio está vivo |
| POST | `/presign` | Devuelve una URL prefirmada de R2 para subir un archivo (foto, thumbnail, o video crudo) |
| POST | `/process-video` | Encola el transcode de un video crudo ya subido a R2 |
| POST | `/delete` | Borra objeto(s) de R2 |
| GET | `/capabilities` | Sin auth. `{ multipart: true, partSizeBytes, maxFileBytes }` para detectar subida por partes |
| POST | `/multipart/create` | Inicia una subida por partes; devuelve `uploadId`, `storagePath`, `totalParts` |
| POST | `/multipart/part-urls` | URLs firmadas (1 h) para subir partes concretas (máx. 20 por llamada) |
| POST | `/multipart/list-parts` | Partes ya subidas, para reanudar |
| POST | `/multipart/complete` | Cierra la subida (el servidor lee los ETags); 409 con `missingParts` si falta alguna |
| POST | `/multipart/abort` | Cancela la subida (idempotente) |

Todos (salvo `/health`) requieren `Authorization: Bearer <access token de Supabase>` y validan que el `businessId`/`projectId` pertenezcan al usuario del token antes de hacer nada — ver `src/auth.ts`.

## Subida por partes (multipart)

Para archivos grandes (video hasta 150 MB): el cliente parte el archivo en bloques de 8 MiB (`partSizeBytes`), sube cada uno directo a R2 con URL firmada y reintenta solo los que fallan. Todos los endpoints `/multipart/*` llevan `Authorization: Bearer ...` y `businessId`/`projectId` en el body; `storagePath` debe estar bajo `media/<businessId>/<projectId>/` o `raw/<businessId>/<projectId>/`.

Flujo:

```text
GET  /capabilities                         -> { multipart: true, partSizeBytes: 8388608, maxFileBytes: 157286400 }
POST /multipart/create   { businessId, projectId, updateId, filename, contentType, kind, sizeBytes }
                                           -> { uploadId, storagePath, publicUrl|null, partSizeBytes, totalParts }
POST /multipart/part-urls { businessId, projectId, storagePath, uploadId, partNumbers: [1,2,3] }
                                           -> { urls: [{ partNumber, url }] }
PUT  <url>  (cuerpo = bytes de la parte; la parte N cubre [(N-1)*partSize, N*partSize))
POST /multipart/list-parts { ... }         -> { parts: [{ partNumber, size }] }   (para reanudar)
POST /multipart/complete  { ..., totalParts } -> { storagePath, publicUrl|null }
                                           -> 409 { error, missingParts: [..] } si falta alguna
POST /multipart/abort     { ... }          -> { aborted: true }
```

Después de `complete` con `kind: "video-raw"` se sigue igual que antes: `POST /process-video` con `rawStoragePath = storagePath`. El navegador no necesita leer el `ETag` de cada parte (el CORS del bucket no lo expone): `complete` lo obtiene del lado servidor. El CORS del bucket debe permitir `PUT` (ya requerido hoy).

## Tests

```bash
npm test   # node --test + tsx, sin dependencias nuevas
```

## Desarrollo local

```bash
cp .env.example .env   # completar con las credenciales reales
npm install
npm run dev
```

Necesita `ffmpeg` instalado en el sistema para probar `/process-video` localmente (`brew install ffmpeg` en Mac).

## Deploy (EasyPanel)

1. Crear el servicio en EasyPanel apuntando a este repo (build por Dockerfile, ya incluye ffmpeg).
2. Cargar las variables de `.env.example` como env vars del servicio (nunca commitear el `.env`).
3. Exponerlo por Cloudflare Tunnel con el hostname elegido (ej. `uploader.trazalo.app`).
4. Confirmar `GET https://<host>/health` → `{ "ok": true }`.

## Antes de usarlo en producción

- Correr en Supabase (SQL Editor) la migración que agrega la columna `status` a `media` — ver el plan en trazaloApp.
- Crear el bucket de R2, el token de API (Object Read & Write), y atarle un dominio público.
- Configurar CORS del bucket para permitir `PUT`/`GET` desde el dominio de producción del frontend.
