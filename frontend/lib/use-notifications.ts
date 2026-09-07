'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL, getToken } from './api';

interface NotificationEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

// Connects to the Socket.IO backend for live in-app notifications.
// Emits a callback every time a `notification:new` event arrives.
export function useNotificationsSocket(onEvent: (n: NotificationEvent) => void) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = io(API_URL, {
      transports: ['websocket'],
      path: '/socket.io',
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('notification:new', (n: NotificationEvent) => {
      cbRef.current(n);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return { connected };
}
