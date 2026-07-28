import { SIGNUP_PAGE, SignupThrottle, validateSignup } from './signup';

describe('signup validation', () => {
  test('accepts a reasonable submission', () => {
    const result = validateSignup({ name: 'Acme Corp', email: 'You@Acme.com' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe('Acme Corp');
      // Normalised so the same person cannot register twice by casing.
      expect(result.email).toBe('you@acme.com');
    }
  });

  test('rejects a missing or too-short name', () => {
    expect(validateSignup({ name: '', email: 'a@b.co' }).ok).toBe(false);
    expect(validateSignup({ name: 'A', email: 'a@b.co' }).ok).toBe(false);
    expect(validateSignup({ email: 'a@b.co' }).ok).toBe(false);
  });

  test('rejects a malformed email', () => {
    for (const email of ['', 'nope', 'a@b', 'a b@c.com', '@b.co', 'a@.co']) {
      expect(validateSignup({ name: 'Acme', email }).ok).toBe(false);
    }
  });

  test('rejects oversized input', () => {
    expect(validateSignup({ name: 'x'.repeat(81), email: 'a@b.co' }).ok).toBe(false);
    expect(validateSignup({ name: 'Acme', email: 'a'.repeat(200) + '@b.co' }).ok).toBe(false);
  });

  test('trims surrounding whitespace', () => {
    const result = validateSignup({ name: '  Acme  ', email: '  a@b.co  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe('Acme');
  });
});

describe('signup throttle', () => {
  test('allows up to the limit then blocks', () => {
    const throttle = new SignupThrottle({ maxPerWindow: 2, windowMs: 60_000 });

    expect(throttle.allow('1.2.3.4')).toBe(true);
    expect(throttle.allow('1.2.3.4')).toBe(true);
    expect(throttle.allow('1.2.3.4')).toBe(false);
  });

  test('tracks addresses independently', () => {
    const throttle = new SignupThrottle({ maxPerWindow: 1, windowMs: 60_000 });

    expect(throttle.allow('1.1.1.1')).toBe(true);
    expect(throttle.allow('1.1.1.1')).toBe(false);
    expect(throttle.allow('2.2.2.2')).toBe(true);
  });

  test('resets after the window elapses', () => {
    const throttle = new SignupThrottle({ maxPerWindow: 1, windowMs: 1000 });
    const start = Date.now();

    expect(throttle.allow('1.1.1.1', start)).toBe(true);
    expect(throttle.allow('1.1.1.1', start + 500)).toBe(false);
    expect(throttle.allow('1.1.1.1', start + 1500)).toBe(true);
  });

  test('pruning drops expired windows', () => {
    const throttle = new SignupThrottle({ maxPerWindow: 1, windowMs: 1000 });
    const start = Date.now();

    throttle.allow('1.1.1.1', start);
    throttle.prune(start + 5000);
    // A pruned entry behaves as a fresh one.
    expect(throttle.allow('1.1.1.1', start + 5000)).toBe(true);
  });
});

describe('signup page', () => {
  test('is a complete standalone document', () => {
    expect(SIGNUP_PAGE).toMatch(/^<!doctype html>/i);
    expect(SIGNUP_PAGE).toContain('</html>');
    // No build step and no external assets to serve.
    expect(SIGNUP_PAGE).not.toMatch(/<script[^>]+src=/i);
    expect(SIGNUP_PAGE).not.toMatch(/<link[^>]+stylesheet/i);
  });

  test('posts to the signup endpoint', () => {
    expect(SIGNUP_PAGE).toContain("fetch('/signup'");
  });

  test('warns that the key is shown only once', () => {
    expect(SIGNUP_PAGE).toMatch(/shown once and cannot be recovered/i);
  });

  test('supports both colour schemes', () => {
    expect(SIGNUP_PAGE).toContain('color-scheme: light dark');
    expect(SIGNUP_PAGE).toContain('prefers-color-scheme: dark');
  });
});
