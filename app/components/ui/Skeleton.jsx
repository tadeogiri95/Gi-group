'use client';
import { C } from '../../lib/theme';

// ═══════════════════════════════════════════════════════
// Skeleton — Loading placeholders animados
// Ubicación: app/components/ui/Skeleton.jsx
// ═══════════════════════════════════════════════════════
//
// Reemplaza los "Cargando datos..." textuales con placeholders
// que imitan la forma del contenido real.
//
// Uso:
//   <Skeleton width={120} height={16} />
//   <SkeletonCard />
//   <SkeletonList rows={5} />
//   <SkeletonTable rows={4} cols={3} />

const pulseStyle = {
  background: `linear-gradient(90deg, ${C.surface} 25%, ${C.border} 50%, ${C.surface} 75%)`,
  backgroundSize: '200% 100%',
  animation: 'skeletonPulse 1.5s ease-in-out infinite',
  borderRadius: 8,
};

// Inyectar keyframes una sola vez
if (typeof document !== 'undefined' && !document.getElementById('skeleton-keyframes')) {
  const style = document.createElement('style');
  style.id = 'skeleton-keyframes';
  style.textContent = `@keyframes skeletonPulse { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`;
  document.head.appendChild(style);
}

// ─── Base ───
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

// ─── Card skeleton ───
export function SkeletonCard({ style = {} }) {
  return (
    <div style={{
      background: C.surface, borderRadius: 16, padding: 16,
      border: `1px solid ${C.border}`, ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Skeleton width={40} height={40} rounded={12} />
        <div style={{ flex: 1 }}>
          <Skeleton width="60%" height={14} style={{ marginBottom: 8 }} />
          <Skeleton width="40%" height={10} />
        </div>
      </div>
      <Skeleton height={12} style={{ marginBottom: 8 }} />
      <Skeleton width="75%" height={12} />
    </div>
  );
}

// ─── List row skeleton ───
export function SkeletonList({ rows = 4, style = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 0',
          borderBottom: i < rows - 1 ? `1px solid ${C.border}` : 'none',
        }}>
          <Skeleton width={36} height={36} rounded={10} />
          <div style={{ flex: 1 }}>
            <Skeleton width={`${55 + (i % 3) * 15}%`} height={13} style={{ marginBottom: 6 }} />
            <Skeleton width={`${35 + (i % 2) * 20}%`} height={10} />
          </div>
          <Skeleton width={40} height={20} rounded={6} />
        </div>
      ))}
    </div>
  );
}

// ─── Table skeleton ───
export function SkeletonTable({ rows = 4, cols = 3, style = {} }) {
  return (
    <div style={{ ...style }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, padding: '0 4px' }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} width={`${100 / cols}%`} height={10} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{
          display: 'flex', gap: 12, padding: '10px 4px',
          borderBottom: `1px solid ${C.border}`,
        }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} width={`${100 / cols}%`} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
