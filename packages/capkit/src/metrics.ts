/**
 * Prometheus metrics.
 *
 * A tiny in-process registry rather than prom-client: ABSuite exposes a handful
 * of series, and the exposition format is simple enough that owning it avoids a
 * dependency on every service. Enterprise buyers ask for `/metrics` before they
 * ask for features, so this ships by default.
 */

export type LabelSet = Record<string, string | number>;

interface Series {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  values: Map<string, number>;
  /** Histogram only. */
  buckets?: number[];
  sums?: Map<string, number>;
  counts?: Map<string, number>;
}

function labelKey(labels: LabelSet): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map(key => `${key}="${escapeLabel(String(labels[key]))}"`).join(',');
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export class MetricsRegistry {
  private readonly series = new Map<string, Series>();

  counter(name: string, help: string): void {
    if (!this.series.has(name)) {
      this.series.set(name, { name, help, type: 'counter', values: new Map() });
    }
  }

  gauge(name: string, help: string): void {
    if (!this.series.has(name)) {
      this.series.set(name, { name, help, type: 'gauge', values: new Map() });
    }
  }

  histogram(name: string, help: string, buckets = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000]): void {
    if (!this.series.has(name)) {
      this.series.set(name, {
        name, help, type: 'histogram',
        values: new Map(), buckets: [...buckets].sort((a, b) => a - b),
        sums: new Map(), counts: new Map(),
      });
    }
  }

  increment(name: string, labels: LabelSet = {}, amount = 1): void {
    const series = this.series.get(name);
    if (!series) return;
    const key = labelKey(labels);
    series.values.set(key, (series.values.get(key) ?? 0) + amount);
  }

  set(name: string, value: number, labels: LabelSet = {}): void {
    const series = this.series.get(name);
    if (!series) return;
    series.values.set(labelKey(labels), value);
  }

  observe(name: string, value: number, labels: LabelSet = {}): void {
    const series = this.series.get(name);
    if (!series || series.type !== 'histogram' || !series.buckets) return;

    const key = labelKey(labels);
    series.sums!.set(key, (series.sums!.get(key) ?? 0) + value);
    series.counts!.set(key, (series.counts!.get(key) ?? 0) + 1);

    // Prometheus histogram buckets are cumulative: an observation counts in
    // every bucket whose upper bound it falls at or below.
    for (const bucket of series.buckets) {
      if (value <= bucket) {
        const bucketKey = key ? `${key},le="${bucket}"` : `le="${bucket}"`;
        series.values.set(bucketKey, (series.values.get(bucketKey) ?? 0) + 1);
      }
    }
    const infKey = key ? `${key},le="+Inf"` : 'le="+Inf"';
    series.values.set(infKey, (series.values.get(infKey) ?? 0) + 1);
  }

  /** Render in Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];

    for (const series of this.series.values()) {
      lines.push(`# HELP ${series.name} ${series.help}`);
      lines.push(`# TYPE ${series.name} ${series.type}`);

      for (const [key, value] of series.values) {
        lines.push(key ? `${series.name}${series.type === 'histogram' ? '_bucket' : ''}{${key}} ${value}` : `${series.name} ${value}`);
      }

      if (series.type === 'histogram') {
        for (const [key, sum] of series.sums ?? []) {
          lines.push(key ? `${series.name}_sum{${key}} ${sum}` : `${series.name}_sum ${sum}`);
        }
        for (const [key, count] of series.counts ?? []) {
          lines.push(key ? `${series.name}_count{${key}} ${count}` : `${series.name}_count ${count}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.series.clear();
  }
}

/** Registry with the series every ABSuite service reports. */
export function createServiceMetrics(service: string): MetricsRegistry {
  const registry = new MetricsRegistry();

  registry.counter('absuite_requests_total', 'Total HTTP requests handled');
  registry.counter('absuite_auth_decisions_total', 'Authorisation decisions by outcome');
  registry.counter('absuite_quota_rejections_total', 'Requests rejected for exceeding a plan quota');
  registry.histogram('absuite_request_duration_ms', 'HTTP request duration in milliseconds');
  registry.gauge('absuite_up', 'Whether the service is up');
  registry.gauge('absuite_uptime_seconds', 'Service uptime in seconds');

  registry.set('absuite_up', 1, { service });
  return registry;
}
