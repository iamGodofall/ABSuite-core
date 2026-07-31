#!/usr/bin/env node
/**
 * The four secrets a public instance needs, and why each one exists.
 *
 * Written because the first deployment attempt of this repository failed on
 * the first of them and would have failed silently, months later, on the
 * second — and neither failure is one an operator could have predicted from
 * reading the deployment files, because the deployment files did not mention
 * them.
 *
 * Prints shell-ready assignments. Nothing is written to disk: a secret in a
 * file in a repository is a secret with a countdown on it.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SigningKey } = require('../packages/capkit/dist/index.js');

const { privateKeyPem } = SigningKey.createPair();
const b64 = (n) => randomBytes(n).toString('base64');

/*
 * The trace key is Ed25519 and asymmetric on purpose — an auditor must be able
 * to verify a trace without also being able to forge one. It is the only one of
 * the four that cannot be a random string.
 *
 * It is also the one that matters most and looks least urgent. capkit runs
 * happily without it, signing with an ephemeral key it regenerates at every
 * start. On a machine with no volume that is harmless. On a machine with one —
 * which is what fly.toml and render.yaml both configure, because records that
 * vanish on deploy are not much of a demonstration — the traces outlive the key
 * that signed them, and after the first restart every one of them fails
 * verification at once.
 *
 * Measured rather than assumed: three traces recorded, then a restart, and the
 * chain went from `valid: true, checked: 3` to `determination: FAILED,
 * brokenAt: 1`. To the library's credit the reason is exact — "the content
 * still matches its hash, so this record was not edited; it was signed by a
 * different key" — so this is not a false accusation of tampering. It is still
 * a trust product reporting its own record as unverifiable, on an instance
 * whose purpose is to show that the record can be verified.
 */
const traceKeyId = `absuite-trace-${new Date().toISOString().slice(0, 10)}`;

console.log(`# ABSuite deployment secrets — generated ${new Date().toISOString()}
#
# Store these in your platform's secret manager. Do not commit them.
# Losing CAPKIT_TRACE_PRIVATE_KEY makes every existing trace unverifiable;
# it is the one worth backing up.

# Signs execution traces. Ed25519, asymmetric: the public half verifies, and
# cannot forge. Keep this stable forever — a new key invalidates old records.
CAPKIT_TRACE_PRIVATE_KEY='${privateKeyPem.trim()}'

# Names the key in each trace header, so verification picks the right one
# instead of trying all of them.
CAPKIT_TRACE_KEY_ID='${traceKeyId}'

# Symmetric secret for capability tokens. capkit refuses to start without it
# when NODE_ENV=production, which is the correct behaviour and is why a
# container missing it never reaches a health check.
CAPKIT_HMAC_SECRET='${b64(32)}'

# Mints the first capability token. Without it nothing can be recorded, so
# every layer of the interface stays empty and correctly says so.
CAPKIT_ADMIN_KEY='${b64(32)}'

# Reads the record. Twenty-eight routes sit behind this one — every execution,
# every chain verification, the queue, the disputes, the unknowns — so an
# instance without it answers /status and returns 503 to everything else, and
# the room reports UNKNOWN across the board while being entirely healthy.
#
# It is never compiled into the bundle. A visitor pastes it into the interface,
# which keeps it in localStorage, so the deployed page holds no secret and a
# reader without the key sees a room that will not lie to them about what it
# cannot read.
ABSUITE_ADMIN_API_KEY='${b64(32)}'

# Gates the whole interface behind HTTP basic auth (username: absuite).
# Required for any instance with a public address: that process holds the key
# above and can control services.
ABSUITE_PUBLIC_PASSWORD='${b64(18)}'`);

console.error(`
Generated. To load them into Fly:

  node scripts/gen-deploy-secrets.mjs > secrets.env
  fly secrets import < secrets.env
  rm secrets.env

On Render, paste them into the service's Environment tab. render.yaml
generates the two random ones for you, but not the trace key — that one has
structure and has to come from here.
`);
