#!/usr/bin/env node
/**
 * The specification and the implementation, checked against each other.
 *
 * docs/PROTOCOL.md describes a record format independently of the TypeScript
 * that writes it — which is the whole point of having it, and also the whole
 * risk. A specification nobody executes drifts from the code within one release,
 * and a drifted specification is worse than none: somebody writes a second
 * implementation against it, their records fail to verify, and the document that
 * misled them looks authoritative.
 *
 * So every normative claim in that document is asserted here against the real
 * canonicaliser, using the frozen fixtures as conformance vectors. If the spec
 * says v1 is sixteen elements, this counts sixteen elements.
 */
import { readFileSync } from 'node:fs';
import { createHash, verify as cryptoVerify, createPublicKey } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const { canonicalTrace, hashTrace, verifyTrace, GENESIS_HASH } = await import(R+'packages/capkit/dist/index.js');

const v1 = JSON.parse(readFileSync(R+'packages/capkit/src/fixtures/frozen-chain.json','utf8'));
const v2 = JSON.parse(readFileSync(R+'packages/capkit/src/fixtures/frozen-chain-v2.json','utf8'));
let ok = true;
const check = (label, pass, detail='') => { console.log((pass?'✓':'✗')+' '+label+(detail?'  '+detail:'')); if(!pass) ok=false; };

// §5.1 genesis
check('§5.1 genesis is 64 zeros', GENESIS_HASH === '0'.repeat(64));

// §4.2 v1 element count
const { hash:_h, signature:_s, ...plain } = v1.records[0];
const { hash:_h2, signature:_s2, ...governed } = v1.records[2];
check('§4.2 v1 uncosted is 16 elements', JSON.parse(canonicalTrace(plain)).length === 16, `got ${JSON.parse(canonicalTrace(plain)).length}`);
check('§4.2 v1 governed appends a 17th', JSON.parse(canonicalTrace(governed)).length === 17, `got ${JSON.parse(canonicalTrace(governed)).length}`);

// §4.3 v2 element count and version-first
const { hash:_h3, signature:_s3, ...costed } = v2.records[1];
const form2 = JSON.parse(canonicalTrace(costed));
check('§4.3 v2 is 19 elements', form2.length === 19, `got ${form2.length}`);
check('§4.3 version marker is first', form2[0] === 2);

// §4.4 oldest form that fits
check('§4.4 uncosted record in a v2 chain is still v1', (v2.records[0].canonicalVersion ?? 1) === 1);

// §5.2 signature is over the hex string
const pub = createPublicKey(v2.publicKeyPem);
const rec = v2.records[1];
check('§5.2 Ed25519 over the hex string of the hash',
  cryptoVerify(null, Buffer.from(rec.hash,'utf8'), pub, Buffer.from(rec.signature,'base64')));
check('§5.2 NOT over the raw hash bytes',
  !cryptoVerify(null, Buffer.from(rec.hash,'hex'), pub, Buffer.from(rec.signature,'base64')));

// §7 conformance: both fixtures verify from the published key alone
for (const [name, f] of [['v1',v1],['v2',v2]]) {
  const all = f.records.every(r => verifyTrace(r, f.publicKeyPem).valid);
  check(`§7 ${name} fixture verifies from its public key alone`, all);
  const hashes = f.records.every(r => { const {hash,signature,...u}=r; return hashTrace(u)===hash; });
  check(`§7 ${name} hashes are byte-identical`, hashes);
}

// §4.2 v1 refuses a costed record
let refused = false;
try { canonicalTrace({ ...plain, cost: { amount:1, currency:'USD', source:'x' } }); }
catch (e) { refused = /must declare v2|no slot/.test(e.message); }
check('§4.2 v1 refuses to hash a costed record', refused);

// §4.5 unknown version is unreadable, not invalid
const future = { ...v2.records[1], canonicalVersion: 99 };
const verdict = verifyTrace(future, v2.publicKeyPem);
check('§4.5 unknown version reports unreadable, not tampered',
  verdict.checkable === false && verdict.contentIntact === null);

// §6 signature not checked is not "verified"
check('§6 no key supplied → signatureValid is null, not true',
  verifyTrace(v2.records[1]).signatureValid === null);

console.log(ok ? '\nEvery normative claim in PROTOCOL.md holds against the implementation.'
               : '\nSPEC AND CODE DISAGREE.');
process.exit(ok?0:1);
