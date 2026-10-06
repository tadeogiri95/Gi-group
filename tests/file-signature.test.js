// tests/file-signature.test.js — Detección de tipo por magic bytes (F2-09)
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectarMime, contenidoCoincide } from "../app/lib/fileSignature.js";

const bytes = (...b) => Uint8Array.from(b);
const txt = (s) => new TextEncoder().encode(s);

test("detectarMime — reconoce los formatos aceptados", () => {
  assert.equal(detectarMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), "image/png");
  assert.equal(detectarMime(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(detectarMime(txt("GIF89a")), "image/gif");
  assert.equal(detectarMime(txt("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(detectarMime(txt("%PDF-1.7")), "application/pdf");
  assert.equal(detectarMime(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1)), "application/msword");
  assert.equal(detectarMime(bytes(0x50, 0x4b, 0x03, 0x04, 0x14)), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

test("detectarMime — SVG, HTML y basura no se reconocen", () => {
  assert.equal(detectarMime(txt('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectarMime(txt('<?xml version="1.0"?><svg/>')), null);
  assert.equal(detectarMime(txt("<html><script>alert(1)</script>")), null);
  assert.equal(detectarMime(txt("RIFF\0\0\0\0WAVE")), null);
  assert.equal(detectarMime(bytes(0x89)), null);
  assert.equal(detectarMime(null), null);
});

test("contenidoCoincide — exige que el contenido sea el tipo declarado", () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a);
  assert.equal(contenidoCoincide(png, "image/png"), true);
  assert.equal(contenidoCoincide(png, "image/jpeg"), false);
  assert.equal(contenidoCoincide(txt("<svg/>"), "image/svg+xml"), false);
});
