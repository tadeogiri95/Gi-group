// app/lib/foto.js — Fotos sacadas con el celular para subir por /api/upload
// (carga y acta de instalación, Órdenes de Producción partes 10 y 11).
import { apiFetch } from "./supabase";

/** Achica la foto (lado mayor 1600 px, JPEG) para que no pase de 5 MB. Devuelve base64 sin prefijo. */
export async function fotoBase64(file) {
  const dataUrl = await new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = mal;
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = dataUrl; });
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL("image/jpeg", 0.8).split(",")[1], tipo: "image/jpeg" };
  } catch {
    return { base64: String(dataUrl).split(",")[1], tipo: file.type || "image/jpeg" };
  }
}

/** Sube una imagen (base64 sin prefijo) por /api/upload y devuelve su URL pública. */
export async function subirImagen({ base64, tipo }) {
  const r = await apiFetch("/api/upload", { method: "POST", body: JSON.stringify({ fileBase64: base64, fileType: tipo }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.url) throw new Error(data.error || "No se pudo subir la imagen");
  return data.url;
}

/**
 * Un comprobante de Finanzas (13/11, parte 4): una foto se achica como las
 * demás; un PDF va tal cual (hasta 5 MB).
 * @returns {Promise<{ url: string, nombre: string, tipo: "pdf"|"foto" }>}
 */
export async function subirComprobante(file) {
  const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (!pdf) return { url: await subirImagen(await fotoBase64(file)), nombre: String(file.name || "Foto").slice(0, 120), tipo: "foto" };
  if (file.size > 5 * 1024 * 1024) throw new Error("El PDF pesa más de 5 MB");
  const dataUrl = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(file); });
  const r = await apiFetch("/api/upload", { method: "POST", body: JSON.stringify({ fileBase64: String(dataUrl).split(",")[1], fileType: "application/pdf", uso: "comprobante" }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.url) throw new Error(data.error || "No se pudo subir el PDF");
  return { url: data.url, nombre: String(file.name || "Comprobante.pdf").slice(0, 120), tipo: "pdf" };
}
