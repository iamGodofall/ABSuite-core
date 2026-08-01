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

  // Layer 1 — Identity. A subject enrolled against a public key it holds the
  // private half of, so `subject` stops being a string the caller typed.
  `CREATE TABLE IF NOT EXISTS identities (
     subject          TEXT PRIMARY KEY,
     public_key_pem   TEXT NOT NULL,
     kind             TEXT NOT NULL DEFAULT 'agent',
     status           TEXT NOT NULL DEFAULT 'active',
     label            TEXT,
     enrolled_at      TEXT NOT NULL,
     last_proven_at   TEXT,
     suspended_at     TEXT,
     suspended_reason TEXT
   )`,

  // Single-use challenges. Short-lived by design and swept on issue.
  `CREATE TABLE IF NOT EXISTS identity_challenges (
     nonce      TEXT PRIMARY KEY,
     subject    TEXT NOT NULL,
     expires_at TEXT NOT NULL
   )`,

  // Which issued tokens were backed by a proof. Keyed by a hash of the token id
  // so this table is not a list of live credential identifiers.
  `CREATE TABLE IF NOT EXISTS identity_tokens (
     jti_hash  TEXT PRIMARY KEY,
     subject   TEXT NOT NULL,
     proven    INTEGER NOT NULL DEFAULT 0,
     issued_at TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_identity_challenges_expiry ON identity_challenges (expires_at)`,

  // Verify's fourth target: which model was approved, and what it looked like
  // at the time. Compared against, never used to load anything.
  `CREATE TABLE IF NOT EXISTS approved_models (
     name        TEXT PRIMARY KEY,
     fingerprint TEXT NOT NULL,
     hash        TEXT NOT NULL,
     approved_at TEXT NOT NULL,
     approved_by TEXT NOT NULL,
     basis       TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_executions_seq ON executions (seq)`,
  `CREATE INDEX IF NOT EXISTS idx_executions_tenant ON executions (tenant_id, started_at)`,
];

/**
 * Columns added after the tables above already existed in the wild.
 *
 * Kept separate from MIGRATIONS because `CREATE TABLE IF NOT EXISTS` silently
 * does nothing when a table exists with an older shape — which means a schema
 * change written there would apply to new deployments and skip every existing
 * one, and nobody would notice until a query returned null forever.
 */
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  // Which rule permitted an action, as opposed to which capability carried it.
  ['executions', 'governance', 'TEXT'],
  // Null means canonical form v1. Added ahead of any v2 so that changing the
  // canonical form is a code change, not a schema migration during an upgrade.
  ['executions', 'canonical_version', 'INTEGER'],
  // What an action cost, as the caller claimed it — stored as the signed JSON
  // and deliberately not also as a numeric column, so no total can be edited
  // without breaking the hash that proves it.
  ['executions', 'cost', 'TEXT'],
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
    for (const [table, column, definition] of ADDED_COLUMNS) {
      this.addColumn(table, column, definition);
    }
  }

  /**
   * Add a column to an existing table, once.
   *
   * SQLite has no `ADD COLUMN IF NOT EXISTS`, and every ABSuite service opens
   * this file at the same moment — so this checks first and still tolerates
   * losing the race, because two processes adding the same column is a
   * duplicate-column error, not a corruption. A migration that crashes a
   * service on a harmless collision is worse than the collision.
   */
  private addColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some(existing => existing.name === column)) return;

    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Another process added it between the check and the write.
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
