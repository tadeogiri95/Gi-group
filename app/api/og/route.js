import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#0C0A09',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: 'absolute',
            top: -120,
            right: -120,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -100,
            left: -100,
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(167,139,250,0.1) 0%, transparent 70%)',
          }}
        />

        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          {/* Logo */}
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 22,
              background: 'linear-gradient(135deg, #F97316, #A78BFA)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 32,
            }}
          >
            <span style={{ fontSize: 40, fontWeight: 800, color: '#000' }}>G</span>
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: 56,
              fontWeight: 800,
              color: '#F5F0E8',
              letterSpacing: '-0.02em',
              marginBottom: 16,
              textAlign: 'center',
            }}
          >
            Tu equipo ficha,{' '}
            <span style={{ color: '#F97316' }}>vos controlás</span>
          </div>

          {/* Subtitle */}
          <div
            style={{
              fontSize: 24,
              color: '#A39A8E',
              textAlign: 'center',
              maxWidth: 700,
              lineHeight: 1.4,
            }}
          >
            Fichaje digital, seguimiento de obra y reportes en tiempo real
          </div>

          {/* Features pills */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 40,
            }}
          >
            {['⏱ Fichaje', '📍 Geo', '📊 Reportes', '🤖 IA', '👥 Multi-empresa'].map(
              (f) => (
                <div
                  key={f}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 12,
                    background: 'rgba(249,115,22,0.12)',
                    color: '#F97316',
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  {f}
                </div>
              )
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 700, color: '#F5F0E8' }}>gypi.app</span>
          <span style={{ fontSize: 16, color: '#615A52' }}>·</span>
          <span style={{ fontSize: 16, color: '#615A52' }}>Gestión y productividad industrial</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
