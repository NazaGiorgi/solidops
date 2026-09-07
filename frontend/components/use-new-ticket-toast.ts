'use client';
import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useToast } from './toast';
import { API_URL, getToken } from '../lib/api';

interface NewTicketPayload {
  id: string;
  title: string;
  customerName?: string | null;
  technicianName?: string | null;
  status?: string;
  priority?: string;
  createdAt?: string;
}

// Muestra una notificación flotante (toast) estilo Zammad cuando llega un TICKET
// NUEVO al sistema (manual o por email), en CUALQUIER pantalla. Usa su propio
// Socket.IO (evento 'ticket:new') para no interferir con 'notification:new' que
// ya usa el Shell para el contador de no leídas. Auto-cierra a los 8s; el clic
// lleva directo al ticket.
export function useNewTicketToast() {
  const { push } = useToast();
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket: Socket = io(API_URL, {
      transports: ['websocket'],
      path: '/socket.io',
      auth: { token },
    });
    socket.on('ticket:new', (payload: NewTicketPayload) => {
      if (!payload?.id || !payload?.title) return;
      push({
        title: `🎫 Nuevo ticket: ${payload.title}`,
        body: [payload.customerName ? `Cliente: ${payload.customerName}` : null, payload.technicianName ? `Técnico: ${payload.technicianName}` : null]
          .filter(Boolean)
          .join(' · '),
        tone: 'info',
        actionHref: `/tickets/${payload.id}`,
        actionLabel: 'abrir ticket →',
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [push]);
}
