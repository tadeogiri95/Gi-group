'use client';
import { C, fH } from '../../lib/theme';

// ═══════════════════════════════════════════════════════
// Avatar — Avatar con fallback de iniciales
// Ubicación: app/components/ui/Avatar.jsx
// ═══════════════════════════════════════════════════════
//
// Muestra imagen si url existe, sino genera iniciales con color
// determinístico basado en el nombre.
//
// Uso:
//   <Avatar name="Juan Pérez" size="md" />
//   <Avatar name="María" url="/fotos/maria.jpg" size="lg" />
//   <Avatar name="AB" size="sm" color={C.amber} />

const SIZES = {
  xs: { box: 24, font: 10, radius: 7 },
  sm: { box: 32, font: 12, radius: 9 },
  md: { box: 40, font: 14, radius: 12 },
  lg: { box: 52, font: 18, radius: 14 },
  xl: { box: 72, font: 24, radius: 18 },
};

// Paleta de colores determinísticos
const COLORS = ['#F97316', '#8B5CF6', '#06B6D4', '#22C55E', '#EF4444', '#EC4899', '#F59E0B', '#6366F1'];

function hashName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Avatar({
  name = '',
  url,
  size = 'md',
  color,
  style = {},
}) {
  const s = SIZES[size] || SIZES.md;
  const bgColor = color || COLORS[hashName(name) % COLORS.length];
  const initials = getInitials(name);

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={{
          width: s.box, height: s.box, borderRadius: s.radius,
          objectFit: 'cover', flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <div style={{
      width: s.box, height: s.box, borderRadius: s.radius,
      background: `${bgColor}22`,
      color: bgColor,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: fH, fontSize: s.font, fontWeight: 700,
      flexShrink: 0, letterSpacing: '-0.02em',
      ...style,
    }}>
      {initials}
    </div>
  );
}
