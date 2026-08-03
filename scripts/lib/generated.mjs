/**
 * Does a committed generated file still match its generator?
 *
 * ## Why this is not `===`
 *
 * It was, in six places across five generators, and every one of them failed on
 * Windows for a reason that had nothing to do with the content.
 *
 * Git for Windows checks out text files with CRLF by default. These generators
 * build their output in memory with `\n`. So `readFileSync(target)` returned
 * CRLF, `output` held LF, the two compared unequal, and `pnpm verify` stopped at
 * step three with:
 *
 *     docs/API.md is out of date. Run: pnpm docs:api
 *
 * Running `pnpm docs:api` did not fix it — it rewrote the identical document —
 * so the instruction in the error message was advice that could not work. That
 * is worse than a wrong answer: it sends someone to re-run a command until they
 * conclude the repository is broken, which on Windows it effectively was, since
 * no check after the third one could ever be reached.
 *
 * `.gitattributes` now normalises the working tree to LF, which is the actual
 * fix. This exists because a checkout that predates it, or a machine configured
 * some other way, must not turn a portability difference into a false claim that
 * a document disagrees with the code. **A newline is not a fact about content.**
 *
 * Deliberately narrow: only line endings are normalised. Trailing whitespace,
 * final newlines and encoding differences are real differences and still fail,
 * because the point of these checks is that a generated file nobody regenerated
 * gets caught.
 */

/** CRLF and CR both become LF. Nothing else is touched. */
const normalizeNewlines = (text) => String(text).replace(/\r\n?/g, '\n');

/**
 * True when the two differ only in how their lines end.
 *
 * Use this for every `--check` comparison of generated content, and never a bare
 * `===` — `check:cross-platform` fails the build if a generator goes back to
 * one.
 */
export function sameGenerated(current, generated) {
  return normalizeNewlines(current) === normalizeNewlines(generated);
}
