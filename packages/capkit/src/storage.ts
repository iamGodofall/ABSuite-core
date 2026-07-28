/**
 * Durable storage, built on Node's bundled SQLite.
 *
 * Using `node:sqlite` keeps ABSuite dependency-free on the persistence path —
 * no native module to compile, nothing to install, and the database is a single
 * file an operator can copy or back up. Passing no path gives an in-memory
 * database, which is what tests and ephemeral deployments want.
 */
import { DatabaseSync } from 'node:sqlite';

export type Row = Record<string, unknown>;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS tenants (
     id            TEXT PRIMARY KEY,
     name          TEXT NOT NULL,
     plan          TEXT NOT NULL DEFAULT 'free',
     api_key_hash  TEXT NOT NULL UNIQUE,
     status        TEXT NOT NULL DEFAULT 'active',
     external_ref  TEXT,
     created_at    TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS usage (
     tenant_id  TEXT NOT NULL,
     metric     TEXT NOT NULL,
     period     TEXT NOT NULL,
     count      INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (tenant_id, metric, period)
   )`,

  `CREATE TABLE IF NOT EXISTS revocations (
     jti        TEXT PRIMARY KEY,
     expires_at INTEGER NOT NULL,
     tenant_id  TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS audit (
     id          TEXT PRIMARY KEY,
     seq         INTEGER,
     timestamp   TEXT NOT NULL,
     tenant_id   TEXT,
     subject     TEXT NOT NULL,
     action      TEXT NOT NULL,
     resource    TEXT NOT NULL,
     result      TEXT NOT NULL,
     reason      TEXT,
     duration_ms INTEGER,
     prev_hash   TEXT,
     hash        TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit (tenant_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_revocations_expiry ON revocations (expires_at)`,

  // Edge-Run durability lives in the same file so one volume backs the suite.
  `CREATE TABLE IF NOT EXISTS schedules (
     id           TEXT PRIMARY KEY,
     tenant_id    TEXT,
     cron         TEXT NOT NULL,
     task         TEXT NOT NULL,
     retry        TEXT,
     timeout_ms   INTEGER,
     status       TEXT NOT NULL DEFAULT 'active',
     next_run     TEXT NOT NULL,
     last_run     TEXT,
     run_count    INTEGER NOT NULL DEFAULT 0,
     failure_count INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS queue_tasks (
     id           TEXT PRIMARY KEY,
     tenant_id    TEXT,
     priority     TEXT NOT NULL,
     task         TEXT NOT NULL,
     retry        TEXT NOT NULL,
     timeout_ms   INTEGER,
     state        TEXT NOT NULL,
     attempts     INTEGER NOT NULL DEFAULT 0,
     available_at INTEGER NOT NULL,
     queued_at    TEXT NOT NULL,
     started_at   TEXT,
     completed_at TEXT,
     last_error   TEXT,
     result       TEXT,
     schedule_id  TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS idx_queue_state ON queue_tasks (state, available_at)`,

  // Verifiable execution: one signed, chained record per real action taken.
  `CREATE TABLE IF NOT EXISTS executions (
     id           TEXT PRIMARY KEY,
     seq          INTEGER,
     tenant_id    TEXT,
     subject      TEXT NOT NULL,
     jti          TEXT,
     scope        TEXT NOT NULL,
     module       TEXT NOT NULL,
     action       TEXT NOT NULL,
     input_hash   TEXT NOT NULL,
     output_hash  TEXT,
     outcome      TEXT NOT NULL,
     error        TEXT,
     started_at   TEXT NOT NULL,
     completed_at TEXT,
     duration_ms  INTEGER,
     steps        TEXT NOT NULL,
     prev_hash    TEXT NOT NULL,
     hash         TEXT NOT NULL,
     signature    TEXT,
     key_id       TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS idx_executions_seq ON executions (seq)`,
  `CREATE INDEX IF NOT EXISTS idx_executions_tenant ON executions (tenant_id, started_at)`,
];

export class Storage {
  private readonly db: DatabaseSync;
  readonly path: string;

  constructor(path?: string) {
    // ':memory:' is a real SQLite database, so there is one code path either way.
    this.path = (path || '').trim() || ':memory:';
    this.db = new DatabaseSync(this.path);

    // WAL gives concurrent readers alongside a writer; it is meaningless for
    // an in-memory database, so only enable it for a real file.
    if (this.path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL');

      // Every ABSuite service opens this same file, and Docker Compose starts
      // them simultaneously. Without a busy timeout SQLite fails immediately
      // with SQLITE_BUSY when two processes migrate at once, crashing whichever
      // lost the race. Wait for the lock instead.
      this.db.exec('PRAGMA busy_timeout = 10000');
    }
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  /**
   * Apply schema statements.
   *
   * Every statement is `IF NOT EXISTS`, so concurrent migrators converge on the
   * same schema; the busy timeout above is what stops them colliding.
   */
  private migrate(): void {
    for (const statement of MIGRATIONS) {
      this.db.exec(statement);
    }
  }

  run(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...(params as never[]));
  }

  get<T extends Row = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T extends Row = Row>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  /** Run a unit of work atomically; rolls back if the callback throws. */
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

let shared: Storage | undefined;

/**
 * Process-wide storage handle.
 *
 * Every ABSuite service resolves the same ABSUITE_DB_PATH, so a single volume
 * backs tenants, metering, revocation and Edge-Run state across the suite.
 */
export function getStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  if (!shared) {
    shared = new Storage(env.ABSUITE_DB_PATH || env.CAPKIT_DB_PATH || '');
  }
  return shared;
}

/** Test helper — drops the shared handle so a fresh database can be opened. */
export function resetStorage(): void {
  shared?.close();
  shared = undefined;
}
