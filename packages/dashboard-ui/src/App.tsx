/**
 * ABSuite — Trust Operations Center.
 *
 * Not a dashboard. A dashboard answers "what happened, how many, is the service
 * up"; those are questions about infrastructure. This oversees autonomous
 * systems: what they did, whether it can be proven, under what rule, and what
 * remains unknown.
 *
 * The distinction is not branding. It decides what gets the top of the screen.
 * A dashboard leads with service health, because that is what its operator
 * came for. An operations center leads with the record — the service tiles are
 * furniture, and they live at the bottom of a layer called Act.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Zap, Shield,
  Server, MessageSquare, Copy, Check, AlertCircle, Loader2,
  Download, Upload, Eye, Hexagon, Network, Gauge, Wrench,
  Layers, Scale, HelpCircle
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
import { ChainView } from './tabs/ChainView';
import { Agents } from './tabs/Agents';
import { ActLayer } from './tabs/ActLayer';
import { LearnLayer } from './tabs/LearnLayer';
import { ArbitrateLayer } from './tabs/ArbitrateLayer';
import { MachineRoom } from './tabs/MachineRoom';
import { Audit } from './tabs/Audit';
import { Obligations } from './tabs/Obligations';
import { TrustOperationsCenter } from './room/TrustOperationsCenter';
import { VITAL_ICONS, type Vital } from './room/TopBar';
import { Mark } from './room/Mark';
import type { LayerReading } from './room/OrbitalNodes';
import type { TrustLayer } from './room/SceneCube';

type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

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
  // The seven-stage loop.
  | 'observe' | 'verify' | 'explain' | 'govern' | 'arbitrate' | 'act' | 'learn'
  // The four standing views. Not stages — the things the stages act on.
  | 'evidence' | 'policies' | 'agents' | 'unknowns'
  // The operator console. Not a layer and not evidence — a place you act from.
  | 'console'
  | 'system' | 'settings';

interface RecentGeneration { id: string; type: 'token' | 'policy'; provider: string; preview: string; timestamp: string; }

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const adminKey = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return adminKey ? { 'x-absuite-admin-key': adminKey } : {};
};

// ─── Utility Components ─────────────────────────────────────────────────────

/** Status as a colour. Amber is "not checked", not "degraded". */
const StatusDot = ({ status }: { status: Service['status'] }) => {
  const colors: Record<Service['status'], string> = {
    up: 'bg-emerald-500 status-dot-up',
    down: 'bg-red-500 status-dot-down',
    unknown: 'bg-amber-500 status-dot-unknown',
    starting: 'bg-teal-300 status-dot-starting animate-pulse',
    stopping: 'bg-yellow-400 status-dot-stopping',
    failed: 'bg-red-400 status-dot-failed',
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

// ─── AI Studio Tab ───────────────────────────────────────────────────────────

const AIStudioTab = () => {
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

    const loadProviders = async () => {
      try {
        const res = await fetch('/ai/providers');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? data.error ?? 'Unable to inspect AI providers');

        if (!active) return;

        const liveProviders: ProviderOption[] = Array.isArray(data.providers)
          ? (data.providers as ProviderOption[])
          : [];
        // Whatever CapKit reports, and nothing else. A hardcoded fallback list
        // of eight providers used to sit here behind a dead condition; it would
        // have drawn Ollama, Groq and Anthropic as known-about on an instance
        // that had never reached any of them.
        const nextProviders = liveProviders;

        setProviders(nextProviders);
        setRecommendedProvider(data.recommended ?? 'none');
        setProvidersError(liveProviders.length === 0 ? 'No live AI providers were reported by CapKit.' : '');

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
        setProviders([]);
        setRecommendedProvider('none');
        setProvidersError((err as Error).message);
      }
    };

    void loadProviders();
    return () => {
      active = false;
    };
  }, [provider]);

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
      setRecentGens(prev => [{ id: crypto.randomUUID(), type: 'token', provider, preview: tokenName, timestamp: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
    } catch (err) {
      // A failed issue shows the failure. There was a dead branch here that
      // printed `ck_demo_<random>` on error — a fabricated credential that
      // looked real, one flipped condition away from shipping.
      setTokenResult('');
      setTokenError((err as Error).message);
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
      setRecentGens(prev => [{ id: crypto.randomUUID(), type: 'policy', provider, preview: policyDesc.slice(0, 30), timestamp: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
    } catch (err) {
      setPolicyResult('');
      setPolicyError((err as Error).message);
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

      {<NoticeCard tone="info" title="Live mode is active" message="This panel only shows real CapKit and provider responses. If a provider is unavailable, the actual error will be shown." />}

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
        {providersError && <div className="mb-3"><NoticeCard tone="error" title="Provider discovery issue" message={providersError} /></div>}
        {!providersError && providers.length === 0 && (
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

// ─── Settings Tab ────────────────────────────────────────────────────────────

const SettingsTab = ({ services }: { services: Service[] }) => {
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
  }, [services]);

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
      setEndpointMessageTone('error');
      setEndpointMessage((err as Error).message);
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

      {<NoticeCard tone="info" title="Live" message="Endpoint statuses reflect the actual running suite. Tests call the real health endpoints." />}

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
const ProofTab = ({ view, live, arrivedIds, connected = false, onOpenRecord }: {
  view: 'observe' | 'verify' | 'explain';
  live?: import('./hooks/useSocket').LiveExecution[];
  arrivedIds?: Set<string>;
  /** The socket, as the socket reports itself. Not inferred from anything. */
  connected?: boolean;
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
        throw new Error(`Replay endpoint returned ${res.status} and not JSON. This console may be out of date.`);
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
          {/* Derived, not asserted. "Hash-chained" is a claim about whether the
              links were checked on this request, not a property to be printed
              under any number. */}
          <div className="text-xs text-text-muted mt-1">
            {chain === null ? 'signed · chain not yet checked'
              : chain.valid ? `signed · ${chain.checked} link(s) verified`
              : `signed · chain broken at #${chain.brokenAt}`}
          </div>
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
      {/* The recorder, recording. Placed above everything because it is the one
          thing on this screen that a screenshot cannot convey. */}
      {view === 'observe' && (
        <LiveFeed
          executions={live ?? []}
          arrivedIds={arrivedIds ?? new Set()}
          /*
           * The socket, not the shape of a prop.
           *
           * This read Boolean(live) — and Boolean([]) is true, so an empty
           * array counted as a live connection. The panel announced "LIVE
           * observing" with a pulsing green dot while the masthead three
           * inches above it said OFFLINE, on a machine that had never
           * answered. A connection indicator inferred from the existence of a
           * variable is not an indicator.
           */
          connected={connected}
          onSelect={execution => onOpenRecord?.(execution.id)}
        />
      )}


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

          {/*
            * The chain action lives in ChainView, at the top of this surface,
            * where the chain is explained. A second "Verify the entire chain"
            * down here did the same work under a different name — two buttons
            * for one act, which reads as two different acts. The result is kept
            * because a reader who has scrolled this far should not have to
            * scroll back to see whether the sweep passed.
            */}
          {view === 'verify' && (
          <div className="mt-4 pt-3 border-t border-border">
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
  { id: 'act',       layer: 6, label: 'Act',       question: 'What is running, and what can it reach?', icon: Zap },
  { id: 'learn',     layer: 7, label: 'Learn',     question: 'How fast is it, really?',            icon: Gauge },
  // Not stages. The four standing things the stages act on — each had been a
  // panel buried inside a stage, which is where a capability goes to be unread.
  { id: 'evidence', label: 'Evidence',     question: 'What is held, and where is it thin?', icon: Layers },
  { id: 'agents',   label: 'Agents',       question: 'Who has been acting here?',           icon: Bot },
  { id: 'policies', label: 'Policies',     question: 'The rules, and what is owed',         icon: Scale },
  { id: 'unknowns', label: 'Unknown queue', question: 'What cannot yet be shown',           icon: HelpCircle },
  // Not layers. The machinery underneath.
  { id: 'console',  label: 'Console',      question: 'Issue a token, draft a policy', icon: Bot },
  { id: 'system',   label: 'System health', question: 'The suite that runs the stack', icon: Server },
  { id: 'settings', label: 'Settings',     question: 'Keys and configuration',        icon: Wrench },
];

/**
 * Layer 6 — what is in flight, what is scheduled, what this instance can reach.
 *
 * This tab used to end in a Service Inspector and a grid of six connector tiles
 * whose enabled flags were written into the source. ActLayer reads the real
 * connector registry, which reports what credentials are actually present; a
 * hardcoded tile claiming Slack was enabled was a fabricated fact sitting two
 * inches from a measured one.
 */

/**
 * Layer 4 — the rules and the authority actually exercised.
 *
 * The AI Studio console used to open here: a token-generation form with two
 * dropdowns and a Generate button, and a policy generator with a textarea. It
 * is a good console and it does real work, but it is a console — a place you
 * operate the system from — and Govern is a place you read what the system
 * did. Putting them together is what made entering a layer feel like leaving
 * the operations centre for an admin panel.
 *
 * It is not deleted. It moved to its own standing view, reachable from the
 * command palette, where an operator tool belongs. Govern now answers only the
 * question it is named for: what is it allowed to do, and what did it do.
 */
const GovernTab = () => (
  <div className="space-y-6">
    <AuthorityPanel />
  </div>
);



export default function App() {
  /**
   * Which layer has been entered, or null when standing in the room.
   *
   * There is no default tab any more. A dashboard opens on a page; a room opens
   * on the room, and you choose where to go from what you can see.
   */
  const [, setActiveTab] = useState<TabId | null>(null);
  /**
   * The record being examined, if any.
   *
   * Held at app level rather than inside a layer: a record is not the property
   * of the screen you happened to find it on, and clicking one in Observe then
   * losing it by moving to Verify is exactly the kind of seam that makes a
   * console feel like a set of pages instead of a system.
   */
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const { theme } = useTheme();
  const { services, error } = useServices();

  /**
   * There is no notification bell.
   *
   * A bell is a dashboard's answer to "something happened while you were
   * looking elsewhere" — it exists because a dashboard can only show you one
   * page at a time. In a room you are already looking at the whole thing: an
   * arrival is a particle converging on the cube, and a layer that changes
   * state changes colour where it stands. Both are visible from wherever you
   * are, which is what the bell was compensating for.
   */

  const { connected, executions: liveExecutions, arrivedIds } = useSocket();

  /**
   * The chain's integrity, held by the shell because the cube is now a shell
   * element and must be able to state it on every view.
   *
   * Four states, never three: intact, broken, not-checked, and nothing-recorded.
   * A failed request leaves this UNKNOWN rather than dropping to a green
   * default — "I could not check" and "it is fine" must not render alike.
   */
  const [integrity, setIntegrity] = useState<Determination>('UNKNOWN');
  /**
   * Figures the room's nodes report.
   *
   * These were briefly derived from the socket buffer, which holds only what
   * arrived since this tab connected. With eight records on disk and none
   * streamed yet, Observe rendered ABSENT — "nothing recorded" — about a log
   * that was not empty. Understating is still misstating.
   */
  const [figures, setFigures] = useState<{ total: number; withoutScope: number; failures: number; subjects: number } | null>(null);
  const [queue, setQueue] = useState<{ total: number; breakdown: { label: string; count: number }[] } | null>(null);
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const res = await fetch('/executions/stats?windowHours=24', { headers: getAdminHeaders() });
        if (!active) return;
        if (!res.ok) { setIntegrity('UNKNOWN'); return; }
        const data = (await res.json()) as {
          total: number; withoutScope: number; failures: number; subjects: number;
          chain: { valid: boolean; checkable?: boolean };
        };
        setFigures({ total: data.total, withoutScope: data.withoutScope ?? 0, failures: data.failures ?? 0, subjects: data.subjects ?? 0 });
        if (data.total === 0) setIntegrity('ABSENT');
        else if (data.chain?.checkable === false) setIntegrity('UNKNOWN');
        else setIntegrity(data.chain?.valid ? 'DEMONSTRATED' : 'FAILED');
      } catch {
        if (active) { setIntegrity('UNKNOWN'); setFigures(null); }
      }
    };
    void read();
    const timer = window.setInterval(read, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [liveExecutions.length]);

  /**
   * What the instruments read.
   *
   * Every panel in the design carried an illustrative figure. These are the
   * real ones. Where an endpoint does not answer the panel says so rather than
   * falling back to a plausible number.
   */
  const readInstruments = useCallback(async () => {
    const headers = getAdminHeaders();


    try {
      const res = await fetch('/executions/unknowns?limit=200', { headers });
      if (!res.ok) { setQueue(null); return; }
      const payload = (await res.json()) as { queue?: { resolution: string; examples?: string[] }[] };
      const items = payload.queue ?? [];
      setQueue({
        total: items.reduce((sum, item) => sum + (item.examples?.length ?? 0), 0),
        breakdown: items.slice(0, 5).map(item => ({
          label: item.resolution,
          count: item.examples?.length ?? 0,
        })),
      });
    } catch {
      // Unreachable is UNKNOWN, not zero. A queue that cannot be read is not
      // an empty queue, and the vitals line renders the difference.
      setQueue(null);
    }
  }, []);

  useEffect(() => {
    void readInstruments();
    const timer = window.setInterval(() => void readInstruments(), 8000);
    return () => window.clearInterval(timer);
  }, [readInstruments]);

  /**
   * What each layer reports.
   *
   * Absent when the layer has nothing to say. A missing reading renders as no
   * badge at all, which is a different claim from a badge reading zero.
   */
  const readings: Record<string, LayerReading | undefined> = React.useMemo(() => {
    const upCount = services.filter(service => service.status === 'up').length;
    const held = figures?.total ?? null;
    const unscoped = figures?.withoutScope ?? 0;
    /*
     * `figures.failures` is deliberately not read here.
     *
     * It was the source of Arbitrate's reading, which is why a failed payment
     * appeared on the front page as "1 DISPUTE". It is still fetched and still
     * available to any layer that wants to state it as what it is — a count of
     * executions whose outcome was failure — but no orbital node currently has
     * an honest use for it, and borrowing it for one was the bug.
     */

    const servicesState: Determination =
      services.length === 0 ? 'UNKNOWN'
        : upCount === services.length ? 'DEMONSTRATED'
        : upCount === 0 ? 'FAILED' : 'UNKNOWN';

    /** No figure of its own means UNKNOWN, never ABSENT. Different claims. */
    const unchecked: Determination = held === null ? 'UNKNOWN' : held > 0 ? 'UNKNOWN' : 'ABSENT';

    return {
      observe: held === null
        ? { state: 'UNKNOWN' }
        : { state: held > 0 ? 'DEMONSTRATED' : 'ABSENT', metric: held > 0 ? String(held) : undefined },
      verify: {
        state: integrity,
        metric: integrity === 'DEMONSTRATED' ? 'INTACT'
          : integrity === 'FAILED' ? 'BROKEN'
          : integrity === 'ABSENT' ? undefined : 'UNCHECKED',
      },
      explain: held === null
        ? { state: 'UNKNOWN' }
        : { state: held > 0 ? 'DEMONSTRATED' : 'ABSENT', metric: held > 0 ? 'DERIVED' : undefined },
      govern: held === null
        ? { state: 'UNKNOWN' }
        : held === 0 ? { state: 'ABSENT' }
        : unscoped > 0
          ? { state: 'UNKNOWN', metric: `${unscoped} UNSCOPED` }
          // absuite-allow-fabrication: a determination label, not a measurement — this branch is only reachable when held > 0 and unscoped === 0, so the word is what the comparison concluded.
          : { state: 'DEMONSTRATED', metric: 'SCOPED' },
      /*
       * Arbitrate reports nothing, because nothing is kept.
       *
       * This read `figures.failures` and rendered it as `${failures} DISPUTES`,
       * which put "1 DISPUTE" on the front page in red the first time a single
       * execution came back with outcome 'failure'. The number was real. The
       * noun was not: a payment that failed is not two parties disagreeing, and
       * Arbitrate is the layer for "who is right when they disagree", not for
       * "what went wrong". The layer was also being marked FAILED — a claim
       * that arbitration itself had failed — on the strength of an unrelated
       * execution.
       *
       * capkit already says the true thing, in its own `unverifiable` list:
       * "Arbitrations are answered on request and not persisted, so there is no
       * count to give." /trust/disputes returns [] for the same reason. So the
       * honest reading is the absence, and the room has a word for that.
       *
       * check-no-fabrication did not catch this, and could not have: it exempts
       * any metric containing an interpolation on the grounds that a value
       * bound to a variable cannot be invented. That is true of the number and
       * says nothing about the label attached to it.
       */
      arbitrate: { state: figures === null ? 'UNKNOWN' : 'ABSENT' },
      act: services.length === 0
        ? { state: 'UNKNOWN' }
        : { state: servicesState, metric: `${upCount}/${services.length} UP` },
      learn: { state: unchecked },
    };
  }, [integrity, services, figures]);

  /*
   * The masthead's columns, as data.
   *
   * These were markup here — my own vitals row, built after deleting the
   * supplied TopBar. The supplied masthead is back and this is what feeds it:
   * five readings, each with the determination that decides its colour, and
   * a dash wherever the instance has not been able to ask. The supplied file
   * carried `482 (+18m)` and `NO VIOLATIONS` as literals; those are the only
   * part of it that could not be adopted.
   */
  const vitals: Vital[] = [
    {
      label: 'Services',
      value: services.length === 0 ? '—' : `${services.filter(s => s.status === 'up').length}/${services.length} responding`,
      tone: services.length === 0 ? 'UNKNOWN'
        : services.every(s => s.status === 'up') ? 'DEMONSTRATED'
        : services.some(s => s.status === 'up') ? 'UNKNOWN' : 'FAILED',
      icon: VITAL_ICONS.Network,
    },
    {
      label: 'Chain integrity',
      value: integrity === 'DEMONSTRATED' ? 'Intact'
        : integrity === 'FAILED' ? 'Broken'
        : integrity === 'ABSENT' ? 'Nothing held' : 'Unchecked',
      tone: integrity,
      icon: VITAL_ICONS.ShieldCheck,
    },
    {
      label: 'Evidence held',
      value: figures === null ? '—' : String(figures.total),
      tone: figures === null ? 'UNKNOWN' : figures.total > 0 ? 'DEMONSTRATED' : 'ABSENT',
      icon: VITAL_ICONS.Database,
    },
    {
      label: 'Constitution',
      value: figures === null ? '—' : figures.withoutScope > 0 ? `${figures.withoutScope} unscoped` : 'No violations',
      tone: figures === null ? 'UNKNOWN' : figures.withoutScope > 0 ? 'UNKNOWN' : 'DEMONSTRATED',
      icon: VITAL_ICONS.Star,
    },
    {
      label: 'Unknowns',
      value: queue === null ? '—' : String(queue.total),
      tone: queue === null ? 'UNKNOWN' : queue.total > 0 ? 'UNKNOWN' : 'DEMONSTRATED',
    },
  ];

  /** The real surface behind each layer. */
  const surface = (layer: TrustLayer) => {
    switch (layer) {
      case 'observe': return <ProofTab view="observe" live={liveExecutions} arrivedIds={arrivedIds} connected={connected} onOpenRecord={setOpenRecordId} />;
      case 'verify': return <><ProofTab view="verify" onOpenRecord={setOpenRecordId} /><Audit /></>;
      case 'explain': return <ProofTab view="explain" onOpenRecord={setOpenRecordId} />;
      case 'govern': return <GovernTab />;
      case 'arbitrate': return <ArbitrateLayer />;
      case 'act': return <ActLayer />;
      case 'learn': return <><LearnLayer /><PerformanceTab /></>;
      // The standing views. Not stages — the things the stages act on. They
      // have no orbital node in this shell, so the command palette is how you
      // reach them, and TAB_CONFIG below is what names them.
      case 'evidence' as TrustLayer: return <><GlobalView /><AttentionPanel /></>;
      case 'agents' as TrustLayer: return <Agents onOpenRecord={setOpenRecordId} />;
      case 'policies' as TrustLayer: return <><ConstraintsPanel /><Obligations /></>;
      case 'unknowns' as TrustLayer: return <UnknownsPanel />;
      case 'console' as TrustLayer: return <AIStudioTab />;
      case 'system' as TrustLayer: return <MachineRoom services={services} error={error} />;
      case 'settings' as TrustLayer: return <SettingsTab services={services} />;
      default: return null;
    }
  };

  return (
    <div className={cn(theme)}>
      <TrustOperationsCenter
        readings={readings}
        vitals={vitals}
        connected={connected}
        version={__APP_VERSION__}
        surface={surface}
        onLayerChange={(layer: TrustLayer) => setActiveTab(layer === 'overview' ? null : (layer as TabId))}
        /* TAB_CONFIG names all thirteen views; check-ui-philosophy reads it. */
        views={TAB_CONFIG.map(tab => ({ id: tab.id, label: tab.label, question: tab.question }))}
        onOpenRecord={setOpenRecordId}
      />

      {error && (
        /*
         * Two different situations were wearing the same red notice.
         *
         * "A service is not answering" is correct when there is an instance and
         * one part of it has stopped responding. It is misleading when there is
         * no instance at all — a copy of this interface opened with nothing
         * behind it, where every call fails because there is nothing to call.
         * That is not a fault, it is an unconnected console, and reporting it
         * as a failure makes a working product look broken to anyone you show
         * it to.
         *
         * The two are distinguishable by whether anything at all has answered:
         * the socket is down and not one service is up. A partial failure still
         * has something responding and still deserves the red card.
         *
         * Bottom-right, not bottom-centre — centred it covered Arbitrate and
         * Govern, the two stations most likely to matter when something has
         * stopped answering.
         */
        <div className="fixed bottom-8 right-6 z-50 max-w-sm w-[92%] sm:w-auto">
          {!connected && services.every(service => service.status !== 'up') ? (
            <NoticeCard
              tone="info"
              title="No instance connected"
              message="This is the Trust Operations Center with nothing behind it. Every reading shows UNKNOWN because nothing has been asked, not because anything failed — the room will not invent a figure to fill a gap. Point it at a running ABSuite instance and the same screen fills with real evidence."
            />
          ) : (
            <NoticeCard
              tone="error"
              title="A service is not answering"
              message={`${error} Nothing is being substituted — a service that cannot be reached is reported as unreachable, not as healthy and not as down.`}
            />
          )}
        </div>
      )}

      <AnimatePresence>
        {openRecordId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[60] bg-ab-bg/97 backdrop-blur-md overflow-y-auto px-8 py-6"
          >
            <button
              type="button"
              onClick={() => setOpenRecordId(null)}
              className="text-[10px] font-mono uppercase tracking-[0.24em] text-ab-white/40 hover:text-ab-green transition-colors mb-4"
            >
              ← back
            </button>
            <RecordDetail id={openRecordId} onClose={() => setOpenRecordId(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
