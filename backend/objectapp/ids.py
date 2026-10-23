"""ULID generation (26 characters, Crockford base32, time-ordered prefix)."""

from __future__ import annotations

import secrets
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_ulid() -> str:
    """48-bit millisecond timestamp + 80 random bits, encoded as 26 characters."""
    value = (time.time_ns() // 1_000_000) << 80 | secrets.randbits(80)
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))
