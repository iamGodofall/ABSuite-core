#!/usr/bin/env node
/**
 * A deployment manifest must be able to deploy.
 *
 * Every other check in this repository reads source, docs, routes or the
 * interface. None of them read the files that claim to install the product,
 * and those files had drifted further than anything the other checks guard.
 *
 * What was found the first time this ran:
 *
 *   - `helm-chart/` contained Chart.yaml and a 250-line values.yaml describing
 *     autoscaling, LDAP, SIEM export, Prometheus and a 99.9% uptime target —
 *     and no templates/ directory at all. `helm install` would have created
 *     zero resources. Every knob in that file was a setting for nothing.
 *
 *   - `k8s/` had manifests for three of the five services. quickbench,
 *     connector-starter and trust had none, so the dashboard would have come
 *     up and reported three services permanently unreachable.
 *
 *   - The dashboard manifest set `EDGERUN_URL` and `CONNECTOR_URL`. The server
 *     reads `EDGE_RUN_URL` and `CONNECTOR_STARTER_URL`. Neither variable was
 *     ever read, and because the code falls back to a Docker-style hostname
 *     the failure was silent rather than loud.
 *
 *   - Every image referenced `absuite/<service>:latest`. CD publishes
 *     `ghcr.io/<owner>/absuite-<service>:<sha>` and pushes no `latest` tag at
 *     all, so every pull would have failed.
 *
 * None of that is exotic. It is what happens to infrastructure files over a
 * year when nothing reads them, and it matters here more than in most projects,
 * because the argument this product makes is that nothing may look more
 * complete than it is. A chart that deploys nothing while describing an SLA is
 * that failure in its purest form — a fabricated capability, in YAML, where
 * check-no-fabrication.mjs cannot see it.
 *
 * The four rules below are the ones that can be checked without a cluster.
 * They compare the manifests against three sources of truth already in the
 * repository: docker-compose.yml for which services exist, the dashboard's own
 * server.ts for which variables it reads, and cd.yml for which images are
 * actually published.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(root, p);

const failures = [];
const passes = [];

/* ── Sources of truth ─────────────────────────────────────────────────────── */

const compose = parse(readFileSync(join(root, 'docker-compose.yml'), 'utf8'));
/** The services that make up the product, less the volume-init helper. */
const SERVICES = Object.keys(compose.services).filter(name => name !== 'absuite-db');

const cd = readFileSync(join(root, '.github/workflows/cd.yml'), 'utf8');
/** Image basenames CD actually builds and pushes. */
const publishedImages = new Set(
  [...cd.matchAll(/\/(absuite-[a-z-]+):/g)].map(match => match[1]),
);
/** CD tags by commit sha. A manifest pinning `latest` pins a tag nobody pushes. */
const publishesLatest = /absuite-[a-z-]+:latest/.test(cd);

