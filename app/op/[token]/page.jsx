// app/op/[token]/page.jsx — Orden de pago para el CFO (Finanzas F2b, 2;
// migración 175). El dueño le manda este link por WhatsApp a quien firma en
// el banco; sin usuario de Gypi la abre y ve qué se paga y con qué. Desde el
// 13/11 es solo informativa: puede apretar 👍 Visto, pero el pago no lo
// espera. El link deja de servir si la orden se anula
// (app/lib/ordenPagoCfo.js). No muestra cuentas contables ni otros datos.
import { datosOrdenCfo } from "../../lib/ordenPagoCfo";
import { fechaCorta } from "../../lib/finanzasPagos";
import { plata } from "../../lib/finanzasOperaciones";
import VistoCfo from "../../components/VistoCfo";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orden de pago",
  robots: { index: false, follow: false },
};

function NoEncontrada() {
  return (
    <main className="min-h-dvh bg-gypi-bg text-gypi-text font-body flex items-center justify-center p-6">
      <div className="max-w-[420px] text-center">
        <div className="text-[40px] mb-2" aria-hidden="true">🔍</div>
        <h1 className="text-[20px] font-bold font-heading m-0 mb-2">Este link ya no sirve</h1>
        <p className="text-[15px] text-gypi-dim m-0">La orden de pago se anuló. Pedile el link nuevo a quien te la mandó.</p>
      </div>
    </main>
  );
}

export default async function PaginaOrdenPago({ params }) {
  const { token } = await params;
  const datos = await datosOrdenCfo(decodeURIComponent(String(token || ""))).catch(() => null);
  if (!datos) return <NoEncontrada />;
  const { empresa, numero, fecha, proveedor, total, notas, cargada_por, facturas, formas, pagada, pagada_fecha, visto, cfo } = datos;

  return (
    <main className="min-h-dvh bg-gypi-bg text-gypi-text font-body overflow-y-auto">
      <div className="max-w-[560px] mx-auto px-4 py-6 flex flex-col gap-4">
        <header className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo de la empresa, URL de Supabase */}
          {empresa.logo && <img src={empresa.logo} alt="" className="w-12 h-12 rounded-xl object-contain bg-gypi-surface" />}
          <div className="min-w-0">
            <div className="text-[17px] font-bold font-heading truncate">{empresa.nombre}</div>
            <div className="text-[13px] text-gypi-dim">Orden de pago para firmar en el banco</div>
          </div>
        </header>

        <section aria-label="Orden de pago" className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4 flex flex-col gap-1">
          <div className="text-[13px] font-bold text-gypi-dim">Orden de pago N° {numero} · {fechaCorta(fecha)}</div>
          <h1 className="m-0 text-[20px] font-bold font-heading leading-snug">{proveedor}</h1>
          <div className="text-[26px] font-bold font-mono">{plata(total, "ARS")}</div>
          {cargada_por && <div className="text-[13px] text-gypi-dim">Preparó: {cargada_por}</div>}
          <div className={`text-[13px] font-semibold ${pagada ? "text-gypi-green" : "text-gypi-dim"}`}>
            {pagada ? `💸 Ya registrada como pagada${pagada_fecha ? ` el ${fechaCorta(pagada_fecha)}` : ""}` : "Preparada para pagar"}
          </div>
        </section>

        <section aria-label="Con qué se paga" className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4">
          <h2 className="m-0 mb-2 text-[15px] font-bold">Con qué se paga</h2>
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {formas.map((f, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[14px]">
                <span className="flex-1 min-w-0">{f.texto}</span>
                <span className="font-mono font-semibold">{plata(f.importe, "ARS")}</span>
              </li>
            ))}
          </ul>
        </section>

        {facturas.length > 0 && (
          <section aria-label="Qué se paga" className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4">
            <h2 className="m-0 mb-2 text-[15px] font-bold">Qué se paga</h2>
            <ul className="list-none m-0 p-0 flex flex-col gap-2">
              {facturas.map((f, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[14px]">
                  <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(f.fecha)}</span>
                  <span className="flex-1 min-w-0">{f.detalle}</span>
                  <span className="font-mono">{plata(f.importe, "ARS")}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {notas && <p className="m-0 text-[14px] rounded-[14px] border border-gypi-border bg-gypi-surface p-3">📝 {notas}</p>}

        <VistoCfo token={token} api="/api/op/visto" visto={visto} cfo={cfo} que="la orden" />
      </div>
    </main>
  );
}
