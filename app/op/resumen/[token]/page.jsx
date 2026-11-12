// app/op/resumen/[token]/page.jsx — Resumen de órdenes de pago para el CFO
// (12/11, migración 186). El dueño le manda este link por WhatsApp; sin
// usuario de Gypi lo abre, ve cada pago (fecha, proveedor, medio, importe y
// comprobante), la suma de lo inmediato y de los cheques, y aprueba todas las
// órdenes que esperan o abre cada una para decidirla (/op/<token>).
// El token deja de servir cuando el resumen se anula (app/lib/resumenPagoCfo.js).
import { datosResumenCfo } from "../../../lib/resumenPagoCfo";
import { ESTADOS_ORDEN, fechaCorta } from "../../../lib/finanzasPagos";
import { plata } from "../../../lib/finanzasOperaciones";
import AprobarResumenPago from "../../../components/AprobarResumenPago";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Resumen de órdenes de pago",
  robots: { index: false, follow: false },
};

function NoEncontrado() {
  return (
    <main className="min-h-dvh bg-gypi-bg text-gypi-text font-body flex items-center justify-center p-6">
      <div className="max-w-[420px] text-center">
        <div className="text-[40px] mb-2" aria-hidden="true">🔍</div>
        <h1 className="text-[20px] font-bold font-heading m-0 mb-2">Este link ya no sirve</h1>
        <p className="text-[15px] text-gypi-dim m-0">El resumen se anuló o se armó otro. Pedile el link nuevo a quien te lo mandó.</p>
      </div>
    </main>
  );
}

export default async function PaginaResumenPago({ params }) {
  const { token } = await params;
  const datos = await datosResumenCfo(decodeURIComponent(String(token || ""))).catch(() => null);
  if (!datos) return <NoEncontrado />;
  const { empresa, numero, fecha, notas, cargado_por, totales, ordenes, cfo } = datos;
  const esperando = ordenes.filter((o) => o.estado === "para_aprobar").length;

  return (
    <main className="min-h-dvh bg-gypi-bg text-gypi-text font-body overflow-y-auto">
      <div className="max-w-[640px] mx-auto px-4 py-6 flex flex-col gap-4">
        <header className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo de la empresa, URL de Supabase */}
          {empresa.logo && <img src={empresa.logo} alt="" className="w-12 h-12 rounded-xl object-contain bg-gypi-surface" />}
          <div className="min-w-0">
            <div className="text-[17px] font-bold font-heading truncate">{empresa.nombre}</div>
            <div className="text-[13px] text-gypi-dim">Resumen de órdenes de pago N° {numero} · {fechaCorta(fecha)}</div>
          </div>
        </header>

        <section aria-label="Totales" className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4 flex flex-col gap-2">
          <div className="flex items-baseline gap-2 text-[15px]">
            <span className="flex-1">⚡ Transferencia, efectivo o inmediato</span>
            <span className="font-mono font-bold">{plata(totales.inmediato, "ARS")}</span>
          </div>
          <div className="flex items-baseline gap-2 text-[15px]">
            <span className="flex-1">🧾 Cheques (e-cheq y de terceros)</span>
            <span className="font-mono font-bold">{plata(totales.cheques, "ARS")}</span>
          </div>
          <div className="flex items-baseline gap-2 border-t border-gypi-border pt-2">
            <span className="flex-1 text-[16px] font-bold">Total · {totales.ordenes} {totales.ordenes === 1 ? "orden" : "órdenes"}</span>
            <span className="text-[22px] font-bold font-mono">{plata(totales.total, "ARS")}</span>
          </div>
          {cargado_por && <div className="text-[13px] text-gypi-dim">Preparó: {cargado_por}</div>}
        </section>

        {notas && <p className="m-0 text-[14px] rounded-[14px] border border-gypi-border bg-gypi-surface p-3">📝 {notas}</p>}

        <ul aria-label="Órdenes de pago" className="list-none m-0 p-0 flex flex-col gap-2">
          {ordenes.map((o) => {
            const est = ESTADOS_ORDEN[o.estado] || { nombre: o.estado, icono: "" };
            return (
              <li key={o.numero} className="rounded-[18px] border border-gypi-border bg-gypi-surface p-3 flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(o.fecha)} · OP N° {o.numero}</span>
                  <span className={`ml-auto text-[12px] font-semibold ${o.estado === "aprobada" ? "text-gypi-green" : o.estado === "rechazada" ? "text-gypi-red" : "text-gypi-dim"}`}>{est.icono} {est.nombre}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 text-[16px] font-bold">{o.proveedor}</span>
                  <span className="font-mono font-bold">{plata(o.total, "ARS")}</span>
                </div>
                <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
                  {o.formas.map((f, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[13px]">
                      <span className="flex-1 min-w-0">{f.clase === "cheque" ? "🧾" : "⚡"} {f.texto}</span>
                      <span className="font-mono">{plata(f.importe, "ARS")}</span>
                    </li>
                  ))}
                </ul>
                {o.decision?.nota && o.estado === "rechazada" && <p className="m-0 text-[13px] text-gypi-red">{o.decision.nota}</p>}
                <div className="flex flex-wrap gap-2 mt-1">
                  {o.comprobante && <a className="g-btn g-btn-secondary text-[13px]" href={o.comprobante} target="_blank" rel="noopener noreferrer">📎 Ver comprobante</a>}
                  {o.token && <a className="g-btn g-btn-secondary text-[13px]" href={`/op/${o.token}`}>Ver y decidir</a>}
                </div>
              </li>
            );
          })}
        </ul>

        <AprobarResumenPago token={token} esperando={esperando} cfo={cfo} />
      </div>
    </main>
  );
}
