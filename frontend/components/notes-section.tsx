'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { Card, Empty, Pill } from './ui';
import { MarkdownPreview } from './markdown-preview';
import { timeAgo } from '../lib/helpers';

interface NoteLite {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  box?: { name: string } | null;
  createdByUser?: { id: string; name: string } | null;
  updatedByUser?: { id: string; name: string } | null;
  tagLinks?: Array<{ tag: { name: string } }>;
}

// Sección reutilizable de Notas vinculadas, usada en la Ficha 360 de cliente
// (?customerId=) y en el detalle de ticket (?ticketId=). Muestra las notas de
// esa entidad con acceso directo a /notas.
export function NotesSection({ customerId, ticketId }: { customerId?: string | null; ticketId?: string | null }) {
  const [notes, setNotes] = useState<NoteLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const target = customerId ? `customerId=${customerId}` : ticketId ? `ticketId=${ticketId}` : '';
    if (!target) { setLoading(false); return; }
    api.get<NoteLite[]>(`/notes?${target}`).then(setNotes).catch(() => setNotes([])).finally(() => setLoading(false));
  }, [customerId, ticketId]);

  return (
    <Card title={ticketId ? 'Notas' : 'Notas'} meta={`${notes.length}`}>
      <div className="flex-between mb-16">
        <span className="muted" style={{ fontSize: 13 }}>
          {notes.length === 0 ? 'Sin notas vinculadas' : 'Notas compartidas vinculadas a esta ' + (ticketId ? 'ticket' : 'cliente')}
        </span>
        <Link href="/notas" className="btn btn-sm">ver todas →</Link>
      </div>
      {loading ? (
        <div className="empty">cargando…</div>
      ) : notes.length === 0 ? (
        <Empty message="Sin notas" />
      ) : (
        <div className="stack">
          {notes.map((n) => (
            <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <strong>{n.title}</strong>
              <div className="card-meta" style={{ marginTop: 3 }}>
                📝 Creada por: {n.createdByUser?.name || 'Creador no registrado'}
                {' · '}✏️ Última edición: {n.updatedByUser?.name || (n.createdByUser?.name ?? 'Creador no registrado')} · {timeAgo(n.updatedAt)}
              </div>
              {n.tagLinks && n.tagLinks.length > 0 && (
                <div className="flex wrap" style={{ gap: 4, marginTop: 4 }}>
                  {n.tagLinks.map((tl) => (
                    <Pill key={tl.tag.name} style="pill-gray">{tl.tag.name}</Pill>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 6, maxHeight: 140, overflow: 'auto' }}>
                <MarkdownPreview text={n.body} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
