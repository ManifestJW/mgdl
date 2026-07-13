#!/usr/bin/env python3
"""Collect the live AREDL top-500 completion graph.

Outputs are written to ``aredl_top500_export/``:

* ``aredl_top500_levels.csv`` — one row per sampled level.
* ``aredl_top500_records.csv.gz`` — normalized accepted completion records.
* ``aredl_top500_records_raw.jsonl.gz`` — lossless raw API records with level context.
* ``aredl_top500_players.csv`` — player-level graph summary.
* ``aredl_top500_coverage.csv`` — timestamp/record coverage by level.
* ``aredl_top500_manifest.json`` — provenance, counts, and request failures.

Only Python's standard library is required. The crawler deliberately remains
below AREDL's documented public rate limit and retries transient failures.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import os
import random
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

API_BASE = "https://api.aredl.net/v2/api/aredl"
LEVELS_URL = f"{API_BASE}/levels?exclude_legacy=true"
USER_AGENT = "manifestjw-gd-difficulty-research/0.3 (+https://github.com/ManifestJW/mgdl)"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def request_json(url: str, *, retries: int = 8, timeout: int = 120) -> Any:
    """Fetch JSON with exponential backoff and explicit 429 handling."""
    for attempt in range(retries):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = response.read()
                return json.loads(payload.decode("utf-8"))
        except HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code < 600
            if not retryable or attempt == retries - 1:
                raise
            retry_after = error.headers.get("Retry-After")
            if retry_after:
                try:
                    delay = float(retry_after)
                except ValueError:
                    delay = 0.0
            else:
                delay = 2 ** min(attempt, 6)
            delay += random.uniform(0.1, 0.8)
            print(f"HTTP {error.code}; retrying {url} in {delay:.1f}s", file=sys.stderr)
            time.sleep(delay)
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            if attempt == retries - 1:
                raise
            delay = 2 ** min(attempt, 6) + random.uniform(0.1, 0.8)
            print(f"{type(error).__name__}; retrying {url} in {delay:.1f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"Exhausted retries for {url}")


def scalar(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def nested(mapping: Any, *keys: str) -> Any:
    current = mapping
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def first(mapping: Any, paths: Iterable[tuple[str, ...]]) -> Any:
    for path in paths:
        value = nested(mapping, *path)
        if value not in (None, ""):
            return value
    return None


def normalize_level(level: dict[str, Any]) -> dict[str, Any]:
    tags = [tag for tag in (level.get("tags") or []) if tag]
    return {
        "level_uuid": level.get("id"),
        "gd_level_id": level.get("level_id"),
        "level_name": level.get("name"),
        "aredl_position": level.get("position"),
        "aredl_points": level.get("points"),
        "two_player": level.get("two_player"),
        "legacy": level.get("legacy"),
        "publisher_id": level.get("publisher_id"),
        "publisher_name": level.get("publisher_name"),
        "gddl_tier": level.get("gddl_tier"),
        "nlw_tier": level.get("nlw_tier"),
        "edel_enjoyment": level.get("edel_enjoyment"),
        "tags": "|".join(map(str, tags)),
        "description": level.get("description"),
        "song": level.get("song"),
    }


def normalize_record(level: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    user = first(record, [("submitted_by",), ("user",), ("submitter",), ("player",)])
    if not isinstance(user, dict):
        user = {}
    hardest = user.get("hardest")
    if not isinstance(hardest, dict):
        hardest = {}

    achieved_at = first(record, [("achieved_at",), ("completion_date",), ("completed_at",)])
    created_at = first(record, [("created_at",), ("submitted_at",)])
    timestamp = achieved_at or created_at
    timestamp_source = "achieved_at" if achieved_at else ("created_at" if created_at else "missing")

    player_id = first(
        record,
        [
            ("submitted_by", "id"),
            ("user", "id"),
            ("submitter", "id"),
            ("player", "id"),
            ("submitter_id",),
            ("user_id",),
        ],
    )
    player_name = first(
        record,
        [
            ("submitted_by", "global_name"),
            ("submitted_by", "username"),
            ("submitted_by", "name"),
            ("user", "global_name"),
            ("user", "username"),
            ("user", "name"),
            ("submitter", "global_name"),
            ("submitter", "username"),
            ("player", "name"),
        ],
    )

    return {
        "level_uuid": level.get("id"),
        "gd_level_id": level.get("level_id"),
        "level_name": level.get("name"),
        "aredl_position": level.get("position"),
        "aredl_points": level.get("points"),
        "record_id": first(record, [("id",), ("record_id",)]),
        "player_id": player_id,
        "player_name": player_name,
        "achieved_at": achieved_at,
        "created_at": created_at,
        "completion_timestamp": timestamp,
        "timestamp_source": timestamp_source,
        "mobile": first(record, [("mobile",), ("is_mobile",)]),
        "video_url": first(record, [("video_url",), ("link",), ("video",)]),
        "raw_url": record.get("raw_url"),
        "player_total_points_snapshot": user.get("total_points"),
        "player_level_points_snapshot": user.get("level_points"),
        "player_pack_points_snapshot": user.get("pack_points"),
        "player_extremes_snapshot": user.get("extremes"),
        "player_hardest_name_snapshot": hardest.get("name"),
        "player_hardest_position_snapshot": hardest.get("position"),
        "player_hardest_gd_id_snapshot": hardest.get("level_id"),
        "player_country_snapshot": scalar(user.get("country")),
    }


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str], *, gzip_output: bool = False) -> None:
    opener = gzip.open if gzip_output else open
    kwargs = {"mode": "wt", "encoding": "utf-8", "newline": ""}
    with opener(path, **kwargs) as handle:  # type: ignore[arg-type]
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def parse_timestamp(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--delay", type=float, default=0.72, help="minimum seconds between record requests")
    parser.add_argument("--output", type=Path, default=Path("aredl_top500_export"))
    parser.add_argument("--fail-on-partial", action="store_true")
    args = parser.parse_args()

    output: Path = args.output
    output.mkdir(parents=True, exist_ok=True)
    started_at = utc_now()

    print(f"Fetching level list: {LEVELS_URL}")
    levels_payload = request_json(LEVELS_URL)
    if not isinstance(levels_payload, list):
        raise TypeError("AREDL levels endpoint did not return an array")

    levels = [level for level in levels_payload if isinstance(level, dict)]
    levels.sort(key=lambda item: (item.get("position") is None, item.get("position", math.inf)))
    levels = levels[: args.limit]

    normalized_levels = [normalize_level(level) for level in levels]
    level_fields = list(normalized_levels[0].keys()) if normalized_levels else []
    write_csv(output / "aredl_top500_levels.csv", normalized_levels, level_fields)
    (output / "aredl_top500_levels.json").write_text(
        json.dumps(levels, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    normalized_records: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    raw_path = output / "aredl_top500_records_raw.jsonl.gz"

    with gzip.open(raw_path, "wt", encoding="utf-8") as raw_handle:
        for index, level in enumerate(levels, start=1):
            level_uuid = level.get("id")
            level_name = level.get("name")
            position = level.get("position")
            if not level_uuid:
                failures.append({
                    "level_name": level_name,
                    "aredl_position": position,
                    "error": "missing internal level UUID",
                })
                continue

            url = f"{API_BASE}/levels/{quote(str(level_uuid), safe='')}/records"
            print(f"[{index:03d}/{len(levels):03d}] #{position} {level_name}", flush=True)
            request_started = time.monotonic()
            try:
                records = request_json(url)
                if not isinstance(records, list):
                    raise TypeError("records endpoint did not return an array")
            except Exception as error:  # retain a usable partial export
                failures.append({
                    "level_uuid": level_uuid,
                    "gd_level_id": level.get("level_id"),
                    "level_name": level_name,
                    "aredl_position": position,
                    "url": url,
                    "error_type": type(error).__name__,
                    "error": str(error),
                })
                records = []

            level_rows: list[dict[str, Any]] = []
            for record in records:
                if not isinstance(record, dict):
                    continue
                raw_handle.write(json.dumps({
                    "level": normalize_level(level),
                    "record": record,
                }, ensure_ascii=False, separators=(",", ":")) + "\n")
                row = normalize_record(level, record)
                normalized_records.append(row)
                level_rows.append(row)

            timestamps = [
                parse_timestamp(row.get("completion_timestamp"))
                for row in level_rows
                if parse_timestamp(row.get("completion_timestamp"))
            ]
            players = {
                str(row.get("player_id") or row.get("player_name"))
                for row in level_rows
                if row.get("player_id") or row.get("player_name")
            }
            coverage.append({
                "level_uuid": level_uuid,
                "gd_level_id": level.get("level_id"),
                "level_name": level_name,
                "aredl_position": position,
                "accepted_records": len(level_rows),
                "unique_players": len(players),
                "dated_records": len(timestamps),
                "missing_timestamp_records": len(level_rows) - len(timestamps),
                "timestamp_coverage": (len(timestamps) / len(level_rows)) if level_rows else None,
                "mobile_records": sum(bool(row.get("mobile")) for row in level_rows),
                "first_timestamp_lexical": min(timestamps) if timestamps else None,
                "last_timestamp_lexical": max(timestamps) if timestamps else None,
                "request_failed": any(item.get("level_uuid") == level_uuid for item in failures),
            })

            elapsed = time.monotonic() - request_started
            if elapsed < args.delay:
                time.sleep(args.delay - elapsed)

    record_fields = [
        "level_uuid", "gd_level_id", "level_name", "aredl_position", "aredl_points",
        "record_id", "player_id", "player_name", "achieved_at", "created_at",
        "completion_timestamp", "timestamp_source", "mobile", "video_url", "raw_url",
        "player_total_points_snapshot", "player_level_points_snapshot",
        "player_pack_points_snapshot", "player_extremes_snapshot",
        "player_hardest_name_snapshot", "player_hardest_position_snapshot",
        "player_hardest_gd_id_snapshot", "player_country_snapshot",
    ]
    write_csv(
        output / "aredl_top500_records.csv.gz",
        normalized_records,
        record_fields,
        gzip_output=True,
    )

    coverage_fields = list(coverage[0].keys()) if coverage else []
    write_csv(output / "aredl_top500_coverage.csv", coverage, coverage_fields)

    # Player graph summary.
    by_player: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in normalized_records:
        key = str(row.get("player_id") or row.get("player_name") or "")
        if key:
            by_player[key].append(row)

    player_rows: list[dict[str, Any]] = []
    for player_key, rows in by_player.items():
        positions = [
            int(row["aredl_position"])
            for row in rows
            if isinstance(row.get("aredl_position"), (int, float))
        ]
        timestamps = sorted(
            value for value in (parse_timestamp(row.get("completion_timestamp")) for row in rows)
            if value
        )
        names = [str(row.get("player_name")) for row in rows if row.get("player_name")]
        player_rows.append({
            "player_key": player_key,
            "player_id": next((row.get("player_id") for row in rows if row.get("player_id")), None),
            "player_name_latest_snapshot": names[-1] if names else None,
            "top500_completion_count": len({row.get("level_uuid") for row in rows}),
            "hardest_current_aredl_position": min(positions) if positions else None,
            "easiest_current_aredl_position": max(positions) if positions else None,
            "dated_completion_count": len(timestamps),
            "first_completion_timestamp_lexical": timestamps[0] if timestamps else None,
            "last_completion_timestamp_lexical": timestamps[-1] if timestamps else None,
            "mobile_completion_count": sum(bool(row.get("mobile")) for row in rows),
        })
    player_rows.sort(
        key=lambda row: (
            -(row.get("top500_completion_count") or 0),
            row.get("hardest_current_aredl_position") or math.inf,
        )
    )
    player_fields = list(player_rows[0].keys()) if player_rows else []
    write_csv(output / "aredl_top500_players.csv", player_rows, player_fields)

    completed_at = utc_now()
    manifest = {
        "schema_version": "aredl-top500-graph-v1",
        "collection_started_at": started_at,
        "collection_completed_at": completed_at,
        "api_base": API_BASE,
        "levels_endpoint": LEVELS_URL,
        "requested_limit": args.limit,
        "levels_collected": len(levels),
        "levels_with_successful_record_requests": len(levels) - len(failures),
        "record_request_failures": failures,
        "normalized_records": len(normalized_records),
        "unique_players": len(player_rows),
        "dated_records": sum(row.get("dated_records", 0) for row in coverage),
        "complete": len(failures) == 0 and len(levels) == args.limit,
        "rate_limit_delay_seconds": args.delay,
        "files": [
            "aredl_top500_levels.csv",
            "aredl_top500_levels.json",
            "aredl_top500_records.csv.gz",
            "aredl_top500_records_raw.jsonl.gz",
            "aredl_top500_players.csv",
            "aredl_top500_coverage.csv",
        ],
    }
    (output / "aredl_top500_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps(manifest, indent=2))
    if failures and args.fail_on_partial:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
