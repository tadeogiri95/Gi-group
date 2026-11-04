// tests/pdf-ot-pantallas.test.jsx — 📄 PDF de la OT en el Detalle y en la lista (04/11)
import "./helpers/domSetup.js";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";

const { PdfDeOt, BotonPdfOt } = await import("../app/components/PdfOt.jsx");
const { olvidarPdfsOt } = await import("../app/hooks/usePdfsOt.js");
const { indicePdfs } = await import("../app/lib/pdfOt.js");

const ARCHIVOS = [
  { nombre: "7498-36-GRUPO ELYON-PLACARD.pdf", id: "1aaaaaaaaaaaaaaa", fecha: "2026-10-01T00:00:00.000Z" },
  { nombre: "7498-36-GRUPO ELYON-PLACARD v2.pdf", id: "1bbbbbbbbbbbbbbb", fecha: "2026-10-20T00:00:00.000Z" },
  { nombre: "7498-GRUPO ELYON-GENERAL.pdf", id: "1ccccccccccccccc", fecha: "2026-09-01T00:00:00.000Z" },
];
const respuesta = (cuerpo) => { global.fetch = async () => new Response(JSON.stringify(cuerpo), { status: 200 }); };

beforeEach(() => olvidarPdfsOt());
afterEach(() => cleanup());

test("Detalle — 📄 Ver PDF de la OT abre el más nuevo en Drive y lista los otros", async () => {
  respuesta({ conectado: true, archivos: ARCHIVOS });
  render(<PdfDeOt ot="M-7498-36" />);
  const link = await screen.findByRole("link", { name: /Ver PDF de la OT/ });
  assert.equal(link.getAttribute("href"), "https://drive.google.com/file/d/1bbbbbbbbbbbbbbb/view");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.ok(screen.getByRole("link", { name: /PLACARD\.pdf/ }));
});

test("Detalle — una sub-OT sin PDF propio muestra el de la madre y lo dice", async () => {
  respuesta({ conectado: true, archivos: ARCHIVOS });
  render(<PdfDeOt ot="M-7498-40" />);
  const link = await screen.findByRole("link", { name: /Ver PDF de la OT/ });
  assert.equal(link.getAttribute("href"), "https://drive.google.com/file/d/1ccccccccccccccc/view");
  assert.ok(screen.getByText(/De la OT 7498/));
});

test("Detalle — sin PDF avisa con qué número tiene que empezar el archivo", async () => {
  respuesta({ conectado: true, archivos: ARCHIVOS });
  render(<PdfDeOt ot="M-7285" />);
  assert.ok(await screen.findByText(/tiene que empezar con 7285/));
});

test("Detalle — con la carpeta sin conectar no muestra nada", async () => {
  respuesta({ conectado: false, archivos: [] });
  const { container } = render(<PdfDeOt ot="M-7498-36" />);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(container.textContent, "");
});

test("Lista — el botón 📄 PDF aparece solo si la OT tiene PDF", () => {
  const indice = indicePdfs(ARCHIVOS);
  const { container, rerender } = render(<BotonPdfOt ot="M-7498-36" indice={indice} />);
  assert.equal(screen.getByRole("link", { name: /PDF/ }).getAttribute("href"), "https://drive.google.com/file/d/1bbbbbbbbbbbbbbb/view");
  rerender(<BotonPdfOt ot="M-9999" indice={indice} />);
  assert.equal(container.textContent, "");
});
