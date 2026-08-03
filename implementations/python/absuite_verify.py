"""
A second implementation of the Agent Trust Record protocol.

Written from docs/PROTOCOL.md, not from the TypeScript. That distinction is the
entire reason this file exists: until a record format has been implemented twice,
independently, "protocol" is a word attached to one codebase. Everything here
follows the specification's section numbers so that a disagreement between the
two implementations can be located in the document rather than argued about.

No part of this can produce a record. It only checks them, which is the honest
shape for a second implementation — a verifier that also writes is a fork.

    python3 absuite_verify.py chain.json                  # verify a chain
    python3 absuite_verify.py chain.json --key public.pem # ... and its signatures

There are no dependencies. Ed25519 is implemented here from RFC 8032, because the
argument this protocol makes is that anyone can check a record without trusting
whoever wrote it — and a verifier that first asks you to install a native
extension has put a step in front of the person it is trying to convince.
"""

from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

# The verdict has to survive being redirected to a file.
#
# This is the reference verifier — the thing somebody who does not trust us
# downloads and points at our records. Its output contains § and — and ✓, and on
# Windows Python encodes stdout with the locale codepage whenever it is not a
# console. cp1252 has none of those characters, so
# `python absuite_verify.py records.json > report.txt` died with
# UnicodeEncodeError before printing a verdict, while the same command run
# straight to the terminal worked.
#
# An auditor redirecting output to a file is the ordinary case, not the exotic
# one, and a verifier that crashes instead of reporting is worse than useless —
# it is indistinguishable, to the person running it, from a verification that
# failed.
if hasattr(sys.stdout, "reconfigure"):  # Python 3.7+
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

__all__ = [
    "GENESIS_HASH",
    "SUPPORTED_CANONICAL_VERSIONS",
    "Outcome",
    "RecordVerdict",
    "ChainVerdict",
    "canonical_json",
    "public_key_bytes",
    "verify_signature",
    "hash_payload",
    "canonical_form",
    "hash_record",
    "verify_record",
    "verify_chain",
    "UnsupportedCanonicalVersion",
    "MalformedRecord",
]

# §5.1
GENESIS_HASH = "0" * 64

# §4. Old versions are never dropped, so this list only ever grows.
SUPPORTED_CANONICAL_VERSIONS = (1, 2)


class UnsupportedCanonicalVersion(Exception):
    """§4.5 — a form this build does not implement. Not a finding about the record."""

    def __init__(self, version: int) -> None:
        super().__init__(
            f"This implementation understands canonical form(s) "
            f"v{', v'.join(map(str, SUPPORTED_CANONICAL_VERSIONS))} and cannot read a "
            f"record written as v{version}. This is not evidence of tampering."
        )
        self.version = version


class MalformedRecord(Exception):
    """§4.2 — the record's declared form cannot express the record's own fields."""


# --------------------------------------------------------------------------- #
# §4.1 Canonical JSON
# --------------------------------------------------------------------------- #


def canonical_json(value: Any) -> str:
    """
    JSON with object keys sorted, no insignificant whitespace, array order kept.

    Three settings do the work, and each one is a place two implementations
    silently disagree if it is wrong:

    ``separators`` — Python's default puts a space after ``:`` and ``,``.
    JavaScript's ``JSON.stringify`` does not. One space anywhere changes every
    hash.

    ``ensure_ascii=False`` — Python escapes non-ASCII to ``\\uXXXX`` by default;
    JavaScript emits the character. A record containing a single accented
    character would hash differently between the two.

    ``sort_keys=True`` — required by §4.1.

    A known and unresolved edge: JavaScript sorts object keys by UTF-16 code
    unit, Python by Unicode code point. These agree for everything in the Basic
    Multilingual Plane and disagree for keys containing astral characters —
    emoji, for instance. The specification says "code point" and this follows the
    specification; an implementation pair that needs to agree on emoji keys has
    found a real gap in §4.1 rather than a bug in either side.
    """
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def hash_payload(value: Any) -> str:
    """§4.1 — SHA-256 over the canonical JSON of a payload, lowercase hex."""
    if value is None:
        text = "null"
    else:
        text = canonical_json(value)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# §4.2 / §4.3 Canonical form
# --------------------------------------------------------------------------- #


def _steps(record: dict) -> list:
    return [
        [s.get("seq"), s.get("name"), s.get("at"), s.get("detail")]
        for s in (record.get("steps") or [])
    ]


def _governance(record: dict) -> list | None:
    g = record.get("governance")
    if not g:
        return None
    return [
        g.get("policyRef"),
        g.get("policyVersion"),
        g.get("decision"),
        list(g.get("evidence") or []),
        g.get("evaluatedBy"),
    ]


