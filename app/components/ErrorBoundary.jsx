"use client";
// ═══════════════════════════════════════════════════════════
// ErrorBoundary — Catch de errores por pantalla
//
// ENTREGA 2G: Si una pantalla tiene un error de JS, muestra
// "Algo salió mal" con botón de recargar en vez de crashear
// toda la app (React unmount).
//
// Uso (wrappear cada screen en page.js o en cada componente):
//
//   <ErrorBoundary name="Dashboard">
//     <DashboardGerencia />
//   </ErrorBoundary>
//
// También exporta un HOC para wrappear en una línea:
//
//   const SafeDashboard = withErrorBoundary(DashboardGerencia, "Dashboard");
// ═══════════════════════════════════════════════════════════

import { Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          {/* Icon */}
          <div className="w-14 h-14 rounded-full bg-gypi-red/15 flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gypi-red">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>

          {/* Message */}
          <p className="text-sm font-semibold text-gypi-text m-0 mb-1">
            Algo salió mal
            {this.props.name && <span className="text-gypi-dim font-normal"> en {this.props.name}</span>}
          </p>
          <p className="text-xs text-gypi-mute m-0 mb-4 max-w-[280px]">
            Hubo un error inesperado. El resto de la app sigue funcionando.
          </p>

          {/* Error detail (dev only) */}
          {process.env.NODE_ENV === "development" && this.state.error && (
            <pre className="text-[10px] text-gypi-red/70 bg-gypi-surface rounded-lg p-3 mb-4 max-w-full overflow-x-auto text-left font-mono">
              {this.state.error.message}
            </pre>
          )}

          {/* Retry button */}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-5 py-2.5 rounded-btn bg-gypi-amber/15 text-gypi-amber text-xs font-bold border-none cursor-pointer hover:bg-gypi-amber/25"
          >
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ─── HOC para wrappear en una línea ───
export function withErrorBoundary(WrappedComponent, name) {
  return function SafeComponent(props) {
    return (
      <ErrorBoundary name={name}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

export default ErrorBoundary;
