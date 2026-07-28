/**
 * Append-only audit log.
 *
 * Entries are held in a bounded ring in memory for fast querying and mirrored
 * to a JSONL file so the record survives a restart. Write failures are
 * swallowed on purpose: losing durability on the audit trail must never take
 * the authorisation path down with it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export type AuditResult = 'allow' | 'deny';

export interface AuditEntry {
  id: string;
  timestamp: string;
  subject: string;
  action: string;
  resource: string;
  result: AuditResult;
  durationMs?: number;
  reason?: string;
  /** Hash of the preceding entry, linking the log into a chain. */
  prevHash?: string;
  /** SHA-256 over this entry's content plus prevHash. */
  hash?: string;
}

const GENESIS_HASH = '0'.repeat(64);

/**
 * Hash an entry together with its predecessor.
 *
 * Any edit to a historical entry changes its hash, which breaks every
 * subsequent link — so tampering is detectable without trusting the storage
 * layer. Fields are serialised in a fixed order so the hash is reproducible.
 */
export function hashEntry(entry: Omit<AuditEntry, 'hash'>): string {
  const canonical = JSON.stringify([
    entry.id,
    entry.timestamp,
    entry.subject,
    entry.action,
    entry.resource,
    entry.result,
    entry.durationMs ?? null,
    entry.reason ?? null,
    entry.prevHash ?? GENESIS_HASH,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export interface AuditQuery {
  limit?: number;
  offset?: number;
  subject?: string;
  action?: string;
  result?: string;
  from?: string;
  to?: string;
}

const MAX_IN_MEMORY_ENTRIES = 5000;

export class AuditLog {
  private entries: AuditEntry[] = [];

  constructor(private readonly filePath?: string) {
    if (filePath) {
      this.ensureDirectory(filePath);
      this.loadFromDisk(filePath);
    }
  }

  record(entry: Omit<AuditEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): AuditEntry {
    const previous = this.entries[this.entries.length - 1];
    const unhashed: Omit<AuditEntry, 'hash'> = {
      id: entry.id ?? randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      subject: entry.subject,
      action: entry.action,
      resource: entry.resource,
      result: entry.result,
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      ...(entry.reason ? { reason: entry.reason } : {}),
      prevHash: previous?.hash ?? GENESIS_HASH,
    };

    const complete: AuditEntry = { ...unhashed, hash: hashEntry(unhashed) };

    this.entries.push(complete);
    if (this.entries.length > MAX_IN_MEMORY_ENTRIES) {
      this.entries = this.entries.slice(-MAX_IN_MEMORY_ENTRIES);
    }

    if (this.filePath) {
      try {
        appendFileSync(this.filePath, `${JSON.stringify(complete)}\n`, 'utf8');
      } catch {
        // Durability is best-effort; the in-memory record still stands.
      }
    }

    return complete;
  }

  query(options: AuditQuery = {}): { entries: AuditEntry[]; total: number; limit: number; offset: number } {
    // Treat absent, non-numeric and non-positive values alike as "use the
    // default" — clamping a negative limit up to 1 would silently return a
    // single row instead of a page.
    const rawLimit = Number(options.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 50;

    const rawOffset = Number(options.offset);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

    const fromTime = options.from ? Date.parse(options.from) : undefined;
    const toTime = options.to ? Date.parse(options.to) : undefined;

    const filtered = this.entries.filter(entry => {
      if (options.subject && entry.subject !== options.subject) return false;
      if (options.action && entry.action !== options.action) return false;
      if (options.result && entry.result !== options.result) return false;

      if (fromTime !== undefined && !Number.isNaN(fromTime)) {
        if (Date.parse(entry.timestamp) < fromTime) return false;
      }
      if (toTime !== undefined && !Number.isNaN(toTime)) {
        if (Date.parse(entry.timestamp) > toTime) return false;
      }
      return true;
    });

    // Newest first — the order an operator actually wants to read.
    const ordered = [...filtered].reverse();

    return {
      entries: ordered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Walk the chain and report the first entry that does not verify.
   *
   * `brokenAt` is the index of the entry whose content or link no longer
   * matches — that is the evidence an auditor needs, so it is reported rather
   * than just a boolean.
   */
  verifyChain(): { valid: boolean; checked: number; brokenAt?: number; reason?: string } {
    let expectedPrev = GENESIS_HASH;

    for (let index = 0; index < this.entries.length; index++) {
      const entry = this.entries[index]!;

      if (!entry.hash) {
        return { valid: false, checked: index, brokenAt: index, reason: 'Entry is missing its hash' };
      }
      if ((entry.prevHash ?? GENESIS_HASH) !== expectedPrev) {
        return { valid: false, checked: index, brokenAt: index, reason: 'Entry does not link to its predecessor' };
      }

      const { hash, ...unhashed } = entry;
      if (hashEntry(unhashed) !== hash) {
        return { valid: false, checked: index, brokenAt: index, reason: 'Entry content does not match its hash' };
      }

      expectedPrev = entry.hash;
    }

    return { valid: true, checked: this.entries.length };
  }

  /** Latest chain hash — publish or countersign this to anchor the log. */
  get headHash(): string {
    return this.entries[this.entries.length - 1]?.hash ?? GENESIS_HASH;
  }

  private ensureDirectory(filePath: string): void {
    try {
      const dir = dirname(filePath);
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    } catch {
      // Fall through to in-memory-only operation.
    }
  }

  private loadFromDisk(filePath: string): void {
    try {
      if (!existsSync(filePath)) return;
      const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
      const restored: AuditEntry[] = [];
      for (const line of lines.slice(-MAX_IN_MEMORY_ENTRIES)) {
        try {
          restored.push(JSON.parse(line) as AuditEntry);
        } catch {
          // Skip corrupt lines rather than refusing to start.
        }
      }
      this.entries = restored;
    } catch {
      this.entries = [];
    }
  }
}