def _cost(record: dict) -> list | None:
    c = record.get("cost")
    if not c:
        return None
    return [
        c.get("amount"),
        c.get("currency"),
        c.get("source"),
        c.get("unit"),
        c.get("quantity"),
    ]


def canonical_version_of(record: dict) -> int:
    """§4.2 — an absent marker means v1."""
    return record.get("canonicalVersion") or 1


def _canonical_v1(record: dict) -> str:
    # §4.2 — v1 has no slot for a cost, so it refuses rather than dropping one
    # outside the hash. Silently omitting it would leave a signed record whose
    # cost anybody could change.
    if record.get("cost"):
        raise MalformedRecord(
            "This record carries a cost but declares canonical form v1, which has no "
            "slot for one. Hashing it as v1 would leave the figure outside the "
            "signature. A costed record must declare v2."
        )

    fields: list[Any] = [
        record.get("id"),
        record.get("tenantId"),
        record.get("subject"),
        record.get("jti"),
        sorted(record.get("scope") or []),
        record.get("module"),
        record.get("action"),
        record.get("inputHash"),
        record.get("outputHash"),
        record.get("outcome"),
        record.get("error"),
        record.get("startedAt"),
        record.get("completedAt"),
        record.get("durationMs"),
        _steps(record),
        record.get("prevHash"),
    ]

    # §4.2 — appended if and only if governance is present. A null placeholder
    # would change the canonical form of every v1 record ever written.
    governance = _governance(record)
    if governance is not None:
        fields.append(governance)

    return canonical_json(fields)


def _canonical_v2(record: dict) -> str:
    # §4.3 — fixed at nineteen elements, version first so the marker is inside
    # the hash and therefore inside the signature.
    return canonical_json(
        [
            2,
            record.get("id"),
            record.get("tenantId"),
            record.get("subject"),
            record.get("jti"),
            sorted(record.get("scope") or []),
            record.get("module"),
            record.get("action"),
            record.get("inputHash"),
            record.get("outputHash"),
            record.get("outcome"),
            record.get("error"),
            record.get("startedAt"),
            record.get("completedAt"),
            record.get("durationMs"),
            _steps(record),
            record.get("prevHash"),
            _governance(record),
            _cost(record),
        ]
    )


def canonical_form(record: dict) -> str:
    """§4 — the byte string a record hashes to, dispatched on its own version."""
    version = canonical_version_of(record)
    if version not in SUPPORTED_CANONICAL_VERSIONS:
        raise UnsupportedCanonicalVersion(version)
    return _canonical_v1(record) if version == 1 else _canonical_v2(record)


def hash_record(record: dict) -> str:
    """§5.1 — SHA-256 of the canonical form, lowercase hex."""
    return hashlib.sha256(canonical_form(record).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# §5.2 Signature
# --------------------------------------------------------------------------- #


# Ed25519 verification, RFC 8032, in pure Python.
#
# There is no dependency here and that is deliberate. The argument this protocol
# makes is that anyone can check a record without trusting the party that wrote
# it — and a verifier that first requires you to install a native extension has
# put a step in front of exactly the person it is trying to convince.
#
# The first draft imported `cryptography` and fell back when it was missing. In
# the very environment this was written in, that package imports and then dies
# inside its Rust backend raising a PanicException — which inherits from
# BaseException, not Exception, so the fallback did not catch it and the
# "graceful" path crashed. A degradation path that is itself fragile is worse
# than no degradation path.
#
# This is the slow, clear reference formulation. Verifying a handful of records
# takes milliseconds, and the code can be read against RFC 8032 line by line,
# which matters more here than speed.

_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = (-121665 * pow(121666, _P - 2, _P)) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _x_recover(y: int) -> int:
    xx = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P)
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P != 0:
        x = (x * _I) % _P
    if x % 2 != 0:
        x = _P - x
    return x


_BY = (4 * pow(5, _P - 2, _P)) % _P
_B = (_x_recover(_BY) % _P, _BY)


def _edwards_add(point_p, point_q):
    x1, y1 = point_p
    x2, y2 = point_q
    common = _D * x1 * x2 * y1 * y2
    x3 = (x1 * y2 + x2 * y1) * pow(1 + common, _P - 2, _P)
    y3 = (y1 * y2 + x1 * x2) * pow(1 - common, _P - 2, _P)
    return (x3 % _P, y3 % _P)


