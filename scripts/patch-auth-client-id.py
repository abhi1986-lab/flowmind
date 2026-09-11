#!/usr/bin/env python3
"""DEPRECATED (Gate 0.2 / 0.4).

AuthService now looks up the live control-plane Client UUID at login time.
No source patching of hardcoded client_id is required or desired.
Kept as a no-op so older docs/scripts that still call it do not fail loudly.
"""
from __future__ import annotations

import sys


def main() -> int:
    print(
        "patch-auth-client-id.py: no-op (AuthService uses live control Client.id). "
        "Safe to remove callers from scripts/dev-up.sh.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
