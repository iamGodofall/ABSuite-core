/**
 * Revocation backends.
 *
 * A capability token is verified by signature alone, so revoking one before it
 * expires requires shared state. The in-memory store is correct for a single
 * process; multi-replica deployments need a store every replica can see.
 *
 * The interface is async so a Redis or Postgres backend drops in without any
 * caller changing.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RevocationStore {
  revoke(jti: string, expiresAtEpochSec: number): Promise<void>;
  isRevoked(jti: string): Promise<boolean>;
  /** Drop entries whose token has expired anyway. */
  prune(): Promise<number>;
}

export class MemoryRevocationStore implements RevocationStore {
  private readonly revoked = new Map<string, number>();

  async revoke(jti: string, expiresAtEpochSec: number): Promise<void> {
    if (jti) this.revoked.set(jti, expiresAtEpochSec);
  }

  async isRevoked(jti: string): Promise<boolean> {
    await this.prune();
    return this.revoked.has(jti);
  }

  async prune(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    let removed = 0;
    for (const [jti, expiresAt] of this.revoked) {
      if (expiresAt && expiresAt < now) {
        this.revoked.delete(jti);
        removed += 1;
      }
    }
    return removed;
  }
}

/**
 * File-backed store for replicas sharing a volume.
 *
 * Appends are atomic enough for this purpose (single short line, O_APPEND), and
 * the in-memory index is refreshed when the file grows, so a revocation issued
 * by one replica is visible to the others.
 */
export class FileRevocationStore implements RevocationStore {
  private index = new Map<string, number>();
  private lastSize = -1;

  constructor(private readonly filePath: string) {
    const dir = dirname(filePath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.refresh();
  }

  async revoke(jti: string, expiresAtEpochSec: number): Promise<void> {
    if (!jti) return;
    this.index.set(jti, expiresAtEpochSec);
    appendFileSync(this.filePath, `${JSON.stringify({ jti, exp: expiresAtEpochSec })}\n`, 'utf8');
    this.lastSize = this.currentSize();
  }

  async isRevoked(jti: string): Promise<boolean> {
    this.refresh();
    const expiresAt = this.index.get(jti);
    if (expiresAt === undefined) return false;

    // An expired token is rejected on its own merits; no need to keep tracking.
    if (expiresAt && expiresAt < Math.floor(Date.now() / 1000)) {
      this.index.delete(jti);
      return false;
    }
    return true;
  }

  async prune(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    let removed = 0;
    for (const [jti, expiresAt] of this.index) {
      if (expiresAt && expiresAt < now) {
        this.index.delete(jti);
        removed += 1;
      }
    }
    return removed;
  }

  private currentSize(): number {
    try {
      return existsSync(this.filePath) ? statSync(this.filePath).size : 0;
    } catch {
      return 0;
    }
  }

  /** Re-read the file only when it has grown, so the hot path stays cheap. */
  private refresh(): void {
    const size = this.currentSize();
    if (size === this.lastSize) return;

    try {
      const next = new Map<string, number>();
      if (existsSync(this.filePath)) {
        for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
          if (!line) continue;
          try {
            const parsed = JSON.parse(line) as { jti?: string; exp?: number };
            if (parsed.jti) next.set(parsed.jti, Number(parsed.exp) || 0);
          } catch {
            // Skip corrupt lines rather than failing closed on the whole file.
          }
        }
      }
      this.index = next;
      this.lastSize = size;
    } catch {
      // Keep the previous index if the file becomes briefly unreadable.
    }
  }
}

/** Pick a store from the environment: CAPKIT_REVOCATION_FILE, else in-memory. */
export function revocationStoreFromEnv(env: NodeJS.ProcessEnv = process.env): RevocationStore {
  const file = (env.CAPKIT_REVOCATION_FILE || '').trim();
  return file ? new FileRevocationStore(file) : new MemoryRevocationStore();
}
