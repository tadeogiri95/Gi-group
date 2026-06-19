'use client';

const pulseStyle = {
  background: 'linear-gradient(90deg, var(--color-surface) 25%, var(--color-border) 50%, var(--color-surface) 75%)',
  backgroundSize: '200% 100%',
  animation: 'skeletonPulse 1.5s ease-in-out infinite',
  borderRadius: 8,
};

export function Skeleton({ width, height = 16, rounded = 8, style = {} }) {
  return (
    <div style={{
      ...pulseStyle,
      width: width || '100%',
      height,
      borderRadius: rounded,
      flexShrink: 0,
      ...style,
    }} />
  );
}

export function SkeletonCard({ style = {} }) {
  return (
    <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border" style={style}>
      <div className="flex items-center gap-3 mb-3.5">
        <Skeleton width={40} height={40} rounded={12} />
        <div className="flex-1">
          <Skeleton width="60%" height={14} style={{ marginBottom: 8 }} />
          <Skeleton width="40%" height={10} />
        </div>
      </div>
      <Skeleton height={12} style={{ marginBottom: 8 }} />
      <Skeleton width="75%" height={12} />
    </div>
  );
}

export function SkeletonList({ rows = 4, style = {} }) {
  return (
    <div className="flex flex-col gap-2.5" style={style}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`flex items-center gap-3 py-3 ${i < rows - 1 ? "border-b border-gypi-border" : ""}`}>
          <Skeleton width={36} height={36} rounded={10} />
          <div className="flex-1">
            <Skeleton width={`${55 + (i % 3) * 15}%`} height={13} style={{ marginBottom: 6 }} />
            <Skeleton width={`${35 + (i % 2) * 20}%`} height={10} />
          </div>
          <Skeleton width={40} height={20} rounded={6} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 4, cols = 3, style = {} }) {
  return (
    <div style={style}>
      <div className="flex gap-3 mb-3 px-1">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} width={`${100 / cols}%`} height={10} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 py-2.5 px-1 border-b border-gypi-border">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} width={`${100 / cols}%`} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
