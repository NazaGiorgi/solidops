'use client';
import { useEffect, useRef, useState } from 'react';
import { Pill } from './ui';

export interface TechnicianOption {
  id: string;
  userId?: string | null;
  name?: string;
  user?: { name?: string };
}

export function technicianName(t: TechnicianOption): string {
  return t.name || t.user?.name || 'Técnico sin nombre';
}

// Multi-select de técnicos extraído del modal "Agendar cita" de un ticket.
// Se reutiliza en la ficha del ticket y en la Agenda. Sin colores fijos: todo
// sale de las variables del tema.
export function TechnicianMultiSelect({
  technicians,
  selected,
  onChange,
  label = 'Técnicos',
  disabled = false,
  placeholder = 'Elegí de la lista…',
  closeSignal = 0,
}: {
  technicians: TechnicianOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
  // El formulario dueño incrementa este valor al enviar para cerrar la lista.
  closeSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const options = technicians.map((t) => ({ id: t.id, label: technicianName(t) }));
  const filtered = options.filter((o) => !query || o.label.toLowerCase().includes(query.toLowerCase()));

  // Clic afuera y Esc cierran el desplegable sin importar qué formulario lo use.
  useEffect(() => {
    if (!open || disabled) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, disabled]);

  // Enviar el formulario también cierra la lista (ej. botón "crear").
  useEffect(() => {
    setOpen(false);
  }, [closeSignal]);

  function toggle(id: string) {
    if (disabled) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="field">
      <label>{label} ({selected.length})</label>
      <div className="multi-select" ref={rootRef}>
        <button
          type="button"
          className="input"
          disabled={disabled}
          style={{ textAlign: 'left', cursor: disabled ? 'default' : 'pointer', width: '100%' }}
          onClick={() => !disabled && setOpen((v) => !v)}
        >
          {selected.length === 0
            ? placeholder
            : selected
                .map((id) => options.find((o) => o.id === id)?.label || '—')
                .join(', ')}
          <span className="card-meta" style={{ float: 'right' }}>▾</span>
        </button>
        {open && !disabled && (
          // En flujo normal: empuja los campos siguientes hacia abajo en vez de
          // superponerse a "Fin", "Privado" o los botones del modal.
          <div
            style={{
              marginTop: 6,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.08)',
              maxHeight: 220, overflow: 'auto',
            }}
          >
            <input
              className="input"
              placeholder="filtrar técnicos…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0,
                position: 'sticky', top: 0, width: '100%',
              }}
              autoFocus
            />
            {filtered.length === 0 && (
              <div className="card-meta" style={{ padding: '10px 12px' }}>sin resultados</div>
            )}
            {filtered.map((o) => (
              <label
                key={o.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  cursor: 'pointer', background: selected.includes(o.id) ? 'var(--bg-hover)' : 'none',
                }}
              >
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex wrap" style={{ gap: 4, marginTop: 6 }}>
          {selected.map((id) => {
            const o = options.find((x) => x.id === id);
            return (
              <Pill key={id} style="pill-blue">
                {o?.label || 'técnico'}
                {!disabled && (
                  <button
                    type="button"
                    className="link"
                    aria-label={`Quitar a ${o?.label || 'técnico'}`}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit' }}
                    onClick={() => toggle(id)}
                  >
                    ×
                  </button>
                )}
              </Pill>
            );
          })}
        </div>
      )}
    </div>
  );
}
