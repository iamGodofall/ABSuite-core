# Contributing to ABSuite

Thank you for investing time in ABSuite. This guide tells you everything you need to know to contribute effectively.

---

## 📋 Before You Start

### Open an issue first

For **anything beyond a small bug fix**, open an issue before you start coding. This helps:

- Align on the solution before wasted effort
- Avoid duplicate work
- Connect you with others who might be solving the same problem
- Give maintainers a chance to guide the design

Use the issue templates. They exist for a reason.

### Development setup

```bash
# Clone the repository
git clone https://github.com/iamGodofall/ABSuite-core.git
cd ABSuite-core

# Install dependencies (requires pnpm 9+)
corepack enable
pnpm install

# Verify everything builds
pnpm build

# Verify all tests pass
pnpm test

# Start the full stack locally
pnpm start
```

Required tools:
- **Node.js** 20+ — use [nvm](https://github.com/nvm-sh/nvm) on macOS/Linux or [nvm-windows](https://github.com/coreybutler/nvm-windows)
- **pnpm** 9+ — `corepack enable` or `npm install -g pnpm`
- **Docker** 24+ — for running integration tests and full stack

---

## 🏗️ Repository Structure

ABSuite uses a **pnpm monorepo** with workspaces. Each module is an independent package that can be built, tested, and published separately.

```
packages/
├── capkit/              # Security module — JWT, capabilities, policies
├── edge-run/            # Execution module — scheduler, runtime, healing
├── quickbench/          # Benchmarking module — performance testing
├── connector-starter/   # Connector scaffold — GitHub, Slack, Jira adapters
├── dashboard-ui/        # React dashboard — Vite + TypeScript
└── apps/                # SaaS frontend — multi-tenant layer
```

---

## 🔧 Making Changes

### Code style

- **TypeScript strict mode** — no `any`, always annotate return types
- **ESLint + Prettier** — run `pnpm lint` before committing
- **No default exports** — named exports only, helps with refactoring
- **Document public APIs** — JSDoc on exported functions and classes

### Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(capkit): add capability token rotation
fix(dashboard): correct theme toggle persistence
docs(readme): update architecture diagram
chore(edge-run): upgrade dependencies
test(quickbench): add A/B test coverage for KV cache
```

### Pull requests

**Smaller PRs merge faster.** Aim for one logical change per PR. A PR that fixes three things at once is harder to review and harder to revert if something goes wrong.

**PR checklist:**
- [ ] `pnpm build` passes locally
- [ ] `pnpm test` passes locally
- [ ] `pnpm lint` passes locally
- [ ] New tests added or updated for changed behavior
- [ ] No console.logs or debug code left in
- [ ] Documentation updated if behavior changed

---

## 🧪 Writing Tests

Unit tests live next to the code they test:

```
src/
├── scheduler.ts
└── scheduler.test.ts   # ← same directory
```

Integration tests live in a `tests/` directory at the package root.

```bash
# Run tests for all packages
pnpm test

# Run tests for a specific package with coverage
pnpm --filter capkit test --coverage

# Run tests in watch mode during development
pnpm --filter edge-run test --watch
```

### Test conventions

- **Describe blocks** use the class/function name: `describe('AgentScheduler')`
- **Test blocks** use the action + expected outcome: `it('retries failed tasks with exponential backoff')`
- **Fixtures** are deterministic and don't depend on external services
- **Integration tests** are marked with `it.skip` if they require Docker and are run separately

---

## 🐳 Adding a New Package

ABSuite modules are published as independent npm packages. To add a new module:

1. Create `packages/<module-name>/package.json` with proper workspace references
2. Add it to the `workspaces` array in the root `package.json`
3. Copy the TypeScript config from an existing package
4. Add Docker configuration to `docker-compose.yml`
5. Write tests from day one

---

## 🐛 Reporting Bugs

Use the **Bug Report** issue template. Include:

- ABSuite version (run `pnpm cli version`)
- Node.js version and OS
- Steps to reproduce, with minimal code if possible
- Actual behavior vs expected behavior
- Full error messages and stack traces
- Docker vs local runtime (if applicable)

**The fastest way to get a bug fixed is to provide a minimal reproduction.** If you can isolate the bug to a specific package and include a test that fails, that's the gold standard.

---

## 💡 Suggesting Features

Use the **Feature Request** issue template. Explain:

- What problem you're solving
- How you imagine it working
- Why this belongs in ABSuite core vs a standalone package
- Any alternative solutions you've considered

We take all suggestions seriously. Not every feature will be accepted — that's normal. The issue gives us a place to discuss the tradeoffs before you invest time building.

---

## 📖 Documentation

Docs live in the repo alongside code. If you change an API, update the docs in the same PR. If you find a doc that's wrong or unclear, fix it — no issue needed for doc fixes.

- `README.md` — Getting started and high-level overview
- `docs/ARCHITECTURE.md` — System design and module interactions
- `docs/API.md` — API reference for each module
- `docs/SECURITY.md` — Security model and threat analysis

---

## 🚀 Release Process

Releases are managed by the maintainers. The process is:

1. Version bump in `package.json` (follows SemVer)
2. `CHANGELOG.md` updated with all changes since last release
3. GitHub release created with tag
4. Docker images built and pushed to registry
5. npm packages published (for installable modules)

Contributors don't need to manage releases. Just submit a great PR and the maintainers will handle the rest.

---

## 📤 Getting Help

- **Questions?** Open a Discussion in the GitHub repo
- **Bug reports?** Use the issue tracker
- **Quick questions?** The issue tracker is also fine — we respond within 48 hours

---

_This guide is itself open source. If something is unclear or missing, a PR to improve it is welcome._
