/**
 * Layer 1 — Identity. Who is acting, and can they prove it.
 *
 * The layer was marked *partly built* against `keyring.ts`, which is the ring of
 * secrets **this server** signs with. That is the server's identity, not the
 * agent's, and the gap between those two was doing real damage:
 *
 *   `subject` was a string the caller typed.
 *
 * Anyone holding an admin key could record `subject: "agent:cfo"` and the
 * condition report would answer **Identity: DEMONSTRATED** — because the check
 * behind it was "does the server's own signature verify", which is always true
 * for a record the server just wrote. It proved authorship of the record and was
 * read as attribution of the act. That is a false DEMONSTRATED on the strongest
 * word this system has, in the layer everything else rests on, and it is exactly
 * the failure the product exists to refuse everywhere else.
 *
 * What identity means here, and nothing more:
 *
 *   An enrolled subject holds an Ed25519 private key. To obtain a capability
 *   token in its name, it signs a single-use challenge. The server verifies that
 *   against the public key recorded at enrolment. The token's `sub` is then
 *   *earned* rather than asserted, and every execution carried out under it
 *   inherits that proof.
 *
 * Three rules make it worth having:
 *
 * **Enrolment is optional; enforcement is not.** A deployment with no enrolled
 * identities behaves exactly as before and reports Identity as UNKNOWN, which is
 * true. But the moment a subject is enrolled, a token in its name *requires*
 * proof — otherwise enrolment would be a decoration anyone could bypass by
 * simply not proving anything, and an identity that can be impersonated is not
 * an identity.
 *
 * **The private key never arrives here.** Enrolment takes a public key. This
 * server cannot sign as any agent, which is what lets an agent's proof mean
 * something to somebody who does not trust this server.
 *
 * **Suspension is immediate and is not deletion.** A suspended identity stops
 * being able to obtain tokens, and every record it already wrote stays exactly
 * as it was. History is not revised because someone was later distrusted.
 */
import { createPublicKey, createHash, randomBytes, randomUUID, verify as cryptoVerify } from 'node:crypto';
import type { Storage } from './storage';

export type IdentityStatus = 'active' | 'suspended';

/** What kind of thing this is. Recorded, never inferred from the name. */
export type IdentityKind = 'agent' | 'human' | 'service' | 'model';

export const IDENTITY_KINDS: readonly IdentityKind[] = ['agent', 'human', 'service', 'model'];

export interface Identity {
  subject: string;
  publicKeyPem: string;
  kind: IdentityKind;
  status: IdentityStatus;
  label?: string;
  enrolledAt: string;
  lastProvenAt?: string;
  suspendedAt?: string;
  suspendedReason?: string;
}

/** Thrown when an identity operation cannot be carried out as asked. */
export class IdentityError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

/**
 * How long a challenge stands.
 *
 * Long enough for an agent to sign and come back, short enough that a captured
 * challenge is worthless by the time anyone could use it. Single use regardless
 * — the window is a second line, not the defence.
 */
export const CHALLENGE_TTL_MS = 120_000;

/**
 * What can be said about a subject's identity, in the product's four words.
 *
 * `ABSENT` — no subject at all. `UNKNOWN` — a subject that nobody enrolled, so
 * the name is a label and this system has no opinion on whether it is true.
 * `FAILED` — enrolled and suspended, or a proof that did not verify. Only a
 * subject that proved possession of its enrolled key reaches `DEMONSTRATED`.
 */
export type IdentityAttestation = {
  state: 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';
  because: string;
  enrolled: boolean;
};

export class IdentityRegistry {
  constructor(private readonly storage: Storage) {}

