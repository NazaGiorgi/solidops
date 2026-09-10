'use client';
import { useToast } from './toast';
import { useTicketEvents } from '../lib/use-ticket-events';
import { playNewTicketSound, playClientReplySound } from '../lib/sound';
import { CHANNEL_LABELS } from '../lib/helpers';

// Muestra una notificación flotante (toast) estilo Zammad cuando llega un TICKET
// NUEVO (manual, por email o por portal) o una RESPUESTA DE CLIENTE a un ticket
// ya abierto (WhatsApp/email/portal), en CUALQUIER pantalla. Usa Socket.IO
// (eventos 'ticket:new' y 'ticket:client-reply') sin interferir con
// 'notification:new' que ya usa el Shell para el contador de no leídas.
// Auto-cierra a los 8s; el clic lleva directo al ticket.
export function useNewTicketToast() {
  const { push } = useToast();
  useTicketEvents((type, payload) => {
    if (!payload?.id || !payload?.title) return;
    if (type === 'ticket:new') {
      playNewTicketSound();
      push({
        title: `🎫 Nuevo ticket: ${payload.title}`,
        body: [payload.customerName ? `Cliente: ${payload.customerName}` : null, payload.technicianName ? `Técnico: ${payload.technicianName}` : null]
          .filter(Boolean)
          .join(' · '),
        tone: 'info',
        actionHref: `/tickets/${payload.id}`,
        actionLabel: 'abrir ticket →',
      });
    } else {
      const channel = CHANNEL_LABELS[payload.channel || ''] || payload.channel || 'mensaje';
      playClientReplySound();
      push({
        title: `💬 ${channel}: respuesta de ${payload.customerName || 'cliente'} · ${payload.title}`,
        body: payload.preview ? payload.preview.trim() : undefined,
        tone: 'info',
        actionHref: `/tickets/${payload.id}`,
        actionLabel: 'abrir ticket →',
      });
    }
  });
}