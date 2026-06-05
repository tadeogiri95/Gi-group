// ═══════════════════════════════════════════════════════════
// Skeleton — Skeleton loaders para estados de carga
//
// ENTREGA 2B: Reemplaza los textos "Cargando..." con
// placeholders animados que dan feedback visual inmediato.
//
// Uso:
//   <Skeleton.Line />                    — línea de texto
//   <Skeleton.Line width="60%" />        — línea corta
//   <Skeleton.Card />                    — tarjeta completa
//   <Skeleton.Circle size={40} />        — avatar
//   <Skeleton.List count={5} />          — lista de líneas
// ═══════════════════════════════════════════════════════════

const shimmer = "animate-pulse bg-gypi-surface-hi rounded";

export function Line({ width = "100%", height = "14px", className = "" }) {
  return <div className={`${shimmer} ${className}`} style={{ width, height }} />;
}

export function Circle({ size = 40, className = "" }) {
  return <div className={`${shimmer} rounded-full ${className}`} style={{ width: size, height: size }} />;
}

export function Card({ className = "" }) {
  return (
    <div className={`bg-gypi-surface rounded-card border border-gypi-border p-4 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <Circle size={36} />
        <div className="flex-1 flex flex-col gap-2">
          <Line width="40%" height="12px" />
          <Line width="25%" height="10px" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Line width="100%" />
        <Line width="80%" />
        <Line width="60%" />
      </div>
    </div>
  );
}

export function List({ count = 3, className = "" }) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Circle size={32} />
          <div className="flex-1 flex flex-col gap-1.5">
            <Line width={`${60 + Math.random() * 30}%`} height="12px" />
            <Line width={`${30 + Math.random() * 30}%`} height="10px" />
          </div>
        </div>
      ))}
    </div>
  );
}

const Skeleton = { Line, Circle, Card, List };
export default Skeleton;
