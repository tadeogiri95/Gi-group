'use client';

/**
 * GYPI — Componentes UI Base (Design System)
 *
 * Ubicación destino: app/components/ui.jsx
 * Reemplaza el archivo actual que solo tiene Tag y Chip.
 *
 * Todos los componentes usan Tailwind CSS + CSS variables.
 * Compatible con dark mode vía clase .dark en <html>.
 */

import Icon from './Icon';

// ============================================
// BUTTON
// ============================================

const buttonVariants = {
  primary:   'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm',
  secondary: 'bg-surface-100 text-surface-700 hover:bg-surface-200 active:bg-surface-300 dark:bg-surface-700 dark:text-surface-200 dark:hover:bg-surface-600',
  danger:    'bg-danger-500 text-white hover:bg-danger-600 active:bg-danger-700',
  ghost:     'text-surface-600 hover:bg-surface-100 active:bg-surface-200 dark:text-surface-300 dark:hover:bg-surface-700',
  outline:   'border border-surface-300 text-surface-700 hover:bg-surface-50 dark:border-surface-600 dark:text-surface-200 dark:hover:bg-surface-800',
};

const buttonSizes = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  className = '',
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-medium
        transition-all duration-150 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500
        ${buttonVariants[variant]}
        ${buttonSizes[size]}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      {...props}
    >
      {loading ? (
        <Icon name="refresh" size={size === 'sm' ? 14 : 16} className="animate-spin" />
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

export function Card({ children, className = '', padding = true, hover = false, ...props }) {
  return (
    <div
      className={`
        bg-[var(--color-surface-raised)] border border-[var(--color-border)]
        rounded-xl shadow-card
        ${padding ? 'p-4' : ''}
        ${hover ? 'hover:shadow-card-lg hover:-translate-y-0.5 transition-all duration-200' : ''}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      {...props}
    >
      {children}
    </div>
  );
}

// ============================================
// BADGE (reemplaza Tag)
// ============================================

const badgeVariants = {
  default: 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
  brand:   'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300',
  success: 'bg-success-100 text-success-700 dark:bg-green-900 dark:text-green-300',
  danger:  'bg-danger-100 text-danger-700 dark:bg-red-900 dark:text-red-300',
  warning: 'bg-warning-100 text-warning-600 dark:bg-amber-900 dark:text-amber-300',
  info:    'bg-info-100 text-info-600 dark:bg-cyan-900 dark:text-cyan-300',
  accent:  'bg-accent-100 text-accent-600 dark:bg-violet-900 dark:text-violet-300',
};

export function Badge({ children, variant = 'default', dot = false, className = '', ...props }) {
  return (
    <span
      className={`
        inline-flex items-center gap-1 px-2 py-0.5 rounded-full
        text-xs font-medium whitespace-nowrap
        ${badgeVariants[variant]}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      {...props}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${
          variant === 'success' ? 'bg-success-500' :
          variant === 'danger' ? 'bg-danger-500' :
          variant === 'warning' ? 'bg-warning-500' :
          variant === 'brand' ? 'bg-brand-500' :
          'bg-current'
        }`} />
      )}
      {children}
    </span>
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
  ...props
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
            <Icon name={icon} size={18} />
          </div>
        )}
        <input
          className={`
            w-full h-10 px-3 rounded-xl
            bg-[var(--color-bg)] border border-[var(--color-border)]
            text-[var(--color-text)] text-sm
            placeholder:text-[var(--color-text-muted)]
            focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500
            transition-all duration-150
            disabled:opacity-50 disabled:cursor-not-allowed
            ${icon ? 'pl-10' : ''}
            ${error ? 'border-danger-500 focus:ring-danger-500/30 focus:border-danger-500' : ''}
            ${inputClassName}
          `.trim().replace(/\s+/g, ' ')}
          {...props}
        />
      </div>
      {error && (
        <p className="text-xs text-danger-500 flex items-center gap-1">
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
  ...props
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          className={`
            w-full h-10 px-3 pr-10 rounded-xl appearance-none
            bg-[var(--color-bg)] border border-[var(--color-border)]
            text-[var(--color-text)] text-sm
            focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500
            transition-all duration-150
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? 'border-danger-500' : ''}
          `.trim().replace(/\s+/g, ' ')}
          {...props}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt.value ?? opt} value={opt.value ?? opt}>
              {opt.label ?? opt}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-muted)]">
          <Icon name="chevron-down" size={16} />
        </div>
      </div>
      {error && (
        <p className="text-xs text-danger-500">{error}</p>
      )}
    </div>
  );
}

// ============================================
// MODAL
// ============================================

export function Modal({ open, onClose, title, children, size = 'md', className = '' }) {
  if (!open) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)]',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`
          relative w-full ${sizeClasses[size]}
          bg-[var(--color-surface-raised)] border border-[var(--color-border)]
          rounded-2xl shadow-modal
          animate-fade-in
          flex flex-col max-h-[85vh]
          ${className}
        `.trim().replace(/\s+/g, ' ')}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <h2 className="text-base font-semibold text-[var(--color-text)] font-display">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================
// AVATAR
// ============================================

const avatarSizes = {
  xs: 'w-6 h-6 text-2xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
};

export function Avatar({ name, src, size = 'md', className = '' }) {
  const initials = name
    ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div
      className={`
        ${avatarSizes[size]}
        rounded-full flex items-center justify-center
        bg-brand-100 text-brand-700 font-semibold
        dark:bg-brand-900 dark:text-brand-300
        overflow-hidden shrink-0
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {src ? (
        <img src={src} alt={name || ''} className="w-full h-full object-cover" />
      ) : (
        initials
      )}
    </div>
  );
}

// ============================================
// STAT CARD
// ============================================

export function StatCard({ label, value, icon, trend, trendUp, className = '' }) {
  return (
    <Card className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wide">
          {label}
        </span>
        {icon && (
          <div className="p-1.5 rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-900/30">
            <Icon name={icon} size={16} />
          </div>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-[var(--color-text)] font-display">
          {value}
        </span>
        {trend && (
          <span className={`text-xs font-medium flex items-center gap-0.5 ${
            trendUp ? 'text-success-600' : 'text-danger-600'
          }`}>
            <Icon name={trendUp ? 'trending-up' : 'chevron-down'} size={12} />
            {trend}
          </span>
        )}
      </div>
    </Card>
  );
}

// ============================================
// CHIP (filtros seleccionables)
// ============================================

export function Chip({ children, active = false, onClick, className = '', ...props }) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center px-3 py-1.5 rounded-full
        text-xs font-medium whitespace-nowrap
        transition-all duration-150 ease-out
        ${active
          ? 'bg-brand-500 text-white shadow-sm'
          : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600'
        }
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      {...props}
    >
      {children}
    </button>
  );
}

// ============================================
// EMPTY STATE
// ============================================

export function EmptyState({ icon = 'folder', title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
      <div className="p-4 rounded-full bg-surface-100 dark:bg-surface-700 mb-4">
        <Icon name={icon} size={32} className="text-[var(--color-text-muted)]" />
      </div>
      {title && (
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-1">{title}</h3>
      )}
      {description && (
        <p className="text-sm text-[var(--color-text-muted)] max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ============================================
// SPINNER
// ============================================

export function Spinner({ size = 20, className = '' }) {
  return (
    <Icon name="refresh" size={size} className={`animate-spin text-brand-500 ${className}`} />
  );
}

// ============================================
// TOAST (para notificaciones inline)
// ============================================

const toastVariants = {
  success: { icon: 'check-circle', color: 'text-success-500', bg: 'bg-success-50 dark:bg-success-700/20' },
  error:   { icon: 'x-circle',     color: 'text-danger-500',  bg: 'bg-danger-50 dark:bg-danger-700/20' },
  warning: { icon: 'alert-triangle', color: 'text-warning-500', bg: 'bg-warning-50 dark:bg-warning-700/20' },
  info:    { icon: 'info',          color: 'text-info-500',    bg: 'bg-info-50 dark:bg-info-700/20' },
};

export function Toast({ message, variant = 'info', onClose, className = '' }) {
  const v = toastVariants[variant];
  return (
    <div className={`
      flex items-center gap-3 px-4 py-3 rounded-xl shadow-toast
      border border-[var(--color-border)] ${v.bg}
      animate-slide-down ${className}
    `.trim().replace(/\s+/g, ' ')}>
      <Icon name={v.icon} size={18} className={v.color} />
      <span className="text-sm text-[var(--color-text)] flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="p-1 rounded-md hover:bg-surface-200 dark:hover:bg-surface-600">
          <Icon name="x" size={14} className="text-[var(--color-text-muted)]" />
        </button>
      )}
    </div>
  );
}

// Re-exportar Tag como alias de Badge para compatibilidad
export const Tag = Badge;
