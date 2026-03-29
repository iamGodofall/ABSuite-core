/**
 * Socket.io Hook for Real-time Communication
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface ServiceStatus {
  [key: string]: 'up' | 'down' | 'unknown';
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<ServiceStatus>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize socket connection
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);
      setError(null);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setError('Failed to connect to real-time updates');
      setIsConnected(false);
    });

    socket.on('status', (data: ServiceStatus) => {
      setStatus(data);
    });

    // Request initial status
    socket.emit('get-status');

    return () => {
      socket.disconnect();
    };
  }, []);

  const emit = useCallback((event: string, data?: any) => {
    if (socketRef.current) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const startService = useCallback((serviceName: string) => {
    emit('start', serviceName);
  }, [emit]);

  const stopService = useCallback((serviceName: string) => {
    emit('stop', serviceName);
  }, [emit]);

  return {
    socket: socketRef.current,
    isConnected,
    status,
    error,
    emit,
    startService,
    stopService,
  };
}
