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
import { randomUUID } from 'node:crypto';

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
    const complete: AuditEntry = {
      id: entry.id ?? randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      subject: entry.subject,
      action: entry.action,
      resource: entry.resource,
      result: entry.result,
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      ...(entry.reason ? { reason: entry.reason } : {}),
    };

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
