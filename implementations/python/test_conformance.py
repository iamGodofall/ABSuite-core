"""
§7 conformance, plus the failure modes §6 requires an implementation to keep apart.

This is the file that decides whether the Agent Trust Record is a protocol or a
description of one codebase. It runs a Python implementation against records
signed by a TypeScript one, using nothing but the public key stored beside them.

    python3 test_conformance.py

No test framework, on purpose: a conformance suite that needs pytest installed
is a conformance suite somebody skips.
"""

from __future__ import annotations

import copy
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from absuite_verify import (  # noqa: E402
    GENESIS_HASH,
    Outcome,
    canonical_form,
    canonical_json,
    hash_record,
    public_key_bytes,
    verify_chain,
    verify_record,
    verify_signature,
)

FIXTURES = pathlib.Path(__file__).parents[2] / "packages" / "capkit" / "src" / "fixtures"

passed = 0
failed: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  \033[32m✓\033[0m {label}" + (f"  {detail}" if detail else ""))
    else:
        failed.append(label)
        print(f"  \033[31m✗\033[0m {label}" + (f"  {detail}" if detail else ""))


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


v1 = load("frozen-chain.json")
v2 = load("frozen-chain-v2.json")


# --------------------------------------------------------------------------- #
print("\n§7.1  The frozen chains verify, from the published public key alone")
# --------------------------------------------------------------------------- #

for name, fixture in (("v1", v1), ("v2", v2)):
    result = verify_chain(fixture["records"], fixture["publicKeyPem"])
    check(
        f"{name} fixture: {len(fixture['records'])} records verify",
        result.valid and result.signatures_checked,
        f"head {result.head_hash[:12]}…",
    )

# --------------------------------------------------------------------------- #
print("\n§7.2  Hashes are reproduced byte for byte from the fields")
# --------------------------------------------------------------------------- #

for name, fixture in (("v1", v1), ("v2", v2)):
    mismatches = [
        record["id"] for record in fixture["records"] if hash_record(record) != record["hash"]
    ]
    check(f"{name} fixture: every hash recomputes", not mismatches, str(mismatches or ""))

# The element counts the specification fixes. If these drift, the two
# implementations stop agreeing and every downstream check is meaningless.
check(
    "§4.2 an uncosted v1 record is sixteen elements",
    len(json.loads(canonical_form(v1["records"][0]))) == 16,
)
check(
    "§4.2 a governed v1 record appends a seventeenth",
    len(json.loads(canonical_form(v1["records"][2]))) == 17,
)
form = json.loads(canonical_form(v2["records"][1]))
check("§4.3 a v2 record is nineteen elements", len(form) == 19)
check("§4.3 the version marker is the first element", form[0] == 2)
check(
    "§4.4 an uncosted record in a v2 chain is still written as v1",
    v2["records"][0].get("canonicalVersion") is None,
)

# --------------------------------------------------------------------------- #
print("\n§5  Chaining and signing")
# --------------------------------------------------------------------------- #

check("§5.1 the first record links to the genesis hash", v2["records"][0]["prevHash"] == GENESIS_HASH)
check("§5.1 the genesis hash is sixty-four zeros", GENESIS_HASH == "0" * 64)

record = v2["records"][1]
check(
    "§5.2 the signature is over the hex string of the hash",
    verify_signature(record["hash"], record["signature"], v2["publicKeyPem"]),
)
check(
    "§5.2 ... and not over the raw hash bytes",
    not verify_signature(
        bytes.fromhex(record["hash"]).decode("latin-1"), record["signature"], v2["publicKeyPem"]
    ),
)
check("§5.2 the public key is 32 raw bytes of Ed25519", len(public_key_bytes(v2["publicKeyPem"])) == 32)

# --------------------------------------------------------------------------- #
print("\n§6  The outcomes an implementation must keep apart")
# --------------------------------------------------------------------------- #


def mutated(mutate) -> tuple[Outcome, object]:
    records = copy.deepcopy(v2["records"])
    mutate(records)
    result = verify_chain(records, v2["publicKeyPem"])
    return result.records[-1].outcome, result


for label, mutate, expected in [
    ("an edited field is CONTENT_ALTERED", lambda r: r[1].__setitem__("subject", "agent:other"), Outcome.CONTENT_ALTERED),
    ("a removed record is LINK_BROKEN", lambda r: r.pop(1), Outcome.LINK_BROKEN),
    ("reordered records are LINK_BROKEN", lambda r: r.insert(0, r.pop(1)), Outcome.LINK_BROKEN),
    ("a stripped cost is CONTENT_ALTERED", lambda r: r[1].pop("cost"), Outcome.CONTENT_ALTERED),
    ("stripped governance is CONTENT_ALTERED", lambda r: r[2].pop("governance"), Outcome.CONTENT_ALTERED),
    ("an unknown version is UNREADABLE", lambda r: r[1].__setitem__("canonicalVersion", 99), Outcome.UNREADABLE),
    ("a costed record declaring v1 is MALFORMED", lambda r: r[1].__setitem__("canonicalVersion", 1), Outcome.MALFORMED),
]:
    outcome, _ = mutated(mutate)
    check(label, outcome is expected, f"got {outcome.value}")

# The distinction that matters most, and the one implementations get wrong.
#
# A forger who can write to the database and recompute hashes produces a chain
# that is internally perfect. Content matches, linkage holds — and no key signed
# it. Reporting that as "content altered" would send an investigator looking for
# an edit that does not exist.
records = copy.deepcopy(v2["records"])
records[1]["subject"] = "agent:forged"
records[1]["hash"] = hash_record(records[1])
records[2]["prevHash"] = records[1]["hash"]
result = verify_chain(records, v2["publicKeyPem"])
check(
    "a re-hashed forgery is WRONG_KEY, not CONTENT_ALTERED",
    result.records[-1].outcome is Outcome.WRONG_KEY,
    f"got {result.records[-1].outcome.value}",
)
check(
    "... and reports content_intact=True, because nothing was edited after the fact",
    result.content_intact is True,
)

# §6 — an unchecked signature must never read as a checked one.
unchecked = verify_chain(v2["records"], None)
check("without a key the chain is still valid on content and linkage", unchecked.valid)
check("... signatures_checked is False", unchecked.signatures_checked is False)
check("... and the verdict says so in words", "NOT checked" in unchecked.covers)
check(
    "... and no record claims signature_valid",
    all(r.signature_valid is None for r in unchecked.records),
)

# --------------------------------------------------------------------------- #
print("\n§7.5  No score")
# --------------------------------------------------------------------------- #

emitted = json.dumps(
    {
        "outcome": result.records[-1].outcome.value,
        "reason": result.records[-1].reason,
        "covers": unchecked.covers,
    }
).lower()
check("no percentage appears in any output", "%" not in emitted)
check(
    "no score, grade, rating or confidence appears",
    not any(word in emitted for word in ("score", "grade", "rating", "confidence")),
)

# --------------------------------------------------------------------------- #
print("\n§4.1  Canonical JSON")
# --------------------------------------------------------------------------- #

check("keys are sorted", canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}')
check("no insignificant whitespace", " " not in canonical_json({"a": [1, 2]}))
check("array order is significant", canonical_json([1, 2]) != canonical_json([2, 1]))
check("non-ASCII is not escaped", canonical_json({"a": "é"}) == '{"a":"é"}')


# --------------------------------------------------------------------------- #
total = passed + len(failed)
print(f"\n{passed}/{total} checks passed.")
if failed:
    print("\nFAILED:")
    for label in failed:
        print(f"  - {label}")
    print(
        "\nA failure here means the specification and an independent implementation "
        "disagree. Fix whichever is wrong — that argument is the point of this file."
    )
    sys.exit(1)

print(
    "\nAn independent Python implementation verifies records signed by the "
    "TypeScript one,\nusing only docs/PROTOCOL.md and the published public key. "
    "The format is a protocol."
)
