/**
 * Services Hook for Managing ABSuite Services
 */

import { useState, useEffect, useCallback } from 'react';

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const adminKey = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return adminKey ? { 'x-absuite-admin-key': adminKey } : {};
};

export interface Service {
  id: string;
  name: string;
  status: 'up' | 'down' | 'unknown' | 'starting' | 'stopping' | 'failed';
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

const SERVICE_PORTS: Record<string, number> = {
  'capkit': 8081,
  'edge-run': 8082,
  'quickbench': 8083,
  'connector-starter': 8084,
  'dashboard': 3001,
};

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
  const [services, setServices] = useState<Service[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  



  const refreshServices = useCallback(async () => {
    if (demoMode) {
      setServices(DEFAULT_SERVICES);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/status');
      if (!response.ok) throw new Error(`Status ${response.status}`);
      
      const statusData = await response.json() as Record<string, string>;

      const liveServices: Service[] = await Promise.all(
        DEFAULT_SERVICES
          .filter(service => SERVICE_PORTS[service.id as keyof typeof SERVICE_PORTS])
          .map(async template => {
            const rawStatus = (statusData[template.id] || template.status).toLowerCase();
            const normalizedStatus: Service['status'] = ['up', 'down', 'unknown', 'starting', 'stopping', 'failed'].includes(rawStatus)
              ? rawStatus as Service['status']
              : 'unknown';

            let healthData: any = null;
            let finalStatus: Service['status'] = normalizedStatus;
            try {
              const healthResponse = await fetch(`/service-health/${template.id}`);
              if (healthResponse.ok) {
                healthData = await healthResponse.json();
                if (!['starting', 'stopping'].includes(normalizedStatus)) {
                  finalStatus = 'up';
                }
              } else if (!['starting', 'stopping'].includes(normalizedStatus)) {
                finalStatus = 'down';
              }
            } catch {
              healthData = null;
              if (!['starting', 'stopping'].includes(normalizedStatus)) {
                finalStatus = 'down';
              }
            }

            const liveHealth = healthData?.health ?? {};
            const liveStats = healthData?.stats ?? {};
            const cpu = typeof liveHealth.cpu === 'number' ? Math.round(liveHealth.cpu) : undefined;
            const memory = typeof liveHealth.memory === 'number' ? Math.round(liveHealth.memory) : undefined;
            const requestCount = [liveStats.total, liveStats.totalTests, liveStats.pending, liveStats.running].find((value: unknown) => typeof value === 'number') as number | undefined;
            const errorCount = [liveStats.failed, liveStats.alerts].find((value: unknown) => typeof value === 'number') as number | undefined;
            const uptime = typeof liveHealth.uptime === 'number'
              ? Math.max(0, Math.min(100, Math.round(liveHealth.uptime)))
              : finalStatus === 'up'
                ? 100
                : 0;

            return {
              id: template.id,
              name: template.name,
              status: finalStatus,
              port: template.port,
              features: Array.isArray(healthData?.features) && healthData.features.length > 0 ? healthData.features : template.features,
              health: {
                cpu: cpu ?? 0,
                memory: memory ?? 0,
                uptime,
              },
              metrics: cpu !== undefined || memory !== undefined || requestCount !== undefined || errorCount !== undefined
                ? {
                    cpu: cpu ?? 0,
                    memory: memory ?? 0,
                    requests: requestCount ?? 0,
                    errors: errorCount ?? 0,
                  }
                : undefined,
              lastCheck: new Date(healthData?.timestamp ?? Date.now()),
            };
          })
      );

      setServices(liveServices);
      setError(null);
    } catch (err: any) {
      console.error('Live services failed:', err);
      setError(`Orchestrator unavailable: ${err.message}`);
      setServices(DEFAULT_SERVICES.map(service => ({
        ...service,
        status: service.id === 'dashboard' ? 'up' : 'unknown',
        lastCheck: new Date(),
      })));
    } finally {
      setLoading(false);
    }
  }, [demoMode]);


  const startService = useCallback(async (serviceName: string) => {
    if (demoMode) return;
    try {
      setServices(prev => prev.map(s => s.id === serviceName ? { ...s, status: 'starting' as const } : s));
      const response = await fetch(`/start/${serviceName}`, { method: 'POST', headers: getAdminHeaders() });
      if (!response.ok) throw new Error(await response.text());
      // refreshServices called by WebSocket
    } catch (err: any) {
      console.error(`Start ${serviceName} failed:`, err);
      setServices(prev => prev.map(s => s.id === serviceName ? { ...s, status: 'failed' as const } : s));
      setError(`Start ${serviceName}: ${err.message}`);
    }
  }, [demoMode]);

  const stopService = useCallback(async (serviceName: string) => {
    if (demoMode) return;
    try {
      setServices(prev => prev.map(s => s.id === serviceName ? { ...s, status: 'stopping' as const } : s));
      const response = await fetch(`/stop/${serviceName}`, { method: 'POST', headers: getAdminHeaders() });
      if (!response.ok) throw new Error(await response.text());
      // refreshServices called by WebSocket
    } catch (err: any) {
      console.error(`Stop ${serviceName} failed:`, err);
      setServices(prev => prev.map(s => s.id === serviceName ? { ...s, status: 'failed' as const } : s));
      setError(`Stop ${serviceName}: ${err.message}`);
    }
  }, [demoMode]);

  const restartService = useCallback(async (serviceName: string) => {
    if (demoMode) return;
    await stopService(serviceName);
    setTimeout(() => startService(serviceName), 1500);
  }, [stopService, startService, demoMode]);


  // Toggle demo/live mode
  const toggleDemoMode = useCallback(() => {
    const newMode = !demoMode;
    setDemoMode(newMode);
    localStorage.setItem('dashboardDemoMode', newMode.toString());
    if (newMode) {
      setError(null);
    }
  }, [demoMode]);

  // Load mode from storage
  useEffect(() => {
    const saved = localStorage.getItem('dashboardDemoMode');
    if (saved === 'true') {
      setDemoMode(true);
    }
  }, []);

  useEffect(() => {
    refreshServices();
    const interval = setInterval(refreshServices, demoMode ? 10000 : 3000);
    return () => clearInterval(interval);
  }, [refreshServices, demoMode]);

  return {
    services,
    demoMode,
    toggleDemoMode,
    loading,
    error,
    refreshServices,
    startService,
    stopService,
    restartService,
  };
}

