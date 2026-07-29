import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Actually execute the built CLI.
 *
 * @absuitecore/cli@1.0.0 shipped completely broken: the package is ESM
 * ("type": "module") but the source used `__dirname`, so every invocation died
 * with `ReferenceError: __dirname is not defined in ES module scope` on the
 * first line. Nothing caught it because the test script was
 * `echo "not yet implemented" && exit 0`, and a passing placeholder reads
 * exactly like a passing test.
 *
 * Importing the module is not enough — a CLI has to be run.
 */
const BUILT = join(__dirname, '..', 'dist', 'index.js');

describe('the built CLI', () => {
  test('is built before this suite runs', () => {
    expect(existsSync(BUILT)).toBe(true);
  });

  test('runs without a module-system error', () => {
    const output = execFileSync(process.execPath, [BUILT, '--help'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(output).not.toMatch(/ReferenceError/);
    expect(output.length).toBeGreaterThan(0);
  });

  test('mentions its own name in the help text', () => {
    const output = execFileSync(process.execPath, [BUILT, '--help'], { encoding: 'utf8' });
    expect(output.toLowerCase()).toContain('absuite');
  });
});
