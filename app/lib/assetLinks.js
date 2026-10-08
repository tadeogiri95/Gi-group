// app/lib/assetLinks.js — Contenido de /.well-known/assetlinks.json (ítem 34).
const HUELLA = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const PAQUETE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function assetLinks(env = process.env) {
  const paquete = String(env.ANDROID_PACKAGE_NAME || "").trim();
  const huellas = String(env.ANDROID_SHA256_FINGERPRINTS || "")
    .split(",").map((h) => h.trim().toUpperCase()).filter((h) => HUELLA.test(h));
  if (!PAQUETE.test(paquete) || huellas.length === 0) return [];
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: paquete, sha256_cert_fingerprints: huellas },
  }];
}