const dashboardServer = readFileSync(join(root, 'packages/dashboard-ui/server.ts'), 'utf8');
/** Every environment variable the orchestrator reads, by name. */
const readsEnv = new Set(
  [...dashboardServer.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(match => match[1]),
);

/* ── Manifests under inspection ───────────────────────────────────────────── */

const k8sDir = join(root, 'k8s');
const manifests = existsSync(k8sDir)
  ? readdirSync(k8sDir).filter(f => /\.ya?ml$/.test(f)).map(f => ({
      file: rel(join(k8sDir, f)),
      // A manifest file may hold several documents separated by ---; every one
      // of them is a resource that has to be right.
      docs: readFileSync(join(k8sDir, f), 'utf8').split(/^---\s*$/m).map(d => {
        try { return parse(d); } catch { return null; }
      }).filter(Boolean),
      text: readFileSync(join(k8sDir, f), 'utf8'),
    }))
  : [];

/* ── 1. A chart with values must have templates ───────────────────────────── */
//
// Helm renders templates/. A chart without that directory installs nothing,
// however long its values file is — and a long values file is precisely what
// makes the absence hard to notice.

const chartDir = join(root, 'helm-chart');
if (existsSync(chartDir)) {
  const templates = join(chartDir, 'templates');
  const hasTemplates = existsSync(templates) &&
    readdirSync(templates).some(f => /\.ya?ml$/.test(f) && statSync(join(templates, f)).size > 0);

  if (hasTemplates) {
    passes.push('helm-chart renders templates');
  } else {
    const valuesPath = join(chartDir, 'values.yaml');
    const lines = existsSync(valuesPath) ? readFileSync(valuesPath, 'utf8').split('\n').length : 0;
    failures.push(
      `helm-chart/ has no templates/ directory with any manifest in it, so \`helm install\` creates nothing.\n` +
      `      values.yaml is ${lines} lines of settings for resources that are never rendered.\n` +
      `      Write the templates, or remove the chart. A chart that configures an SLA it\n` +
      `      cannot deploy is the fabrication this repository exists to refuse.`,
    );
  }
}

/* ── 2. Every service the product has needs a manifest ────────────────────── */
//
// Checked against docker-compose.yml rather than a list written here, so
// adding a service to the product cannot silently skip the cluster path.

/*
 * Two shapes are legitimate, and the check has to know both.
 *
 * A per-service manifest set needs one workload per service in compose. A
 * single-container set needs exactly one workload running the all-in-one
 * image, which contains all six by construction.
 *
 * What is not legitimate is the state this replaced: a per-service set missing
 * two thirds of its services, which is neither shape and which no rule written
 * for only one of them would have caught.
 */
if (manifests.length > 0) {
  const workloads = [];
  for (const manifest of manifests) {
    for (const doc of manifest.docs) {
      if (doc?.kind !== 'Deployment' && doc?.kind !== 'StatefulSet') continue;
      const images = (doc.spec?.template?.spec?.containers ?? []).map(c => c.image ?? '');
      workloads.push({ name: doc.metadata?.name, images, file: manifest.file });
    }
  }

  const allInOne = workloads.filter(w => w.images.some(i => /absuite-allinone/.test(i)));

  if (allInOne.length === 1 && workloads.length === 1) {
    passes.push(`one workload running the all-in-one image, covering all ${SERVICES.length} services`);
  } else if (allInOne.length > 0) {
    failures.push(
      `k8s/ mixes shapes: ${workloads.length} workloads, ${allInOne.length} of them the all-in-one image.\n` +
      `      The all-in-one image already contains every service. Running it alongside\n` +
      `      per-service workloads means two copies of each service against one SQLite file.`,
    );
  } else {
    const declared = new Set(workloads.map(w => w.name));
    const missing = SERVICES.filter(service => !declared.has(service));
    if (missing.length === 0) {
      passes.push(`every service in docker-compose.yml has a k8s workload (${SERVICES.length})`);
    } else {
      failures.push(
        `k8s/ has no Deployment for: ${missing.join(', ')}.\n` +
        `      docker-compose.yml runs ${SERVICES.length} services; the cluster manifests cover ${SERVICES.length - missing.length}.\n` +
        `      The interface would come up and report the rest permanently unreachable.\n` +
        `      Either add the missing workloads, or deploy the all-in-one image instead.`,
      );
    }
  }

  /*
   * A shared single-writer volume and more than one replica cannot both be
   * right. This is the contradiction the previous manifests shipped: capkit at
   * replicas 2, an autoscaler to 10, and a ReadWriteOnce claim underneath.
   */
  for (const manifest of manifests) {
    for (const doc of manifest.docs) {
      if (doc?.kind !== 'Deployment' && doc?.kind !== 'StatefulSet') continue;
      const replicas = doc.spec?.replicas;
      const claims = (doc.spec?.template?.spec?.volumes ?? [])
        .filter(v => v.persistentVolumeClaim).map(v => v.persistentVolumeClaim.claimName);
      if (!claims.length || typeof replicas !== 'number' || replicas <= 1) continue;

      const rwo = manifests.some(m => m.docs.some(d =>
        d?.kind === 'PersistentVolumeClaim' &&
        claims.includes(d.metadata?.name) &&
        (d.spec?.accessModes ?? []).includes('ReadWriteOnce')));

      if (rwo) {
        failures.push(
          `${manifest.file}: ${doc.metadata?.name} runs ${replicas} replicas against a ReadWriteOnce claim.\n` +
          `      The volume mounts on one node, so the second pod either never schedules or\n` +
          `      writes concurrently to a SQLite file that permits one writer.`,
        );
      }
    }
  }

  /* An autoscaler on a workload that cannot have two replicas. */
  for (const manifest of manifests) {
    for (const doc of manifest.docs) {
      if (doc?.kind !== 'HorizontalPodAutoscaler') continue;
      const target = doc.spec?.scaleTargetRef?.name;
      const workload = workloads.find(w => w.name === target);
      if (!workload) continue;
      const pinned = manifests.some(m => m.docs.some(d =>
        (d?.kind === 'Deployment' || d?.kind === 'StatefulSet') &&
        d.metadata?.name === target && d.spec?.replicas === 1));
      if (pinned) {
        failures.push(
          `${manifest.file}: an autoscaler targets ${target}, which is pinned to one replica.\n` +
          `      Scaling it horizontally is not available until the storage layer supports\n` +
          `      more than one writer. An HPA here is a setting for something that cannot happen.`,
        );
      }
    }
  }
}

/* ── 3. A *_URL the code never reads is not configuration ─────────────────── */
//
// The most dangerous of the four, because it fails silently: server.ts falls
// back to a Docker service name, so a misspelled variable produces a working
// container in compose and an unreachable service in a cluster.

for (const manifest of manifests) {
  for (const doc of manifest.docs) {
    const containers = [
      ...(doc?.spec?.template?.spec?.containers ?? []),
      ...(doc?.spec?.template?.spec?.initContainers ?? []),
    ];
    for (const container of containers) {
      for (const entry of container.env ?? []) {
        if (!/_URL$/.test(entry.name ?? '')) continue;
        // Only the orchestrator's variables are checked here; a service that
        // reads its own is out of scope for a file that only parsed server.ts.
        if (!/^(CAPKIT|EDGE_RUN|EDGERUN|QUICKBENCH|CONNECTOR|CONNECTOR_STARTER|TRUST|DASHBOARD)_URL$/.test(entry.name)) continue;
        if (!readsEnv.has(entry.name)) {
          const candidates = [...readsEnv].filter(v => /_URL$/.test(v));
          failures.push(
            `${manifest.file}: sets ${entry.name}, which packages/dashboard-ui/server.ts never reads.\n` +
            `      The value is discarded and the code falls back to a Docker hostname, so this\n` +
            `      fails silently in a cluster rather than loudly.\n` +
            `      It reads: ${candidates.sort().join(', ')}`,
          );
        }
      }
    }
  }
}

/* ── 4. An image reference must name something CD publishes ───────────────── */

for (const manifest of manifests) {
  for (const doc of manifest.docs) {
    const containers = doc?.spec?.template?.spec?.containers ?? [];
    for (const container of containers) {
      const image = container.image;
      if (!image || typeof image !== 'string') continue;
      // Third-party images (alpine, busybox) are not ours to publish.
      if (!/absuite/i.test(image)) continue;

      const [repository, tag] = image.split(':');
      const basename = repository.split('/').pop();

      if (!publishedImages.has(basename)) {
        failures.push(
          `${manifest.file}: image "${image}" — CD publishes no image named "${basename}".\n` +
          `      It publishes: ${[...publishedImages].sort().join(', ')}\n` +
          `      under ghcr.io/<owner>/. Every pull of this manifest would fail.`,
        );
      } else if (tag === 'latest' && !publishesLatest) {
        failures.push(
          `${manifest.file}: image "${image}" pins :latest, and cd.yml pushes only :<sha>.\n` +
          `      The tag does not exist in the registry. Pin a digest or a sha tag, or\n` +
          `      publish a moving tag deliberately — but do not reference one by hope.`,
        );
      }
    }
  }
}

/* ── 5. A Dockerfile may only COPY paths that exist ───────────────────────── */
//
// deploy/Dockerfile carried `COPY packages/mcp-server/package.json`. The
// directory is packages/mcp. The path was written from memory, nothing in the
// repository read Dockerfiles, and the only thing that could catch it was a
// container build — which needs a daemon, which the machine it was written on
// did not have. So it went in green and CD failed for three commits with
// "/packages/mcp-server/package.json: not found" while everything local passed.
//
// A build that takes four minutes to tell you a filename is wrong should not be
// the first thing that tells you a filename is wrong.

const dockerfiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/^Dockerfile/.test(entry)) dockerfiles.push(full);
  }
})(root);

