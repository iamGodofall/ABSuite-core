/*
 * The suite runs source, never build output.
 *
 * `testMatch` is a glob over the whole tree, and every package compiles its
 * tests alongside its code — so a `dist/` left over from an earlier build gets
 * collected and run as if it were a suite. That is not a hypothetical: a root
 * `dist/cli.test.js` dated three days earlier was being executed on every local
 * run, testing a compiled `dist/index.js` that no current source produced.
 *
 * The damage is not the two extra tests. It is that the number stopped being
 * reproducible — CI checks out clean and counted 495, a working copy with a
 * stale build counted 497, and the README could only agree with one of them.
 * A test count that depends on whether you happened to build first is a figure
 * this repository is not entitled to print.
 *
 * Worse, those tests passed. They were asserting against July's compiled
 * output, so they would have gone on passing after the source they were built
 * from had been deleted.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],

  // Compiled output, vendored code, and the standalone interface bundle. Each
  // is a place a `.test.js` can appear without a person having written it there.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/dist-artifact/',
    '/build/',
    '/coverage/',
  ],

  moduleNameMapper: {
    '^better-sqlite3$': '<rootDir>/packages/edge-run/__mocks__/better-sqlite3.js',
  },

  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
};
