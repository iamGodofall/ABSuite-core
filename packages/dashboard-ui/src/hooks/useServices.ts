/**
 * What is running underneath, reported without embellishment.
 *
 * This hook used to fill in what it did not know. A service that answered its
 * health check was given `uptime: 100` — a figure nobody measured, derived from
 * "it responded once, just now". CPU and memory defaulted to 0 rather than to
 * absent, so an unreported metric was drawn as a real reading of zero. And every
 * service carried a hardcoded feature list ("Self-Healing", "AI Analyzer") that
 * described an intention, not an endpoint.
 *
 * All three are gone. `health` and `metrics` are now absent when the service did
 * not report them, and absent is rendered as absent. The one thing this hook can
 * honestly state is whether something answered, on which port, and when.
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
  /** Present only when the service reported it. Absent means not measured. */
  metrics?: {
    cpu?: number;
    memory?: number;
    requests?: number;
    errors?: number;
  };
  /** Present only when the service reported it. Absent means not measured. */
  health?: {
    cpu?: number;
    memory?: number;
    uptime?: number;
  };
  lastCheck: Date;
  /** True when this entry came from a real /service-health answer. */
  reported: boolean;
}

const SERVICE_PORTS: Record<string, number> = {
  'capkit': 8081,
  'edge-run': 8082,
  'quickbench': 8083,
  'connector-starter': 8084,
  'trust': 8085,
  'dashboard': 3001,
};

const DEFAULT_SERVICES: Service[] = [
  {
    id: 'capkit',
    name: 'capkit',
    status: 'unknown',
    port: 8081,
    features: [],
    lastCheck: new Date(),
    reported: false,
  },
  {
    id: 'edge-run',
    name: 'edge-run',
    status: 'unknown',
    port: 8082,
    features: [],
    lastCheck: new Date(),
    reported: false,
  },
  {
    id: 'quickbench',
    name: 'quickbench',
    status: 'unknown',
    port: 8083,
    features: [],
    lastCheck: new Date(),
    reported: false,
  },
  {
    id: 'connector-starter',
    name: 'connector-starter',
    status: 'unknown',
    port: 8084,
    features: [],
    lastCheck: new Date(),
    reported: false,
  },
  {
    id: 'trust',
    name: 'trust',
    status: 'unknown',
    port: 8085,
    features: [],
    lastCheck: new Date(),
    reported: false,
  },
  {
    id: 'dashboard',
    name: 'dashboard',
    status: 'unknown',
    port: 3001,
    features: [],
    lastCheck: new Date(),
    reported: false,
  },
];

export function useServices() {
  const [services, setServices] = useState<Service[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  



  const refreshServices = useCallback(async () => {
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
            const num = (value: unknown) => (typeof value === 'number' ? Math.round(value) : undefined);

            const cpu = num(liveHealth.cpu);
            const memory = num(liveHealth.memory);
            // Uptime is only uptime if the service measured it. "It answered
            // just now" is not 100%, and writing 100 there would be an invented
            // figure in the one place that exists to refuse them.
            const uptime = typeof liveHealth.uptime === 'number'
              ? Math.max(0, Math.min(100, Math.round(liveHealth.uptime)))
              : undefined;
            const requestCount = [liveStats.total, liveStats.totalTests, liveStats.pending, liveStats.running].find((value: unknown) => typeof value === 'number') as number | undefined;
            const errorCount = [liveStats.failed, liveStats.alerts].find((value: unknown) => typeof value === 'number') as number | undefined;

            const anyHealth = cpu !== undefined || memory !== undefined || uptime !== undefined;
            const anyMetric = requestCount !== undefined || errorCount !== undefined;

            return {
              id: template.id,
              name: template.name,
              status: finalStatus,
              port: template.port,
              features: Array.isArray(healthData?.features) ? healthData.features : [],
              ...(anyHealth ? { health: { cpu, memory, uptime } } : {}),
              ...(anyMetric || anyHealth
                ? { metrics: { cpu, memory, requests: requestCount, errors: errorCount } }
                : {}),
              lastCheck: new Date(healthData?.timestamp ?? Date.now()),
              reported: healthData !== null,
            };
          })
      );

      setServices(liveServices);
      setError(null);
    } catch (err: any) {
      console.error('Live services failed:', err);
      setError(`Orchestrator unavailable: ${err.message}`);
      // Not reachable is not "down". Every status becomes unknown, because the
      // orchestrator is the thing that would have told us.
      setServices(DEFAULT_SERVICES.map(service => ({
        ...service,
        status: 'unknown' as const,
        lastCheck: new Date(),
        reported: false,
      })));
    } finally {
      setLoading(false);
    }
  }, []);


  const startService = useCallback(async (serviceName: string) => {
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
  }, []);

  const stopService = useCallback(async (serviceName: string) => {
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
  }, []);

  const restartService = useCallback(async (serviceName: string) => {
    await stopService(serviceName);
    setTimeout(() => startService(serviceName), 1500);
  }, [stopService, startService]);


  useEffect(() => {
    refreshServices();
    const interval = setInterval(refreshServices, 3000);
    return () => clearInterval(interval);
  }, [refreshServices]);

  return {
    services,
    loading,
    error,
    refreshServices,
    startService,
    stopService,
    restartService,
  };
}