let copyPaths = 0;
for (const file of dockerfiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/^\s*COPY\s+(?!--from)(.+)$/gim)) {
    // Everything but the final argument is a source; the last is the
    // destination inside the image and is not ours to check.
    const args = match[1].trim().split(/\s+/);
    if (args.length < 2) continue;
    for (const source of args.slice(0, -1)) {
      // Build-context-relative, and globs are left alone — a glob that matches
      // nothing is a different and much rarer mistake than a typo.
      if (source.startsWith('--') || /[*?[\]]/.test(source) || source === '.') continue;
      copyPaths += 1;
      if (!existsSync(join(root, source))) {
        failures.push(
          `${rel(file)}: COPY ${source} — no such path in the build context.\n` +
          `      The image build fails on this with "not found", four minutes in.`,
        );
      }
    }
  }
}
if (dockerfiles.length > 0 && !failures.some(f => /COPY /.test(f))) {
  passes.push(`${copyPaths} COPY path(s) across ${dockerfiles.length} Dockerfile(s) exist`);
}

/* ── 6. A package's workspace dependencies must be in its image ───────────── */
//
// The path check above verifies that every COPY names something real. It cannot
// notice a COPY that is *missing*, and that is the shape this failed in next.
//
// `packages/dashboard-ui` gained a `workspace:^` dependency on capkit — for the
// outbound guard that /endpoint-check needs — and its Dockerfile still copied
// only its own directory. `pnpm install --frozen-lockfile` then could not
// resolve `@absuitecore/capkit`, and every container build failed for five
// hours while `pnpm verify` stayed green, because nothing local installs from a
// Dockerfile's build context.
//
// A dependency edge added in one file and not the other is the same hand-copied
// fact this repository keeps finding. Here it is checked instead.

