#!/usr/bin/env python3
"""Patch demo JWT clientId in auth.service.ts to match seeded acme id.

Used by scripts/dev-up.sh after control seed. Keep this out of a bash heredoc
so regex quoting stays reliable.
"""
from __future__ import annotations

import re
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: patch-auth-client-id.py <auth.service.ts> <acme-uuid>",
            file=sys.stderr,
        )
        return 2

    path, acme_id = sys.argv[1], sys.argv[2]
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    new_src, n = re.subn(
        r"(const resolved = \{\s*clientId:\s*')[0-9a-fA-F-]{36}(?=')",
        r"\g<1>" + acme_id,
        src,
        count=1,
        flags=re.DOTALL,
    )
    if n == 0:
        new_src, n = re.subn(
            r"(clientId:\s*')[0-9a-fA-F-]{36}(?=')",
            r"\g<1>" + acme_id,
            src,
            count=1,
        )

    if n == 0:
        print(
            f"WARN: could not patch {path}; set clientId manually to {acme_id}",
            file=sys.stderr,
        )
        return 0

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    print(f"patched {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
