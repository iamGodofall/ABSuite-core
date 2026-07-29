/**
 * Trust HTTP server — events, scoring, verification, monitoring, arbitration
 * and reciprocal contracts.
 *
 * Every route is guarded by the same `capabilityGuard` the rest of the suite
 * uses, because a service that grades other services is exactly the one you do
 * not want reachable without a token.
 */
import express from 'express';
import { capabilityGuard, revocationStoreFromEnv, createServiceMetrics, getStorage } from '@absuitecore/capkit';
import { TrustEventStore, type SubjectType, type TrustEventKind } from './events';
import { TrustScorer } from './scoring';
import { verifyOutput, findingsToEventKinds, renderReport } from './verification';
import { InteractionMonitor } from './monitoring';
import { ArbitrationStore, arbitrate, type Position } from './arbitration';
import { ReciprocalTrust, STANDARD_OBLIGATIONS, type ObligationId } from './reciprocal';

const PORT = Number(process.env.TRUST_PORT || process.env.PORT || 8085);
const STARTED_AT = Date.now();

const storage = getStorage();
const events = new TrustEventStore(storage);
const scorer = new TrustScorer(events);
const monitor = new InteractionMonitor(storage);
const disputes = new ArbitrationStore(storage);
const contracts = new ReciprocalTrust(storage, events);
const metrics = createServiceMetrics('trust');

const SUBJECT_TYPES: SubjectType[] = ['agent', 'human', 'system', 'model'];

const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const startedAt = performance.now();
  res.on('finish', () => {
    const route = req.path.split('/').slice(0, 3).join('/') || '/';
    metrics.increment('absuite_requests_total', { service: 'trust', route, status: res.statusCode });
    metrics.observe('absuite_request_duration_ms', performance.now() - startedAt, { service: 'trust', route });
  });
  return next();
});

const requireCapability = capabilityGuard({ revocations: revocationStoreFromEnv() });

function fail(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function asSubjectType(value: unknown): SubjectType | undefined {
  return SUBJECT_TYPES.includes(value as SubjectType) ? (value as SubjectType) : undefined;
}

// ---- Operational ----

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'trust',
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    humanScoringEnabled: scorer.humansScorable,
  });
});

app.get('/ready', (_req, res) => {
  try {
    storage.get('SELECT 1 AS ok');
    res.status(200).json({ ready: true });
  } catch (error) {
    res.status(503).json({ ready: false, reason: (error as Error).message });
  }
});

app.get('/metrics', (_req, res) => {
  metrics.set('absuite_uptime_seconds', Math.floor((Date.now() - STARTED_AT) / 1000), { service: 'trust' });
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(metrics.render());
});

// ---- Events ----