let edges = 0;
for (const file of dockerfiles) {
  const text = readFileSync(file, 'utf8');
  const owner = rel(file).match(/^packages\/([a-z-]+)\/Dockerfile$/)?.[1];
  if (!owner) continue;   // deploy/Dockerfile copies the whole context.

  // A Dockerfile that copies everything needs no per-package COPY.
  if (/^\s*COPY\s+\.\s+\.\s*$/m.test(text)) continue;

  const manifestPath = join(root, 'packages', owner, 'package.json');
  if (!existsSync(manifestPath)) continue;

  const deps = JSON.parse(readFileSync(manifestPath, 'utf8')).dependencies ?? {};
  for (const [name, range] of Object.entries(deps)) {
    if (!String(range).startsWith('workspace:')) continue;
    const dir = name.replace('@absuitecore/', '');
    edges += 1;

    if (!new RegExp(`COPY\\s+packages/${dir}/`).test(text)) {
      failures.push(
        `${rel(file)}: depends on ${name} (workspace:) and never COPYs packages/${dir}/.\n` +
        `      pnpm install cannot resolve a workspace package that is not in the build context.\n` +
        `      The image build fails; nothing local does, because nothing local installs from a Dockerfile.`,
      );
    }
  }
}
if (edges > 0 && !failures.some(f => /workspace:/.test(f))) {
  passes.push(`${edges} workspace dependency edge(s) present in the image that needs them`);
}

/* ── Report ───────────────────────────────────────────────────────────────── */

for (const line of passes) console.log(`✓ ${line}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} deployment manifest problem(s):\n`);
  for (const line of failures) console.error(`  ✗ ${line}\n`);
  console.error('A manifest that cannot deploy is a claim with nothing behind it.\n');
  process.exit(1);
}

console.log(`\n${manifests.length} manifest file(s) checked against compose, server.ts and cd.yml.`);
