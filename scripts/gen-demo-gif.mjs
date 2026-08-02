#!/usr/bin/env node
/**
 * Render `pnpm demo` to docs/images/two-minute-demo.gif.
 *
 * The frames are the program's **real output**, captured by running it — not a
 * transcript somebody pasted into a template. A GIF that was hand-assembled
 * would be a picture of a claim rather than a recording of one, in a repository
 * whose whole argument is the difference.
 *
 * It is committed for the same reason every other figure here is derived: an
 * artifact nobody can regenerate is one nobody can check.
 *
 *   pnpm demo:gif
 *
 * Needs Chromium and two encoders that are not project dependencies, because
 * nothing at runtime should carry a GIF encoder:
 *
 *   npm i --no-save gifenc pngjs playwright-core
 *
 * PLAYWRIGHT_CHROMIUM overrides the browser path if yours is elsewhere.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
import { chromium } from 'playwright-core';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import pkg from 'pngjs';
const { PNG } = pkg;

/* ── 1. The real output ─────────────────────────────────────────────────── */

const raw = execFileSync('node', ['scripts/demo.mjs', '--fast'], {
  cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '3' },
});

/** ANSI → HTML. Only the codes the demo actually emits. */
const COLOURS = {
  '2': 'opacity:.55',
  '1': 'font-weight:700;color:#F4F7FA',
  '38;2;0;245;140': 'color:#00F58C',
  '38;2;239;68;68': 'color:#EF4444',
  '38;5;245': 'color:#7C9389',
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (text) =>
  esc(text)
    .replace(/\x1b\[([0-9;]+)m/g, (_, code) =>
      code === '0' ? '</span>' : `<span style="${COLOURS[code] ?? ''}">`)
    .replace(/\x1b\[0m/g, '</span>');

const lines = raw.split('\n').map(toHtml);

/* ── 2. Frames ──────────────────────────────────────────────────────────── */

const page = (visible, cursor) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#000;}
  .term{width:900px;height:640px;padding:22px 26px;box-sizing:border-box;
    background:#02070A;color:#F4F7FA;overflow:hidden;
    font:13px/1.55 ui-monospace,'DejaVu Sans Mono',Menlo,Consolas,monospace;
    background-image:linear-gradient(rgba(0,245,140,.035) 1px,transparent 1px),
      linear-gradient(90deg,rgba(0,245,140,.035) 1px,transparent 1px);
    background-size:34px 34px;}
  .bar{display:flex;gap:7px;margin-bottom:14px;align-items:center}
  .dot{width:10px;height:10px;border-radius:50%}
  .t{margin-left:10px;font-size:11px;color:#7C9389;letter-spacing:.09em}
  pre{margin:0;white-space:pre-wrap;word-break:break-word}
  .cur{background:#00F58C;color:#02070A}
</style>
<div class="term">
  <div class="bar">
    <span class="dot" style="background:#EF4444"></span>
    <span class="dot" style="background:#F59E0B"></span>
    <span class="dot" style="background:#00F58C"></span>
    <span class="t">pnpm demo</span>
  </div>
  <pre>${visible.join('\n')}${cursor ? '<span class="cur"> </span>' : ''}</pre>
</div>`;

// Keep the last 36 lines visible so the terminal scrolls rather than overflows.
const WINDOW = 36;
const frames = [];
for (let n = 1; n <= lines.length; n++) {
  const shown = lines.slice(Math.max(0, n - WINDOW), n);
  frames.push({ html: page(shown, n < lines.length), hold: 1 });
}
// Hold the final frame so the ending is readable before it loops.
frames.push({ html: page(lines.slice(-WINDOW), false), hold: 22 });

/* ── 3. Shoot ───────────────────────────────────────────────────────────── */

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const tab = await browser.newPage({ viewport: { width: 900, height: 640 } });

const encoder = GIFEncoder();
let palette = null;

for (let i = 0; i < frames.length; i++) {
  await tab.setContent(frames[i].html);
  const png = PNG.sync.read(await tab.screenshot({ type: 'png' }));
  const data = new Uint8Array(png.data);

  // One palette, taken from the busiest frame, so colours do not shimmer
  // between frames — a flickering demo reads as a broken one.
  if (!palette) palette = quantize(new Uint8Array(PNG.sync.read(
    await (async () => { await tab.setContent(frames[frames.length - 1].html); return tab.screenshot({ type: 'png' }); })()
  ).data), 128);

  const indexed = applyPalette(data, palette);
  encoder.writeFrame(indexed, png.width, png.height, { palette, delay: frames[i].hold * 90 });
  if (i % 10 === 0) process.stdout.write('.');
}

encoder.finish();
const target = join(root, 'docs/images/two-minute-demo.gif');
writeFileSync(target, Buffer.from(encoder.bytes()));
await browser.close();

const size = Buffer.from(encoder.bytes()).length;
console.log(`\nwrote ${target} — ${frames.length} frames, ${(size / 1024 / 1024).toFixed(2)} MB`);
