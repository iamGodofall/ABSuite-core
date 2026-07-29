/**
 * Connector-Starter HTTP server — connector discovery, verification,
 * execution and scaffold generation.
 */
import express from 'express';
import { capabilityGuard, revocationStoreFromEnv, createServiceMetrics } from '@absuitecore/capkit';
import { describeConnectors, getConnector, verifyConnector, runAction } from './connectors';
import { generate } from './scaffold';

const PORT = Number(process.env.CONNECTOR_STARTER_PORT || process.env.PORT || 8084);
const STARTED_AT = Date.now();
const metrics = createServiceMetrics('connector-starter');

const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  const startedAt = performance.now();
  res.on('finish', () => {
    const route = req.path.split('/').slice(0, 3).join('/') || '/';
    metrics.increment('absuite_requests_total', { service: 'connector-starter', route, status: res.statusCode });
    metrics.observe('absuite_request_duration_ms', performance.now() - startedAt, { service: 'connector-starter', route });
  });
  return next();
});

const requireCapability = capabilityGuard({ revocations: revocationStoreFromEnv() });

function fail(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

app.get('/health', (_req, res) => {
  const connectors = describeConnectors();
  res.status(200).json({
    status: 'healthy',
    service: 'connector-starter',
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    connectors: connectors.length,
    configured: connectors.filter(connector => connector.configured).map(connector => connector.id),
  });
});

app.get('/ready', (_req, res) => {
  res.status(200).json({ ready: true });
});

app.get('/metrics', (_req, res) => {
  metrics.set('absuite_uptime_seconds', Math.floor((Date.now() - STARTED_AT) / 1000), { service: 'connector-starter' });
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(metrics.render());
});

app.get('/connectors', (_req, res) => {
  res.status(200).json({ connectors: describeConnectors() });
});

app.get('/connectors/:id', (req, res) => {
  const connector = getConnector(String(req.params.id));
  if (!connector) return fail(res, 404, 'NOT_FOUND', 'Unknown connector');

  const described = describeConnectors().find(candidate => candidate.id === connector.id);
  return res.status(200).json(described);
});

/** Read-only credential check — never performs a write. */
app.post('/connectors/:id/verify', requireCapability('connector:read'), async (req, res) => {
  const result = await verifyConnector(String(req.params.id));
  return res.status(result.ok ? 200 : 503).json({
    connector: req.params.id,
    ...result,
  });
});

app.post('/connectors/:id/actions/:action', requireCapability('connector:execute'), async (req, res) => {
  const result = await runAction(String(req.params.id), String(req.params.action), req.body ?? {});
  if (!result.ok) {
    const status = /unknown connector|unknown action/i.test(result.error ?? '') ? 404
      : /missing required input|must be https/i.test(result.error ?? '') ? 400
      : 502;
    return res.status(status).json({ connector: req.params.id, action: req.params.action, ...result });
  }
  return res.status(200).json({ connector: req.params.id, action: req.params.action, ...result });
});

app.post('/generate', (req, res) => {
  const description = String(req.body?.prompt ?? req.body?.description ?? '').trim();
  if (!description) return fail(res, 400, 'INVALID_REQUEST', 'A prompt or description is required');

  try {
    const generated = generate(description);
    return res.status(200).json({
      success: true,
      source: generated.source,
      // `config` keeps the dashboard's existing contract working.
      config: generated.manifest,
      manifest: generated.manifest,
      typescript: generated.typescript,
      spec: generated.spec,
    });
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.use((req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

export { app };

if (require.main === module) {
  app.listen(PORT, () => console.log(`[connector-starter] listening on :${PORT}`));
}
