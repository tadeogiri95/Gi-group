// ═══════════════════════════════════════════════════════════
// Componentes UI compartidos — Tag y Chip
//
// ENTREGA 2B: Refactorizados para usar Tailwind donde posible,
// manteniendo compatibilidad con el prop color={C.amber} que
// usan todas las pantallas existentes (inline dynamic color
// necesita style= porque Tailwind no soporta valores dinámicos).
//
// Cuando las pantallas se migren a Tailwind (2E), se puede
// agregar variants predefinidos (color="amber" | "green" | ...).
// ═══════════════════════════════════════════════════════════

import { C } from "../lib/theme";

export const Tag = ({ color = C.amber, children, style = {} }) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase font-body"
    style={{
      background: `${color}22`,
      color,
      ...style,
    }}
  >
    {children}
  </span>
);

export const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button
    onClick={onClick}
    className="px-3 py-1.5 rounded-pill border-none cursor-pointer text-[11px] font-bold font-body whitespace-nowrap transition-all duration-150"
    style={{
      background: active ? `${color}22` : undefined,
      color: active ? color : undefined,
    }}
  >
    {children}
  </button>
);

// ─── Nuevos componentes de 2B ───

export const Badge = ({ variant = "default", children }) => {
  const variants = {
    default: "bg-gypi-surface-hi text-gypi-dim",
    success: "bg-gypi-green/15 text-gypi-green",
    warning: "bg-gypi-amber/15 text-gypi-amber",
    danger:  "bg-gypi-red/15 text-gypi-red",
    info:    "bg-gypi-cyan/15 text-gypi-cyan",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${variants[variant] || variants.default}`}>
      {children}
    </span>
  );
};

export const Button = ({ variant = "primary", size = "md", onClick, disabled, children, className = "" }) => {
  const base = "inline-flex items-center justify-center gap-2 font-semibold border-none cursor-pointer rounded-btn font-body transition-all";
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2.5 text-sm",
    lg: "px-6 py-3 text-sm",
  };
  const variants = {
    primary:   "bg-gypi-amber text-gypi-bg hover:opacity-90",
    secondary: "bg-gypi-surface-hi text-gypi-text border border-gypi-border-hi hover:bg-gypi-surface",
    ghost:     "bg-transparent text-gypi-dim hover:text-gypi-text hover:bg-gypi-surface-hi",
    danger:    "bg-gypi-red/15 text-gypi-red hover:bg-gypi-red/25",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${className}`}
    >
      {children}
    </button>
  );
};

export const Input = ({ label, error, className = "", ...props }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    {label && <label className="text-[11px] font-semibold text-gypi-dim uppercase tracking-wider">{label}</label>}
    <input
      className={`w-full px-3 py-2.5 rounded-btn bg-gypi-surface-hi border text-sm text-gypi-text font-body placeholder:text-gypi-mute focus:outline-none focus:border-gypi-amber ${
        error ? "border-gypi-red" : "border-gypi-border-hi"
      }`}
      {...props}
    />
    {error && <span className="text-[11px] text-gypi-red">{error}</span>}
  </div>
);
