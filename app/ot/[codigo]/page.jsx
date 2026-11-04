// app/ot/[codigo]/page.jsx — Página de la OT para el cliente (Tadeo, 04/11;
// notes/diseno-pagina-cliente-ot.md). Se abre escaneando el QR que la oficina
// saca de 🔗 Para el cliente, sin usuario de Gypi. Solo lectura y solo esa OT:
// el código está firmado (app/lib/linkClienteOt.js). Muestra la OT, el estado,
// el % de producción y de instalación, la entrega y el PDF; nada de precios
// ni datos internos (app/lib/paginaClienteOt.js).
import { leerCodigoClienteOt } from "../../lib/linkClienteOt";
import { datosPaginaCliente } from "../../lib/paginaClienteServidor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Seguimiento de tu proyecto",
  robots: { index: false, follow: false },
};

const TONOS = {
  verde: "bg-gypi-green/15 text-gypi-green",
  ambar: "bg-gypi-amber/15 text-gypi-amber-ink",
  gris: "bg-gypi-surf-hi text-gypi-dim",
};

function Barra({ titulo, valor }) {
  const v = Math.max(0, Math.min(100, Number(valor) || 0));
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[15px] font-semibold">{titulo}</span>
        <span className="font-mono text-[17px] font-bold">{v} %</span>
      </div>
      <progress max={100} value={v} aria-label={`${titulo}: ${v} %`}
        className={`w-full h-3 rounded-full overflow-hidden appearance-none bg-gypi-border [&::-webkit-progress-bar]:bg-gypi-border [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full ${v >= 100 ? "[&::-webkit-progress-value]:bg-gypi-green [&::-moz-progress-bar]:bg-gypi-green" : "[&::-webkit-progress-value]:bg-gypi-amber [&::-moz-progress-bar]:bg-gypi-amber"}`} />
    </div>
  );
}

function NoEncontrada() {
  return (
    <main className="min-h-dvh bg-gypi-bg text-gypi-text font-body flex items-center justify-center p-6">
      <div className="max-w-[420px] text-center">
        <div className="text-[40px] mb-2" aria-hidden="true">🔍</div>
        <h1 className="text-[20px] font-bold font-heading m-0 mb-2">No encontramos este proyecto</h1>
        <p className="text-[15px] text-gypi-dim m-0">El link no es válido o el proyecto ya no está. Pedile a la empresa que te mande el link de nuevo.</p>
      </div>
    </main>
  );
}

export default async function PaginaClienteOt({ params }) {
  const { codigo } = await params;
  const datos = await (async () => {
    const leido = leerCodigoClienteOt(decodeURIComponent(String(codigo || "")));
    return leido ? datosPaginaCliente(leido) : null;
  })().catch(() => null);
  if (!datos) return <NoEncontrada />;

  const { empresa, ot, estado, produccion, instalacion, entrega, pdf, actualizado } = datos;
  const detalle = [ot.cliente, ot.proyecto, ot.descripcion].filter(Boolean);
  const hora = new Date(actualizado).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });

  return (
    <main className="min-h-dvh bg-gypi-bg text-gypi-text font-body overflow-y-auto">
      <div className="max-w-[520px] mx-auto px-4 py-6 flex flex-col gap-4">
        <header className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo de la empresa, URL de Supabase */}
          {empresa.logo && <img src={empresa.logo} alt="" className="w-12 h-12 rounded-xl object-contain bg-gypi-surface" />}
          <div className="min-w-0">
            <div className="text-[17px] font-bold font-heading truncate">{empresa.nombre}</div>
            <div className="text-[13px] text-gypi-dim">Seguimiento de tu proyecto</div>
          </div>
        </header>

        <section aria-label="Tu proyecto" className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4 flex flex-col gap-2">
          <div className="text-[13px] font-bold text-gypi-dim">OT {ot.codigo}</div>
          {detalle.length > 0 && <h1 className="m-0 text-[20px] font-bold font-heading leading-snug">{detalle.join(" · ")}</h1>}
          <div><span className={`inline-block px-3 py-1.5 rounded-lg text-[14px] font-bold ${TONOS[estado.tono] || TONOS.gris}`}>{estado.texto}</span></div>
          {entrega && <div className="text-[15px]">📅 Entrega: <b>{entrega}</b></div>}
        </section>

        {(produccion != null || instalacion != null) && (
          <section aria-label="Avance" className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4 flex flex-col gap-4">
            {produccion != null && <Barra titulo="🏭 Fabricación" valor={produccion} />}
            {instalacion != null && <Barra titulo="🔧 Instalación" valor={instalacion} />}
          </section>
        )}

        {pdf && (
          <a href={pdf.url} target="_blank" rel="noopener noreferrer"
            className="g-btn g-btn-primary w-full min-h-[56px] flex items-center justify-center gap-2 no-underline text-[17px] font-bold">
            📄 Ver el plano del proyecto
          </a>
        )}

        <p className="m-0 text-[12px] text-gypi-dim text-center">Actualizado: {hora}<br />Si tenés dudas, consultá con {empresa.nombre || "la empresa"}.</p>
      </div>
    </main>
  );
}
