'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL, getToken } from './api';

export type TicketEventType = 'ticket:new' | 'ticket:client-reply' | 'ticket:updated';

export interface TicketEventPayload {
  id: string;
  title: string;
  customerName?: string | null;
  technicianName?: string | null;
  status?: string;
  priority?: string;
  channel?: string;
  preview?: string;
  createdAt?: string;
}

// Escucha en vivo los eventos de tickets (Socket.IO, evento compartido con el
// resto de la app). Callbacks con ref: el handler puede cerrar sobre estado
// fresco sin re-conectar el socket en cada render.
export function useTicketEvents(handler: (type: TicketEventType, payload: TicketEventPayload) => void) {
  const cbRef = useRef(handler);
  cbRef.current = handler;

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket: Socket = io(API_URL, {
      transports: ['websocket'],
      path: '/socket.io',
      auth: { token },
    });
    socket.on('ticket:new', (p: TicketEventPayload) => cbRef.current('ticket:new', p));
    socket.on('ticket:client-reply', (p: TicketEventPayload) => cbRef.current('ticket:client-reply', p));
    socket.on('ticket:updated', (p: TicketEventPayload) => cbRef.current('ticket:updated', p));
    return () => {
      socket.disconnect();
    };
  }, []);
}