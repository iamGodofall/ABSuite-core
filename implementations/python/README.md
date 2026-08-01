# absuite-verify — a second implementation

A dependency-free Python verifier for the Agent Trust Record protocol.

```bash
python3 absuite_verify.py chain.json                    # content and linkage
python3 absuite_verify.py chain.json --key public.pem   # ... and signatures
python3 test_conformance.py                             # the §7 conformance suite
```

## Why it exists

Until a record format has been implemented twice, independently, *protocol* is a
word attached to one codebase. This verifies records signed by the TypeScript
implementation using nothing but [docs/PROTOCOL.md](../../docs/PROTOCOL.md) and
the published public key — which is the only evidence that the specification is
complete enough to build from.

It **verifies only**. It cannot produce a record, which is the honest shape for a
second implementation: one that also writes is a fork.

## No dependencies

Ed25519 is implemented here from RFC 8032. The argument this protocol makes is
that anybody can check a record without trusting whoever wrote it, and a verifier
that first asks you to install a native extension has put a step in front of
exactly the person it is trying to convince.

The first draft did import `cryptography` and fall back when it was missing. In
the environment it was written in, that package imports and then dies inside its
Rust backend raising a `PanicException` — which inherits from `BaseException`,
not `Exception`, so the fallback never caught it and the graceful path crashed. A
degradation path that is itself fragile is worse than none.

## What it found

Writing this changed the specification. §4.1 said "sort keys by Unicode code
point", and JavaScript sorts by UTF-16 code unit — identical for everything in
the Basic Multilingual Plane, different for astral characters such as emoji. Two
conformant implementations could disagree on a record with an emoji key. That is
now recorded in §9 as an open question rather than sitting undiscovered in the
gap between two codebases.

Finding it is what a second implementation is for.
