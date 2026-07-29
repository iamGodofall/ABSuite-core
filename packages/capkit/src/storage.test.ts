
/**
 * Cold start with every service at once.
 *
 * `docker compose up -d` starts five processes that all open the same SQLite
 * file within milliseconds of each other. Switching journal mode takes a brief
 * exclusive lock, so before `busy_timeout` was moved above the WAL pragma this
 * killed whichever processes lost the race — two of five, reproducibly, with
 * "database is locked" at boot.
 *
 * Nothing in the unit tests could catch it: one Storage in one process never
 * contends with anything.
 */
describe('concurrent cold start', () => {
  test('five processes can open the same database at once', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');

    const dir = mkdtempSync(join(tmpdir(), 'absuite-race-'));
    const dbPath = join(dir, 'absuite.db');
    const storageModule = join(__dirname, '..', 'dist', 'storage.js');

    // Separate processes, not separate handles: the lock is held per connection
    // and only a real process boundary reproduces the compose behaviour.
    const script = `
      const { Storage } = require(${JSON.stringify(storageModule)});
      const s = new Storage(${JSON.stringify(dbPath)});
      s.close();
    `;

    try {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          new Promise<void>((resolve, reject) => {
            try {
              execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', timeout: 25_000 });
              resolve();
            } catch (error) {
              reject(new Error(String((error as { stderr?: Buffer }).stderr ?? error)));
            }
          })
        )
      );

      const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
      expect(failed.map(f => String(f.reason).slice(0, 200))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