def _scalar_mult(point, exponent: int):
    """Double-and-add, iterative — a recursive form recurses 253 deep on a real scalar."""
    result = (0, 1)
    addend = point
    while exponent > 0:
        if exponent & 1:
            result = _edwards_add(result, addend)
        addend = _edwards_add(addend, addend)
        exponent >>= 1
    return result


def _on_curve(point) -> bool:
    x, y = point
    return (-x * x + y * y - 1 - _D * x * x * y * y) % _P == 0


def _decode_point(data: bytes):
    y = int.from_bytes(data, "little") & ((1 << 255) - 1)
    x = _x_recover(y)
    if (x & 1) != ((data[31] >> 7) & 1):
        x = _P - x
    point = (x, y)
    if not _on_curve(point):
        raise ValueError("point is not on the curve")
    return point


def _encode_point(point) -> bytes:
    x, y = point
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


#: The fixed SPKI prefix for an Ed25519 public key: SEQUENCE, OID 1.3.101.112,
#: BIT STRING. A 44-byte DER starting with these twelve bytes is an Ed25519 key
#: and the remaining thirty-two bytes are the key itself.
_ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")


def public_key_bytes(public_key_pem: str) -> bytes:
    """The raw 32-byte key from a PEM SPKI document, with the algorithm checked."""
    import base64

    body = "".join(
        line.strip()
        for line in public_key_pem.strip().splitlines()
        if not line.startswith("-----")
    )
    der = base64.b64decode(body)

    if len(der) != 44 or not der.startswith(_ED25519_SPKI_PREFIX):
        raise ValueError(
            "Not an Ed25519 public key. §5.2 of the protocol specifies Ed25519, and "
            "a key of another algorithm cannot verify these records."
        )
    return der[12:]


def verify_signature(hash_hex: str, signature_b64: str, public_key_pem: str) -> bool:
    """
    §5.2 — Ed25519 over the **hex string** of the hash, not the raw bytes.

    This is the single detail most likely to be got wrong by a new
    implementation, and it fails in the worst possible way: everything looks
    correct, and every signature is rejected.
    """
    import base64

    try:
        signature = base64.b64decode(signature_b64)
        if len(signature) != 64:
            return False

        key = public_key_bytes(public_key_pem)
        message = hash_hex.encode("utf-8")

        point_r = _decode_point(signature[:32])
        point_a = _decode_point(key)
        s = int.from_bytes(signature[32:], "little")
        if s >= _L:
            # A non-canonical scalar, rejected rather than reduced. Accepting it
            # would make signatures malleable.
            return False

        challenge = int.from_bytes(
            hashlib.sha512(_encode_point(point_r) + key + message).digest(), "little"
        )

        return _scalar_mult(_B, s) == _edwards_add(point_r, _scalar_mult(point_a, challenge))
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# §6 Verification, and what a verdict may say
# --------------------------------------------------------------------------- #


class Outcome(str, Enum):
    """§6 — these are kept apart on purpose. Collapsing any two of them is the failure."""

    VALID = "VALID"
    CONTENT_ALTERED = "CONTENT_ALTERED"
    LINK_BROKEN = "LINK_BROKEN"
    WRONG_KEY = "WRONG_KEY"           # content intact — a rotation, not an intrusion
    UNSIGNED = "UNSIGNED"
    UNREADABLE = "UNREADABLE"          # this build is too old; not a finding
    MALFORMED = "MALFORMED"            # internally inconsistent


@dataclass
class RecordVerdict:
    outcome: Outcome
    reason: str = ""
    #: None means "not checked". Never False unless it was actually checked.
    content_intact: bool | None = None
    signature_valid: bool | None = None

    @property
    def valid(self) -> bool:
        return self.outcome is Outcome.VALID


@dataclass
class ChainVerdict:
    valid: bool
    checked: int
    head_hash: str = GENESIS_HASH
    broken_at: int | None = None
    broken_id: str | None = None
    reason: str = ""
    content_intact: bool | None = None
    signatures_checked: bool = False
    covers: str = ""
    records: list[RecordVerdict] = field(default_factory=list)


