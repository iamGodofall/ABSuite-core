/**
 * Socket.io Hook for Real-time Communication
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface ServiceStatus {
  [key: string]: 'up' | 'down' | 'unknown';
}

/** A signed execution, as it arrives. */
export interface LiveExecution {
  id: string;
  subject: string;
  module: string;
  action: string;
  outcome: 'success' | 'failure';
  error?: string;
  scope?: string[];
  jti?: string;
  startedAt: string;
  durationMs?: number;
  hash: string;
  keyId?: string;
  governance?: { policyRef: string; policyVersion: string; decision: string };
  steps?: { seq: number; name: string; at: string }[];
  /** Set by this hook, not by the server: when this client first saw it. */
  arrivedAt?: number;
}

/** How many arrivals to keep in memory. The feed is a window, not an archive. */
const FEED_LIMIT = 60;

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<ServiceStatus>({});
  const [error, setError] = useState<string | null>(null);
  const [executions, setExecutions] = useState<LiveExecution[]>([]);
  /**
   * Ids this client watched arrive, as opposed to ones it found already there.
   *
   * Only these are animated. Animating the initial snapshot would tell the
   * viewer that thirty records just happened, which is a lie told with motion —
   * and motion is the easiest way to overstate something.
   */
  const [arrivedIds, setArrivedIds] = useState<Set<string>>(new Set());

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

    // What was already there when this client connected. Not an arrival.
    socket.on('executions:snapshot', (data: { executions: LiveExecution[] }) => {
      setExecutions((data.executions ?? []).slice(0, FEED_LIMIT));
    });

    // A record that landed while someone was watching.
    socket.on('execution', (execution: LiveExecution) => {
      const stamped = { ...execution, arrivedAt: Date.now() };
      setExecutions(current => [stamped, ...current.filter(e => e.id !== execution.id)].slice(0, FEED_LIMIT));
      setArrivedIds(current => new Set(current).add(execution.id));
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
    connected: isConnected,
    status,
    error,
    executions,
    arrivedIds,
    emit,
    startService,
    stopService,
  };
}
