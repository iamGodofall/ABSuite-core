#!/usr/bin/env node
/**
 * The interaction model must not regress.
 *
 * The remaining risk in this interface is no longer fabrication — that is
 * covered. It is regression. Someone six months from now, with entirely good
 * intentions, adds `<Sidebar />` because a page needs navigation, and ABSuite
 * is a SaaS admin panel again. Nothing in the test suite would notice, because
 * every test passes and every number is still real.
 *
 * Four assertions, each phrased as an absence. Absences are far harder to
 * satisfy by accident than presences: a check for "the cube exists" passes on a
 * dashboard with a cube in it, which is exactly how the earlier checks let a
 * dashboard through while reporting compliance.
 *
 *   1. No permanent navigation.
 *   2. No document-flow primary layout.
 *   3. The cube is the primary interaction model.
 *   4. State precedes explanation.
 *
 * Scope is the shell — App.tsx and src/room. A layer's own surface may lay
 * itself out however it likes once you are inside it; the doctrine governs how
 * you move between places, not what a place contains.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiRoot = join(root, 'packages/dashboard-ui/src');
const roomDir = join(uiRoot, 'room');

const shell = [join(uiRoot, 'App.tsx')];
if (existsSync(roomDir)) {
  for (const entry of readdirSync(roomDir)) {
    if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) shell.push(join(roomDir, entry));
  }
}

const read = (file) => ({ file: relative(root, file), text: readFileSync(file, 'utf8') });
const sources = shell.map(read);

const failures = [];
const passes = [];

/** Comment bodies blanked, offsets preserved — prose about a sidebar is not one. */
const strip = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, blank => blank.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length));

const code = sources.map(source => ({ ...source, text: strip(source.text) }));

// ── 1. assertNoPermanentNavigation ──────────────────────────────────────────
//
// A nav landmark, an aside, or a component named Sidebar. Any of the three is
// a standing list of destinations, which is the thing a room does not have.

const NAV = /<nav\b|<aside\b|\bSidebar\b|\bNavRail\b|\bTabBar\b/;
const navOffenders = code.filter(source => NAV.test(source.text));
if (navOffenders.length === 0) passes.push('no permanent navigation in the shell');
else for (const offender of navOffenders) {
  failures.push(`${offender.file}: the shell contains permanent navigation (<nav>, <aside>, or a Sidebar-like component). A room has no standing list of destinations — you move through it.`);
}

// ── 2. assertNoDocumentFlowPrimaryLayout ────────────────────────────────────
//
// The shell must not be a scrolling document. Scrolling *inside* something you
// entered is fine and expected; scrolling as the way you move between things is
// the dashboard's defining behaviour.

const rootScrolls = code.some(source =>
  /className="[^"]*\bmin-h-screen\b[^"]*"/.test(source.text) ||
  /<main[^>]*className="[^"]*overflow-y-auto/.test(source.text));
if (!rootScrolls) passes.push('the shell is a fixed canvas, not a scrolling document');
else failures.push('The shell lays itself out as a scrolling document (min-h-screen, or a scrolling <main>). One canvas, many depths — scrolling belongs inside a place you entered, not between places.');

// ── 3. assertCubeIsPrimaryInteractionModel ──────────────────────────────────
//
// The cube must be mounted by the shell and must carry navigation. Mounting it
// is not enough — a cube nobody can steer is decoration, which is the state
// this interface spent several revisions in.

/*
 * The shell is found by role, not by filename.
 *
 * This resolved `src/room/Environment.tsx` by path for its whole first life,
 * and the day the shell was replaced with a better one the check did not
 * report a violation — it reported that the file was missing, which is a
 * different and much weaker claim. A doctrine check that only works while the
 * implementation it was written against still exists is a check that retires
 * itself the first time someone improves the interface.
 *
 * The shell is now whatever room module mounts the core. That is the actual
 * definition, and it survives renaming.
 */
const CORE = /<(?:Scene|TrustCube|CoreCube|SceneCube)\b/;
const shellCandidates = code.filter(source => /room[\\/]/.test(source.file) && CORE.test(source.text));
// The scene component mounts the cube too; the shell is the one that is not
// itself the scene — it is the module the app renders as its root.
const environment = shellCandidates.find(source => !/room[\\/]Scene\.tsx$/.test(source.file));

if (!environment) {
  failures.push('No shell mounts the core. Some module under src/room must render the cube as the root of the interface — the cube is the operating system, not a component a page may choose to include.');
} else {
  const steerable = /onPointerUp|onWheel|onDoubleClick|onPointerDown/.test(environment.text);
  // The call is usually conditional — commit(dx > 0 ? 'verify' : 'govern') —
  // so match a layer name anywhere in the argument rather than only at its head.
  const commits = /commit\([^)]*['"](?:observe|verify|explain|govern)['"]/.test(environment.text);

  if (steerable && commits) passes.push(`the cube is mounted by the shell and drives navigation (${environment.file})`);
  else {
    if (!steerable) failures.push('The shell mounts the cube but binds no gesture to it. A cube nobody can steer is decoration.');
    if (!commits) failures.push('No gesture resolves to a layer. Manipulating the cube must be how you enter Observe, Verify, Explain and Govern.');
  }
}

// ── 4. assertStatePrecedesExplanation ───────────────────────────────────────
//
// A station renders its figure before its purpose. Enforced structurally: the
// headline must appear earlier in the component than the purpose text, because
// order in the source is order on the screen.

// Checked where the stations are actually drawn, which is the node layer —
// again by role rather than by the field names one implementation happened to
// use. A station shows what it read before it explains what it is for.
const stations = code.find(source => /reading\?\.(?:metric|state)/.test(source.text) && /\.desc\b/.test(source.text));

if (!stations) {
  failures.push('No component renders a station with both a reading and a purpose. A station must show what it measured and what it is for.');
} else {
  const readingAt = stations.text.indexOf('reading?.metric');
  const purposeAt = stations.text.indexOf('layer.desc');

  if (readingAt === -1 || purposeAt === -1) {
    failures.push('A station must render both a reading (its state) and a purpose (its explanation). One of them is missing.');
  } else if (readingAt < purposeAt) {
    passes.push(`state precedes explanation on every station (${stations.file})`);
  } else {
    failures.push('A station renders its purpose before its state. Mission Control leads with the reading, not with a sentence about what the reading is for.');
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

for (const line of passes) console.log(`✓ ${line}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} doctrine violation(s) in the shell:\n`);
  for (const line of failures) console.error(`  ✗ ${line}\n`);
  console.error('ABSuite is not software you browse. It is evidence you inhabit.\n');
  process.exit(1);
}

console.log(`\n${sources.length} shell file(s) checked. The interaction model holds.`);
