'use client';
import Link from 'next/link';
import { Pill } from './ui';
import {
  STATUS_PILLS,
  STATUS_LABELS,
  PRIORITY_PILLS,
  PRIORITY_LABELS,
  SLA_PILLS,
  timeAgo,
} from '../lib/helpers';

export interface TicketCardData {
  id: string;
  title: string;
  status: string;
  priority: string;
  slaStatus?: string | null;
  createdAt: string;
  customer?: { name?: string } | null;
  technician?: { user?: { name?: string } } | null;
  technicianId?: string | null;
  mergedIntoId?: string | null;
  shadow?: boolean;
}

// Reusable ticket card (same presentation as the /tickets list). Used by the
// client 360 view so the ticket list is not duplicated.
export function TicketCard({
  ticket,
  mine,
}: {
  ticket: TicketCardData;
  mine?: boolean;
}) {
  return (
    <Link href={`/tickets/${ticket.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className={`card ${mine ? 'card-mine' : ''}`} style={{ height: '100%' }}>
        <div className="flex-between">
          <Pill style={STATUS_PILLS[ticket.status] || 'pill-gray'}>{STATUS_LABELS[ticket.status] || ticket.status}</Pill>
          <span className="card-meta">{timeAgo(ticket.createdAt)}</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, margin: '8px 0' }}>{ticket.title}</div>
        <div className="flex wrap">
          <Pill style={PRIORITY_PILLS[ticket.priority] || 'pill-gray'}>{PRIORITY_LABELS[ticket.priority] || ticket.priority}</Pill>
          {ticket.slaStatus && (
            <Pill style={SLA_PILLS[ticket.slaStatus] || 'pill-gray'}>SLA {ticket.slaStatus}</Pill>
          )}
          {ticket.shadow && (
            <Pill style="pill-amber">
              <span title="Modo sombra — no responder desde acá (Zammad sigue procesando esta casilla)">☁ modo sombra — no responder</span>
            </Pill>
          )}
          {ticket.mergedIntoId && (
            <Pill style="pill-amber">
              fusionado con <Link href={`/tickets/${ticket.mergedIntoId}`} onClick={(e) => e.stopPropagation()} className="link">#{ticket.mergedIntoId.slice(0, 8)}</Link>
            </Pill>
          )}
        </div>
        <div className="card-meta" style={{ marginTop: 8 }}>
          {ticket.customer?.name || '—'} · {ticket.technician?.user?.name || 'sin técnica'}
          {mine && <span className="pill pill-blue" style={{ marginLeft: 8 }}>asignado a mí</span>}
        </div>
      </div>
    </Link>
  );
}
