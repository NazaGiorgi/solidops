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
  ticketNumberDisplay,
  sourceIcon,
  sourceLabel,
} from '../lib/helpers';

// Lista de tickets en filas compactas. CADA FILA es un <Link> a /tickets/[id]:
// al hacer clic en un ticket se ABRE su ficha (comportamiento original), NO se
// expande inline. La expansión de toda la sección la maneja el encabezado
// "Tickets" en la página (ticketsExpanded), no este componente.
export interface TicketListItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  slaStatus?: string | null;
  createdAt: string;
  ticketNumber?: number | null;
  source?: string | null;
  customer?: { name?: string } | null;
  technician?: { user?: { name?: string } } | null;
  technicianId?: string | null;
  mergedIntoId?: string | null;
  shadow?: boolean;
  workshop?: { equipmentId: string; contactName?: string | null } | null;
}

export function TicketList({
  tickets,
  mineIds,
  selectedIds,
  onToggle,
}: {
  tickets: TicketListItem[];
  mineIds: Set<string>;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const selectable = !!onToggle;
  return (
    <div className="ticket-list" role="list">
      {tickets.map((t) => {
        const mine = mineIds.has(t.id);
        const selected = selectedIds?.has(t.id) || false;
        return (
          <Link
            key={t.id}
            href={`/tickets/${t.id}`}
            className={`ticket-row-link ${mine ? 'ticket-row-mine' : ''} ${selected ? 'ticket-row-selected' : ''}`}
            role="listitem"
            style={selectable ? { gridTemplateColumns: 'auto auto 88px 1fr auto auto 1.1fr 130px auto' } : undefined}
          >
            {selectable && (
              <label
                className="ticket-cell ticket-cell-check"
                onClick={(e) => e.stopPropagation()}
              >
                <input type="checkbox" checked={selected} onChange={() => onToggle?.(t.id)} />
              </label>
            )}
            <span className="ticket-cell ticket-cell-status">
              <Pill style={STATUS_PILLS[t.status] || 'pill-gray'}>
                {STATUS_LABELS[t.status] || t.status}
              </Pill>
            </span>
            <span className="ticket-cell ticket-cell-time">{timeAgo(t.createdAt)}</span>
            <span className="ticket-cell ticket-cell-title">
              <span className="ticket-cell-source" title={sourceLabel(t.source)}>{sourceIcon(t.source)}</span>
              {ticketNumberDisplay(t) && (
                <span className="pill pill-gray" style={{ fontSize: 11, marginRight: 6 }}>{ticketNumberDisplay(t)}</span>
              )}
              {t.title}
            </span>
            <span className="ticket-cell ticket-cell-prio">
              <Pill style={PRIORITY_PILLS[t.priority] || 'pill-gray'}>
                {PRIORITY_LABELS[t.priority] || t.priority}
              </Pill>
            </span>
            <span className="ticket-cell ticket-cell-sla">
              {t.slaStatus ? (
                <Pill style={SLA_PILLS[t.slaStatus] || 'pill-gray'}>SLA {t.slaStatus}</Pill>
              ) : (
                <span className="muted">—</span>
              )}
            </span>
            <span className="ticket-cell ticket-cell-cust">
              <span className="ticket-cell-cust-name">
                {t.workshop?.contactName || t.customer?.name || '—'}
              </span>
              {t.workshop && (
                <Link
                  href={`/taller/${t.workshop.equipmentId}`}
                  className="pill pill-blue ticket-cell-workshop"
                  title="Ver equipo en Taller"
                >
                  🔧 Taller
                </Link>
              )}
              {t.mergedIntoId && (
                <span className="pill pill-amber ticket-cell-merged">fusionado</span>
              )}
              {t.shadow && (
                <span className="pill pill-amber ticket-cell-merged" title="modo sombra">
                  ☁
                </span>
              )}
            </span>
            <span className="ticket-cell ticket-cell-tech">
              {t.technician?.user?.name || 'sin técnica'}
            </span>
            <span className="ticket-cell ticket-cell-chevron" aria-hidden="true">
              →
            </span>
          </Link>
        );
      })}
    </div>
  );
}