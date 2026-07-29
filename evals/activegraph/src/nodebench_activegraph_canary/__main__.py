"""Command-line entry point for the offline ActiveGraph canary."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .canonical import canonical_json_bytes
from .runtime import run_canary


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the deterministic NodeBench ActiveGraph canary."
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--db", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    input_path: Path = args.input
    output_path: Path = args.output
    db_path: Path = args.db

    resolved_paths = {
        input_path.resolve(),
        output_path.resolve(),
        db_path.resolve(),
    }
    if len(resolved_paths) != 3:
        raise ValueError("--input, --output, and --db must be distinct paths")

    try:
        input_doc = json.loads(input_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"unable to read JSON input {input_path}: {exc}") from exc

    output = run_canary(input_doc, db_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(canonical_json_bytes(output))
    # Stable contract for CI: the report is always written, while a failed
    # canary uses exit code 2 so two byte-identical failures cannot look green.
    return 0 if output["verdict"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
