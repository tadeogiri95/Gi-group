// GET /.well-known/assetlinks.json — Vincula la app de Google Play (TWA) con
// gypi.app (D12, D14, ítem 34). Sin esto, la app abre con la barra del
// navegador arriba. Los datos salen de variables de entorno (no son secretos):
//   ANDROID_PACKAGE_NAME          p. ej. app.gypi.twa
//   ANDROID_SHA256_FINGERPRINTS   huellas SHA-256 de la firma, separadas por coma
// Guía: auditoria/como-publicar-en-google-play.md
import { assetLinks } from "../../lib/assetLinks";

export function GET() {
  return Response.json(assetLinks(), { headers: { "Cache-Control": "public, max-age=3600" } });
}
