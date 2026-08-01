/**
 * Verify's fourth target: is this the model whose behaviour was approved?
 *
 * Verify already answers "has any of it been altered?" about three things — the
 * input, the output, and the chain. Model internals are the fourth, and the
 * framing that survives scrutiny is deliberately *not* "what was the model
 * thinking".
 *
 * That refusal is written down in docs/internal/INTERPRETABILITY.md and holds
 * here. A Jacobian-lens readout is a linear approximation fitted on a corpus,
 * decoded into ranked vocabulary tokens; it can never be DEMONSTRATED because
 * there is no ground truth to check it against. Building a layer whose every
 * reading is permanently UNKNOWN would be building a decoration.
 *
 * The governance question underneath it is entirely checkable, and it is the one
 * an operator actually has an interest in:
 *
 *     You approved a model. Is the thing answering you still that model?
 *
 * That needs no claim about cognition. It is the same shape as agent identity —
 * a fingerprint recorded at approval time, and a comparison afterwards — applied
 * to a different subject. Providers silently roll model versions, quantisations
 * change numerics, a proxy can be repointed, and none of those events announce
 * themselves in an execution log.
 *
 * ## What a fingerprint here is, and is not
 *
 * It is a hash over the identifying material the *caller* observed: the provider,
 * the model id, the version or build string, and optionally a digest of weights
 * or of a fixed probe's output. ABSuite does not load models and does not compute
 * this — it records what was reported, exactly as it records cost.
 *
 * So a match means: *the identifying material is byte-identical to what was
 * approved.* A mismatch means: *something in that material changed.* Neither is
 * a statement about behaviour, and the report says so in those words.
 */
import { createHash } from 'node:crypto';
import type { Storage } from './storage';
import type { Determination } from './determination';

export interface ModelFingerprint {
  /** Who serves it: "anthropic", "openai", "ollama", "self-hosted". */
  provider: string;
  /** The model identifier as the provider names it. */
  model: string;
  /** Version, build or snapshot string, when the provider exposes one. */
  version?: string;
  /**
   * A digest of the weights, or of a fixed probe's output — whatever the caller
   * can actually obtain. Optional, because most hosted models expose neither.
   */
  digest?: string;
  /** Anything else identifying, hashed with the rest. Ordered by key. */
  attributes?: Record<string, string>;
}

export interface ApprovedModel {
  /** Stable name for the approval, e.g. "refunds-classifier". */
  name: string;
  fingerprint: ModelFingerprint;
  /** The hash of the fingerprint, which is what comparisons actually use. */
  hash: string;
  approvedAt: string;
  approvedBy: string;
  /** Why it was approved. A change with no stated basis cannot be reviewed. */
  basis: string;
}

export class ModelIdentityError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ModelIdentityError';
  }
}

/**
 * A stable hash of the identifying material.
 *
 * Keys are sorted and absent fields are explicit nulls, so the same model
 * described in a different field order fingerprints identically — and a field
 * that was present at approval and missing later changes the hash, which is
 * correct: losing the version string *is* a change in what you can see.
 */
export function fingerprintHash(fingerprint: ModelFingerprint): string {
  const attributes = Object.keys(fingerprint.attributes ?? {})
    .sort()
    .map(key => [key, fingerprint.attributes![key]!]);

  return createHash('sha256')
    .update(JSON.stringify([
      fingerprint.provider,
      fingerprint.model,
      fingerprint.version ?? null,
      fingerprint.digest ?? null,
      attributes,
    ]))
    .digest('hex');
}

