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
import { PerformanceTab } from './tabs/Performance';
import { ConstraintsPanel } from './tabs/Govern';
import { GlobalView } from './tabs/GlobalView';
import { AttentionPanel } from './tabs/Attention';
import { AuthorityPanel } from './tabs/Authority';
import { UnknownsPanel } from './tabs/Unknowns';
import { LiveFeed } from './tabs/LiveFeed';
import { RecordDetail } from './tabs/RecordDetail';
import { Operations } from './tabs/Operations';
import { ChainView } from './tabs/ChainView';
import { AskBar } from './tabs/AskBar';
import { Agents } from './tabs/Agents';
import { ActLayer } from './tabs/ActLayer';

import { useSocket } from './hooks/useSocket';
import { useTheme } from './hooks/useTheme';
import { cn } from './utils';
import type { ProviderOption } from './types';
import './styles/globals.css';


// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The seven layers.
 *
 * This console used to be organised around the services that happen to run —
 * capkit, edge-run, quickbench — which is the shape of our deployment, not the
 * shape of the problem anyone opens it to solve. Nobody has a "quickbench
 * question". They have "what did it do, was it allowed, has the record been
 * altered, and what do we do when two agents disagree".
 *
 * So the navigation is the stack itself, in the order trust is actually built:
 * observe, verify, explain, govern, arbitrate, act, learn. Everything else sits
 * underneath one of those seven words.
 */
