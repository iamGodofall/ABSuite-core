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

    if (this.path !== ':memory:') {
      // busy_timeout MUST be set before anything that takes a lock.
      //
      // Every ABSuite service opens this same file and Docker Compose starts
      // them simultaneously. Switching journal mode needs a brief exclusive
      // lock, so without a timeout SQLite returns SQLITE_BUSY *immediately* and
      // the process dies at boot. This pragma used to sit one line below the
      // WAL switch — the mitigation was present, correct, and applied too late
      // to protect the only statement that needed it. Starting all five
      // services at once crashed two of them with "database is locked".
      this.db.exec('PRAGMA busy_timeout = 10000');

      // WAL gives concurrent readers alongside a writer; it is meaningless for
      // an in-memory database, so only enable it for a real file.
      //
      // Journal mode is persistent database state, not per-connection: once any
      // connection has set WAL the file stays in WAL. So losing this race is
      // harmless — another service already did it — and refusing to start over
      // it would be worse than continuing.
      try {
        this.db.exec('PRAGMA journal_mode = WAL');
      } catch {
        // Already WAL, or another process is mid-switch. Either way the mode
        // is or is about to be correct, and busy_timeout above covers the rest.
      }
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

  /**
   * Run a unit of work atomically; rolls back if the callback throws.
   *
   * `BEGIN IMMEDIATE`, not a bare `BEGIN`. A deferred transaction takes only a
   * read lock and upgrades when it first writes — and SQLite cannot apply
   * `busy_timeout` to that upgrade, because retrying would mean re-reading data
   * the transaction has already seen. So it fails instantly with SQLITE_BUSY
   * whenever another process holds the write lock. Taking the write lock up
   * front makes the wait legal, and the busy timeout applies.
   *
   * This matters because execution traces are written this way: under
   * concurrency the deferred form silently dropped roughly 60% of them.
   */
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
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