  /**
   * Enrol a subject against a public key it holds the private half of.
   *
   * The key is parsed before anything is written. A malformed PEM stored now is
   * an identity that can never prove itself later, and the failure would surface
   * as "this agent's proof does not verify" — an accusation, for what was a typo
   * at enrolment.
   */
  enrol(input: { subject: string; publicKeyPem: string; kind?: string; label?: string }): Identity {
    const subject = String(input.subject ?? '').trim();
    if (!subject) throw new IdentityError('subject is required to enrol an identity.', 'INVALID_REQUEST');

    const kind = (input.kind ?? 'agent') as IdentityKind;
    if (!IDENTITY_KINDS.includes(kind)) {
      throw new IdentityError(`kind must be one of ${IDENTITY_KINDS.join(', ')}.`, 'INVALID_REQUEST');
    }

    const publicKeyPem = canonicalPublicKey(input.publicKeyPem);

    if (this.get(subject)) {
      // Not overwritten. Re-enrolling under a new key is how an identity would
      // be silently taken over, so replacing a key is a deliberate, separate act.
      throw new IdentityError(
        `${subject} is already enrolled. Rotating its key is a separate, deliberate act — an enrolment that silently replaced a public key would be how an identity is taken over.`,
        'ALREADY_ENROLLED'
      );
    }

    const identity: Identity = {
      subject,
      publicKeyPem,
      kind,
      status: 'active',
      ...(input.label ? { label: String(input.label).trim() } : {}),
      enrolledAt: new Date().toISOString(),
    };

    this.storage.run(
      `INSERT INTO identities (subject, public_key_pem, kind, status, label, enrolled_at)
       VALUES (?,?,?,?,?,?)`,
      identity.subject, identity.publicKeyPem, identity.kind, identity.status,
      identity.label ?? null, identity.enrolledAt
    );

    return identity;
  }

  get(subject: string): Identity | undefined {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM identities WHERE subject = ?', subject);
    return row ? rowToIdentity(row) : undefined;
  }

  list(): Identity[] {
    return this.storage
      .all<Record<string, unknown>>('SELECT * FROM identities ORDER BY enrolled_at DESC')
      .map(rowToIdentity);
  }

  /**
   * Rotate a subject's key.
   *
   * Separate from enrolment on purpose, and it does not touch history: every
   * record signed under the old key stays valid, because the record's own
   * signature is the server's and the proof was verified at the time it was
   * given. What changes is which key future proofs are checked against.
   */
  rotate(subject: string, publicKeyPem: string): Identity {
    const existing = this.requireIdentity(subject);
    const pem = canonicalPublicKey(publicKeyPem);
    if (pem === existing.publicKeyPem) {
      throw new IdentityError('That is the key already on file. A rotation to the same key is not a rotation.', 'INVALID_REQUEST');
    }

    this.storage.run('UPDATE identities SET public_key_pem = ? WHERE subject = ?', pem, subject);
    return { ...existing, publicKeyPem: pem };
  }

  /** Stop this subject obtaining tokens. Nothing it already did is altered. */
  suspend(subject: string, reason: string): Identity {
    const existing = this.requireIdentity(subject);
    const stated = String(reason ?? '').trim();
    if (!stated) {
      // A suspension with no reason is an unexplained loss of access that
      // somebody has to reconstruct later from memory.
      throw new IdentityError('A reason is required to suspend an identity. Access removed without a stated cause cannot be reviewed.', 'INVALID_REQUEST');
    }

    const suspendedAt = new Date().toISOString();
    this.storage.run(
      'UPDATE identities SET status = ?, suspended_at = ?, suspended_reason = ? WHERE subject = ?',
      'suspended', suspendedAt, stated, subject
    );
    return { ...existing, status: 'suspended', suspendedAt, suspendedReason: stated };
  }

  reinstate(subject: string): Identity {
    const existing = this.requireIdentity(subject);
    this.storage.run(
      'UPDATE identities SET status = ?, suspended_at = NULL, suspended_reason = NULL WHERE subject = ?',
      'active', subject
    );
    const { suspendedAt, suspendedReason, ...rest } = existing;
    return { ...rest, status: 'active' };
  }

  /**
   * Issue a single-use challenge for a subject to sign.
   *
   * The nonce is random and stored server-side; nothing about it is derived from
   * the subject, so one identity's challenge tells you nothing about another's.
   */
  /*
   * Accepted, and written down rather than left for someone to find.
   *
   * This distinguishes an enrolled subject from an unknown one — 200 against
   * 404 — so anyone who can reach the endpoint can test whether a name is
   * enrolled. That is a real information disclosure and it is accepted, because
   * the alternatives are worse: a uniform response would replace "no identity is
   * enrolled for X" with silence at the exact moment an operator is debugging
   * their first enrolment, and subject names here are not secrets — they are
   * things like `agent:invoicing`, which appear in every record the log emits.
   *
   * What the endpoint does not do is leak anything usable: a nonce grants
   * nothing, and only the holder of the private key can turn one into authority.
   * The global rate limiter bounds how fast it can be probed.
   */
  challenge(subject: string): { subject: string; nonce: string; expiresAt: string } {
    const identity = this.requireIdentity(subject);
    if (identity.status === 'suspended') {
      throw new IdentityError(
        `${subject} is suspended: ${identity.suspendedReason ?? 'no reason recorded'}. A suspended identity cannot obtain a challenge.`,
        'IDENTITY_SUSPENDED'
      );
    }

    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

    this.storage.run(
      'INSERT INTO identity_challenges (nonce, subject, expires_at) VALUES (?,?,?)',
      nonce, subject, expiresAt
    );

    // Opportunistic sweep. Expired challenges are worthless and unbounded growth
    // in a table nobody reads is how a small feature becomes an outage.
    this.storage.run('DELETE FROM identity_challenges WHERE expires_at < ?', new Date().toISOString());

    return { subject, nonce, expiresAt };
  }

