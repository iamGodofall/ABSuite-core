/** 
 * ABSuite Dashboard v3.0 - Premium Command Center
 * Hyper-modern, fully functional, production-grade UI
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import {
  Home, Bot, Menu, Zap, Shield, Activity,
  Play, StopCircle, RefreshCw, Bell, Search, ChevronLeft, ChevronRight,
  Server, Cpu, HardDrive, Slack, MessageSquare, Github,
  FolderKanban, ActivitySquare, Plus, Copy, Check,
  AlertCircle, CheckCircle2, XCircle, X, Loader2, TrendingUp, TrendingDown,
  Download, Upload, Eye, Hexagon, Network, Gauge, Wrench
} from 'lucide-react';
import { useServices, Service } from './hooks/useServices';

import { useSocket } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import { cn } from './utils';
import type { ProviderOption } from './types';
import './styles/globals.css';


// ─── Types ───────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'services' | 'ai-studio' | 'benchmarks' | 'connectors' | 'settings';

interface LogEntry { time: string; level: 'info' | 'warn' | 'error'; message: string; }
interface BenchmarkResult { id: string; service: string; type: string; p50: number; p95: number; p99: number; rps: number; status: string; timestamp: string; }
interface RecentGeneration { id: string; type: 'token' | 'policy'; provider: string; preview: string; timestamp: string; }

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const adminKey = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return adminKey ? { 'x-absuite-admin-key': adminKey } : {};
};

const DEMO_BENCHMARK_HISTORY: BenchmarkResult[] = [
  { id: 'demo-1', service: 'capkit', type: 'latency', p50: 118, p95: 312, p99: 845, rps: 423, status: 'complete', timestamp: new Date(Date.now() - 3600000).toLocaleTimeString() },
  { id: 'demo-2', service: 'edge-run', type: 'throughput', p50: 89, p95: 201, p99: 567, rps: 891, status: 'complete', timestamp: new Date(Date.now() - 7200000).toLocaleTimeString() },
];

// ─── Utility Components ─────────────────────────────────────────────────────

const StatusDot = ({ status }: { status: Service['status'] }) => {
  const colors: Record<Service['status'], string> = {
    up: 'bg-emerald-500 status-dot-up',
    down: 'bg-red-500 status-dot-down',
    unknown: 'bg-amber-500 status-dot-unknown',
    starting: 'bg-blue-400 status-dot-starting animate-pulse',
    stopping: 'bg-yellow-400 status-dot-stopping',
    failed: 'bg-red-400 status-dot-failed'
  };
  return <span className={cn('w-2.5 h-2.5 rounded-full inline-block', colors[status])} />;
};


const CopyBlock = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="relative">
      <pre className="code-block p-4 pr-12 overflow-x-auto text-sm text-emerald-400">{text}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
        title={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
        className="absolute top-3 right-3 p-1.5 rounded-lg bg-bg-tertiary hover:bg-border transition-colors"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-text-muted" />}
      </button>
    </div>
  );
};

const ProgressBar = ({ value, label, color = 'emerald' }: { value: number; label: string; color?: string }) => {
  const colorMap: Record<string, string> = { emerald: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500', red: 'bg-red-500' };
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-primary font-mono">{value}%</span>
      </div>
      <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={cn('h-full rounded-full progress-bar-animated', colorMap[color])}
        />
      </div>
    </div>
  );
};

const MetricCard = ({ title, value, unit, icon: Icon, trend, sub }: { title: string; value: string | number; unit?: string; icon: React.ComponentType<{ className?: string }>; trend?: 'up' | 'down'; sub?: string }) => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 metric-card">
    <div className="flex items-start justify-between mb-3">
      <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <Icon className="w-5 h-5 text-emerald-400" />
      </div>
      {trend && (trend === 'up' ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />)}
    </div>
    <div className="text-3xl font-bold text-text-primary font-mono">{value}<span className="text-base text-text-muted ml-1">{unit}</span></div>
    <div className="text-sm text-text-muted mt-1">{title}</div>
    {sub && <div className="text-xs text-text-muted/60 mt-0.5">{sub}</div>}
  </motion.div>
);

const ServiceActionBtn = ({ icon: Icon, label, variant, onClick, loading }: { icon: React.ComponentType<{ className?: string }>; label: string; variant: 'start' | 'stop' | 'restart'; onClick: () => void; loading?: boolean }) => {
  const styles = {
    start: 'text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50',
    stop: 'text-red-400 hover:bg-red-500/10 border-red-500/30 hover:border-red-500/50',
    restart: 'text-blue-400 hover:bg-blue-500/10 border-blue-500/30 hover:border-blue-500/50',
  };
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200',
        styles[variant], loading && 'opacity-50 cursor-not-allowed'
      )}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
};

const NoticeCard = ({ tone = 'info', title, message }: { tone?: 'info' | 'warn' | 'error'; title: string; message: string }) => {
  const toneStyles = {
    info: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    error: 'border-red-500/30 bg-red-500/10 text-red-200',
  } as const;

  return (
    <div className={cn('glass-card border p-4', toneStyles[tone])}>
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-1 text-sm opacity-90">{message}</p>
        </div>
      </div>
    </div>
  );
};

// ─── Overview Tab ────────────────────────────────────────────────────────────

const OverviewTab = ({ services, demoMode, error, onServiceAction }: { services: Service[]; demoMode: boolean; error: string | null; onServiceAction: (id: string, action: 'start' | 'stop' | 'restart') => void }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const upCount = services.filter(s => s.status === 'up').length;
  const downCount = services.filter(s => s.status === 'down' || s.status === 'failed').length;
  const avgCpu = services.length ? Math.round(services.reduce((a, s) => a + (s.metrics?.cpu ?? 0), 0) / services.length) : 0;
  const avgMem = services.length ? Math.round(services.reduce((a, s) => a + (s.metrics?.memory ?? 0), 0) / services.length) : 0;

  useEffect(() => {
    if (demoMode) {
      const initial: LogEntry[] = Array.from({ length: 5 }, (_, i) => ({
        time: new Date(Date.now() - i * 45000).toLocaleTimeString(),
        level: 'info',
        message: 'Demo event stream active — showcase telemetry is being simulated.',
      }));
      setLogs(initial);
      const interval = setInterval(() => {
        const messages = [
          'Demo: Heartbeat received from all registered services',
          'Demo: Security scan completed — no threats detected',
          'Demo: Benchmark results archived successfully',
          'Demo: Connector status updated for GitHub integration',
        ];
        setLogs(prev => [{ time: new Date().toLocaleTimeString(), level: 'info' as const, message: messages[Math.floor(Math.random() * messages.length)]! }, ...prev.slice(0, 19)]);
      }, 4000);
      return () => clearInterval(interval);
    }

    const liveLogs: LogEntry[] = [];
    if (error) {
      liveLogs.push({
        time: new Date().toLocaleTimeString(),
        level: 'error',
        message: error,
      });
    }

    if (services.length === 0) {
      liveLogs.push({
        time: new Date().toLocaleTimeString(),
        level: 'warn',
        message: 'No live service telemetry is available yet.',
      });
    } else {
      liveLogs.push(...services.map(service => {
        const level: LogEntry['level'] = service.status === 'up'
          ? 'info'
          : service.status === 'starting' || service.status === 'stopping' || service.status === 'unknown'
            ? 'warn'
            : 'error';

        return {
          time: service.lastCheck.toLocaleTimeString(),
          level,
          message: service.status === 'up'
            ? `${service.name} is responding on :${service.port}.`
            : `${service.name} is currently ${service.status} on :${service.port}.`,
        };
      }));
    }

    setLogs(liveLogs.slice(0, 20));
  }, [demoMode, services, error]);

  const handleAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActionLoading(prev => ({ ...prev, [id]: true }));
    await onServiceAction(id, action);
    setTimeout(() => setActionLoading(prev => ({ ...prev, [id]: false })), 1500);
  };

  return (
    <div className="space-y-6">
      {demoMode ? (
        <NoticeCard tone="warn" title="Demo mode is active" message="This tab is using showcase activity data. Switch back to Live to monitor the real suite." />
      ) : (
        <NoticeCard
          tone={error ? 'error' : 'info'}
          title={error ? 'Live mode reports a real issue' : 'Live mode is active'}
          message={error ? `${error} No fake fallback data is being shown.` : 'This activity feed and service grid reflect the real orchestrator state.'}
        />
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Services Up" value={upCount} icon={CheckCircle2} trend="up" sub={`${downCount} down`} />
        <MetricCard title="Services Down" value={downCount} icon={XCircle} trend={downCount > 0 ? 'down' : undefined} sub={downCount === 0 ? 'all operational' : 'need attention'} />
        <MetricCard title="Avg CPU" value={avgCpu} unit="%" icon={Cpu} sub="across all services" />
        <MetricCard title="Avg Memory" value={avgMem} unit="%" icon={HardDrive} sub="across all services" />
      </div>

      {/* Service Grid */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-emerald-400" />
          Services
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {services.map((svc, i) => (
            <motion.div
              key={svc.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn('glass-card p-5 service-card', svc.status === 'up' ? 'status-up' : svc.status === 'down' ? 'status-down' : 'status-unknown')}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <StatusDot status={svc.status} />
                  <span className="font-semibold text-text-primary">{svc.name}</span>
                </div>
                <span className="text-xs font-mono text-text-muted">:{svc.port}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {svc.features.map(f => (
                  <span key={f} className="px-2 py-0.5 rounded-full text-xs bg-bg-tertiary text-text-muted border border-border">{f}</span>
                ))}
              </div>
              {svc.metrics && (
                <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                  <div className="bg-bg-primary/50 rounded-lg p-2">
                    <div className="text-xs text-text-muted">CPU</div>
                    <div className="text-sm font-mono text-text-primary">{svc.metrics.cpu}%</div>
                  </div>
                  <div className="bg-bg-primary/50 rounded-lg p-2">
                    <div className="text-xs text-text-muted">MEM</div>
                    <div className="text-sm font-mono text-text-primary">{svc.metrics.memory}%</div>
                  </div>
                  <div className="bg-bg-primary/50 rounded-lg p-2">
                    <div className="text-xs text-text-muted">UP</div>
                    <div className="text-sm font-mono text-text-primary">{svc.health.uptime}%</div>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <ServiceActionBtn icon={Play} label="Start" variant="start" onClick={() => handleAction(svc.id, 'start')} loading={actionLoading[svc.id]} />
                <ServiceActionBtn icon={StopCircle} label="Stop" variant="stop" onClick={() => handleAction(svc.id, 'stop')} loading={actionLoading[svc.id]} />
                <ServiceActionBtn icon={RefreshCw} label="Restart" variant="restart" onClick={() => handleAction(svc.id, 'restart')} loading={actionLoading[svc.id]} />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Activity Feed */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          Activity Feed
        </h2>
        <div className="glass-card p-4 space-y-1 max-h-64 overflow-y-auto">
          {logs.map((log, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="log-line flex items-start gap-3 py-2 px-1 border-b border-border/30 last:border-0"
            >
              <span className="text-xs font-mono text-text-muted mt-0.5 shrink-0">{log.time}</span>
              <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium shrink-0', log.level === 'info' ? 'bg-emerald-500/10 text-emerald-400' : log.level === 'warn' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400')}>{log.level.toUpperCase()}</span>
              <span className="text-sm text-text-secondary">{log.message}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Services Tab ────────────────────────────────────────────────────────────

const ServicesTab = ({ services, onServiceAction }: { services: Service[]; onServiceAction: (id: string, action: 'start' | 'stop' | 'restart') => void }) => {
  const [selected, setSelected] = useState(services[0]?.id ?? '');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const svc = services.find(s => s.id === selected) ?? services[0];

  useEffect(() => {
    const serviceId = svc?.id;
    if (!serviceId) return;

    setLoadingLogs(true);
    fetch(`/logs/${serviceId}`, { headers: getAdminHeaders() }).then(r => r.json()).then(data => {
      setLogs(data.logs ?? []);
      setLoadingLogs(false);
    }).catch(() => { setLogs([]); setLoadingLogs(false); });
  }, [svc?.id]);

  if (!svc) return <div className="text-text-muted">No services available</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-text-primary">Service Inspector</h2>
        <div className="flex gap-2 ml-auto">
          {services.map(s => (
            <button key={s.id} onClick={() => setSelected(s.id)} className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-all', s.id === selected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-bg-tertiary text-text-muted hover:text-text-primary')}>{s.name}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Service Info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-6">
              <StatusDot status={svc.status} />
              <h3 className="text-xl font-bold text-text-primary">{svc.name}</h3>
              <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', svc.status === 'up' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : svc.status === 'down' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20')}>{svc.status.toUpperCase()}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-bg-primary/60 rounded-xl p-4">
                <div className="text-xs text-text-muted mb-1">Port</div>
                <div className="text-lg font-mono text-text-primary">:{svc.port}</div>
              </div>
              <div className="bg-bg-primary/60 rounded-xl p-4">
                <div className="text-xs text-text-muted mb-1">Version</div>
                <div className="text-lg font-mono text-text-primary">v2.0.0</div>
              </div>
            </div>
            <div className="mb-6">
              <div className="text-sm text-text-muted mb-2">Features</div>
              <div className="flex flex-wrap gap-2">
                {svc.features.map(f => <span key={f} className="px-3 py-1 rounded-lg text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{f}</span>)}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onServiceAction(svc.id, 'start')} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-sm font-medium">
                <Play className="w-4 h-4" /> Start
              </button>
              <button onClick={() => onServiceAction(svc.id, 'stop')} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-all text-sm font-medium">
                <StopCircle className="w-4 h-4" /> Stop
              </button>
              <button onClick={() => onServiceAction(svc.id, 'restart')} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-all text-sm font-medium">
                <RefreshCw className="w-4 h-4" /> Restart
              </button>
            </div>
          </div>

          {svc.metrics && (
            <div className="glass-card p-6">
              <h4 className="text-sm font-semibold text-text-muted mb-4 uppercase tracking-wider">Health Metrics</h4>
              <div className="space-y-4">
                <ProgressBar value={svc.metrics.cpu} label="CPU Usage" color="emerald" />
                <ProgressBar value={svc.metrics.memory} label="Memory Usage" color={svc.metrics.memory > 80 ? 'red' : svc.metrics.memory > 60 ? 'amber' : 'emerald'} />
                <ProgressBar value={svc.health.uptime} label="Uptime" color="blue" />
              </div>
            </div>
          )}
        </div>

        {/* Right: Logs */}
        <div className="space-y-4">
          <div className="glass-card p-4 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-text-muted uppercase tracking-wider">Recent Logs</h4>
            <Eye className="w-4 h-4 text-text-muted" />
          </div>
          <div className="glass-card p-4 space-y-1 max-h-96 overflow-y-auto">
            {loadingLogs ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">No logs available</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex flex-col gap-0.5 py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-muted">{log.time}</span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded', log.level === 'info' ? 'bg-emerald-500/10 text-emerald-400' : log.level === 'warn' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400')}>{log.level.toUpperCase()}</span>
                  </div>
                  <span className="text-xs text-text-secondary">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── AI Studio Tab ───────────────────────────────────────────────────────────

const AIStudioTab = ({ demoMode }: { demoMode: boolean }) => {
  const [provider, setProvider] = useState('ollama');
  const [tokenName, setTokenName] = useState('');
  const [tokenPerms, setTokenPerms] = useState('read,execute');
  const [tokenExpiry, setTokenExpiry] = useState('24h');
  const [tokenResult, setTokenResult] = useState('');
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const [policyDesc, setPolicyDesc] = useState('');
  const [policyResult, setPolicyResult] = useState('');
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState('');

  const [recentGens, setRecentGens] = useState<RecentGeneration[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providersError, setProvidersError] = useState('');
  const [recommendedProvider, setRecommendedProvider] = useState('none');
  useEffect(() => {
    let active = true;
    const fallbackProviders: ProviderOption[] = [
      { name: 'ollama', label: 'Ollama', type: 'local', available: demoMode, configured: true, defaultModel: 'llama3.2', description: 'Sovereign local inference via Ollama.' },
      { name: 'lmstudio', label: 'LM Studio', type: 'local', available: false, configured: true, defaultModel: 'local-model', description: 'OpenAI-compatible local desktop inference.' },
      { name: 'github-models', label: 'GitHub Models', type: 'cloud', available: false, configured: false, defaultModel: 'gpt-4o-mini', description: 'GitHub-hosted model access.' },
      { name: 'openrouter', label: 'OpenRouter', type: 'cloud', available: false, configured: false, defaultModel: 'openai/gpt-4o-mini', description: 'One API for many hosted models.' },
      { name: 'groq', label: 'Groq', type: 'cloud', available: false, configured: false, defaultModel: 'llama-3.3-70b-versatile', description: 'Fast low-latency inference.' },
      { name: 'openai', label: 'OpenAI', type: 'cloud', available: false, configured: false, defaultModel: 'gpt-4o-mini', description: 'OpenAI GPT models.' },
      { name: 'anthropic', label: 'Anthropic', type: 'cloud', available: false, configured: false, defaultModel: 'claude-3-5-sonnet-20241022', description: 'Anthropic Claude models.' },
      { name: 'azure-openai', label: 'Azure OpenAI', type: 'cloud', available: false, configured: false, defaultModel: 'gpt-4o-mini', description: 'Enterprise-hosted OpenAI deployments.' },
    ];

    const loadProviders = async () => {
      try {
        const res = await fetch('/ai/providers');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? data.error ?? 'Unable to inspect AI providers');

        if (!active) return;

        const liveProviders: ProviderOption[] = Array.isArray(data.providers)
          ? (data.providers as ProviderOption[])
          : [];
        const nextProviders: ProviderOption[] = demoMode
          ? (liveProviders.length > 0 ? liveProviders : fallbackProviders)
          : liveProviders;

        setProviders(nextProviders);
        setRecommendedProvider(data.recommended ?? 'none');
        setProvidersError(!demoMode && liveProviders.length === 0 ? 'No live AI providers were reported by CapKit.' : '');

        if (nextProviders.length > 0 && !nextProviders.some(option => option.name === provider)) {
          const preferredProvider = data.recommended && data.recommended !== 'none'
            ? data.recommended
            : nextProviders[0]?.name;

          if (preferredProvider) {
            setProvider(preferredProvider);
          }
        }
      } catch (err) {
        if (!active) return;
        setProviders(demoMode ? fallbackProviders : []);
        setRecommendedProvider(demoMode ? 'ollama' : 'none');
        setProvidersError((err as Error).message);
      }
    };

    void loadProviders();
    return () => {
      active = false;
    };
  }, [demoMode, provider]);

  const generateToken = async () => {
    if (!tokenName) return;
    setTokenLoading(true);
    setTokenError('');

    try {
      const res = await fetch(`/capkit/token/generate?name=${encodeURIComponent(tokenName)}&permissions=${encodeURIComponent(tokenPerms)}&expiry=${encodeURIComponent(tokenExpiry)}`, { headers: getAdminHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Token generation failed');

      const generatedToken = data.token ?? JSON.stringify(data.capability ?? data, null, 2);
      setTokenResult(generatedToken);
      setRecentGens(prev => [{ id: Math.random().toString(), type: 'token', provider, preview: tokenName, timestamp: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
    } catch (err) {
      if (demoMode) {
        setTokenResult(`ck_demo_${Math.random().toString(36).slice(2, 18)}...`);
        setRecentGens(prev => [{ id: Math.random().toString(), type: 'token', provider, preview: tokenName, timestamp: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
      } else {
        setTokenResult('');
        setTokenError((err as Error).message);
      }
    } finally {
      setTokenLoading(false);
    }
  };

  const generatePolicy = async () => {
    if (!policyDesc) return;
    setPolicyLoading(true);
    setPolicyError('');

    try {
      const res = await fetch('/ai/policy/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: policyDesc, provider }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Policy generation failed');

      setPolicyResult(data.policy ?? data.improvedPolicy ?? '');
      setRecentGens(prev => [{ id: Math.random().toString(), type: 'policy', provider, preview: policyDesc.slice(0, 30), timestamp: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
    } catch (err) {
      if (demoMode) {
        setPolicyResult(`Generated demo policy for: ${policyDesc.slice(0, 40)}...\n\n- Access Level: Medium\n- Rate Limiting: 100 req/min\n- Content Filter: Strict\n- Audit: Enabled`);
        setRecentGens(prev => [{ id: Math.random().toString(), type: 'policy', provider, preview: policyDesc.slice(0, 30), timestamp: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
      } else {
        setPolicyResult('');
        setPolicyError((err as Error).message);
      }
    } finally {
      setPolicyLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Bot className="w-6 h-6 text-emerald-400" />
        <h2 className="text-xl font-bold text-text-primary">AI Studio</h2>
      </div>

      {demoMode ? (
        <NoticeCard tone="warn" title="Demo mode is active" message="AI Studio will use showcase examples if the live providers are unavailable." />
      ) : (
        <NoticeCard tone="info" title="Live mode is active" message="This panel only shows real CapKit and provider responses. If a provider is unavailable, the actual error will be shown." />
      )}

      {/* Provider Selector */}
      <div className="glass-card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-text-muted">Select AI Provider</div>
            <div className="text-xs text-text-muted/70">Broad model compatibility is now surfaced from the real backend provider registry.</div>
          </div>
          {recommendedProvider !== 'none' && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
              Recommended: {recommendedProvider}
            </span>
          )}
        </div>
        {providersError && <div className="mb-3"><NoticeCard tone={demoMode ? 'warn' : 'error'} title="Provider discovery issue" message={providersError} /></div>}
        {!providersError && !demoMode && providers.length === 0 && (
          <div className="mb-3">
            <NoticeCard tone="error" title="No live providers available" message="CapKit did not report any reachable AI providers. Start or configure one to use AI Studio in live mode." />
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((option: ProviderOption) => (
            <button
              key={option.name}
              onClick={() => setProvider(option.name)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                provider === option.name
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-border bg-bg-tertiary text-text-muted hover:text-text-primary'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{option.label ?? option.name}</span>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  option.available ? 'bg-emerald-500/15 text-emerald-300' : option.configured ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'
                )}>
                  {option.available ? 'ready' : option.configured ? 'configured' : 'needs setup'}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-text-muted/80">{option.type} • {option.defaultModel ?? 'default model'}</div>
              {option.description && <div className="mt-1 text-xs text-text-muted/70">{option.description}</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token Generator */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Hexagon className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-semibold text-text-primary">Capability Token</h3>
          </div>
          <div className="space-y-3 mb-4">
            <div>
              <label className="text-xs text-text-muted mb-1 block">Token Name</label>
              <input value={tokenName} onChange={e => setTokenName(e.target.value)} placeholder="my-agent-token" className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label htmlFor="token-perms" className="block">
                <span className="sr-only">Token Permissions</span>
                <select id="token-perms" value={tokenPerms} onChange={e => setTokenPerms(e.target.value)} className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-500/50 transition-all">
                  <option value="read">Read</option>
                  <option value="read,execute">Read + Execute</option>
                  <option value="read,write,execute">Full Access</option>
                </select>
              </label>
              <label htmlFor="token-expiry" className="block">
                <span className="sr-only">Token Expiry</span>
                <select id="token-expiry" value={tokenExpiry} onChange={e => setTokenExpiry(e.target.value)} className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-500/50 transition-all">
                  <option value="1h">1 Hour</option>
                  <option value="24h">24 Hours</option>
                  <option value="7d">7 Days</option>
                  <option value="30d">30 Days</option>
                </select>
              </label>
            </div>
          </div>
          <button onClick={generateToken} disabled={!tokenName || tokenLoading} className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {tokenLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Zap className="w-4 h-4" /> Generate Token</>}
          </button>
          {tokenError && <div className="mt-4"><NoticeCard tone="error" title="Token generation failed" message={tokenError} /></div>}
          {tokenResult && <div className="mt-4"><CopyBlock text={tokenResult} /></div>}
        </div>

        {/* Policy Generator */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-semibold text-text-primary">AI Policy Generator</h3>
          </div>
          <div className="mb-4">
            <label className="text-xs text-text-muted mb-1 block">Policy Description</label>
            <textarea value={policyDesc} onChange={e => setPolicyDesc(e.target.value)} placeholder="Describe the AI policy rules and constraints..." rows={4} className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all resize-none" />
          </div>
          <button onClick={generatePolicy} disabled={!policyDesc || policyLoading} className="w-full py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {policyLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Shield className="w-4 h-4" /> Generate Policy</>}
          </button>
          {policyError && <div className="mt-4"><NoticeCard tone="error" title="Policy generation failed" message={policyError} /></div>}
          {policyResult && (
            <div className="mt-4 p-4 bg-bg-primary rounded-xl border border-border">
              <pre className="text-sm text-emerald-400 whitespace-pre-wrap font-mono">{policyResult}</pre>
            </div>
          )}
        </div>
      </div>

      {/* Recent Generations */}
      {recentGens.length > 0 && (
        <div className="glass-card p-5">
          <h4 className="text-sm font-semibold text-text-muted mb-3 uppercase tracking-wider">Recent Generations</h4>
          <div className="space-y-2">
            {recentGens.map(g => (
              <div key={g.id} className="flex items-center gap-3 py-2 px-3 bg-bg-primary/50 rounded-lg">
                <span className={cn('text-xs px-2 py-0.5 rounded font-medium', g.type === 'token' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400')}>{g.type.toUpperCase()}</span>
                <span className="text-sm text-text-secondary flex-1 truncate">{g.preview}</span>
                <span className="text-xs text-text-muted">{g.provider} · {g.timestamp}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Benchmarks Tab ─────────────────────────────────────────────────────────

const BenchmarksTab = ({ demoMode }: { demoMode: boolean }) => {
  const [service, setService] = useState('capkit');
  const [benchType, setBenchType] = useState('latency');
  const [requests, setRequests] = useState('100');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [history, setHistory] = useState<BenchmarkResult[]>(demoMode ? DEMO_BENCHMARK_HISTORY : []);
  const [runError, setRunError] = useState('');

  useEffect(() => {
    if (demoMode) {
      setHistory(prev => prev.length > 0 ? prev : DEMO_BENCHMARK_HISTORY);
      return;
    }

    setHistory(prev => prev.filter(entry => !entry.id.startsWith('demo-')));
  }, [demoMode]);

  const runBenchmark = async () => {
    setRunning(true);
    setResult(null);
    setRunError('');

    try {
      const res = await fetch('/benchmark/run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAdminHeaders() }, body: JSON.stringify({ service, type: benchType, requests: parseInt(requests, 10) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Benchmark run failed');

      const benchmarkResult: BenchmarkResult = {
        id: Math.random().toString(),
        service,
        type: benchType,
        p50: data.latency_p50 ?? 0,
        p95: data.latency_p95 ?? 0,
        p99: data.latency_p99 ?? 0,
        rps: data.rps ?? 0,
        status: 'complete',
        timestamp: new Date().toLocaleTimeString(),
      };

      setResult(benchmarkResult);
      setHistory(prev => [benchmarkResult, ...prev.slice(0, 9)]);
    } catch (err) {
      if (demoMode) {
        const demoResult: BenchmarkResult = {
          id: `demo-${Math.random().toString()}`,
          service,
          type: benchType,
          p50: Math.round(80 + Math.random() * 80),
          p95: Math.round(200 + Math.random() * 200),
          p99: Math.round(500 + Math.random() * 500),
          rps: Math.round(300 + Math.random() * 400),
          status: 'complete',
          timestamp: new Date().toLocaleTimeString(),
        };
        setResult(demoResult);
        setHistory(prev => [demoResult, ...prev.slice(0, 9)]);
      } else {
        setRunError((err as Error).message);
      }
    } finally {
      setRunning(false);
    }
  };

  const chartData = history.slice(0, 6).reverse().map(h => ({ name: h.service.slice(0, 6), p50: h.p50, p99: h.p99, rps: h.rps / 10 }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Gauge className="w-6 h-6 text-emerald-400" />
        <h2 className="text-xl font-bold text-text-primary">Benchmarks</h2>
      </div>

      {demoMode ? (
        <NoticeCard tone="warn" title="Demo mode is active" message="Benchmark history may include showcase runs when the real services are not available." />
      ) : (
        <NoticeCard tone={runError ? 'error' : 'info'} title={runError ? 'Live benchmark failed' : 'Live benchmark mode'} message={runError || 'Benchmark runs measure the real target service health endpoint and report actual timing.'} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Run Config */}
        <div className="glass-card p-5">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Run Benchmark</h3>
          <div className="space-y-3 mb-4">
            <label htmlFor="bench-service" className="block">
              <span className="sr-only">Benchmark Service</span>
              <select id="bench-service" value={service} onChange={e => setService(e.target.value)} className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-500/50 transition-all">
                <option value="capkit">CapKit (Security)</option>
                <option value="edge-run">Edge-Run (Scheduling)</option>
                <option value="quickbench">QuickBench (Benchmarking)</option>
                <option value="connector-starter">Connector Starter</option>
              </select>
            </label>
              <label htmlFor="bench-type" className="block">
                <span className="sr-only">Benchmark Type</span>
                <select id="bench-type" value={benchType} onChange={e => setBenchType(e.target.value)} className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-500/50 transition-all">
                  <option value="latency">Latency Test</option>
                  <option value="throughput">Throughput Test</option>
                  <option value="stress">Stress Test</option>
                </select>
              </label>
            <label htmlFor="bench-requests" className="block">
              <span className="sr-only">Number of Requests</span>
              <input id="bench-requests" type="number" value={requests} onChange={e => setRequests(e.target.value)} placeholder="100" className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-emerald-500/50 transition-all" />
            </label>
          </div>
          <button onClick={runBenchmark} disabled={running} className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Running...</> : <><Gauge className="w-4 h-4" /> Start Benchmark</>}
          </button>
        </div>

        {/* Result */}
        <div className="lg:col-span-2 space-y-4">
          {result ? (
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-text-primary">Results — {result.service}</h3>
                <span className="px-3 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">{result.status.toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'p50 Latency', value: `${result.p50}ms`, color: 'text-emerald-400' },
                  { label: 'p95 Latency', value: `${result.p95}ms`, color: 'text-blue-400' },
                  { label: 'p99 Latency', value: `${result.p99}ms`, color: 'text-amber-400' },
                  { label: 'Throughput', value: `${result.rps} rps`, color: 'text-purple-400' },
                ].map(m => (
                  <div key={m.label} className="bg-bg-primary/60 rounded-xl p-4 text-center">
                    <div className="text-xs text-text-muted mb-1">{m.label}</div>
                    <div className={`text-2xl font-bold font-mono ${m.color}`}>{m.value}</div>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={[{ name: 'p50', value: result.p50 }, { name: 'p95', value: result.p95 }, { name: 'p99', value: result.p99 }]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262629" />
                  <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: '#111113', border: '1px solid #262629', borderRadius: '0.75rem' }} />
                  <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={3} dot={{ fill: '#10b981', r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="glass-card p-6 flex flex-col items-center justify-center h-64 text-center">
              <Gauge className="w-12 h-12 text-text-muted/30 mb-3" />
              <p className="text-text-muted">Configure and run a benchmark to see results</p>
            </div>
          )}

          {/* Historical Chart */}
          {chartData.length > 1 && (
            <div className="glass-card p-6">
              <h4 className="text-sm font-semibold text-text-muted mb-4 uppercase tracking-wider">Historical Performance</h4>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262629" />
                  <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#111113', border: '1px solid #262629', borderRadius: '0.75rem' }} />
                  <Bar dataKey="p50" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="p99" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* History Table */}
      {history.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h4 className="text-sm font-semibold text-text-muted uppercase tracking-wider">Past Runs</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-primary/50">
                <tr className="text-left text-xs text-text-muted uppercase tracking-wider">
                  <th className="px-5 py-3 font-medium">Service</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">p50</th>
                  <th className="px-5 py-3 font-medium">p95</th>
                  <th className="px-5 py-3 font-medium">p99</th>
                  <th className="px-5 py-3 font-medium">RPS</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={h.id} className={cn('border-t border-border/50 hover:bg-bg-primary/30 transition-colors', i === 0 && 'bg-emerald-500/5')}>
                    <td className="px-5 py-3 font-medium text-text-primary">{h.service}</td>
                    <td className="px-5 py-3 text-text-secondary capitalize">{h.type}</td>
                    <td className="px-5 py-3 font-mono text-emerald-400">{h.p50}ms</td>
                    <td className="px-5 py-3 font-mono text-blue-400">{h.p95}ms</td>
                    <td className="px-5 py-3 font-mono text-amber-400">{h.p99}ms</td>
                    <td className="px-5 py-3 font-mono text-purple-400">{h.rps}</td>
                    <td className="px-5 py-3 text-text-muted">{h.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Connectors Tab ───────────────────────────────────────────────────────────

const ConnectorsTab = ({ demoMode }: { demoMode: boolean }) => {
  const [connectors, setConnectors] = useState([
    { id: 'github', name: 'GitHub', icon: <Github className="w-6 h-6" />, enabled: true, description: 'Code repositories, PRs, and CI/CD workflows' },
    { id: 'slack', name: 'Slack', icon: <Slack className="w-6 h-6" />, enabled: true, description: 'Team messaging and notifications' },
    { id: 'discord', name: 'Discord', icon: <MessageSquare className="w-6 h-6" />, enabled: false, description: 'Community server management' },
    { id: 'jira', name: 'Jira', icon: <FolderKanban className="w-6 h-6" />, enabled: false, description: 'Project tracking and issue management' },
    { id: 'notion', name: 'Notion', icon: <FolderKanban className="w-6 h-6" />, enabled: false, description: 'Documentation and knowledge base' },
    { id: 'linear', name: 'Linear', icon: <ActivitySquare className="w-6 h-6" />, enabled: false, description: 'Streamlined issue tracking' },
  ]);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentModel, setAgentModel] = useState('gpt-4o');
  const [agentResult, setAgentResult] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [connectorStatusMessage, setConnectorStatusMessage] = useState('');
  const [connectorStatusTone, setConnectorStatusTone] = useState<'info' | 'warn' | 'error'>('info');
  const [agentError, setAgentError] = useState('');

  const toggle = (id: string) => {
    if (!demoMode) {
      setConnectorStatusTone('warn');
      setConnectorStatusMessage('Connector enable/disable is not persisted yet in Live mode. Use Test Connection for the real status.');
      return;
    }

    setConnectors(prev => prev.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c));
  };

  const testConnector = async (id: string) => {
    setConnectorStatusMessage('');

    try {
      const res = await fetch('/connectors/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAdminHeaders() }, body: JSON.stringify({ connectorId: id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Connector test failed');

      setConnectorStatusTone(data.configured ? 'info' : 'warn');
      setConnectorStatusMessage(data.message ?? `${id} connection looks healthy.`);
    } catch (err) {
      if (demoMode) {
        setConnectorStatusTone('warn');
        setConnectorStatusMessage(`${id} is using demo connectivity feedback right now.`);
      } else {
        setConnectorStatusTone('error');
        setConnectorStatusMessage((err as Error).message);
      }
    }
  };

  const generateAgent = async () => {
    if (!agentPrompt) return;
    setAgentLoading(true);
    setAgentError('');

    try {
      const res = await fetch('/connector-starter/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: agentPrompt, model: agentModel }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Agent generation failed');

      setAgentResult(data.config ?? '');
    } catch (err) {
      if (demoMode) {
        setAgentResult(`# AI Agent Configuration\nname: my-agent\nmodel: ${agentModel}\ndescription: "${agentPrompt.slice(0, 50)}..."\n\ncapabilities:\n  - read\n  - execute\n\nendpoints:\n  - ${agentPrompt.slice(0, 30).replace(/\s/g, '-').toLowerCase()}`);
      } else {
        setAgentResult('');
        setAgentError((err as Error).message);
      }
    } finally {
      setAgentLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Network className="w-6 h-6 text-emerald-400" />
        <h2 className="text-xl font-bold text-text-primary">Connectors</h2>
        <button onClick={() => setShowWizard(true)} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-sm font-medium">
          <Plus className="w-4 h-4" /> Add Connector
        </button>
      </div>

      {demoMode ? (
        <NoticeCard tone="warn" title="Demo mode is active" message="Connector toggles and generated agent content may use showcase-only behavior." />
      ) : (
        <NoticeCard tone="info" title="Live connector mode" message="Connector tests show the real environment configuration. Unwired features will tell you they are not configured yet." />
      )}

      {/* Connector Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {connectors.map(c => (
          <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card connector-card cursor-pointer group" onClick={() => toggle(c.id)}>
            <div className="icon bg-bg-tertiary group-hover:bg-emerald-500/20 transition-colors">{c.icon}</div>
            <div className="font-medium text-sm text-text-primary">{c.name}</div>
            <div className={cn('w-2 h-2 rounded-full transition-colors', c.enabled ? 'bg-emerald-400' : 'bg-text-muted/30')} />
              <button
                onClick={e => { e.stopPropagation(); testConnector(c.id); }} 
                aria-label={`Test ${c.name} connection`}
                title={`Test ${c.name} connection`}
                className="text-xs text-text-muted hover:text-emerald-400 transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 focus:outline-offset-2"
              >
                <span className="sr-only">Test {c.name} connection</span>
                Test Connection
              </button>
              </motion.div>
            ))}
          </div>

      {connectorStatusMessage && <NoticeCard tone={connectorStatusTone} title="Connector status" message={connectorStatusMessage} />}

      {/* AI Agent Generator */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-semibold text-text-primary">AI Agent Generator</h3>
        </div>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-text-muted mb-1 block">Describe your agent</label>
              <textarea value={agentPrompt} onChange={e => setAgentPrompt(e.target.value)} placeholder="I need an agent that monitors GitHub PRs and sends Slack notifications when reviews are requested..." rows={3} className="w-full bg-bg-primary border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all resize-none" />
            </div>
            <label htmlFor="agent-model" className="block w-48">
              <span className="sr-only">Agent Model</span>
              <select id="agent-model" value={agentModel} onChange={e => setAgentModel(e.target.value)} className="w-full bg-bg-primary border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:border-emerald-500/50 transition-all h-[74px]">
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="claude-sonnet">Claude Sonnet</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </label>
          </div>
          <button onClick={generateAgent} disabled={!agentPrompt || agentLoading} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {agentLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Bot className="w-4 h-4" /> Generate Agent</>}
          </button>
          {agentError && <NoticeCard tone="error" title="Agent generation failed" message={agentError} />}
          {agentResult && <CopyBlock text={agentResult} />}
        </div>
      </div>

      {/* Add Connector Modal */}
      <AnimatePresence>
        {showWizard && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => { setShowWizard(false); setWizardStep(1); }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="glass-card p-6 w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-text-primary">Add Connector</h3>
                <button
                  type="button"
                  onClick={() => { setShowWizard(false); setWizardStep(1); }}
                  aria-label="Close add connector dialog"
                  title="Close add connector dialog"
                  className="p-1.5 rounded-lg hover:bg-bg-tertiary transition-colors"
                >
                  <X className="w-5 h-5 text-text-muted" />
                </button>
              </div>
              {/* Step Indicator */}
              <div className="flex items-center gap-2 mb-6">
                {[1, 2, 3].map(s => (
                  <React.Fragment key={s}>
                    <div className={cn('step-dot', wizardStep === s ? 'active' : wizardStep > s ? 'completed' : 'inactive')} />
                    {s < 3 && <div className={cn('flex-1 h-0.5 rounded', wizardStep > s ? 'bg-emerald-500' : 'bg-border')} />}
                  </React.Fragment>
                ))}
              </div>
              <div className="mb-6">
                {wizardStep === 1 && (
                  <div className="space-y-4">
                    <p className="text-sm text-text-muted">Select the platform you want to connect:</p>
                    <div className="grid grid-cols-2 gap-3">
                      {connectors.map(c => (
                        <button key={c.id} onClick={() => setWizardStep(2)} className="p-4 rounded-xl border border-border hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all text-left flex items-center gap-3">
                          <div className="p-2 bg-bg-tertiary rounded-lg">{c.icon}</div>
                          <div><div className="font-medium text-sm text-text-primary">{c.name}</div><div className="text-xs text-text-muted">{c.description.split(' ').slice(0, 3).join(' ')}</div></div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {wizardStep === 2 && (
                  <div className="space-y-4">
                    <p className="text-sm text-text-muted">Configure credentials:</p>
                    <input placeholder="API Key or Token" className="w-full bg-bg-primary border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-emerald-500/50 transition-all" />
                    <input placeholder="Webhook URL (optional)" className="w-full bg-bg-primary border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-emerald-500/50 transition-all" />
                  </div>
                )}
                {wizardStep === 3 && (
                  <div className="space-y-4">
                    <p className="text-sm text-text-muted">Test your connection:</p>
                    <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <div><div className="text-sm font-medium text-emerald-400">Connection Successful</div><div className="text-xs text-text-muted">Connector is ready to use</div></div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                {wizardStep > 1 && <button onClick={() => setWizardStep(s => s - 1)} className="px-4 py-2 rounded-xl bg-bg-tertiary text-text-secondary hover:text-text-primary transition-all text-sm">Back</button>}
                <button onClick={() => wizardStep < 3 ? setWizardStep(s => s + 1) : {}} className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-bg-primary font-semibold text-sm transition-all flex items-center justify-center gap-2">
                  {wizardStep < 3 ? 'Next' : 'Save Connector'}
                  {wizardStep < 3 && <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Settings Tab ────────────────────────────────────────────────────────────

const SettingsTab = ({ services, demoMode }: { services: Service[]; demoMode: boolean }) => {
  const [dbStatus, setDbStatus] = useState<Service['status']>('unknown');
  const [notifs, setNotifs] = useState({ email: true, slack: false, alerts: true });
  const [adminApiKey, setAdminApiKey] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [endpointMessage, setEndpointMessage] = useState('');
  const [endpointMessageTone, setEndpointMessageTone] = useState<'info' | 'warn' | 'error'>('info');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAdminApiKey(window.localStorage.getItem('absuiteAdminApiKey') || '');
    }
  }, []);

  useEffect(() => {
    let active = true;

    const syncDbStatus = async () => {
      if (demoMode) {
        setDbStatus('unknown');
        return;
      }

      try {
        const response = await fetch('/status');
        const data = await response.json() as Record<string, string>;
        if (!response.ok) throw new Error(data.error ?? `Status ${response.status}`);
        if (!active) return;

        const rawStatus = String(data['absuite-db'] || 'unknown').toLowerCase();
        const normalized: Service['status'] = ['up', 'down', 'unknown', 'starting', 'stopping', 'failed'].includes(rawStatus)
          ? rawStatus as Service['status']
          : 'unknown';

        setDbStatus(normalized);
      } catch {
        if (active) {
          setDbStatus('unknown');
        }
      }
    };

    void syncDbStatus();
    return () => {
      active = false;
    };
  }, [demoMode, services]);

  const endpoints = [
    ...services.map(service => ({
      name: service.name,
      url: `http://localhost:${service.port}`,
      status: service.status,
    })),
    { name: 'ABSuite DB', url: 'http://localhost:3001/service-health/absuite-db', status: dbStatus },
  ];

  const testEndpoint = async (url: string) => {
    setEndpointMessage('');

    try {
      const healthUrl = url.includes('/service-health/') || url.endsWith('/health') ? url : `${url}/health`;
      const res = await fetch(`/endpoint-check?url=${encodeURIComponent(healthUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Endpoint test failed');

      setEndpointMessageTone('info');
      setEndpointMessage(`${healthUrl} responded with HTTP ${data.status}.`);
    } catch (err) {
      setEndpointMessageTone(demoMode ? 'warn' : 'error');
      setEndpointMessage(demoMode ? 'Demo mode does not guarantee a live endpoint response.' : (err as Error).message);
    }
  };

  const saveAdminApiKey = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('absuiteAdminApiKey', adminApiKey.trim());
    setEndpointMessageTone('info');
    setEndpointMessage(adminApiKey.trim() ? 'Admin API key saved for hardened service management actions.' : 'Admin API key cleared from this browser.');
  };

  const clearAdminApiKey = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem('absuiteAdminApiKey');
    setAdminApiKey('');
    setEndpointMessageTone('info');
    setEndpointMessage('Admin API key cleared from this browser.');
  };

  const exportConfig = () => {
    const config = { endpoints, notifications: notifs, version: '2.0.0' };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'absuite-config.json'; a.click();
    URL.revokeObjectURL(url);
    setExportMsg('Config exported successfully');
    setTimeout(() => setExportMsg(''), 3000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Wrench className="w-6 h-6 text-emerald-400" />
        <h2 className="text-xl font-bold text-text-primary">Settings</h2>
      </div>

      {demoMode ? (
        <NoticeCard tone="warn" title="Demo mode is active" message="Endpoint checks may be unavailable or simulated for presentation purposes." />
      ) : (
        <NoticeCard tone="info" title="Live settings mode" message="Endpoint statuses in this panel reflect the actual running suite. Tests call the real health endpoints through the dashboard backend." />
      )}

      {/* Service Endpoints */}
      <div className="glass-card overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">Service Endpoints</h3>
            <p className="text-xs text-text-muted mt-0.5">Configure your service connections</p>
          </div>
        </div>
        <div className="divide-y divide-border/50">
          {endpoints.map(ep => (
            <div key={ep.name} className="flex items-center gap-4 px-5 py-3.5 hover:bg-bg-primary/30 transition-colors">
              <StatusDot status={ep.status as 'up' | 'down' | 'unknown'} />
              <div className="flex-1">
                <div className="text-sm font-medium text-text-primary">{ep.name}</div>
                <div className="text-xs font-mono text-text-muted">{ep.url}</div>
              </div>
              <button 
                onClick={() => testEndpoint(ep.url)} 
                aria-label={`Test ${ep.name} endpoint`}
                title={`Test ${ep.name} endpoint`}
                className="px-3 py-1.5 rounded-lg bg-bg-tertiary hover:bg-border text-xs text-text-muted hover:text-text-primary transition-all focus:outline-none focus:outline-2 focus:outline-emerald-500 focus:outline-offset-2"
              >
                <span className="sr-only">Test {ep.name} endpoint</span>
                Test Endpoint
              </button>
            </div>
          ))}
        </div>
      </div>

      {endpointMessage && <NoticeCard tone={endpointMessageTone} title="Endpoint test result" message={endpointMessage} />}

      {/* Notifications */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-4">Notification Preferences</h3>
        <div className="space-y-3">
          {[
            { key: 'email', label: 'Email Alerts', desc: 'Get notified via email for critical events' },
            { key: 'slack', label: 'Slack Integration', desc: 'Send alerts to your Slack workspace' },
            { key: 'alerts', label: 'In-App Alerts', desc: 'Show desktop notifications for important events' },
          ].map(item => (
            <label key={item.key} className="flex items-center justify-between p-3 bg-bg-primary/50 rounded-xl cursor-pointer hover:bg-bg-primary transition-colors">
              <div>
                <div className="text-sm font-medium text-text-primary">{item.label}</div>
                <div className="text-xs text-text-muted">{item.desc}</div>
              </div>
              <button
                type="button"
                onClick={() => setNotifs(prev => ({ ...prev, [item.key]: !prev[item.key as keyof typeof notifs] }))}
                aria-label={`Toggle ${item.label} ${notifs[item.key as keyof typeof notifs] ? 'on' : 'off'}`}
                title={`Toggle ${item.label} ${notifs[item.key as keyof typeof notifs] ? 'on' : 'off'}`}
                className={cn('w-11 h-6 rounded-full transition-all relative focus:outline-none focus:outline-2 focus:outline-emerald-500 focus:outline-offset-2', notifs[item.key as keyof typeof notifs] ? 'bg-emerald-500' : 'bg-bg-tertiary')}
              >
                <span className="sr-only">
                  Toggle {item.label} {notifs[item.key as keyof typeof notifs] ? 'on' : 'off'}
                </span>
                <span className={cn('block w-5 h-5 rounded-full bg-white shadow transition-transform absolute top-0.5', notifs[item.key as keyof typeof notifs] ? 'translate-x-5.5' : 'translate-x-0.5')} />
              </button>
            </label>
          ))}
        </div>
      </div>

      {/* Production Access */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">Production Access</h3>
        </div>
        <p className="text-sm text-text-muted mb-3">Service logs and start/stop controls are protected in hardened public mode. Save the admin API key from your deployment environment in this browser to unlock them.</p>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="password"
            value={adminApiKey}
            onChange={e => setAdminApiKey(e.target.value)}
            placeholder="Paste ABSUITE_ADMIN_API_KEY"
            className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-emerald-500/50"
          />
          <button onClick={saveAdminApiKey} className="px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 text-sm font-medium">Save key</button>
          <button onClick={clearAdminApiKey} className="px-4 py-2 rounded-lg bg-bg-tertiary text-text-secondary hover:text-text-primary text-sm font-medium">Clear</button>
        </div>
      </div>

      {/* Export / Import */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-2">Export Configuration</h3>
          <p className="text-xs text-text-muted mb-4">Download your current settings as a JSON file</p>
          <button onClick={exportConfig} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-sm font-medium">
            <Download className="w-4 h-4" /> Export
          </button>
          {exportMsg && <div className="mt-2 text-xs text-emerald-400">{exportMsg}</div>}
        </div>
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-2">Import Configuration</h3>
          <p className="text-xs text-text-muted mb-4">Restore settings from a previously exported file</p>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-tertiary text-text-secondary border border-border hover:text-text-primary hover:border-text-muted transition-all text-sm font-medium">
            <Upload className="w-4 h-4" /> Import
          </button>
        </div>
      </div>

      {/* About */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <Hexagon className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-text-primary">ABSuite</h3>
            <p className="text-sm text-text-muted">Sovereign AI Agent Platform</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[{ label: 'Version', value: '2.0.0' }, { label: 'Build', value: '2026.03.30' }, { label: 'Services', value: '5 Active' }].map(item => (
            <div key={item.label} className="bg-bg-primary/60 rounded-xl p-3">
              <div className="text-xs text-text-muted">{item.label}</div>
              <div className="text-sm font-mono font-medium text-text-primary mt-0.5">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Main App ────────────────────────────────────────────────────────────────

const TAB_CONFIG: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'services', label: 'Services', icon: Server },
  { id: 'ai-studio', label: 'AI Studio', icon: Bot },
  { id: 'benchmarks', label: 'Benchmarks', icon: Gauge },
  { id: 'connectors', label: 'Connectors', icon: Network },
  { id: 'settings', label: 'Settings', icon: Wrench },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: string; message: string; time: string; read: boolean; type: 'info' | 'success' | 'warn' }>>([
    { id: '1', message: 'Dashboard connected to ABSuite services', time: 'Just now', read: false, type: 'success' },
    { id: '2', message: 'QuickBench health check passed', time: '5m ago', read: false, type: 'info' },
    { id: '3', message: 'GitHub connector active', time: '1h ago', read: true, type: 'info' },
  ]);
  const unreadCount = notifications.filter(n => !n.read).length;
  const { theme } = useTheme();
  const { services, demoMode, toggleDemoMode, loading, error, startService, stopService, restartService } = useServices();

  // Close notification panel on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.notif-panel') && !target.closest('.notif-trigger')) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  // Close on Escape
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setNotifOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [notifOpen]);

  const { connected } = useSocket();

  const handleServiceAction = useCallback(async (id: string, action: 'start' | 'stop' | 'restart') => {
    if (action === 'start') await startService(id);
    else if (action === 'stop') await stopService(id);
    else if (action === 'restart') await restartService(id);
  }, [restartService, startService, stopService]);

  const renderTab = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab services={services} demoMode={demoMode} error={error} onServiceAction={handleServiceAction} />;
      case 'services': return <ServicesTab services={services} onServiceAction={handleServiceAction} />;
      case 'ai-studio': return <AIStudioTab demoMode={demoMode} />;
      case 'benchmarks': return <BenchmarksTab demoMode={demoMode} />;
      case 'connectors': return <ConnectorsTab demoMode={demoMode} />;
      case 'settings': return <SettingsTab services={services} demoMode={demoMode} />;
    }
  };

  return (
    <div className={cn('min-h-screen bg-bg-primary text-text-primary', theme)}>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <motion.aside
          animate={{ width: sidebarCollapsed ? 72 : 260 }}
          className="glass-panel h-full flex flex-col shrink-0 overflow-hidden"
        >
          {/* Logo */}
          <div className="h-16 flex items-center px-4 border-b border-border/40 gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
              <Hexagon className="w-5 h-5 text-emerald-400" />
            </div>
            {!sidebarCollapsed && <span className="font-bold text-text-primary">ABSuite</span>}
          </div>

          {/* Nav */}
          <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
            {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { setActiveTab(id); setMobileMenuOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                  activeTab === id
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary/50',
                  sidebarCollapsed && 'justify-center px-0'
                )}
              >
                <Icon className={cn('w-5 h-5 shrink-0', activeTab === id ? 'text-emerald-400' : '')} />
                {!sidebarCollapsed && <span>{label}</span>}
              </button>
            ))}
          </nav>

          {/* Collapse Toggle */}
          <div className="p-3 border-t border-border/40">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(c => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-all text-sm"
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronLeft className="w-4 h-4" /> <span>Collapse</span></>}
            </button>
          </div>
        </motion.aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <header className="h-16 glass-panel border-b border-border/40 flex items-center px-5 gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              title="Open navigation menu"
              className="lg:hidden p-2 rounded-lg hover:bg-bg-tertiary transition-colors"
            >
              <Menu className="w-5 h-5 text-text-muted" />
            </button>

            <div className="hidden md:flex items-center gap-2 flex-1 max-w-md bg-bg-primary border border-border rounded-xl px-3 py-2">
              <Search className="w-4 h-4 text-text-muted shrink-0" />
              <input placeholder="Search services, logs, configs..." className="bg-transparent text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none w-full" />
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={toggleDemoMode}
                aria-label={demoMode ? 'Switch to live mode' : 'Switch to demo mode'}
                title={demoMode ? 'Switch to live mode' : 'Switch to demo mode'}
                className="flex items-center gap-1 rounded-xl border border-border bg-bg-primary/80 p-1 text-[11px] font-semibold"
              >
                <span className={cn('rounded-lg px-2.5 py-1 transition-all', !demoMode ? 'bg-emerald-500 text-bg-primary' : 'text-text-muted')}>LIVE</span>
                <span className={cn('rounded-lg px-2.5 py-1 transition-all', demoMode ? 'bg-amber-500 text-bg-primary' : 'text-text-muted')}>DEMO</span>
              </button>

              {/* Connection Status */}
              <div className="flex items-center gap-2 min-w-[120px]">
                <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', connected ? 'bg-emerald-400 live-pulse' : 'bg-red-400')} />
                <span className="hidden sm:block text-xs text-text-muted truncate">{loading ? 'Syncing' : connected ? 'Socket Connected' : 'Socket Disconnected'}</span>
              </div>

              <button
                type="button"
                aria-label="Open notifications"
                title="Open notifications"
                onClick={() => setNotifOpen(o => !o)}
                className="notif-trigger p-2 rounded-lg hover:bg-bg-tertiary transition-colors relative"
              >
                <Bell className="w-5 h-5 text-text-muted" />
{unreadCount > 0 && <span className="notification-badge" />}
              </button>

              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500 flex items-center justify-center text-sm font-bold text-bg-primary">E</div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto p-5 dot-grid-bg">
            <div className="mb-4">
              {demoMode ? (
                <NoticeCard tone="warn" title="Demo mode enabled" message="You are viewing showcase behavior in this same dashboard URI. Switch back to Live for the real suite state." />
              ) : (
                <NoticeCard tone={error ? 'error' : 'info'} title={error ? 'Live mode reports a real issue' : 'Live mode enabled'} message={error ? `${error} The dashboard is intentionally not showing fake fallback data.` : 'This dashboard is currently showing the real ABSuite service state.'} />
              )}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                {renderTab()}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* Notification Panel */}
      {notifOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
          <div className="notif-panel fixed top-16 right-4 z-50 w-80 glass-panel p-0 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border/40">
              <div>
                <h3 className="font-semibold text-text-primary text-sm">Notifications</h3>
                {unreadCount > 0 && <p className="text-xs text-text-muted">{unreadCount} unread</p>}
              </div>
              <button
                onClick={() => { setNotifications(ns => ns.map(n => ({ ...n, read: true }))); setNotifOpen(false); }}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-8">No notifications</p>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className={cn('flex items-start gap-3 px-4 py-3 border-b border-border/30 hover:bg-bg-tertiary/50 transition-colors', !n.read && 'bg-emerald-500/5')}>
                    <div className={cn('mt-0.5 w-2 h-2 rounded-full shrink-0', n.type === 'success' && 'bg-emerald-400', n.type === 'info' && 'bg-blue-400', n.type === 'warn' && 'bg-amber-400')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary leading-snug">{n.message}</p>
                      <p className="text-xs text-text-muted mt-0.5">{n.time}</p>
                    </div>
                    {!n.read && <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
            <motion.div initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="w-72 h-full glass-panel" onClick={e => e.stopPropagation()}>
              <div className="h-16 flex items-center px-4 border-b border-border/40 gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <Hexagon className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="font-bold text-text-primary">ABSuite</span>
              </div>
              <nav className="py-4 px-3 space-y-1">
                {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => { setActiveTab(id); setMobileMenuOpen(false); }}
                    className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all', activeTab === id ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'text-text-muted hover:text-text-primary')}
                  >
                    <Icon className="w-5 h-5" /> {label}
                  </button>
                ))}
              </nav>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
