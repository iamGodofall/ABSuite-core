#!/usr/bin/env node
/**
 * Generate the durable trace signing key, straight into `.env`.
 *
 * `absuite doctor` opens on any fresh instance by saying the signing key is
 * ephemeral — every record written since the last restart stops verifying at the
 * next one. That was a finding nobody could act on from inside the product,
 * which is a complaint rather than a finding. This is the action.
 *
 * ## Why it never writes the key to a file of its own
 *
 * The obvious shape is: generate to `key.json`, then read it and append. That
 * shape leaves the most dangerous secret in the product sitting in a working
 * directory, unignored, one `git add -A` away from being public permanently —
 * and unlike a password it cannot be rotated out of trouble, because rotating it
 * invalidates every record it ever signed.
 *
 * So the private half exists in memory, goes into `.env`, and is never written
 * anywhere else. The public half is printed, because that one is meant to be
 * published.
 *
 *   node scripts/gen-trace-key.mjs          # write it, refuse to overwrite
 *   node scripts/gen-trace-key.mjs --force  # replace an existing key
 *
 * `--force` is the dangerous one and it says so: replacing the key means every
 * record signed with the old one fails verification, for ever, with no recovery.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const force = process.argv.includes('--force');

const KEY = 'CAPKIT_TRACE_PRIVATE_KEY';
const ID = 'CAPKIT_TRACE_KEY_ID';

if (!existsSync(envPath)) {
  console.error(`No .env at ${envPath}.`);
  console.error('Copy .env.example to .env first, so this appends rather than inventing a file.');
  process.exit(1);
}

let env = readFileSync(envPath, 'utf8');

// An existing key is not a nuisance to route around. It is signing a chain.
// [^\S\r\n] rather than \s: \s matches a newline, so `KEY=` followed by the
// next line's variable read as "already set" and the generator refused to run on
// a fresh .env.example. Found by running it, not by reading it.
const present = new RegExp(`^[^\\S\\r\\n]*${KEY}[^\\S\\r\\n]*=[^\\S\\r\\n]*\\S`, 'm').test(env);
if (present && !force) {
  console.log(`${KEY} is already set in .env. Nothing was changed.`);
  console.log('');
  console.log('If you replace it, every record signed with the current key fails');
  console.log('verification permanently — there is no recovery and there should not be.');
  console.log('Pass --force only if you know that chain is disposable.');
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const keyId = `absuite-trace-${new Date().toISOString().slice(0, 10)}`;

/*
 * Newlines escaped, and the whole value quoted.
 *
 * A PEM is multi-line, and an unquoted multi-line value in a `.env` is read as
 * one variable followed by several lines of garbage — which parses without
 * complaint and yields a key that cannot be loaded. Docker Compose and dotenv
 * both read `"...\n..."` correctly.
 */
const encoded = `"${privatePem.trim().replace(/\r?\n/g, '\\n')}"`;

if (present) {
  env = env.replace(new RegExp(`^[^\\S\\r\\n]*${KEY}[^\\S\\r\\n]*=.*$`, 'm'), `${KEY}=${encoded}`);
  env = new RegExp(`^[^\\S\\r\\n]*${ID}[^\\S\\r\\n]*=`, 'm').test(env)
    ? env.replace(new RegExp(`^[^\\S\\r\\n]*${ID}[^\\S\\r\\n]*=.*$`, 'm'), `${ID}=${keyId}`)
    : `${env.replace(/\n*$/, '\n')}${ID}=${keyId}\n`;
} else {
  env = env.replace(/\n*$/, '\n');
  env += `\n# The durable trace signing key. Losing it fails every record ever signed.\n`;
  env += `${KEY}=${encoded}\n${ID}=${keyId}\n`;
}

writeFileSync(envPath, env);

console.log(`Wrote ${KEY} and ${ID}=${keyId} to .env.\n`);
console.log('The public half — safe to publish, and what anybody verifying needs:\n');
console.log(publicPem.trim());
console.log('');
console.log('Three things, in order of how much they will cost you:');
console.log('');
console.log('  1. Back up .env somewhere that is not this machine. Losing this key');
console.log('     fails every record it ever signed, permanently. No recovery.');
console.log('  2. Restart the services so they pick it up, then re-seed if the');
console.log('     existing chain was signed by an ephemeral key.');
console.log('  3. Run `absuite doctor` — the signing-key finding should be gone.');
console.log('');
console.log('The private half was never written anywhere but .env. Keep it that way.');