  /**
   * Verify that a subject signed its challenge with the enrolled key.
   *
   * The nonce is consumed whether or not the signature verifies. A challenge
   * that survives a failed attempt is a challenge an attacker may retry against
   * for as long as it lives.
   */
  prove(subject: string, nonce: string, signatureBase64: string): { subject: string; provenAt: string } {
    const identity = this.requireIdentity(subject);
    if (identity.status === 'suspended') {
      throw new IdentityError(`${subject} is suspended: ${identity.suspendedReason ?? 'no reason recorded'}.`, 'IDENTITY_SUSPENDED');
    }

    const row = this.storage.get<Record<string, unknown>>(
      'SELECT * FROM identity_challenges WHERE nonce = ?', String(nonce ?? '')
    );
    if (!row) throw new IdentityError('No such challenge. Request one, sign it, and present it once.', 'CHALLENGE_UNKNOWN');

    /*
     * Consumed by deletion, before the signature is even looked at.
     *
     * There was a `used` flag here and a check against it, and nothing ever set
     * it — the row was deleted instead, so the check could never fire. A dead
     * branch that reads like a replay defence is worse than no branch at all,
     * because the next person to read this file believes the check is running.
     * Deletion is the defence; a replay now fails as CHALLENGE_UNKNOWN, which is
     * the truth about a nonce that no longer exists.
     */
    this.storage.run('DELETE FROM identity_challenges WHERE nonce = ?', String(nonce));

    if (String(row.subject) !== subject) {
      throw new IdentityError('That challenge was issued to a different subject.', 'CHALLENGE_MISMATCH');
    }
    if (String(row.expires_at) < new Date().toISOString()) {
      throw new IdentityError('That challenge has expired. Request another.', 'CHALLENGE_EXPIRED');
    }

    const ok = verifyDetached(String(nonce), String(signatureBase64 ?? ''), identity.publicKeyPem);
    if (!ok) {
      throw new IdentityError(
        `The signature does not verify against the public key enrolled for ${subject}. Either it was signed by a different key, or this is not that subject.`,
        'PROOF_INVALID'
      );
    }

    const provenAt = new Date().toISOString();
    this.storage.run('UPDATE identities SET last_proven_at = ? WHERE subject = ?', provenAt, subject);
    return { subject, provenAt };
  }

  /**
   * Record that a token was issued against a proven identity.
   *
   * Stored by token id so a record written weeks later can still be asked
   * whether the authority behind it was ever tied to a proven subject. The jti
   * is hashed: this table would otherwise be a list of live credential
   * identifiers, and a read-only leak of it should not be a leak of those.
   */
  bindToken(jti: string, subject: string, proven: boolean): void {
    if (!jti) return;
    this.storage.run(
      'INSERT OR REPLACE INTO identity_tokens (jti_hash, subject, proven, issued_at) VALUES (?,?,?,?)',
      hashJti(jti), subject, proven ? 1 : 0, new Date().toISOString()
    );
  }

  /** Whether the token behind a record was issued to a subject that proved itself. */
  tokenWasProven(jti?: string): boolean | undefined {
    if (!jti) return undefined;
    const row = this.storage.get<Record<string, unknown>>(
      'SELECT proven FROM identity_tokens WHERE jti_hash = ?', hashJti(jti)
    );
    return row ? Number(row.proven) === 1 : undefined;
  }

