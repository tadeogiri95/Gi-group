'use client';

/**
 * GYPI — CambiarPasswordScreen (migrado a Tailwind)
 * Ubicación destino: app/components/CambiarPasswordScreen.jsx
 */

import { useState } from 'react';
import { getToken } from '../lib/supabase';
import Icon from './Icon';
import { Button, Input } from './ui';

export default function CambiarPasswordScreen({ usuario, onDone }) {
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cambiar = async () => {
    if (!nueva || !confirmar) return;
    if (nueva.length < 4) { setError('La contraseña debe tener al menos 4 caracteres'); return; }
    if (nueva !== confirmar) { setError('Las contraseñas no coinciden'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login-empresa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cambiar_password', userId: usuario.id, nuevaPassword: nueva, token: getToken() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || 'Error al cambiar'); setLoading(false); return; }
      onDone(data.usuario);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full px-7 justify-center max-w-sm mx-auto">
      {/* Ícono */}
      <div className="w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center text-brand-500 mb-5">
        <Icon name="shield" size={28} />
      </div>

      {/* Título */}
      <h1 className="text-2xl font-bold font-display text-[var(--color-text)] m-0">
        Crear tu contraseña
      </h1>
      <p className="text-sm text-[var(--color-text-muted)] mt-1.5 mb-7 leading-relaxed">
        Hola <span className="font-semibold text-[var(--color-text)]">{usuario.apodo}</span>, es tu primer ingreso. Elegí una contraseña personal para tu cuenta.
      </p>

      {/* Formulario */}
      <div className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">
            Nueva contraseña
          </label>
          <input
            type={showPwd ? 'text' : 'password'}
            value={nueva}
            onChange={e => setNueva(e.target.value)}
            placeholder="Mínimo 4 caracteres"
            className="w-full h-10 px-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all duration-150"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">
            Confirmar contraseña
          </label>
          <input
            type={showPwd ? 'text' : 'password'}
            value={confirmar}
            onChange={e => setConfirmar(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && cambiar()}
            placeholder="Repetí la contraseña"
            className="w-full h-10 px-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all duration-150"
          />
        </div>

        <button
          onClick={() => setShowPwd(!showPwd)}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors flex items-center gap-1.5"
        >
          <Icon name={showPwd ? 'eye-off' : 'eye'} size={14} />
          {showPwd ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
        </button>
      </div>

      {/* Botón confirmar */}
      <Button
        onClick={cambiar}
        disabled={loading || !nueva || !confirmar}
        loading={loading}
        size="lg"
        className="w-full mt-6"
      >
        {loading ? 'Guardando...' : 'Confirmar contraseña'}
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