function normalise(input: unknown): ModelFingerprint {
  if (!input || typeof input !== 'object') {
    throw new ModelIdentityError('A fingerprint needs at least a provider and a model.', 'INVALID_REQUEST');
  }
  const { provider, model, version, digest, attributes } = input as Record<string, unknown>;

  if (typeof provider !== 'string' || !provider.trim()) {
    throw new ModelIdentityError('fingerprint.provider is required — who serves this model.', 'INVALID_REQUEST');
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw new ModelIdentityError('fingerprint.model is required — the identifier the provider uses.', 'INVALID_REQUEST');
  }

  const cleanAttributes: Record<string, string> = {};
  if (attributes && typeof attributes === 'object') {
    for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
      cleanAttributes[key] = String(value);
    }
  }

  return {
    provider: provider.trim(),
    model: model.trim(),
    ...(typeof version === 'string' && version.trim() ? { version: version.trim() } : {}),
    ...(typeof digest === 'string' && digest.trim() ? { digest: digest.trim() } : {}),
    ...(Object.keys(cleanAttributes).length > 0 ? { attributes: cleanAttributes } : {}),
  };
}

/** What changed between an approved fingerprint and an observed one. */
export interface ModelDrift {
  field: string;
  approved: string | null;
  observed: string | null;
}

export interface ModelAttestation {
  state: Determination;
  name: string;
  finding: string;
  /** Every field that differs. Empty when nothing does. */
  drift: ModelDrift[];
  /** What this cannot tell you, carried with the answer rather than footnoted. */
  limits: string[];
}

export class ModelRegistry {
  constructor(private readonly storage: Storage) {}

  /**
   * Record that a model was approved, and what it looked like at the time.
   *
   * Approval is a human act and this does not perform it — it records that
   * somebody performed it, who, and on what basis. A registry that implied it
   * had evaluated the model would be making a claim nothing here supports.
   */
  approve(input: { name: string; fingerprint: unknown; approvedBy: string; basis: string }): ApprovedModel {
    const name = String(input.name ?? '').trim();
    if (!name) throw new ModelIdentityError('name is required — what this approval is called.', 'INVALID_REQUEST');

    const approvedBy = String(input.approvedBy ?? '').trim();
    if (!approvedBy) {
      throw new ModelIdentityError(
        'approvedBy is required. An approval with nobody behind it cannot be reviewed, revoked or defended.',
        'INVALID_REQUEST'
      );
    }
    const basis = String(input.basis ?? '').trim();
    if (!basis) {
      throw new ModelIdentityError(
        'basis is required — what this approval rests on. "Approved" with no stated reason is a record that helps nobody later.',
        'INVALID_REQUEST'
      );
    }

    const fingerprint = normalise(input.fingerprint);
    const hash = fingerprintHash(fingerprint);

    if (this.get(name)) {
      throw new ModelIdentityError(
        `${name} is already approved. Approving a different model under the same name is how a swap goes unnoticed — supersede it deliberately.`,
        'ALREADY_APPROVED'
      );
    }

    const approved: ApprovedModel = {
      name, fingerprint, hash,
      approvedAt: new Date().toISOString(),
      approvedBy, basis,
    };

    this.storage.run(
      'INSERT INTO approved_models (name, fingerprint, hash, approved_at, approved_by, basis) VALUES (?,?,?,?,?,?)',
      name, JSON.stringify(fingerprint), hash, approved.approvedAt, approvedBy, basis
    );
    return approved;
  }

  get(name: string): ApprovedModel | undefined {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM approved_models WHERE name = ?', name);
    if (!row) return undefined;
    return {
      name: String(row.name),
      fingerprint: JSON.parse(String(row.fingerprint)) as ModelFingerprint,
      hash: String(row.hash),
      approvedAt: String(row.approved_at),
      approvedBy: String(row.approved_by),
      basis: String(row.basis),
    };
  }

  list(): ApprovedModel[] {
    return this.storage
      .all<Record<string, unknown>>('SELECT name FROM approved_models ORDER BY approved_at DESC')
      .map(row => this.get(String(row.name))!)
      .filter(Boolean);
  }

