'use client';
import { useState, useEffect } from 'react';

// Logo de la empresa (SolidoCS). Se sirve desde /public → /logo.png (o .svg).
// Si el archivo todavía no está en public/, muestra un texto de respaldo para no
// romper la pantalla de login. Tamaño contenido, sin distorsión.
export function BrandLogo({
  size = 120,
  alt = 'SolidoCS',
  showText = false,
}: {
  size?: number;
  alt?: string;
  showText?: boolean;
}) {
  // El logo real se coloca en frontend/public/logo.png (o .svg). Probamos ambos.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const candidates = ['/logo.png', '/logo.svg', '/logo.jpg'];
    let mounted = true;
    Promise.all(
      candidates.map((u) =>
        fetch(u, { method: 'HEAD' }).then((r) => (r.ok ? u : null)).catch(() => null),
      ),
    ).then((found) => {
      // Preferir PNG, luego SVG, luego JPG — el primero que exista.
      const ok = found.find(Boolean) || null;
      if (mounted) setSrc(ok);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const styleMain: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  };

  return (
    <div style={styleMain}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: size * 3,
            maxHeight: size,
            objectFit: 'contain',
            width: 'auto',
            height: 'auto',
            display: 'block',
            margin: '0 auto',
          }}
        />
      ) : (
        <div style={{ fontSize: Math.min(Math.max(size * 0.24, 14), 26), fontWeight: 700, textAlign: 'center' }}>
          {alt}
        </div>
      )}
    </div>
  );
}