  /**
   * What can honestly be said about a subject, in the product's four words.
   *
   * Note what does *not* appear: a valid record signature. That proves this
   * server wrote the record, which is a fact about us and was previously being
   * reported as a fact about the actor.
   */
  attest(subject?: string, jti?: string): IdentityAttestation {
    const named = String(subject ?? '').trim();
    if (!named) {
      return { state: 'ABSENT', enrolled: false, because: 'No subject was recorded, so there is nothing to attribute this to.' };
    }

    const identity = this.get(named);
    if (!identity) {
      return {
        state: 'UNKNOWN',
        enrolled: false,
        because: `${named} is a name on the record, not an enrolled identity. Nothing here shows that the actor was who the record says. Enrol it with a public key and this becomes checkable.`,
      };
    }

    if (identity.status === 'suspended') {
      return {
        state: 'FAILED',
        enrolled: true,
        because: `${named} is enrolled but suspended: ${identity.suspendedReason ?? 'no reason recorded'}.`,
      };
    }

    const proven = this.tokenWasProven(jti);
    if (proven === true) {
      return {
        state: 'DEMONSTRATED',
        enrolled: true,
        because: `${named} is enrolled, and the token that authorised this was issued only after it signed a challenge with the key on file.`,
      };
    }

    if (proven === false) {
      return {
        state: 'FAILED',
        enrolled: true,
        because: `${named} is enrolled, but the token behind this action was issued without proof of possession. An enrolled identity whose authority can be obtained without its key is not an identity.`,
      };
    }

    return {
      state: 'UNKNOWN',
      enrolled: true,
      because: `${named} is enrolled, but this record carries no token id, so the authority behind it cannot be traced to a proven issue.`,
    };
  }

  private requireIdentity(subject: string): Identity {
    const identity = this.get(String(subject ?? '').trim());
    if (!identity) throw new IdentityError(`No identity is enrolled for ${subject}.`, 'IDENTITY_UNKNOWN');
    return identity;
  }
}

/**
 * Validate an Ed25519 public key and return it in one canonical form.
 *
 * Re-exported through `createPublicKey` rather than stored as submitted, so the
 * same key sent with different line endings, indentation or a missing trailing
 * newline is the same identity — not two. An operator comparing what they
 * enrolled against what the API returns should see their key, byte for byte,
 * and two people enrolling the same key should never produce a mismatch that
 * exists only in whitespace.
 *
 * A private key pasted here by mistake is the one input worth naming
 * specifically: it would parse, it would work, and the operator would have
 * handed their signing key to a service that only ever needed the public half.
 */
function canonicalPublicKey(input: unknown): string {
  const pem = String(input ?? '').trim();
  if (!pem) throw new IdentityError('publicKeyPem is required. Enrolment takes the public half only.', 'INVALID_REQUEST');
  if (pem.includes('PRIVATE KEY')) {
    throw new IdentityError(
      'That is a private key. Enrolment takes the public half only — this server must never be able to sign as you, or your proof would mean nothing to anyone who does not trust it.',
      'INVALID_REQUEST'
    );
  }

  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new IdentityError('publicKeyPem is not a readable PEM public key.', 'INVALID_REQUEST');
  }

  if (key.asymmetricKeyType !== 'ed25519') {
    throw new IdentityError(
      `Identity keys are Ed25519; this is ${key.asymmetricKeyType ?? 'an unrecognised type'}. The same algorithm the record chain uses, so one verifier handles both.`,
      'INVALID_REQUEST'
    );
  }

  return key.export({ type: 'spki', format: 'pem' }).toString();
}

function verifyDetached(message: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return cryptoVerify(null, Buffer.from(message, 'utf8'), createPublicKey(publicKeyPem), Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

/** Token ids are held as hashes: this table should not be a list of live credentials. */
function hashJti(jti: string): string {
  return createHash('sha256').update(jti).digest('hex');
}

function rowToIdentity(row: Record<string, unknown>): Identity {
  return {
    subject: String(row.subject),
    publicKeyPem: String(row.public_key_pem),
    kind: String(row.kind) as IdentityKind,
    status: String(row.status) as IdentityStatus,
    ...(row.label ? { label: String(row.label) } : {}),
    enrolledAt: String(row.enrolled_at),
    ...(row.last_proven_at ? { lastProvenAt: String(row.last_proven_at) } : {}),
    ...(row.suspended_at ? { suspendedAt: String(row.suspended_at) } : {}),
    ...(row.suspended_reason ? { suspendedReason: String(row.suspended_reason) } : {}),
  };
}

/** Generate an identity keypair, for `absuite enrol` style bootstrapping. */
export function generateIdentityKeypair(): { privateKeyPem: string; publicKeyPem: string } {
  // Deliberately re-exported from the same primitive the trace chain uses, so an
  // operator learns one key format for the whole product.
  const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** A subject id that is unlikely to collide, for callers that want one. */
export function suggestSubjectId(kind: IdentityKind = 'agent'): string {
  return `${kind}:${randomUUID().slice(0, 8)}`;
}
