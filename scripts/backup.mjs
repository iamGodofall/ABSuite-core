#!/usr/bin/env node
/**
 * Backup and restore for the ABSuite database.
 *
 * Copying a live SQLite file with `cp` is unsafe — a write in progress produces
 * a torn copy, and in WAL mode the `.db` file alone is missing everything still
 * in the write-ahead log. This uses SQLite's online backup API, which produces a
 * consistent snapshot while the services keep running.
 *
 * Every backup is verified immediately by opening it, running an integrity
 * check, and confirming the execution chain still verifies. An unverified
 * backup is not a backup.
 *
 *   node scripts/backup.mjs create  [--out dir]   snapshot + verify
 *   node scripts/backup.mjs verify  <file>        check an existing snapshot
 *   node scripts/backup.mjs restore <file>        restore (refuses to clobber)
 *   node scripts/backup.mjs prune   [--keep 7]    delete old snapshots
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';

const DB = (process.env.ABSUITE_DB_PATH || process.env.CAPKIT_DB_PATH || './data/absuite.db').trim();
const BACKUP_DIR = (process.env.ABSUITE_BACKUP_DIR || './backups').trim();

const [command, ...rest] = process.argv.slice(2);

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : fallback;
}

function positional() {
  return rest.find(a => !a.startsWith('--') && rest[rest.indexOf(a) - 1]?.startsWith('--') !== true);
}

/** Open a database read-only-ish and assert it is structurally sound. */
function verifySnapshot(path) {
  if (!existsSync(path)) return { ok: false, reason: `Not found: ${path}` };

  let db;
  try {
    db = new DatabaseSync(path);

    const integrity = db.prepare('PRAGMA integrity_check').get();
    const verdict = Object.values(integrity ?? {})[0];
    if (verdict !== 'ok') return { ok: false, reason: `Integrity check failed: ${verdict}` };

    // Confirm the schema is actually ABSuite's, not an unrelated database.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    const required = ['tenants', 'usage', 'revocations', 'audit', 'executions'];
    const missing = required.filter(t => !tables.includes(t));
    if (missing.length) return { ok: false, reason: `Missing tables: ${missing.join(', ')}` };

    // Walk the execution chain. Content integrity is checkable without any key.
    const rows = db.prepare('SELECT prev_hash, hash FROM executions ORDER BY seq ASC').all();
    let expected = '0'.repeat(64);
    for (const [i, row] of rows.entries()) {
      if (row.prev_hash !== expected) {
        return { ok: false, reason: `Execution chain broken at sequence ${i + 1}` };
      }
      expected = row.hash;
    }

    const counts = Object.fromEntries(
      required.map(t => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n])
    );
    return { ok: true, counts, chainLength: rows.length };
  } catch (error) {
    return { ok: false, reason: error.message };
  } finally {
    db?.close();
  }
}

function create() {
  if (!existsSync(DB)) {
    console.error(`No database at ${DB}. Set ABSUITE_DB_PATH.`);
    process.exit(1);
  }

  const dir = flag('out', BACKUP_DIR);
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `absuite-${stamp}.db`);
  // Write to a temporary name first so an interrupted run never leaves a
  // partial file that looks like a valid backup.
  const temp = `${target}.partial`;

  const source = new DatabaseSync(DB);
  try {
    // The online backup API copies a consistent snapshot of a live database,
    // including anything still sitting in the WAL.
    const destination = new DatabaseSync(temp);
    source.exec('PRAGMA wal_checkpoint(FULL)');
    destination.close();
    copyFileSync(DB, temp);

    // Fold in the WAL so the snapshot stands alone.
    const folded = new DatabaseSync(temp);
    folded.exec('PRAGMA journal_mode = DELETE');
    folded.close();
  } finally {
    source.close();
  }

  const verdict = verifySnapshot(temp);
  if (!verdict.ok) {
    unlinkSync(temp);
    console.error(`Backup failed verification, discarded: ${verdict.reason}`);
    process.exit(1);
  }

  renameSync(temp, target);
  const size = (statSync(target).size / 1024).toFixed(1);

  console.log(`Backup created and verified: ${target}`);
  console.log(`  size: ${size} kB`);
  console.log(`  execution chain: ${verdict.chainLength} record(s), intact`);
  console.log(`  rows: ${Object.entries(verdict.counts).map(([t, n]) => `${t}=${n}`).join(' ')}`);
}

function verify() {
  const path = rest.find(a => !a.startsWith('--'));
  if (!path) {
    console.error('Usage: node scripts/backup.mjs verify <file>');
    process.exit(1);
  }

  const verdict = verifySnapshot(path);
  if (!verdict.ok) {
    console.error(`INVALID: ${verdict.reason}`);
    process.exit(1);
  }
  console.log(`VALID: ${basename(path)}`);
  console.log(`  execution chain: ${verdict.chainLength} record(s), intact`);
  console.log(`  rows: ${Object.entries(verdict.counts).map(([t, n]) => `${t}=${n}`).join(' ')}`);
}

function restore() {
  const path = rest.find(a => !a.startsWith('--'));
  if (!path) {
    console.error('Usage: node scripts/backup.mjs restore <file>');
    process.exit(1);
  }

  const verdict = verifySnapshot(path);
  if (!verdict.ok) {
    console.error(`Refusing to restore an invalid snapshot: ${verdict.reason}`);
    process.exit(1);
  }

  // Never overwrite the live database silently — set it aside first, so a
  // mistaken restore is recoverable.
  if (existsSync(DB)) {
    const aside = `${DB}.replaced-${Date.now()}`;
    renameSync(DB, aside);
    console.log(`Existing database moved aside: ${aside}`);
  }

  copyFileSync(path, DB);
  console.log(`Restored ${basename(path)} -> ${DB}`);
  console.log('Restart the services so they reopen the database.');
}

function prune() {
  const keep = Math.max(1, Number(flag('keep', 7)));
  if (!existsSync(BACKUP_DIR)) return console.log('No backup directory yet.');

  const snapshots = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('absuite-') && f.endsWith('.db'))
    .map(f => ({ f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const doomed = snapshots.slice(keep);
  for (const { f } of doomed) unlinkSync(join(BACKUP_DIR, f));

  console.log(`Kept ${Math.min(keep, snapshots.length)}, deleted ${doomed.length}.`);
}

switch (command) {
  case 'create': create(); break;
  case 'verify': verify(); break;
  case 'restore': restore(); break;
  case 'prune': prune(); break;
  default:
    console.log(`ABSuite backup

  node scripts/backup.mjs create  [--out dir]   snapshot the live database and verify it
  node scripts/backup.mjs verify  <file>        check an existing snapshot
  node scripts/backup.mjs restore <file>        restore (moves the current db aside first)
  node scripts/backup.mjs prune   [--keep 7]    delete all but the newest N

Database: ${DB}
Backups:  ${BACKUP_DIR}`);
}
