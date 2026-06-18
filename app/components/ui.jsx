'use client';

/**
 * GYPI — Componentes UI Base (Design System)
 * Todos los componentes usan CSS variables de globals.css.
 */

import { useId } from 'react';
import Icon from './Icon';

// Re-export canonical versions from standalone files
export { default as Avatar } from './ui/Avatar';
export { default as EmptyState } from './ui/EmptyState';
export { default as Modal } from './ui/Modal';

// ============================================
// BUTTON
// ============================================

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  className = '',
  style,
  ...props
}) {
  const sizes = {
    sm: { minHeight: 32, padding: '0 12px', fontSize: 13, gap: 6, borderRadius: 'var(--radius-sm)' },
    md: { minHeight: 40, padding: '0 16px', fontSize: 14, gap: 8, borderRadius: 'var(--radius-md)' },
    lg: { minHeight: 48, padding: '0 24px', fontSize: 15, gap: 10, borderRadius: 'var(--radius-md)' },
  };

  const variants = {
    primary:   { background: 'var(--color-empresa-primary)', color: '#000', fontWeight: 700 },
    secondary: { background: 'var(--color-surf-hi)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
    danger:    { background: 'var(--color-red-subtle)', color: 'var(--color-red)', fontWeight: 700 },
    ghost:     { background: 'transparent', color: 'var(--color-text-muted)' },
    outline:   { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border-hi)' },
  };

  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;

  return (
    <button
      disabled={disabled || loading}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-body)', fontWeight: 500, border: 'none', cursor: 'pointer',
        transition: 'all var(--duration-fast) var(--ease-default)',
        opacity: (disabled || loading) ? 0.5 : 1,
        ...s, ...v, ...style,
      }}
      className={className}
      {...props}
    >
      {loading ? (
        <Icon name="refresh" size={size === 'sm' ? 14 : 16} style={{ animation: 'spin 1s linear infinite' }} />
      ) : icon ? (
        <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      ) : null}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  );
}

// ============================================
// CARD
// ============================================