  /**
   * Replace an approval deliberately, keeping the reason.
   *
   * Separate from `approve` so that a model swap is never something that happens
   * by re-running a setup script. The old fingerprint is not kept here — the
   * record of what was approved when lives in the execution chain, which is the
   * one place it cannot be quietly rewritten.
   */
  supersede(name: string, input: { fingerprint: unknown; approvedBy: string; basis: string }): ApprovedModel {
    const existing = this.get(name);
    if (!existing) throw new ModelIdentityError(`No approval named ${name}.`, 'NOT_FOUND');

    const fingerprint = normalise(input.fingerprint);
    const approvedBy = String(input.approvedBy ?? '').trim();
    const basis = String(input.basis ?? '').trim();
    if (!approvedBy || !basis) {
      throw new ModelIdentityError('Superseding an approval requires approvedBy and basis.', 'INVALID_REQUEST');
    }

    const hash = fingerprintHash(fingerprint);
    const approvedAt = new Date().toISOString();
    this.storage.run(
      'UPDATE approved_models SET fingerprint = ?, hash = ?, approved_at = ?, approved_by = ?, basis = ? WHERE name = ?',
      JSON.stringify(fingerprint), hash, approvedAt, approvedBy, basis, name
    );
    return { name, fingerprint, hash, approvedAt, approvedBy, basis };
  }

  /**
   * Compare what is answering now against what was approved.
   *
   * The four states carry their usual meanings and none of them is a statement
   * about behaviour. `ABSENT` — nothing was approved under that name, so there
   * is nothing to compare. `UNKNOWN` — an approval exists but the caller
   * observed nothing. `FAILED` — the identifying material changed. `DEMONSTRATED`
   * — it is byte-identical to what was approved, which is a fact about strings
   * and not a promise about outputs.
   */
  attest(name: string, observed?: unknown): ModelAttestation {
    const limits = [
      'This compares identifying material, not behaviour. A model that reports the same version can still answer differently.',
      'ABSuite does not load models. Every field here was reported by the caller and is recorded as their claim.',
    ];

    const approved = this.get(name);
    if (!approved) {
      return {
        state: 'ABSENT', name, drift: [], limits,
        finding: `Nothing is approved under the name ${name}, so there is no baseline to compare against.`,
      };
    }
    if (observed === undefined || observed === null) {
      return {
        state: 'UNKNOWN', name, drift: [], limits,
        finding: `${name} was approved on ${approved.approvedAt.slice(0, 10)}, but nothing was observed to compare against it.`,
      };
    }

    let seen: ModelFingerprint;
    try {
      seen = normalise(observed);
    } catch (error) {
      return {
        state: 'UNKNOWN', name, drift: [], limits,
        finding: `The observed fingerprint could not be read: ${(error as Error).message}`,
      };
    }

    if (fingerprintHash(seen) === approved.hash) {
      return {
        state: 'DEMONSTRATED', name, drift: [], limits,
        finding: `The identifying material matches the approval made by ${approved.approvedBy} on ${approved.approvedAt.slice(0, 10)}.`,
      };
    }

    const drift: ModelDrift[] = [];
    const compare = (field: string, a?: string, b?: string) => {
      if ((a ?? null) !== (b ?? null)) drift.push({ field, approved: a ?? null, observed: b ?? null });
    };
    compare('provider', approved.fingerprint.provider, seen.provider);
    compare('model', approved.fingerprint.model, seen.model);
    compare('version', approved.fingerprint.version, seen.version);
    compare('digest', approved.fingerprint.digest, seen.digest);

    const keys = new Set([
      ...Object.keys(approved.fingerprint.attributes ?? {}),
      ...Object.keys(seen.attributes ?? {}),
    ]);
    for (const key of [...keys].sort()) {
      compare(`attributes.${key}`, approved.fingerprint.attributes?.[key], seen.attributes?.[key]);
    }

    return {
      state: 'FAILED', name, drift, limits,
      finding:
        `What is answering is not what was approved. ${drift.length} field(s) differ: ` +
        drift.map(d => `${d.field} was ${d.approved ?? 'absent'}, now ${d.observed ?? 'absent'}`).join('; ') +
        '. This is a governance finding, not a judgement about the new model — it may be better. It was not the one approved.',
    };
  }
}
