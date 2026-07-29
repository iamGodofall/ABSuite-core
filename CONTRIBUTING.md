# Contributing to ABSuite

Thank you for the time. Everything below has been run against this repository —
if a command here does not work, that is a bug in this file and a pull request
fixing it is welcome without an issue first.

## Before you start

For anything beyond a small fix, [open an issue](https://github.com/iamGodofall/ABSuite-core/issues/new/choose)
before writing code. It avoids duplicate work and gives us a place to disagree
about the design cheaply, before either of us has invested in it.

Security vulnerabilities do **not** go in the issue tracker. See
[`SECURITY.md`](./SECURITY.md).

## Development setup

**Node 22.5 or newer is required.** Not 20, not 18. The persistence layer is
built on `node:sqlite`, which does not exist before 22.5, and the failure if you
try is an unhelpful module-not-found.

```bash
git clone https://github.com/iamGodofall/ABSuite-core.git
cd ABSuite-core

corepack enable          # pnpm 9+
pnpm install

pnpm build               # also type-checks
pnpm test                # 405 tests, ~7 seconds
pnpm docs:check          # fails if docs/API.md has drifted from the routes
```

Docker 24+ is needed only for `pnpm start`, which brings up the whole suite.

## Repository structure

pnpm workspaces. Every package builds, tests and publishes independently.

```
packages/
├── capkit/              # Capability tokens, audit, execution traces, tenancy
├── trust/               # Evidence validation, trust events, arbitration
├── edge-run/            # Scheduling, task queue, retries, self-healing
├── quickbench/          # LLM and HTTP benchmarking
├── connector-starter/   # Connector registry and scaffolding
├── mcp/                 # Model Context Protocol server with attestation
├── cli/                 # The `absuite` command
└── dashboard-ui/        # React dashboard (Vite)
```

## Making changes

### Code style

- TypeScript strict mode. No `any`, annotate return types.
- Named exports only — no default exports.
- JSDoc on anything exported. Say *why*, not *what*; the signature already says
  what.
- `pnpm lint` before committing.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(capkit): add capability token rotation
fix(trust): stop segmentation splitting on decimal points
docs(readme): correct the minimum Node version
```

### Pull requests

One logical change per PR. A PR that fixes three things is harder to review and
harder to revert when one of the three turns out to be wrong.

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm docs:check` passes
- [ ] A test that fails without the change and passes with it
- [ ] Docs updated in the same PR if behaviour changed

## Tests

Unit tests sit next to the code:

```
src/
├── scheduler.ts
└── scheduler.test.ts
```

```bash
pnpm test                                    # everything
pnpm --filter capkit test                    # one package
pnpm --filter capkit test -- --coverage      # note the bare `--`
pnpm --filter edge-run test -- --watch
```

The bare `--` is not optional. Without it pnpm claims the flag for itself and
fails with `Unknown option: 'coverage'`, which is what broke this project's own
deployment pipeline.

### Conventions

- `describe` names the unit: `describe('TraceStore')`.
- `test` names the behaviour and the expectation:
  `test('detects an altered outcome')`.
- Fixtures are deterministic and touch no external service.
- **A test must be able to fail.** A test that passes against broken code is
  worse than no test, because it converts silence into false confidence.

## What gets merged

This project makes claims about verifiability, so contributions are held to
them. See [`PRINCIPLES.md`](./PRINCIPLES.md) — the short version:

- **Evidence over opinion.** If the code cannot demonstrate it, the docs must
  not assert it.
- **Facts over scores.** Report counts people can contest, not verdicts about
  them. Anything that would let ABSuite output "this person scores 42" will be
  declined regardless of how well it is written.
- **Confidence never determines truth.** Agreement between models is not
  evidence, and a high number is not a fact.

## Adding a package

1. `packages/<name>/package.json` — copy `publishConfig`, `files`, `license`,
   `repository` and `engines` from an existing package. A missing
   `repository.url` fails the npm publish with an opaque 422.
2. Cross-package dependencies use `workspace:^`, never `workspace:*`.
   `workspace:*` publishes as an **exact** pin, which stops consumers
   deduplicating and denies them patch releases.
3. Copy `tsconfig.json` from a sibling.
4. Add a `test` script following the existing pattern — per-package jest needs
   `-c ../../jest.config.js`, or it finds no config and reports success having
   run nothing.
5. Add the service to `docker-compose.yml` if it is long-running.
6. Add the package name to the publish list in
   `.github/workflows/publish.yml`.

## Documentation

Docs live beside the code. `docs/API.md` is **generated** — edit
`scripts/gen-api-docs.mjs` or the route definitions, then run `pnpm docs:api`.
CI fails if it has drifted.

- [`README.md`](./README.md) — what this is and the sixty-second version
- [`PRINCIPLES.md`](./PRINCIPLES.md) — the rules the code is held to
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design
- [`docs/API.md`](./docs/API.md) — generated HTTP reference
- [`docs/SECURITY-MODEL.md`](./docs/SECURITY-MODEL.md) — threat model
- [`SECURITY.md`](./SECURITY.md) — how to report a vulnerability

## Releases

Maintainers cut releases. Publishing is manual on purpose: it is irreversible,
so it is never triggered by a push.

1. Version bumps and a `CHANGELOG.md` entry.
2. The **Tag and release** workflow builds, tests and checks docs *before*
   creating the tag — a tag is a claim that a commit is releasable, and this
   project does not take claims on faith.
3. The **Publish to npm** workflow publishes with
   `--provenance`, attaching a signed Sigstore attestation of the exact commit
   and workflow that produced each tarball.

Contributors do not need to run any of this.

## Getting help

Open an issue. This project is maintained by one person, so the honest
expectation is a reply within a few days rather than a few hours — you will be
told plainly if something is going to take longer.

---

_This guide is part of the repository. If something here is unclear, missing or
untrue, a PR fixing it needs no issue._