export function Card({ children, className = '', padding = true, hover = false, style, ...props }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: padding ? 'var(--sp-4)' : undefined,
        transition: hover ? 'box-shadow var(--duration-normal) var(--ease-default), transform var(--duration-normal) var(--ease-default)' : undefined,
        ...style,
      }}
      className={`${hover ? 'card-hover' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

// ============================================
// TAG — pill con color dinámico
// ============================================

export function Tag({ children, color, className = '', style, ...props }) {
  const bg = color ? hexToSubtle(color, 0.12) : 'var(--color-surf-hi)';
  const fg = color || 'var(--color-text-muted)';

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 'var(--radius-full)',
        fontSize: 11, fontWeight: 600, lineHeight: 1.4,
        whiteSpace: 'nowrap',
        background: bg, color: fg,
        ...style,
      }}
      className={className}
      {...props}
    >
      {children}
    </span>
  );
}

function hexToSubtle(color, alpha = 0.12) {
  if (!color) return `rgba(0,0,0,${alpha})`;
  if (color.startsWith('rgba')) return color;
  if (color.startsWith('var(')) return color;
  const hex = color.replace('#', '');
  if (hex.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ============================================
// BADGE — variant-based (alternativa a Tag)
// ============================================

export function Badge({ children, variant = 'default', color, dot = false, className = '', style, ...props }) {
  if (color) return <Tag color={color} style={style} className={className} {...props}>{children}</Tag>;

  const variants = {
    default: { bg: 'var(--color-surf-hi)', fg: 'var(--color-text-muted)' },
    brand:   { bg: 'var(--color-empresa-primary-subtle)', fg: 'var(--color-empresa-primary)' },
    success: { bg: 'var(--color-green-subtle)', fg: 'var(--color-green)' },
    danger:  { bg: 'var(--color-red-subtle)', fg: 'var(--color-red)' },
    info:    { bg: 'var(--color-cyan-subtle)', fg: 'var(--color-cyan)' },
  };

  const v = variants[variant] || variants.default;

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 'var(--radius-full)',
        fontSize: 11, fontWeight: 600, lineHeight: 1.4,
        whiteSpace: 'nowrap',
        background: v.bg, color: v.fg,
        ...style,
      }}
      className={className}
      {...props}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />}
      {children}
    </span>
  );
}

// ============================================
// CHIP — filtro seleccionable
// ============================================

export function Chip({ children, active = false, onClick, color, className = '', style, ...props }) {
  const activeBg = color ? hexToSubtle(color, 0.15) : 'var(--color-empresa-primary-subtle)';
  const activeFg = color || 'var(--color-empresa-primary)';

  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '6px 12px', borderRadius: 'var(--radius-full)',
        fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
        border: active ? `1.5px solid ${activeFg}` : '1.5px solid transparent',
        background: active ? activeBg : 'var(--color-surf-hi)',
        color: active ? activeFg : 'var(--color-text-muted)',
        cursor: 'pointer',
        transition: 'all var(--duration-fast) var(--ease-default)',
        ...style,
      }}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

// ============================================
// INPUT
// ============================================

export function Input({
  label,
  error,
  icon,
  className = '',
  inputClassName = '',
  style,
  id: externalId,
  ...props
}) {
  const autoId = useId();
  const id = externalId || autoId;
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && (
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        {icon && (
          <div style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--color-text-muted)', pointerEvents: 'none',
          }}>
            <Icon name={icon} size={18} />
          </div>
        )}
        <input
          id={id}
          className={`g-input ${inputClassName}`}
          style={{ paddingLeft: icon ? 40 : undefined, borderColor: error ? 'var(--color-red)' : undefined }}
          {...props}
        />
      </div>
      {error && (
        <p style={{ fontSize: 12, color: 'var(--color-red)', display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
          <Icon name="alert-circle" size={12} />
          {error}
        </p>
      )}
    </div>
  );
}

// ============================================
// SELECT
// ============================================

export function Select({
  label,
  error,
  options = [],
  placeholder = 'Seleccionar...',
  className = '',
  style,
  id: externalId,
  ...props
}) {
  const autoId = useId();
  const id = externalId || autoId;
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && (
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        <select
          id={id}
          className="g-input"
          style={{
            paddingRight: 36, appearance: 'none',
            borderColor: error ? 'var(--color-red)' : undefined,
          }}
          {...props}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt.value ?? opt} value={opt.value ?? opt}>
              {opt.label ?? opt}
            </option>
          ))}
        </select>
        <div style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: 'var(--color-text-muted)',
        }}>
          <Icon name="chevron-down" size={16} />
        </div>
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--color-red)', margin: 0 }}>{error}</p>}
    </div>
  );
}

// Modal, Avatar → re-exported from ./ui/Modal and ./ui/Avatar at top of file

// ============================================
// STAT CARD
// ============================================

export function StatCard({ label, value, icon, trend, trendUp, className = '', style }) {
  return (
    <Card className={className} style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ font: 'var(--text-overline)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        {icon && (
          <div style={{
            padding: 6, borderRadius: 'var(--radius-sm)',
            background: 'var(--color-empresa-primary-subtle)',
            color: 'var(--color-empresa-primary)',
          }}>
            <Icon name={icon} size={16} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <span style={{ font: 'var(--text-h1)', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
        {trend && (
          <span style={{
            fontSize: 12, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 2,
            color: trendUp ? 'var(--color-green)' : 'var(--color-red)',
          }}>
            <Icon name={trendUp ? 'trending-up' : 'chevron-down'} size={12} />
            {trend}
          </span>
        )}
      </div>
    </Card>
  );
}

// EmptyState → re-exported from ./ui/EmptyState at top of file

// ============================================
// SPINNER
// ============================================

export function Spinner({ size = 20, className = '' }) {
  return (
    <Icon
      name="refresh"
      size={size}
      style={{ animation: 'spin 1s linear infinite', color: 'var(--color-empresa-primary)' }}
      className={className}
    />
  );
}

// ============================================
// TOAST
// ============================================

const toastConfig = {
  success: { icon: 'check-circle', fg: 'var(--color-green)', bg: 'var(--color-green-subtle)' },
  error:   { icon: 'x-circle',     fg: 'var(--color-red)',   bg: 'var(--color-red-subtle)' },
  warning: { icon: 'alert-triangle', fg: 'var(--color-empresa-primary)', bg: 'var(--color-empresa-primary-subtle)' },
  info:    { icon: 'info',          fg: 'var(--color-cyan)',  bg: 'var(--color-cyan-subtle)' },
};

export function Toast({ message, variant = 'info', onClose, className = '' }) {
  const v = toastConfig[variant] || toastConfig.info;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)', background: v.bg,
        boxShadow: 'var(--shadow-md)',
        animation: 'fadeIn var(--duration-normal) var(--ease-out)',
      }}
      className={className}
    >
      <Icon name={v.icon} size={18} style={{ color: v.fg, flexShrink: 0 }} />
      <span style={{ font: 'var(--text-body)', color: 'var(--color-text)', flex: 1 }}>{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            padding: 4, borderRadius: 'var(--radius-sm)', border: 'none',
            background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer',
          }}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
