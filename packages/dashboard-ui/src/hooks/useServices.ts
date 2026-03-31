/**
 * Services Hook for Managing ABSuite Services
 */

import { useState, useEffect, useCallback } from 'react';

export interface Service {
  id: string;
  name: string;
  status: 'up' | 'down' | 'unknown';
  port: number;
  features: string[];
  metrics?: {
    cpu: number;
    memory: number;
    requests: number;
    errors: number;
  };
  health: {
    cpu: number;
    memory: number;
    uptime: number;
  };
  lastCheck: Date;
}

const DEFAULT_SERVICES: Service[] = [
  {
    id: 'capkit',
    name: 'capkit',
    status: 'unknown',
    port: 8081,
    features: ['Capability Tokens', 'Policy Engine', 'AI Policy Generator'],
    health: { cpu: 0, memory: 0, uptime: 0 },
    lastCheck: new Date(),
  },
  {
    id: 'edge-run',
    name: 'edge-run',
    status: 'unknown',
    port: 8082,
    features: ['Agent Scheduler', 'Self-Healing', 'WebSocket Orchestration'],
    health: { cpu: 0, memory: 0, uptime: 0 },
    lastCheck: new Date(),
  },
  {
    id: 'quickbench',
    name: 'quickbench',
    status: 'unknown',
    port: 8083,
    features: ['Benchmarking', 'A/B Testing', 'AI Analyzer'],
    health: { cpu: 0, memory: 0, uptime: 0 },
    lastCheck: new Date(),
  },
  {
    id: 'connector-starter',
    name: 'connector-starter',
    status: 'unknown',
    port: 8084,
    features: ['Adapter Factory', 'AI Agent Generator', 'Multi-Platform'],
    health: { cpu: 0, memory: 0, uptime: 0 },
    lastCheck: new Date(),
  },
  {
    id: 'dashboard',
    name: 'dashboard',
    status: 'up',
    port: 3001,
    features: ['System Overview', 'AI Studio', 'Monitoring'],
    health: { cpu: 0, memory: 0, uptime: 0 },
    lastCheck: new Date(),
  },
];

export function useServices() {
  const [services, setServices] = useState<Service[]>(DEFAULT_SERVICES);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshServices = useCallback(async () => {
    try {
      // Try to fetch from orchestrator API
      const response = await fetch('/status');
      if (response.ok) {
        const data = await response.json();
        setServices(prev => 
          prev.map(s => ({
            ...s,
            status: data[s.name] || s.status,
            lastCheck: new Date(),
          }))
        );
        setIsConnected(true);
        setError(null);
      }
    } catch (err: any) {
      console.error('Failed to refresh services:', err);
      setError('Failed to connect to orchestrator');
      setIsConnected(false);
    }
  }, []);

  const startService = useCallback(async (serviceName: string) => {
    try {
      const response = await fetch(`/start/${serviceName}`, { method: 'POST' });
      if (response.ok) {
        await refreshServices();
      } else {
        throw new Error(`Failed to start ${serviceName}`);
      }
    } catch (err: any) {
      console.error(`Failed to start ${serviceName}:`, err);
      setError(`Failed to start ${serviceName}`);
    }
  }, [refreshServices]);

  const stopService = useCallback(async (serviceName: string) => {
    try {
      const response = await fetch(`/stop/${serviceName}`, { method: 'POST' });
      if (response.ok) {
        await refreshServices();
      } else {
        throw new Error(`Failed to stop ${serviceName}`);
      }
    } catch (err: any) {
      console.error(`Failed to stop ${serviceName}:`, err);
      setError(`Failed to stop ${serviceName}`);
    }
  }, [refreshServices]);

  const restartService = useCallback(async (serviceName: string) => {
    await stopService(serviceName);
    setTimeout(async () => {
      await startService(serviceName);
    }, 1000);
  }, [stopService, startService]);

  useEffect(() => {
    refreshServices();
    const interval = setInterval(refreshServices, 5000);
    return () => clearInterval(interval);
  }, [refreshServices]);

  return {
    services,
    isConnected,
    error,
    refreshServices,
    startService,
    stopService,
    restartService,
  };
}