def verify_record(record: dict, public_key_pem: str | None = None) -> RecordVerdict:
    """
    §6 steps 1, 2 and 4 for a single record. Linkage is a property of a chain.

    ``public_key_pem`` is optional, and its absence is reported rather than
    ignored: ``signature_valid`` stays ``None``, which §6 requires must not be
    rendered as verified.
    """
    try:
        recomputed = hash_record(record)
    except UnsupportedCanonicalVersion as exc:
        # §4.5 — "I could not check this" is not "this failed the check".
        return RecordVerdict(Outcome.UNREADABLE, str(exc))
    except MalformedRecord as exc:
        return RecordVerdict(Outcome.MALFORMED, str(exc))

    if recomputed != record.get("hash"):
        return RecordVerdict(
            Outcome.CONTENT_ALTERED,
            "Record content does not match its own hash.",
            content_intact=False,
        )

    if public_key_pem is None:
        return RecordVerdict(Outcome.VALID, content_intact=True)

    signature = record.get("signature")
    if not signature:
        return RecordVerdict(
            Outcome.UNSIGNED,
            "Record carries no signature, so its authorship is unproven.",
            content_intact=True,
            signature_valid=False,
        )

    if verify_signature(record["hash"], signature, public_key_pem):
        return RecordVerdict(Outcome.VALID, content_intact=True, signature_valid=True)

    # §6 — content intact and signature failing is a *key* problem, not an edit.
    # An implementation that reports this as tampering trains its operators to
    # ignore the alarm, because key rotations are routine and intrusions are not.
    return RecordVerdict(
        Outcome.WRONG_KEY,
        "Signature does not verify against the supplied key. The content still "
        "matches its hash, so this record was not edited — it was signed by a "
        "different key (a rotation, or a server started with an ephemeral one).",
        content_intact=True,
        signature_valid=False,
    )


def verify_chain(records: list[dict], public_key_pem: str | None = None) -> ChainVerdict:
    """
    §6 — walk the chain in order and stop at the first record that fails.

    Reports the sequence position of the failure, one-based, because "the chain
    is broken" without a location is not actionable.
    """
    expected_prev = GENESIS_HASH
    head = GENESIS_HASH
    verdicts: list[RecordVerdict] = []
    checked_signatures = public_key_pem is not None

    covers = (
        "Content, linkage and Ed25519 signatures."
        if checked_signatures
        else "Content and linkage only. Signatures were NOT checked — no public key was supplied."
    )

    for index, record in enumerate(records, start=1):
        # §5.1 — linkage first: a reordered chain should not be reported as an edit.
        if record.get("prevHash") != expected_prev:
            verdict = RecordVerdict(
                Outcome.LINK_BROKEN,
                "Record does not link to its predecessor. A record was inserted, "
                "removed or reordered.",
            )
            verdicts.append(verdict)
            return ChainVerdict(
                valid=False,
                checked=index,
                head_hash=head,
                broken_at=index,
                broken_id=record.get("id"),
                reason=verdict.reason,
                signatures_checked=checked_signatures,
                covers=covers,
                records=verdicts,
            )

        verdict = verify_record(record, public_key_pem)
        verdicts.append(verdict)

        if not verdict.valid:
            return ChainVerdict(
                valid=False,
                checked=index,
                head_hash=head,
                broken_at=index,
                broken_id=record.get("id"),
                reason=verdict.reason,
                content_intact=verdict.content_intact,
                signatures_checked=checked_signatures,
                covers=covers,
                records=verdicts,
            )

        expected_prev = record.get("hash")
        head = record.get("hash")

    return ChainVerdict(
        valid=True,
        checked=len(records),
        head_hash=head,
        signatures_checked=checked_signatures,
        covers=covers,
        records=verdicts,
    )


# --------------------------------------------------------------------------- #
# Command line
# --------------------------------------------------------------------------- #


def _main(argv: list[str]) -> int:
    if not argv or argv[0] in {"-h", "--help"}:
        print(__doc__.strip())
        return 0

    path = argv[0]
    key_pem: str | None = None

    if "--key" in argv:
        with open(argv[argv.index("--key") + 1], encoding="utf-8") as handle:
            key_pem = handle.read()

    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)

    # Accepts a bare list, or the {publicKeyPem, records} shape the fixtures use.
    if isinstance(document, list):
        records = document
    else:
        records = document.get("records") or document.get("executions") or []
        if key_pem is None and document.get("publicKeyPem"):
            key_pem = document["publicKeyPem"]

    result = verify_chain(records, key_pem)

    print(f"records checked : {result.checked}")
    print(f"covers          : {result.covers}")
    print(f"head            : {result.head_hash[:16]}…")

    if result.valid:
        print("\nVALID — every record hashes to what was recorded and links to the one before it.")
        if not result.signatures_checked:
            print("Signatures were not checked. This is not a pass on authorship.")
        return 0

    print(f"\n{result.records[-1].outcome.value} at record {result.broken_at} ({result.broken_id})")
    print(result.reason)
    if result.content_intact is True:
        print("\nThe content still matches its hash, so nothing was edited.")
    return 1


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
