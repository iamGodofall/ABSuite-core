# Security Policy

> **How the system is designed** is a separate document:
> [`docs/SECURITY-MODEL.md`](./docs/SECURITY-MODEL.md) covers the threat model,
> capability tokens, key rotation and defence in depth. This page is about
> **reporting a problem**.

ABSuite is trust infrastructure. A vulnerability here is not an inconvenience —
it is a hole in the thing people are relying on to prove what happened. Reports
are treated accordingly.

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/iamGodofall/ABSuite-core/security/advisories/new)

Or email **info@socialfeed.co.za** with `SECURITY` in the subject.

Please include what you have — a description, affected package and version, and
a reproduction if you can produce one. A vague report of something real is worth
more than silence.

### What to expect

| | |
|---|---|
| Acknowledgement | Within 72 hours |
| Initial assessment | Within 7 days |
| Fix or mitigation plan | Communicated with the assessment |

This project is currently maintained by one person. Those are honest targets
rather than a corporate SLA, and you will be told plainly if something slips.

You will be credited in the advisory unless you would rather not be.

## Supported versions

Packages version independently, so the honest answer is **the latest published
version of each package**, which `npm view @absuitecore/<name> version` will
tell you. Anything older gets a fix only if the issue is severe and the upgrade
path is genuinely blocked.

Versions with a known defect carry an npm deprecation notice, so `npm install`
tells you at the point it matters rather than leaving you to find out:

| Deprecated | Why |
|---|---|
| `@absuitecore/capkit@<1.1.1` | `POST /auth/token/validate` accepted `requiredScope` and silently ignored it, returning `valid: true` for scopes a token did not hold |
| `@absuitecore/cli@<1.0.2` | `1.0.0` could not run at all; `1.0.1` had broken `--help` and `status` for global installs |

Anything below `1.0` was pre-release. Do not use it.

## What counts as a vulnerability

Anything that breaks one of these guarantees is in scope, and the first three
are the ones that matter most — they are the product:

- **Forgery** — producing an execution trace that verifies against a public key
  without holding the private key.
- **Undetected tampering** — modifying a stored record so `verifyChain()` still
  reports the chain intact.
- **Capability escape** — obtaining a scope the token does not grant, including
  through scope-matching edge cases.
- Signature or hash verification accepting input it should reject.
- Token validation accepting an expired, revoked or wrongly-signed token.
- The revocation store failing **open** rather than closed.
- Secrets or payloads leaking into logs, traces or error messages.
- SQL injection, path traversal, or command injection in any service.

### Out of scope

- Vulnerabilities requiring an attacker who already has the signing key or admin
  credential. That is a compromised deployment, not a flaw in the design.
- Denial of service by simply sending a very large volume of requests.
- Findings from automated scanners with no demonstrated exploit.
- Anything in a dependency that does not affect ABSuite's guarantees — report
  those upstream, though tell us if we should pin around it.

## Design decisions that are deliberate, not bugs

Please do not report these as vulnerabilities. Each is a considered choice, and
the reasoning is in [`PRINCIPLES.md`](./PRINCIPLES.md) and
[`docs/CONSTITUTION.md`](./docs/CONSTITUTION.md):

- **Traces are Ed25519-signed, not HMAC'd.** HMAC is symmetric, so anyone able
  to verify could also forge. Asymmetric signing means a verifier needs only the
  public key.
- **The revocation store fails closed.** When it is unreachable the guard
  returns `503` and authorises nothing. Availability is worth less than the
  guarantee.
- **Script execution is off unless `EDGERUN_SCRIPT_ROOT` is set.** Arbitrary
  execution is opt-in, always.
- **Human trust scoring is off unless `ABSUITE_TRUST_SCORE_HUMANS=true`.**
- **Public signup is off unless `ABSUITE_SIGNUP_ENABLED=true`**, because it
  mints credentials.
- **API keys are stored as SHA-256 only** and shown exactly once.
- **Payloads are hashed, never stored.** A trace proves what was processed
  without becoming a copy of your data.

## Verifying what you installed

Every package is published from CI with a signed Sigstore provenance
attestation. You do not have to take our word for what is in a tarball:

```bash
npm audit signatures
```

That checks the published artefact against the commit and workflow that built
it — which is, appropriately, the same thing this project asks you to demand of
your AI systems.

The same principle applies to the records themselves:
[**the browser verifier**](https://iamgodofall.github.io/ABSuite-core/verify.html)
checks a signed execution trace with WebCrypto, on your machine, using nothing
but a public key. If a claim in this document is wrong, that page is where you
would find out.