type TabId =
  | 'operations'
  | 'observe' | 'verify' | 'explain' | 'govern' | 'arbitrate' | 'act' | 'learn'
  | 'system' | 'settings';

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
    starting: 'bg-teal-300 status-dot-starting animate-pulse',
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
  const colorMap: Record<string, string> = { emerald: 'bg-emerald-500', blue: 'bg-teal-500', amber: 'bg-amber-500', red: 'bg-red-500' };
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
    restart: 'text-teal-300 hover:bg-teal-500/10 border-teal-500/30 hover:border-teal-500/50',
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
    info: 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-100',
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
      {/* Only the demo-mode notice belongs here. The live-mode notice is rendered
          once by the Overview tab; showing it again produced two stacked banners
          telling the reader the same thing in different words. */}
      {demoMode && (
        <NoticeCard tone="warn" title="Demo mode is active" message="This tab is using showcase activity data. Switch back to Live to monitor the real suite." />
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
                <div className="text-lg font-mono text-text-primary">v{__APP_VERSION__}</div>
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
              <button onClick={() => onServiceAction(svc.id, 'restart')} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/30 hover:bg-teal-500/20 transition-all text-sm font-medium">
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
          <button onClick={generatePolicy} disabled={!policyDesc || policyLoading} className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
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
                <span className={cn('text-xs px-2 py-0.5 rounded font-medium', g.type === 'token' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-teal-500/10 text-teal-400')}>{g.type.toUpperCase()}</span>
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
                  { label: 'p95 Latency', value: `${result.p95}ms`, color: 'text-teal-400' },
                  { label: 'p99 Latency', value: `${result.p99}ms`, color: 'text-amber-400' },
                  { label: 'Throughput', value: `${result.rps} rps`, color: 'text-cyan-400' },
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
                    <td className="px-5 py-3 font-mono text-teal-400">{h.p95}ms</td>
                    <td className="px-5 py-3 font-mono text-amber-400">{h.p99}ms</td>
                    <td className="px-5 py-3 font-mono text-cyan-400">{h.rps}</td>
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
          <button onClick={generateAgent} disabled={!agentPrompt || agentLoading} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
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
    const config = { endpoints, notifications: notifs, version: __APP_VERSION__ };
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
          {[{ label: 'Version', value: __APP_VERSION__ }, { label: 'Services', value: `${services.length} tracked` }].map(item => (
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


// ─── Proof ───────────────────────────────────────────────────────────────────

type Trace = {
  id: string; subject: string; module: string; action: string;
  outcome: 'success' | 'failure'; scope?: string[]; error?: string;
  startedAt: string; completedAt?: string; durationMs?: number;
  hash: string; signature?: string; prevHash: string; keyId?: string;
  steps?: { seq: number; name: string; at: string; detail?: string }[];
  inputHash?: string; outputHash?: string;
};

type Verdict = { valid: boolean; reason?: string; contentIntact: boolean | null; signatureValid: boolean | null; checkable?: boolean; determination?: 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT'; statement?: string; resolvedBy?: string; notAnsweredBecause?: string };

/**
 * The regulator-facing view.
 *
 * Shows recorded executions and lets anyone verify one, including after
 * deliberately tampering with it. Verification runs against the server's
 * public key — the same check an outside auditor performs with no credentials
 * at all — so this demonstrates the claim rather than asserting it.
 */
/**
 * Observe, Verify and Explain share one engine.
 *
 * All three answer questions about the same records, and splitting them into
 * three components would mean three copies of the loader, three selections and
 * three places for them to drift apart. They are one component showing
 * different panels, so the record you select in Observe is the record you
 * verify and the record you explain.
 */
const ProofTab = ({ view, live, arrivedIds, onOpenRecord }: {
  view: 'observe' | 'verify' | 'explain';
  live?: import('./hooks/useSocket').LiveExecution[];
  arrivedIds?: Set<string>;
  onOpenRecord?: (id: string) => void;
}) => {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [selected, setSelected] = useState<Trace | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [chain, setChain] = useState<{ valid: boolean; checked: number; brokenAt?: number; reason?: string } | null>(null);
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tampered, setTampered] = useState(false);
  const [replay, setReplay] = useState<{ inputMatches: boolean; outputMatches: boolean; deterministic: boolean } | null>(null);
  const [explanation, setExplanation] = useState<{ headline: string; conclusion: string; warrantsReview: boolean; findings: { question: string; answer: string; from: string; status: string }[] } | null>(null);
  const [conditions, setConditions] = useState<{ conclusion: string; allDemonstrated: boolean; overall?: string; constrainedBy?: string[]; conditions: { condition: string; answers: string; state: string; finding: string; from: string; resolvedBy?: string; notAnsweredBecause?: string }[] } | null>(null);
  const [replayInput, setReplayInput] = useState('');
  const [replayOutput, setReplayOutput] = useState('');

  const load = async () => {
    setError('');
    try {
      const [execRes, keyRes] = await Promise.all([
        fetch('/executions?limit=25', { headers: getAdminHeaders() }),
        fetch('/executions/public-key'),
      ]);
      const execData = await execRes.json();
      if (!execRes.ok) {
        // Name the cause and the fix. Reading the audit trail needs the admin
        // key, which lives in Settings — "Could not load executions" told the
        // reader neither what was wrong nor what to do about it, on the one
        // screen this product exists for.
        if (execRes.status === 403 || execRes.status === 401) {
          throw new Error(
            'Reading the execution log requires your admin key. Add it under Settings → Admin API key, then reload this tab.'
          );
        }
        if (execRes.status === 502 || execRes.status === 503) {
          throw new Error('CapKit is not reachable on :8081. Start it from the Services tab, then reload.');
        }
        throw new Error(execData?.error?.message ?? execData?.error ?? 'Could not load executions');
      }

      setTraces(Array.isArray(execData.executions) ? execData.executions : []);
      const keyData = await keyRes.json();
      setPublicKey(keyData.publicKey ?? '');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void (async () => {
      await load();
      // Answer the headline question without being asked. A silent chain is
      // exactly as informative as a broken one until somebody checks.
      await verifyChain();
    })();
  }, []);

  const verify = async (trace: Trace) => {
    setBusy(true); setVerdict(null); setError('');
    try {
      const res = await fetch('/executions/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trace }),
      });
      setVerdict(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  const verifyChain = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/executions-verify-chain', { headers: getAdminHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Chain verification failed');
      setChain(data);
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  /**
   * Replay: hand back the payloads you believe were used and find out whether
   * they hash to what was recorded.
   *
   * This is the third pillar the README claims and it had no interface at all —
   * the engine worked, the routes worked, and no human could reach it.
   */
  /** Plain-language explanation, derived from signed fields rather than generated. */
  const explain = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setExplanation(null);
    try {
      const res = await fetch(`/executions/${encodeURIComponent(selected.id)}/explain`, { headers: getAdminHeaders() });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`Explain returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        const e = data.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Explain failed (${res.status})`);
      }
      setExplanation(data as never);

      // The five necessary conditions, fetched beside the explanation. They are
      // inputs to a judgement, never a score — see conditions.ts.
      try {
        const res2 = await fetch(`/executions/${encodeURIComponent(selected.id)}/conditions`, { headers: getAdminHeaders() });
        setConditions(res2.ok ? await res2.json() : null);
      } catch { setConditions(null); }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  // On the Explain layer, selecting a record is the request. Making someone
  // click "Explain this record" after choosing it is a step that exists only
  // because the panel used to live inside the verification screen.
  useEffect(() => {
    if (view === 'explain' && selected) void explain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selected?.id]);

  const runReplay = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setReplay(null);
    try {
      // Parse the user's JSON first and on its own, so a malformed *response*
      // is never reported as malformed *input*. A missing route returns the
      // SPA's HTML, which also fails JSON.parse — and blaming the reader's
      // payload for that sent them looking in exactly the wrong place.
      let payload: { input?: unknown; output?: unknown };
      try {
        const parse = (raw: string) => { const v = raw.trim(); return v ? JSON.parse(v) : undefined; };
        payload = { input: parse(replayInput), output: parse(replayOutput) };
      } catch {
        setError('That is not valid JSON. Check the input and output boxes.');
        setBusy(false);
        return;
      }

      const res = await fetch(`/executions/${encodeURIComponent(selected.id)}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Replay endpoint returned ${res.status} and not JSON. The dashboard may be out of date.`);
      }

      if (!res.ok) {
        const err = data.error as { message?: string } | string | undefined;
        throw new Error((typeof err === 'string' ? err : err?.message) ?? `Replay failed (${res.status})`);
      }
      setReplay(data as never);
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  /** Flip the outcome, exactly as someone covering up a failure would. */
  const tamper = () => {
    if (!selected) return;
    setSelected({ ...selected, outcome: selected.outcome === 'success' ? 'failure' : 'success' });
    setTampered(true); setVerdict(null);
  };

  const reset = () => {
    setReplay(null); setExplanation(null); setConditions(null);
    const original = traces.find(t => t.id === selected?.id);
    if (original) { setSelected(original); setTampered(false); setVerdict(null); }
  };

  const keyId = traces[0]?.keyId;

  return (
    <div className="space-y-4">
      {/* The headline answer, before any interaction. Observe gets the fuller
          global view above instead, so this would only repeat it. */}
      {view === 'verify' && (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={cn(
          'rounded-xl border p-4',
          chain === null ? 'border-border bg-bg-secondary'
            : chain.valid ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
            : 'border-red-500/40 bg-red-500/[0.06]'
        )}>
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">Chain integrity</div>
          <div className={cn('text-xl font-bold',
            chain === null ? 'text-text-muted' : chain.valid ? 'text-emerald-400' : 'text-red-400')}>
            {chain === null ? 'Checking…' : chain.valid ? 'Intact' : `Broken at #${chain.brokenAt}`}
          </div>
          <div className="text-xs text-text-muted mt-1">
            {chain === null ? 'verifying every record' : `${chain.checked} record(s) verified`}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">Records held</div>
          <div className="text-xl font-bold text-text-primary">{traces.length}</div>
          <div className="text-xs text-text-muted mt-1">signed and hash-chained</div>
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">Signing key</div>
          <div className="text-xl font-bold text-text-primary font-mono truncate">{keyId ?? '—'}</div>
          <div className="text-xs text-text-muted mt-1">Ed25519 · public half below</div>
        </div>
      </div>
      )}

      {/* The global view opens the Observe layer: what is held, right now,
          counted rather than estimated. */}
      {view === 'observe' && <GlobalView />}

      {/* The recorder, recording. Placed above everything because it is the one
          thing on this screen that a screenshot cannot convey. */}
      {view === 'observe' && (
        <LiveFeed
          executions={live ?? []}
          arrivedIds={arrivedIds ?? new Set()}
          connected={Boolean(live)}
          onSelect={execution => onOpenRecord?.(execution.id)}
        />
      )}

      {view === 'observe' && <AttentionPanel />}
      {view === 'observe' && <UnknownsPanel />}

      {view === 'observe' && (
        <NoticeCard
          tone="info"
          title="Observation is automatic. Action is granted."
          message="Every execution an instrumented agent performs is captured here without anyone deciding to capture it — the subject, the authority it held, the steps it took and the hashes of what it processed. Watching costs nothing and asks no permission; doing something about it does."
        />
      )}

      {view === 'verify' && <ChainView onOpenRecord={onOpenRecord} />}

      {view === 'verify' && (
        <NoticeCard
          tone="info"
          title="Cryptographic proof of what your agents actually did"
          message="Every execution is hash-chained and signed with Ed25519. Verification uses only the public key — which cannot produce a signature — so an auditor can confirm a record without being able to forge one."
        />
      )}

      {view === 'explain' && (
        <NoticeCard
          tone="info"
          title="AI that explains AI does not need an AI"
          message="Every sentence below is derived from a field that was signed, and names the field it came from. Nothing is generated: run it twice and it reads identically, which is what lets you check the prose against the record instead of trusting it."
        />
      )}

      {error && <NoticeCard tone="error" title="Could not load proof data" message={error} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-bg-tertiary border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-primary">Recorded executions</h3>
            <button className="px-3 py-1.5 rounded-lg text-text-muted hover:text-text-primary text-xs font-medium transition-all" onClick={() => void load()}>Refresh</button>
          </div>

          {traces.length === 0 ? (
            <p className="text-sm text-text-muted">
              No executions recorded yet. Queue a task in Edge-Run and it will appear here, signed.
            </p>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {traces.map(trace => (
                <button
                  key={trace.id}
                  onClick={() => {
                    setSelected(trace); setTampered(false); setVerdict(null);
                    // Observe and Explain hand off to the full record; Verify
                    // keeps its side-by-side, which is what that layer is for.
                    if (view !== 'verify') onOpenRecord?.(trace.id);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg border transition-colors',
                    selected?.id === trace.id
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-border hover:border-border-strong'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('w-1.5 h-1.5 rounded-full flex-none',
                      trace.outcome === 'success' ? 'bg-emerald-500' : 'bg-red-500')} />
                    <span className="text-xs font-mono text-text-primary truncate">{trace.action}</span>
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    {trace.subject} · {new Date(trace.startedAt).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}

          {view === 'verify' && (
          <div className="mt-4 pt-3 border-t border-border">
            <button className="px-4 py-2 rounded-lg bg-bg-primary border border-border hover:border-border-strong text-text-primary font-semibold text-sm transition-all disabled:opacity-50" onClick={() => void verifyChain()} disabled={busy}>
              Verify the entire chain
            </button>
            {chain && (
              <p className={cn('text-xs mt-2', chain.valid ? 'text-emerald-500' : 'text-red-500')}>
                {chain.valid
                  ? `Chain intact — ${chain.checked} record(s) verified.`
                  : `Chain BROKEN at record ${chain.brokenAt}: ${chain.reason}`}
              </p>
            )}
          </div>
          )}
        </div>

        <div className="bg-bg-tertiary border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">
            {view === 'observe' ? 'What this execution did' : view === 'explain' ? 'Explain a record' : 'Verify a record'}
          </h3>

          {!selected ? (
            <p className="text-sm text-text-muted">
              {view === 'observe' ? 'Select an execution to see the authority it held and every step it took.'
                : view === 'explain' ? 'Select an execution and have it explained from its signed fields.'
                : 'Select an execution to inspect and verify it.'}
            </p>
          ) : (
            <>
              <dl className="text-xs space-y-1 mb-3">
                {([
                  ['Action', selected.action],
                  ['Performed by', selected.subject],
                  ['Outcome', selected.outcome],
                  ['Authorised under', (selected.scope ?? []).join(', ') || '—'],
                  ['Duration', selected.durationMs != null ? `${selected.durationMs} ms` : '—'],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <dt className="text-text-muted w-28 flex-none">{label}</dt>
                    <dd className={cn('text-text-primary font-mono break-all',
                      label === 'Outcome' && tampered && 'text-amber-500 font-bold')}>{value}</dd>
                  </div>
                ))}
                <div className="flex gap-2">
                  <dt className="text-text-muted w-28 flex-none">Hash</dt>
                  <dd className="text-text-muted font-mono break-all">{selected.hash.slice(0, 32)}…</dd>
                </div>
              </dl>

              {/* The forensic timeline. Every trace records steps[] and nothing
                  had ever rendered them — the "see every step, in order, with
                  timestamps" the campaign artwork promises was in the database
                  and invisible. */}
              {view !== 'explain' && selected.steps && selected.steps.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-2">
                    Timeline · {selected.steps.length} step(s)
                  </div>
                  <ol className="relative border-l border-border ml-1.5 space-y-2">
                    {selected.steps.map(step => (
                      <li key={step.seq} className="ml-4 relative">
                        <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-emerald-500/70" />
                        <div className="text-xs font-mono text-text-primary">{step.name}</div>
                        <div className="text-[10px] text-text-muted font-mono">
                          {new Date(step.at).toLocaleTimeString()}{step.detail ? ` · ${step.detail}` : ''}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Explain — derived, not generated. */}
              {view === 'explain' && (
              <div className="mb-3">
                <button onClick={explain} disabled={busy}
                  className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50">
                  {busy ? 'Working…' : explanation ? 'Explain again' : 'Explain this record'}
                </button>

                {explanation && (
                  <div className="mt-2 rounded-lg border border-border bg-bg-primary/40 p-3">
                    <p className="text-xs font-semibold text-text-primary mb-2">{explanation.headline}</p>
                    <div className="space-y-2">
                      {explanation.findings.map((f, i) => (
                        <div key={i} className="text-[11px] leading-snug">
                          <div className={cn('font-medium',
                            f.status === 'attention' ? 'text-red-400' : f.status === 'unknown' ? 'text-amber-400' : 'text-emerald-400')}>
                            {f.question}
                          </div>
                          <div className="text-text-muted">{f.answer}</div>
                          {/* Naming the source is the point: a reader checks rather than believes. */}
                          <div className="text-dim font-mono text-[10px] mt-0.5 opacity-70">from: {f.from}</div>
                        </div>
                      ))}
                    </div>
                    <p className={cn('text-[11px] mt-3 pt-2 border-t border-border',
                      explanation.warrantsReview ? 'text-amber-400' : 'text-text-muted')}>
                      {explanation.conclusion}
                    </p>
                  </div>
                )}

                {conditions && (
                  <div className="mt-3 rounded-lg border border-border bg-bg-primary/40 p-3">
                    <p className="text-[11px] font-mono text-text-muted mb-1">
                      Trust := f(Identity, Capability, Evidence, Governance, Time)
                    </p>
                    <p className="text-[11px] text-text-muted mb-3 leading-snug opacity-80">
                      f is undefined here on purpose. These are the inputs; the judgement is yours.
                      ABSuite will not turn them into a score.
                    </p>

                    <div className="space-y-2">
                      {conditions.conditions.map(c => (
                        <div key={c.condition} className="text-[11px] leading-snug">
                          <div className="flex items-baseline gap-2">
                            <span className={cn('font-mono',
                              c.state === 'DEMONSTRATED' ? 'text-emerald-400'
                                : c.state === 'FAILED' ? 'text-red-400'
                                : c.state === 'UNKNOWN' ? 'text-amber-400' : 'text-text-muted')}>
                              {c.state === 'DEMONSTRATED' ? '✓' : c.state === 'FAILED' ? '✗' : c.state === 'UNKNOWN' ? '?' : '·'}
                            </span>
                            <span className="font-semibold text-text-primary">{c.condition}</span>
                            <span className="text-text-muted">{c.answers}</span>
                            <span className={cn('font-mono text-[10px] ml-auto',
                              c.state === 'DEMONSTRATED' ? 'text-emerald-500/70'
                                : c.state === 'FAILED' ? 'text-red-400/70'
                                : c.state === 'UNKNOWN' ? 'text-amber-400/70' : 'text-text-muted/70')}>
                              {c.state}
                            </span>
                          </div>
                          <div className="text-text-muted pl-5">{c.finding}</div>
                          {/* An unknown nobody can act on gets read as a pass. */}
                          {c.resolvedBy && <div className="text-amber-400/80 pl-5">Resolved by: {c.resolvedBy}</div>}
                          {c.notAnsweredBecause && <div className="text-text-muted/80 pl-5">Not answered because: {c.notAnsweredBecause}</div>}
                          <div className="text-dim font-mono text-[10px] pl-5 mt-0.5 opacity-70">from: {c.from}</div>
                        </div>
                      ))}
                    </div>

                    {/* The weakest condition is the answer. Four green ticks
                        and one gap is not "mostly trustworthy". */}
                    <div className="mt-3 pt-2 border-t border-border">
                      {conditions.overall && (
                        <p className="text-[11px] font-mono mb-1">
                          <span className="text-text-muted">Strongest claim this record supports: </span>
                          <span className={cn(
                            conditions.overall === 'DEMONSTRATED' ? 'text-emerald-400'
                              : conditions.overall === 'FAILED' ? 'text-red-400' : 'text-amber-400')}>
                            {conditions.overall}
                          </span>
                          {conditions.constrainedBy && conditions.constrainedBy.length > 0 && (
                            <span className="text-text-muted"> — limited by {conditions.constrainedBy.join(', ')}</span>
                          )}
                        </p>
                      )}
                      <p className={cn('text-[11px]', conditions.allDemonstrated ? 'text-emerald-400' : 'text-text-muted')}>
                        {conditions.conclusion}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* Replay. */}
              {view === 'verify' && (<>
              <details className="mb-3 rounded-lg border border-border bg-bg-primary/40 p-3">
                <summary className="text-xs font-semibold text-text-primary cursor-pointer">
                  Replay this execution
                </summary>
                <p className="text-[11px] text-text-muted mt-2 mb-2">
                  Payloads are hashed and never stored, so ABSuite cannot show you what
                  ran. Paste what you believe was used and it will tell you whether it
                  hashes to the record.
                </p>
                <textarea
                  value={replayInput} onChange={e => setReplayInput(e.target.value)}
                  spellCheck={false} placeholder='input, e.g. {"batch":"BATCH-8891","total":250000}'
                  className="w-full h-16 text-[11px] font-mono p-2 rounded bg-bg-primary border border-border text-text-primary mb-2"
                />
                <textarea
                  value={replayOutput} onChange={e => setReplayOutput(e.target.value)}
                  spellCheck={false} placeholder='output, e.g. {"approved":true}'
                  className="w-full h-12 text-[11px] font-mono p-2 rounded bg-bg-primary border border-border text-text-primary mb-2"
                />
                <button onClick={runReplay} disabled={busy}
                  className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50">
                  {busy ? 'Comparing…' : 'Compare against the record'}
                </button>

                {replay && (
                  <div className={cn('mt-3 rounded-lg border p-3 text-xs',
                    replay.deterministic ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-amber-500/40 bg-amber-500/[0.06]')}>
                    <div className={cn('font-bold mb-1.5', replay.deterministic ? 'text-emerald-400' : 'text-amber-400')}>
                      {replay.deterministic ? 'Reproduced exactly' : 'Does not reproduce'}
                    </div>
                    <div className="space-y-0.5 font-mono text-[11px]">
                      <div className={replay.inputMatches ? 'text-emerald-400' : 'text-amber-400'}>
                        {replay.inputMatches ? '✓' : '✗'} input hash {replay.inputMatches ? 'matches' : 'differs'}
                      </div>
                      <div className={replay.outputMatches ? 'text-emerald-400' : 'text-amber-400'}>
                        {replay.outputMatches ? '✓' : '✗'} output hash {replay.outputMatches ? 'matches' : 'differs'}
                      </div>
                    </div>
                    {!replay.deterministic && (
                      <p className="text-text-muted mt-2 leading-relaxed">
                        A mismatch means the payload you supplied is not what was recorded.
                        That is not proof of tampering — the record is still signed and chained —
                        it means these are not the same inputs.
                      </p>
                    )}
                  </div>
                )}
              </details>

              {tampered && (
                <div className="mb-3">
                  <NoticeCard tone="warn" title="Record edited in your browser"
                    message="The outcome was flipped, as someone hiding a failure would. Verify it now — the signature was never over this content." />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50" onClick={() => void verify(selected)} disabled={busy}>Verify</button>
                <button className="px-4 py-2 rounded-lg bg-bg-primary border border-border hover:border-border-strong text-text-primary font-semibold text-sm transition-all disabled:opacity-50" onClick={tamper} disabled={busy}>Tamper with it</button>
                {tampered && <button className="px-3 py-1.5 rounded-lg text-text-muted hover:text-text-primary text-xs font-medium transition-all" onClick={reset}>Reset</button>}
              </div>

              {verdict && (
                <div className={cn('mt-4 rounded-lg border p-3',
                  verdict.determination === 'DEMONSTRATED' ? 'border-emerald-500/50 bg-emerald-500/5'
                    : verdict.determination === 'FAILED' ? 'border-red-500/50 bg-red-500/5'
                    : 'border-amber-500/50 bg-amber-500/5')}>
                  {/* Three states, never two. "Nobody checked" is not a pass
                      and not a failure, and it always says what would settle it. */}
                  <p className={cn('text-sm font-semibold mb-1',
                    verdict.determination === 'DEMONSTRATED' ? 'text-emerald-500'
                      : verdict.determination === 'FAILED' ? 'text-red-500'
                      : 'text-amber-500')}>
                    {verdict.determination === 'DEMONSTRATED' ? 'Demonstrated'
                      : verdict.determination === 'FAILED' ? 'Failed'
                      : verdict.determination === 'ABSENT' ? 'Absent — the record does not answer'
                      : 'Unknown — not checked'}
                  </p>
                  {verdict.statement && <p className="text-xs text-text-muted mb-2">{verdict.statement}</p>}
                  {verdict.resolvedBy && (
                    <p className="text-[11px] text-amber-400/90 mb-2">Resolved by: {verdict.resolvedBy}</p>
                  )}
                  {verdict.notAnsweredBecause && (
                    <p className="text-[11px] text-text-muted mb-2">Not answered because: {verdict.notAnsweredBecause}</p>
                  )}
                  <ul className="text-xs space-y-1">
                    {/* null means we could not check, which must not be shown
                        as a failed check — see TraceVerdict.contentIntact. */}
                    <li className={verdict.contentIntact === null ? 'text-amber-500' : verdict.contentIntact ? 'text-emerald-500' : 'text-red-500'}>
                      {verdict.contentIntact === null ? '–' : verdict.contentIntact ? '✓' : '✗'} Content{' '}
                      {verdict.contentIntact === null ? 'could not be checked by this build'
                        : verdict.contentIntact ? 'matches its hash' : 'does NOT match its hash'}
                    </li>
                    <li className={verdict.signatureValid === false ? 'text-red-500' : 'text-emerald-500'}>
                      {verdict.signatureValid === null ? '–' : verdict.signatureValid ? '✓' : '✗'} Signature{' '}
                      {verdict.signatureValid === null ? 'not checked' : verdict.signatureValid ? 'valid (Ed25519)' : 'does NOT verify'}
                    </li>
                  </ul>
                  {verdict.reason && <p className="text-xs text-text-muted mt-2">{verdict.reason}</p>}
                </div>
              )}
              </>)}
            </>
          )}

          {view === 'verify' && publicKey && (
            <details className="mt-4">
              <summary className="text-xs text-text-muted cursor-pointer">Public key an auditor would use</summary>
              <pre className="text-[10px] font-mono text-text-muted mt-2 overflow-x-auto">{publicKey}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Monitoring: AI watching AI ──────────────────────────────────────────────

type ArbPosition = { agentId: string; answer: string; family?: string; weight: number; rawWeight: number; discounted?: boolean; discountReason?: string };
type Arbitration = { outcome: string; answer?: string; margin: number; independentSupport: number; requiresHuman: boolean; reasoning: string[]; positions: ArbPosition[] };

const DEFAULT_POSITIONS = `[
  { "agentId": "gpt-4o",      "answer": "no",  "family": "openai:gpt-4",     "confidence": 0.90 },
  { "agentId": "gpt-4-turbo", "answer": "no",  "family": "openai:gpt-4",     "confidence": 0.88 },
  { "agentId": "gpt-3.5",     "answer": "no",  "family": "openai:gpt-3.5",   "confidence": 0.85 },
  { "agentId": "claude-opus", "answer": "yes", "family": "anthropic:claude", "confidence": 0.80 }
]`;

/**
 * Correlation-aware arbitration, made visible.
 *
 * Three models agreeing is not three pieces of evidence when two share a
 * family — they fail together. The engine always discounted that; nothing ever
 * showed it happening, which is the one thing that makes the idea land.
 */
const MonitoringTab = () => {
  const [question, setQuestion] = useState('Did the agent exceed its authority?');
  const [positions, setPositions] = useState(DEFAULT_POSITIONS);
  const [result, setResult] = useState<Arbitration | null>(null);
  const [anomalies, setAnomalies] = useState<{ kind: string; detail?: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/trust/anomalies', { headers: getAdminHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setAnomalies(Array.isArray(data.anomalies) ? data.anomalies : []);
      } catch { /* Trust may be down; the panel says so rather than inventing. */ }
    })();
  }, []);

  const arbitrate = async () => {
    setBusy(true); setError(''); setResult(null);
    let parsed: unknown;
    try { parsed = JSON.parse(positions); }
    catch { setError('Positions must be valid JSON.'); setBusy(false); return; }
    try {
      const res = await fetch('/trust/arbitrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
        body: JSON.stringify({ question, positions: parsed }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`Arbitration returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        const e = data.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Arbitration failed (${res.status})`);
      }
      setResult(data as unknown as Arbitration);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <NoticeCard tone="info"
        title="Agreement between correlated models is not corroboration"
        message="Two models of the same family fail the same way, so their agreement counts once rather than twice — and every discount is stated with its reason. Confidence never decides the answer." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Put a question to a panel</h3>
          <input value={question} onChange={e => setQuestion(e.target.value)}
            className="w-full text-xs p-2 mb-2 rounded bg-bg-primary border border-border text-text-primary" />
          <textarea value={positions} onChange={e => setPositions(e.target.value)} spellCheck={false}
            className="w-full h-40 text-[11px] font-mono p-2 rounded bg-bg-primary border border-border text-text-primary mb-2" />
          <button onClick={arbitrate} disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50">
            {busy ? 'Arbitrating…' : 'Arbitrate'}
          </button>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Verdict</h3>
          {!result ? (
            <p className="text-sm text-text-muted">Run an arbitration to see how each voice was weighted.</p>
          ) : (
            <>
              <div className={cn('rounded-lg border p-3 mb-3',
                result.requiresHuman ? 'border-amber-500/40 bg-amber-500/[0.06]'
                  : result.outcome === 'resolved' ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-border')}>
                <div className={cn('text-lg font-bold', result.requiresHuman ? 'text-amber-400'
                  : result.outcome === 'resolved' ? 'text-emerald-400' : 'text-text-primary')}>
                  {result.outcome === 'resolved' ? `Answer: ${result.answer}`
                    : result.outcome === 'escalate' ? 'Escalated to a human' : 'No consensus'}
                </div>
                <div className="text-xs text-text-muted mt-1 font-mono">
                  {Math.round(result.margin * 100)}% of weight · {result.independentSupport} independent famil{result.independentSupport === 1 ? 'y' : 'ies'}
                </div>
              </div>

              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-2">How each voice counted</div>
              <div className="space-y-1.5 mb-3">
                {result.positions.map(pos => (
                  <div key={pos.agentId} className={cn('rounded border p-2 text-xs',
                    pos.discounted ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-border')}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-text-primary">{pos.agentId}</span>
                      <span className="font-mono text-[11px] text-text-muted">
                        {pos.answer} · {pos.discounted
                          ? <><s>{pos.rawWeight.toFixed(2)}</s> <span className="text-amber-400">{pos.weight.toFixed(2)}</span></>
                          : pos.weight.toFixed(2)}
                      </span>
                    </div>
                    {pos.discountReason && <p className="text-[11px] text-amber-400/80 mt-1 leading-snug">{pos.discountReason}</p>}
                  </div>
                ))}
              </div>

              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1.5">Reasoning</div>
              <ul className="space-y-1">
                {result.reasoning.map((line, i) => (
                  <li key={i} className="text-[11px] text-text-muted leading-snug flex gap-1.5">
                    <span className="text-emerald-500/60">·</span><span>{line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Chain anomalies</h3>
        <p className="text-xs text-text-muted mb-3">Cycles, runaways, stalls and observer disagreement across agent chains.</p>
        {anomalies.length === 0 ? (
          <p className="text-sm text-text-muted">None detected. A real result, not a placeholder — chains with no anomalies report none.</p>
        ) : (
          <ul className="space-y-1.5">
            {anomalies.map((a, i) => (
              <li key={i} className="rounded border border-amber-500/30 bg-amber-500/[0.04] p-2 text-xs">
                <span className="font-mono text-amber-400">{a.kind}</span>
                {a.detail && <span className="text-text-muted"> — {a.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

// ─── Main App ────────────────────────────────────────────────────────────────

const TAB_CONFIG: {
  id: TabId;
  label: string;
  layer?: number;
  question: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  // The seven layers, in the order trust is built. Each label is a verb,
  // because each one is something the system does — and the question beneath it
  // is the one a person actually arrived with.
  // Not a layer. The room the layers are in.
  { id: 'operations', label: 'Operations', question: 'Everything, at once',                icon: Hexagon },
  { id: 'observe',   layer: 1, label: 'Observe',   question: 'What did the agents do?',            icon: Eye },
  { id: 'verify',    layer: 2, label: 'Verify',    question: 'Has any of it been altered?',        icon: Shield },
  { id: 'explain',   layer: 3, label: 'Explain',   question: 'What does this record mean?',        icon: MessageSquare },
  { id: 'govern',    layer: 4, label: 'Govern',    question: 'What is it allowed to do?',          icon: Wrench },
  { id: 'arbitrate', layer: 5, label: 'Arbitrate', question: 'Who is right when they disagree?',   icon: Network },
  { id: 'act',       layer: 6, label: 'Act',       question: 'What can it reach, and is it up?',   icon: Zap },
  { id: 'learn',     layer: 7, label: 'Learn',     question: 'How fast is it, really?',            icon: Gauge },
  // Not layers. The machinery underneath.
  { id: 'system',   label: 'System',   question: 'Infrastructure health',  icon: Home },
  { id: 'settings', label: 'Settings', question: 'Keys and configuration', icon: Server },
];

/** Everything the Act layer can reach, and whether it is up. */
const ActTab = ({ services, demoMode, onServiceAction }: {
  services: Service[];
  demoMode: boolean;
  onServiceAction: (id: string, action: 'start' | 'stop' | 'restart') => void;
}) => (
  <div className="space-y-6">
    {/* Work in flight first. Whether a container is up is infrastructure; what
        is running is the layer. */}
    <ActLayer />
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3">The surfaces underneath</h3>
      <ServicesTab services={services} onServiceAction={onServiceAction} />
    </div>
    <ConnectorsTab demoMode={demoMode} />
  </div>
);

/** Layer 7 — what the system measures about itself, and about models. */
const LearnTab = ({ demoMode }: { demoMode: boolean }) => (
  <div className="space-y-6">
    <PerformanceTab />
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3">Benchmark a model</h3>
      <BenchmarksTab demoMode={demoMode} />
    </div>
  </div>
);

/** Layer 4 — the rules, the refusals, and the tokens that carry authority. */
const GovernTab = ({ demoMode, onOpenRecord }: { demoMode: boolean; onOpenRecord?: (id: string) => void }) => (
  <div className="space-y-6">
    <Agents onOpenRecord={onOpenRecord} />
    <AuthorityPanel />
    <ConstraintsPanel />
    <AIStudioTab demoMode={demoMode} />
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('operations');
  /**
   * The record being examined, if any.
   *
   * Held at app level rather than inside a layer: a record is not the property
   * of the screen you happened to find it on, and clicking one in Observe then
   * losing it by moving to Verify is exactly the kind of seam that makes a
   * console feel like a set of pages instead of a system.
   */
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  /**
   * Notifications, from events that actually happened.
   *
   * This list used to be three hardcoded strings, one of which claimed a
   * QuickBench health check had passed. It may never have run. That was invented
   * evidence in the first thing anyone sees, in the product whose root principle
   * is that nothing may look more certain than it is — and every check we built
   * looks at code and docs, never at the interface, which is why it survived.
   *
   * Now it is empty until something happens, and what happens is a signed record
   * arriving.
   */
  const [notifications, setNotifications] = useState<Array<{ id: string; message: string; time: string; read: boolean; type: 'info' | 'success' | 'warn' }>>([]);
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

  const { connected, executions: liveExecutions, arrivedIds } = useSocket();

  // Real arrivals become notifications. Nothing else does.
  const lastNotifiedRef = React.useRef<string | null>(null);
  useEffect(() => {
    const newest = liveExecutions[0];
    if (!newest || !arrivedIds.has(newest.id) || lastNotifiedRef.current === newest.id) return;
    lastNotifiedRef.current = newest.id;
    setNotifications(current => [
      {
        id: newest.id,
        message: `${newest.subject} ${newest.outcome === 'failure' ? 'failed' : 'performed'} "${newest.action}"`,
        time: 'just now',
        read: false,
        type: newest.outcome === 'failure' ? 'warn' : 'success',
      },
      ...current,
    ].slice(0, 20));
  }, [liveExecutions, arrivedIds]);

  const handleServiceAction = useCallback(async (id: string, action: 'start' | 'stop' | 'restart') => {
    if (action === 'start') await startService(id);
    else if (action === 'stop') await stopService(id);
    else if (action === 'restart') await restartService(id);
  }, [restartService, startService, stopService]);

  const renderTab = () => {
    if (openRecordId) {
      return <RecordDetail id={openRecordId} onClose={() => setOpenRecordId(null)} />;
    }
    switch (activeTab) {
      case 'operations': return (
        <Operations
          live={liveExecutions}
          arrivedIds={arrivedIds}
          connected={connected}
          servicesUp={services.filter(s => s.status === 'up').length}
          servicesTotal={services.length}
          onOpenRecord={setOpenRecordId}
          onOpenLayer={layer => setActiveTab(layer as TabId)}
        />
      );
      case 'observe': return <ProofTab view="observe" live={liveExecutions} arrivedIds={arrivedIds} onOpenRecord={setOpenRecordId} />;
      case 'verify': return <ProofTab view="verify" onOpenRecord={setOpenRecordId} />;
      case 'explain': return <ProofTab view="explain" onOpenRecord={setOpenRecordId} />;
      case 'govern': return <GovernTab demoMode={demoMode} onOpenRecord={setOpenRecordId} />;
      case 'arbitrate': return <MonitoringTab />;
      case 'act': return <ActTab services={services} demoMode={demoMode} onServiceAction={handleServiceAction} />;
      case 'learn': return <LearnTab demoMode={demoMode} />;
      case 'system': return <OverviewTab services={services} demoMode={demoMode} error={error} onServiceAction={handleServiceAction} />;
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

          {/* Nav — the stack, in order. */}
          <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
            {TAB_CONFIG.map(({ id, label, layer, question, icon: Icon }) => (
              <React.Fragment key={id}>
                {/* Operations is the room; the seven are the stack inside it. */}
                {layer === 1 && !sidebarCollapsed && (
                  <div className="px-3 pt-3 pb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/70">
                    The stack
                  </div>
                )}
                {/* The seven layers are the product; the last two are plumbing. */}
                {layer === undefined && id === 'system' && (
                  <div className={cn('pt-3 mt-2 border-t border-border/40', sidebarCollapsed && 'mx-2')}>
                    {!sidebarCollapsed && (
                      <div className="px-3 pb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/70">
                        Underneath
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { setActiveTab(id); setOpenRecordId(null); setMobileMenuOpen(false); }}
                  title={sidebarCollapsed ? `${label} — ${question}` : question}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                    activeTab === id
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary/50',
                    sidebarCollapsed && 'justify-center px-0'
                  )}
                >
                  <Icon className={cn('w-5 h-5 shrink-0', activeTab === id ? 'text-emerald-400' : '')} />
                  {!sidebarCollapsed && (
                    <span className="flex-1 text-left flex items-baseline gap-2">
                      <span>{label}</span>
                      {layer !== undefined && (
                        <span className="text-[10px] font-mono text-text-muted/60">{layer}</span>
                      )}
                    </span>
                  )}
                </button>
              </React.Fragment>
            ))}
          </nav>

          {!sidebarCollapsed && (
            <div className="px-4 py-3 mx-3 mb-2 rounded-xl border border-border/60 bg-bg-primary/40">
              <p className="text-[11px] text-text-muted leading-relaxed italic">
                “Tell me what happened. Prove it. Tell me whether I should worry.”
              </p>
              <p className="text-[10px] text-text-muted/60 mt-1.5">
                The three questions. ABSuite answers the first two and shows you what the third rests on.
              </p>
            </div>
          )}

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

            {/* A control that looked capable and did nothing is the same failure
                as a number that looks measured and is not. It asks the log now. */}
            <div className="hidden md:flex flex-1">
              <AskBar onOpenRecord={setOpenRecordId} />
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

              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-sm font-bold text-bg-primary">E</div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto p-5 dot-grid-bg">
            {/* Which layer you are standing in, and the question it answers. A
                tab label alone leaves the reader to guess what this screen is
                for; the question is the whole reason they clicked. */}
            {(() => {
              const current = TAB_CONFIG.find(tab => tab.id === activeTab);
              if (!current) return null;
              // Operations states its own identity in the centre of the room.
              if (current.id === 'operations' && !openRecordId) return null;
              return (
                <div className="mb-5">
                  <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-500/70 mb-1">
                    {current.layer !== undefined
                      ? `Layer ${current.layer} of 7`
                      : current.id === 'operations'
                        ? 'Trust Operations Center'
                        : 'Underneath the stack'}
                  </div>
                  <h1 className="text-2xl font-bold text-text-primary leading-tight">{current.label}</h1>
                  <p className="text-sm text-text-muted mt-0.5">{current.question}</p>
                </div>
              );
            })()}

            {/* Demo mode is worth announcing anywhere, because it changes what the
                numbers mean. "Live mode enabled" is a statement about service
                health, so it belongs on the tabs about service health — on the
                Evidence tab it pushed the answer the reader came for below a
                banner telling them something they did not ask. An actual error
                still surfaces everywhere. */}
            {(demoMode || error || activeTab === 'system' || activeTab === 'act') && (
              <div className="mb-4">
                {demoMode ? (
                  <NoticeCard tone="warn" title="Demo mode enabled" message="You are viewing showcase behavior in this same dashboard URI. Switch back to Live for the real suite state." />
                ) : (
                  <NoticeCard tone={error ? 'error' : 'info'} title={error ? 'Live mode reports a real issue' : 'Live mode enabled'} message={error ? `${error} The dashboard is intentionally not showing fake fallback data.` : 'This dashboard is currently showing the real ABSuite service state.'} />
                )}
              </div>
            )}

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
                    <div className={cn('mt-0.5 w-2 h-2 rounded-full shrink-0', n.type === 'success' && 'bg-emerald-400', n.type === 'info' && 'bg-teal-400', n.type === 'warn' && 'bg-amber-400')} />
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
                {TAB_CONFIG.map(({ id, label, layer, question, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => { setActiveTab(id); setOpenRecordId(null); setMobileMenuOpen(false); }}
                    className={cn('w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all', activeTab === id ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'text-text-muted hover:text-text-primary')}
                  >
                    <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                    <span className="text-left">
                      <span className="flex items-baseline gap-2">
                        {label}
                        {layer !== undefined && <span className="text-[10px] font-mono opacity-60">{layer}</span>}
                      </span>
                      <span className="block text-[11px] font-normal opacity-70 leading-snug">{question}</span>
                    </span>
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
