'use client';

/**
 * GYPI — LoginScreen (migrado a Tailwind)
 * Ubicación destino: app/components/LoginScreen.jsx
 */

import { useState } from 'react';
import { setToken } from '../lib/supabase';
import Icon from './Icon';
import { Button, Input } from './ui';

export default function LoginScreen({ onLogin, empresa }) {
  const [legajo, setLegajo] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = async () => {
    if (!legajo || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login-empresa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo: legajo.trim(), password, empresa_id: empresa?.id || null }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Error de conexión');
        setLoading(false);
        return;
      }
      if (data.token) setToken(data.token);
      onLogin(data.usuario);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full px-7 justify-center max-w-sm mx-auto">
      {/* Logo */}
      {empresa?.logo_url ? (
        <img
          src={empresa.logo_url}
          alt={empresa?.nombre_corto || 'Logo'}
          className="w-[72px] h-[72px] rounded-2xl object-contain mb-6"
        />
      ) : (
        <div className="w-[72px] h-[72px] rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center mb-6">
          <span className={`font-display font-extrabold text-white ${
            (empresa?.nombre_corto?.length || 0) > 4 ? 'text-lg' : 'text-2xl'
          }`}>
            {empresa?.nombre_corto || 'Gypi'}
          </span>
        </div>
      )}

      {/* Título */}
      <h1 className="text-3xl font-bold font-display text-[var(--color-text)] tracking-tight m-0">
        Bienvenido
      </h1>
      <p className="text-sm text-[var(--color-text-muted)] mt-1.5 mb-8">
        Iniciá sesión en {empresa?.nombre_corto || 'Gypi'}
      </p>

      {/* Formulario */}
      <div className="space-y-4">
        <Input
          label="Legajo / DNI"
          value={legajo}
          onChange={e => setLegajo(e.target.value)}
          inputMode="numeric"
          placeholder="Ingresá tu número de legajo"
          icon="user"
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">
            Contraseña
          </label>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
              <Icon name="shield" size={18} />
            </div>
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
              placeholder="Ingresá tu contraseña"
              className="w-full h-10 pl-10 pr-16 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all duration-150"
            />
            <button
              onClick={() => setShowPwd(!showPwd)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              {showPwd ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </div>
      </div>

      {/* Botón login */}
      <Button
        onClick={login}
        disabled={loading || !legajo || !password}
        loading={loading}
        size="lg"
        className="w-full mt-6"
      >
        {loading ? 'Conectando...' : 'Iniciar sesión'}
      </Button>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 mt-3 p-3 rounded-xl bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-800">
          <Icon name="alert-circle" size={14} className="text-danger-500 shrink-0" />
          <span className="text-xs text-danger-600 dark:text-danger-400">{error}</span>
        </div>
      )}
    </div>
  );
}
