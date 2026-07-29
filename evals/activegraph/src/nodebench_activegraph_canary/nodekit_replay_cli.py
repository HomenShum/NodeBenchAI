"""CLI for the disposable-copy-only NodeKit replay canary."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import stat
from typing import Sequence

from .canonical import canonical_json_bytes
from .nodekit_replay import (
    NodeKitReplayContractError,
    run_nodekit_replay_canary,
)


MAX_EXPORT_BYTES = 1024 * 1024
MAX_REPORT_BYTES = 64 * 1024
MAX_SQLITE_BYTES = 64 * 1024 * 1024


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Replay a canonical NodeKit run export in offline ActiveGraph."
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--db", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    resolved = {
        args.input.resolve(),
        args.output.resolve(),
        args.db.resolve(),
    }
    if len(resolved) != 3:
        raise ValueError("--input, --output, and --db must be distinct paths")
    try:
        source_stat = args.input.lstat()
        if (
            not stat.S_ISREG(source_stat.st_mode)
            or stat.S_ISLNK(source_stat.st_mode)
            or source_stat.st_size < 1
        ):
            raise NodeKitReplayContractError(
                "export_read_failed",
                "input must be a non-empty regular file",
            )
        if source_stat.st_size > MAX_EXPORT_BYTES:
            raise NodeKitReplayContractError(
                "export_too_large",
                f"input exceeds {MAX_EXPORT_BYTES} bytes",
            )
        document = json.loads(args.input.read_bytes().decode("utf-8"))
    except NodeKitReplayContractError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"unable to read JSON input {args.input}: {exc}") from exc
    report = run_nodekit_replay_canary(document, args.db)
    if args.db.stat().st_size > MAX_SQLITE_BYTES:
        raise NodeKitReplayContractError(
            "artifact_too_large",
            f"SQLite output exceeds {MAX_SQLITE_BYTES} bytes",
        )
    report_bytes = canonical_json_bytes(report)
    if len(report_bytes) > MAX_REPORT_BYTES:
        raise NodeKitReplayContractError(
            "artifact_too_large",
            f"report output exceeds {MAX_REPORT_BYTES} bytes",
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(report_bytes)
    return 0 if report["verdict"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
