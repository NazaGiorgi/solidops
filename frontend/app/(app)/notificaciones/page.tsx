'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { timeAgo } from '../../../lib/helpers';

interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  ticket_asignado: 'ticket asignado',
  sla_en_riesgo: 'SLA en riesgo',
  tarea_atrasada: 'tarea atrasada',
  whatsapp_message: '💬 WhatsApp',
};

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    api
      .get<Notification[]>('/notifications')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  async function markRead(id: string) {
    await api.patch(`/notifications/${id}/read`);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  }

  async function readAll() {
    await api.patch('/notifications/read-all');
    setItems((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
  }

  return (
    <Shell>
      <PageHeader
        title="Notificaciones"
        subtitle="Centro de avisos in-app"
        action={
          <button className="btn" onClick={readAll}>
            marcar todas como leídas
          </button>
        }
      />
      {loading ? (
        <div className="empty">cargando…</div>
      ) : items.length === 0 ? (
        <Empty message="Sin notificaciones" />
      ) : (
        <div className="stack">
          {items.map((n) => {
            const title = (n.payload.title as string) || '';
            const ticketId = (n.payload.ticketId as string) || null;
            return (
              <Card key={n.id}>
                <div className="flex-between">
                  <div className="flex wrap">
                    <Pill style={!n.readAt ? 'pill-blue' : 'pill-gray'}>
                      {TYPE_LABELS[n.type] || n.type}
                    </Pill>
                    <span className="card-meta">{timeAgo(n.createdAt)}</span>
                  </div>
                  {!n.readAt && (
                    <button className="btn btn-sm btn-ghost" onClick={() => markRead(n.id)}>
                      marcar leída
                    </button>
                  )}
                </div>
                {title && <div style={{ marginTop: 8 }}>{title}</div>}
                {ticketId && (
                  <Link href={`/tickets/${ticketId}`} className="link" style={{ fontSize: 13 }}>
                    ver ticket
                  </Link>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
