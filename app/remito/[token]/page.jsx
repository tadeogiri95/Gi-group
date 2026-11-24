// app/remito/[token]/page.jsx — El remito de una entrega (Logística, parte 4;
// migración 206). Quien recibió lo abre con el link que le mandaron por
// WhatsApp o mail, sin usuario de Gypi: ve lo entregado, las fotos y la
// firma, lo baja en PDF y, si no había nadie para firmar, firma acá.
import { datosRemito } from "../../lib/logisticaRemitoServidor";
import RemitoPublico from "../../components/RemitoPublico";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Remito",
  robots: { index: false, follow: false },
};

function NoEncontrado() {
  return (
    <main className="min-h-dvh bg-gypi-bg text-gypi-text font-body flex items-center justify-center p-6">
      <div className="max-w-[420px] text-center">
        <div className="text-[40px] mb-2" aria-hidden="true">🔍</div>
        <h1 className="text-[20px] font-bold font-heading m-0 mb-2">Este link no sirve</h1>
        <p className="text-[15px] text-gypi-dim m-0">No encontramos el remito. Pedile el link de nuevo a quien te lo mandó.</p>
      </div>
    </main>
  );
}

export default async function PaginaRemito({ params }) {
  const { token } = await params;
  const t = decodeURIComponent(String(token || ""));
  const datos = await datosRemito(t).catch(() => null);
  if (!datos) return <NoEncontrado />;
  return <RemitoPublico token={t} datos={datos} />;
}
