'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
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

const TITLE_WIDTH_KEY = 'solidops_ticket_title_width';
const TITLE_WIDTH_MIN = 120;
const TITLE_WIDTH_MAX = 720;

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
  const [titleW, setTitleW] = useState(0);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = Number(localStorage.getItem(TITLE_WIDTH_KEY));
    if (saved > 0) setTitleW(saved);
  }, []);

  useEffect(() => {
    if (titleW > 0) localStorage.setItem(TITLE_WIDTH_KEY, String(titleW));
  }, [titleW]);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = titleW;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - startX) > 4) moved = true;
        setTitleW(Math.min(TITLE_WIDTH_MAX, Math.max(TITLE_WIDTH_MIN, startW + ev.clientX - startX)));
      };
      const onUp = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        try {
          el.releasePointerCapture(ev.pointerId);
        } catch {
          /* puede no existir si ya fue liberado */
        }
        if (moved) {
          suppressClickRef.current = true;
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 200);
        }
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    },
    [titleW],
  );

  const titleVar = { ['--ticket-title-w' as string]: `${titleW}px` } as CSSProperties;

  return (
    <div className="ticket-list" role="list" style={titleVar}>
      {tickets.map((t) => {
        const mine = mineIds.has(t.id);
        const selected = selectedIds?.has(t.id) || false;
        return (
          <Link
            key={t.id}
            href={`/tickets/${t.id}`}
            className={`ticket-row-link ${mine ? 'ticket-row-mine' : ''} ${selected ? 'ticket-row-selected' : ''}`}
            role="listitem"
            onClickCapture={(e) => {
              const t = e.target as HTMLElement | null;
              if (
                suppressClickRef.current ||
                (t && typeof t.closest === 'function' && t.closest('.ticket-resize-handle'))
              ) {
                suppressClickRef.current = false;
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            style={
              selectable
                ? { gridTemplateColumns: 'auto auto 88px minmax(min(var(--ticket-title-w, 0px), 44vw), 1fr) auto auto 1.1fr 130px auto' }
                : undefined
            }
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
              <span className="ticket-cell-title-text">{t.title}</span>
              <span
                className="ticket-resize-handle"
                onPointerDown={startResize}
                onClick={(e) => e.stopPropagation()}
                title="Arrastrar para ajustar el ancho del título"
                aria-hidden="true"
              />
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