/** Record a trust event. Every event should point at an artefact that proves it. */
app.post('/events', requireCapability('trust:write'), (req, res) => {
  const { subjectId, subjectType, kind, evidenceRef, note, at } = req.body ?? {};

  if (!subjectId || !kind) return fail(res, 400, 'INVALID_REQUEST', 'subjectId and kind are required');
  const type = asSubjectType(subjectType);
  if (!type) return fail(res, 400, 'INVALID_REQUEST', `subjectType must be one of: ${SUBJECT_TYPES.join(', ')}`);

  try {
    const event = events.record({ subjectId, subjectType: type, kind: kind as TrustEventKind, evidenceRef, note, at });
    return res.status(201).json(event);
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.get('/events/:subjectId', requireCapability('trust:read'), (req, res) => {
  const since = req.query.since ? String(req.query.since) : undefined;
  const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
  return res.status(200).json({
    subjectId: String(req.params.subjectId),
    events: events.forSubject(String(req.params.subjectId), { ...(since ? { since } : {}), ...(limit ? { limit } : {}) }),
  });
});

/**
 * Appeal an event. Contestability is not a feature flag — a score nobody can
 * challenge is a blacklist.
 */
app.post('/events/:eventId/appeal', requireCapability('trust:appeal'), (req, res) => {
  const { raisedBy, reason } = req.body ?? {};
  if (!raisedBy || !reason) return fail(res, 400, 'INVALID_REQUEST', 'raisedBy and reason are required');

  try {
    return res.status(201).json(events.appeal(String(req.params.eventId), raisedBy, reason));
  } catch (error) {
    return fail(res, 404, 'NOT_FOUND', (error as Error).message);
  }
});

app.post('/appeals/:appealId/decide', requireCapability('trust:manage'), (req, res) => {
  const { decidedBy, upheld, decision } = req.body ?? {};
  if (!decidedBy || typeof upheld !== 'boolean' || !decision) {
    return fail(res, 400, 'INVALID_REQUEST', 'decidedBy, upheld and decision are required');
  }

  try {
    return res.status(200).json(events.decideAppeal(String(req.params.appealId), decidedBy, upheld, decision));
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.get('/events/:eventId/appeals', requireCapability('trust:read'), (req, res) => {
  return res.status(200).json({ appeals: events.appealsFor(String(req.params.eventId)) });
});

// ---- Scoring ----

app.get('/score/:subjectId', requireCapability('trust:read'), (req, res) => {
  const type = asSubjectType(req.query.subjectType ?? 'agent');
  if (!type) return fail(res, 400, 'INVALID_REQUEST', `subjectType must be one of: ${SUBJECT_TYPES.join(', ')}`);

  try {
    return res.status(200).json(scorer.score(String(req.params.subjectId), type));
  } catch (error) {
    // Human scoring is disabled by default; that is a policy refusal, not a
    // bug, and the caller is pointed at the endpoint that answers honestly.
    return res.status(403).json({
      error: { code: 'SCORING_DISABLED', message: (error as Error).message },
      useInstead: `/evidence/${encodeURIComponent(String(req.params.subjectId))}?subjectType=human`,
    });
  }
});

/**
 * What was recorded about a subject, as facts — no score, no ranking, no
 * conclusion. Available for every subject type including humans, because
 * counting what happened is not the same act as rating someone.
 */
app.get('/evidence/:subjectId', requireCapability('trust:read'), (req, res) => {
  const type = asSubjectType(req.query.subjectType ?? 'agent');
  if (!type) return fail(res, 400, 'INVALID_REQUEST', `subjectType must be one of: ${SUBJECT_TYPES.join(', ')}`);

  return res.status(200).json(scorer.evidence(String(req.params.subjectId), type));
});

app.get('/scores', requireCapability('trust:read'), (req, res) => {
  const type = req.query.subjectType === undefined ? undefined : asSubjectType(req.query.subjectType);
  return res.status(200).json({ scores: scorer.scoreAll(type) });
});

/**
 * Ask whether a subject clears a threshold. Returns `allowed: true` whenever
 * gating is disabled — advisory scores must never deny anyone access.
 */
app.post('/score/:subjectId/check', requireCapability('trust:read'), (req, res) => {
  const type = asSubjectType(req.body?.subjectType ?? 'agent');
  const threshold = Number(req.body?.threshold);

  if (!type) return fail(res, 400, 'INVALID_REQUEST', `subjectType must be one of: ${SUBJECT_TYPES.join(', ')}`);
  if (!Number.isFinite(threshold)) return fail(res, 400, 'INVALID_REQUEST', 'A numeric threshold is required');

  try {
    return res.status(200).json(scorer.check(String(req.params.subjectId), type, threshold));
  } catch (error) {
    return fail(res, 403, 'SCORING_DISABLED', (error as Error).message);
  }
});

// ---- Verification ----

/**
 * Check an output against the sources it was meant to be grounded in.
 * Returns risk signals, not a truth verdict — see the disclaimer in the body.
 */
app.post('/verify', requireCapability('trust:verify'), (req, res) => {
  const { output, sources, subjectId, subjectType, groundingThreshold } = req.body ?? {};
  if (typeof output !== 'string' || !output.trim()) {
    return fail(res, 400, 'INVALID_REQUEST', 'output must be a non-empty string');
  }

  const report = verifyOutput(
    output,
    Array.isArray(sources) ? sources.map(String) : [],
    Number.isFinite(Number(groundingThreshold)) ? { groundingThreshold: Number(groundingThreshold) } : {}
  );

  // Recording is opt-in: verification is often run exploratorily, and every
  // trial run marking a subject's permanent record would poison the evidence.
  const recorded: string[] = [];
  const type = asSubjectType(subjectType ?? 'agent');
  if (subjectId && type) {
    for (const kind of findingsToEventKinds(report)) {
      recorded.push(events.record({ subjectId, subjectType: type, kind, note: `Verification: ${report.findings.length} finding(s)` }).id);
    }
  }

  // `text/plain` returns the claim/evidence/status form, which is what goes in
  // a ticket or an audit bundle and needs no schema to read.
  if (String(req.get('accept') || '').includes('text/plain')) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(renderReport(report));
  }

  return res.status(200).json({ ...report, ...(recorded.length ? { recordedEvents: recorded } : {}) });
});

// ---- Monitoring ----

app.post('/interactions', requireCapability('trust:write'), (req, res) => {
  const { chainId, sourceAgent, targetAgent, kind, payloadHash, traceRef, introducedClaim, note } = req.body ?? {};
  if (!chainId || !sourceAgent || !targetAgent || !kind) {
    return fail(res, 400, 'INVALID_REQUEST', 'chainId, sourceAgent, targetAgent and kind are required');
  }

  try {
    return res.status(201).json(monitor.record({ chainId, sourceAgent, targetAgent, kind, payloadHash, traceRef, introducedClaim, note }));
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

/** Attach an observer's opinion. Stored as an opinion, never promoted to truth. */
app.post('/interactions/:interactionId/observe', requireCapability('trust:write'), (req, res) => {
  const { observerAgent, verdict, reason, confidence } = req.body ?? {};
  if (!observerAgent || !verdict || !reason) {
    return fail(res, 400, 'INVALID_REQUEST', 'observerAgent, verdict and reason are required');
  }

  try {
    return res.status(201).json(monitor.observe({ interactionId: String(req.params.interactionId), observerAgent, verdict, reason, confidence }));
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.get('/chains', requireCapability('trust:read'), (req, res) => {
  return res.status(200).json({ chains: monitor.chains(Number(req.query.limit) || 50) });
});

app.get('/chains/:chainId', requireCapability('trust:read'), (req, res) => {
  const summary = monitor.summarise(String(req.params.chainId));
  if (!summary) return fail(res, 404, 'NOT_FOUND', 'No such chain');

  return res.status(200).json({ ...summary, interactionLog: monitor.chain(String(req.params.chainId)) });
});

/** Every structural anomaly across recent chains — cycles, runaways, stalls, disagreement. */
app.get('/anomalies', requireCapability('trust:read'), (req, res) => {
  return res.status(200).json({ anomalies: monitor.scan(Number(req.query.limit) || 50) });
});

// ---- Arbitration ----

app.post('/disputes', requireCapability('trust:arbitrate'), (req, res) => {
  const { question, positions, irreversible, domain } = req.body ?? {};
  if (!question) return fail(res, 400, 'INVALID_REQUEST', 'question is required');
  if (!Array.isArray(positions) || positions.length === 0) {
    return fail(res, 400, 'INVALID_REQUEST', 'positions must be a non-empty array');
  }

  try {
    return res.status(201).json(disputes.open({ question, positions: positions as Position[], irreversible: Boolean(irreversible), domain }));
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

/**
 * Arbitrate. Agreement between participants of the same model family is
 * discounted, and an irreversible dispute always escalates to a human.
 */
app.post('/disputes/:disputeId/arbitrate', requireCapability('trust:arbitrate'), (req, res) => {
  try {
    return res.status(200).json(disputes.resolve(String(req.params.disputeId), { scorer }));
  } catch (error) {
    return fail(res, 404, 'NOT_FOUND', (error as Error).message);
  }
});

/** Arbitrate without storing anything — for callers evaluating the thresholds. */
app.post('/arbitrate', requireCapability('trust:arbitrate'), (req, res) => {
  const { question, positions, irreversible, domain } = req.body ?? {};
  if (!Array.isArray(positions)) return fail(res, 400, 'INVALID_REQUEST', 'positions must be an array');

  return res.status(200).json(arbitrate({
    id: 'ephemeral',
    question: String(question ?? ''),
    positions: positions as Position[],
    ...(irreversible ? { irreversible: true } : {}),
    ...(domain ? { domain: String(domain) } : {}),
    createdAt: new Date().toISOString(),
  }, { scorer }));
});

app.get('/disputes', requireCapability('trust:read'), (req, res) => {
  return res.status(200).json({ disputes: disputes.list(Number(req.query.limit) || 50) });
});

/** Disputes waiting on a human decision. */
app.get('/disputes/pending', requireCapability('trust:read'), (_req, res) => {
  return res.status(200).json({ disputes: disputes.pending() });
});

app.get('/disputes/:disputeId', requireCapability('trust:read'), (req, res) => {
  const dispute = disputes.get(String(req.params.disputeId));
  if (!dispute) return fail(res, 404, 'NOT_FOUND', 'No such dispute');
  return res.status(200).json(dispute);
});

app.post('/disputes/:disputeId/decide', requireCapability('trust:manage'), (req, res) => {
  const { decidedBy, answer } = req.body ?? {};
  if (!decidedBy || answer === undefined) return fail(res, 400, 'INVALID_REQUEST', 'decidedBy and answer are required');

  try {
    return res.status(200).json(disputes.decide(String(req.params.disputeId), decidedBy, String(answer)));
  } catch (error) {
    return fail(res, 404, 'NOT_FOUND', (error as Error).message);
  }
});

// ---- Reciprocal contracts ----

app.get('/obligations', (_req, res) => {
  res.status(200).json({
    obligations: STANDARD_OBLIGATIONS,
    note: 'Five obligations each way. The operator owes the agent as much as the agent owes the operator.',
  });
});

app.post('/contracts', requireCapability('trust:manage'), (req, res) => {
  const { agentId, operatorId, responseWindowHours } = req.body ?? {};
  if (!agentId || !operatorId) return fail(res, 400, 'INVALID_REQUEST', 'agentId and operatorId are required');

  return res.status(201).json(contracts.establish(agentId, operatorId, { responseWindowHours }));
});

app.get('/contracts', requireCapability('trust:read'), (req, res) => {
  return res.status(200).json({ contracts: contracts.list(Number(req.query.limit) || 100) });
});

app.get('/contracts/:contractId', requireCapability('trust:read'), (req, res) => {
  const contract = contracts.get(String(req.params.contractId));
  if (!contract) return fail(res, 404, 'NOT_FOUND', 'No such contract');
  return res.status(200).json(contract);
});

/**
 * Record a breach by either party. An operator breach is never charged to the
 * agent's score — attributing a failure to the component that cannot fix it is
 * the exact defect this framework exists to remove.
 */
app.post('/contracts/:contractId/breach', requireCapability('trust:write'), (req, res) => {
  const { obligationId, detail, evidenceRef } = req.body ?? {};
  if (!obligationId || !detail) return fail(res, 400, 'INVALID_REQUEST', 'obligationId and detail are required');

  try {
    return res.status(201).json(contracts.recordBreach(String(req.params.contractId), obligationId as ObligationId, detail, evidenceRef));
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.post('/breaches/:breachId/remediate', requireCapability('trust:write'), (req, res) => {
  const { remediation } = req.body ?? {};
  if (!remediation) return fail(res, 400, 'INVALID_REQUEST', 'remediation is required');

  try {
    return res.status(200).json(contracts.remediate(String(req.params.breachId), remediation));
  } catch (error) {
    return fail(res, 404, 'NOT_FOUND', (error as Error).message);
  }
});

/** Whose fault the failures actually are. Usually the most useful call here. */
app.get('/contracts/:contractId/health', requireCapability('trust:read'), (req, res) => {
  try {
    return res.status(200).json(contracts.health(String(req.params.contractId)));
  } catch (error) {
    return fail(res, 404, 'NOT_FOUND', (error as Error).message);
  }
});

app.post('/contracts/:contractId/suspend', requireCapability('trust:manage'), (req, res) => {
  const { reason } = req.body ?? {};
  if (!reason) return fail(res, 400, 'INVALID_REQUEST', 'reason is required');

  try {
    return res.status(200).json(contracts.suspend(String(req.params.contractId), reason));
  } catch (error) {
    return fail(res, 404, 'NOT_FOUND', (error as Error).message);
  }
});

app.post('/contracts/:contractId/reinstate', requireCapability('trust:manage'), (req, res) => {
  try {
    return res.status(200).json(contracts.reinstate(String(req.params.contractId)));
  } catch (error) {
    return fail(res, 404, 'NOT_FOUND', (error as Error).message);
  }
});

app.use((req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

export { app, events, scorer, monitor, disputes, contracts };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[trust] listening on :${PORT}`);
    if (!scorer.humansScorable) {
      console.log('[trust] human subject scoring is disabled (set ABSUITE_TRUST_SCORE_HUMANS=true to enable)');
    }
  });
}
