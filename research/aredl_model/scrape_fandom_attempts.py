#!/usr/bin/env python3
"""Scrape public Geometry Dash Fan Wiki attempt tables for AREDL levels.

The script searches the wiki for every level, verifies the page against the
Geometry Dash level ID when that ID appears, extracts table rows containing an
attempt count, and preserves the raw text for audit. It uses only the standard
library and writes a reproducible intake dataset rather than directly trusting
or fitting the observations.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import time
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

AREDL = "https://api.aredl.net/v2/api/aredl/levels?exclude_legacy=true"
WIKI_API = "https://geometry-dash-fan.fandom.com/api.php"
UA = "manifestjw-gd-difficulty-research/0.5"


def get_json(url: str, retries: int = 6) -> Any:
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urlopen(req, timeout=90) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
            if attempt == retries - 1:
                raise
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError(url)


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._table_depth = 0
        self._current_table: list[list[str]] | None = None
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._table_depth += 1
            if self._table_depth == 1:
                self._current_table = []
        elif self._table_depth == 1 and tag == "tr":
            self._current_row = []
        elif self._table_depth == 1 and tag in {"td", "th"}:
            self._current_cell = []
        elif self._current_cell is not None and tag in {"br", "p", "div", "li"}:
            self._current_cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self._current_cell is not None:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._table_depth == 1 and tag in {"td", "th"} and self._current_cell is not None:
            text = re.sub(r"\s+", " ", html.unescape("".join(self._current_cell))).strip()
            if self._current_row is not None:
                self._current_row.append(text)
            self._current_cell = None
        elif self._table_depth == 1 and tag == "tr" and self._current_row is not None:
            if any(cell for cell in self._current_row):
                assert self._current_table is not None
                self._current_table.append(self._current_row)
            self._current_row = None
        elif tag == "table" and self._table_depth:
            if self._table_depth == 1 and self._current_table:
                self.tables.append(self._current_table)
                self._current_table = None
            self._table_depth -= 1


def wiki_search(title: str) -> list[str]:
    params = urlencode({
        "action": "query", "list": "search", "srsearch": title,
        "srnamespace": 0, "srlimit": 5, "format": "json", "origin": "*",
    })
    data = get_json(f"{WIKI_API}?{params}")
    return [item["title"] for item in data.get("query", {}).get("search", [])]


def wiki_parse(title: str) -> tuple[str, str]:
    params = urlencode({
        "action": "parse", "page": title, "prop": "text|wikitext",
        "format": "json", "origin": "*",
    })
    data = get_json(f"{WIKI_API}?{params}").get("parse", {})
    return data.get("text", {}).get("*", ""), data.get("wikitext", {}).get("*", "")


def normalize_attempt(text: str) -> tuple[int | None, str]:
    cleaned = text.replace(",", "").replace("≈", "~").strip()
    relation = "exact"
    if re.search(r"\b(over|more than|at least)\b|[>+]", cleaned, re.I):
        relation = "lower_bound"
    elif "~" in cleaned or re.search(r"\b(about|around|approx)\b", cleaned, re.I):
        relation = "approx"
    numbers = [int(value) for value in re.findall(r"\b\d{2,7}\b", cleaned)]
    if not numbers:
        return None, relation
    # Attempt fields often include dates/ranks elsewhere; use the largest plausible number.
    plausible = [value for value in numbers if value >= 100]
    return (max(plausible) if plausible else max(numbers)), relation


def looks_like_attempt_header(cell: str) -> bool:
    return bool(re.search(r"attempt", cell, re.I))


def extract_rows(level: dict[str, Any], page_title: str, page_html: str, wikitext: str) -> list[dict[str, Any]]:
    gd_id = str(level.get("level_id") or "")
    id_verified = bool(gd_id and gd_id in (page_html + wikitext))
    parser = TableParser()
    parser.feed(page_html)
    output: list[dict[str, Any]] = []

    for table_index, table in enumerate(parser.tables):
        if len(table) < 2:
            continue
        header = table[0]
        attempt_indices = [i for i, cell in enumerate(header) if looks_like_attempt_header(cell)]
        if not attempt_indices:
            continue
        attempt_index = attempt_indices[0]
        player_index = next((i for i, cell in enumerate(header) if re.search(r"player|victor|user", cell, re.I)), None)
        date_index = next((i for i, cell in enumerate(header) if re.search(r"date", cell, re.I)), None)
        role_index = next((i for i, cell in enumerate(header) if re.search(r"role|verifier", cell, re.I)), None)

        for row_index, row in enumerate(table[1:], start=1):
            if attempt_index >= len(row):
                continue
            raw_attempts = row[attempt_index]
            attempts, relation = normalize_attempt(raw_attempts)
            if attempts is None:
                continue
            player = row[player_index] if player_index is not None and player_index < len(row) else (row[0] if row else "")
            date = row[date_index] if date_index is not None and date_index < len(row) else ""
            role = row[role_index] if role_index is not None and role_index < len(row) else ""
            output.append({
                "level_name": level.get("name"), "gd_level_id": level.get("level_id"),
                "aredl_position": level.get("position"), "tags": "|".join(level.get("tags") or []),
                "page_title": page_title, "page_url": "https://geometry-dash-fan.fandom.com/wiki/" + quote(page_title.replace(" ", "_")),
                "id_verified": id_verified, "table_index": table_index, "row_index": row_index,
                "player": player, "attempts": attempts, "relation": relation,
                "raw_attempts": raw_attempts, "completion_date_raw": date,
                "role_raw": role, "header": "|".join(header), "raw_row": "|".join(row),
            })
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--delay", type=float, default=0.35)
    parser.add_argument("--output", type=Path, default=Path("fandom_attempt_export"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    levels = get_json(AREDL)
    levels = sorted(levels, key=lambda item: item["position"])[: args.limit]
    observations: list[dict[str, Any]] = []
    audit: list[dict[str, Any]] = []

    for index, level in enumerate(levels, 1):
        name = level["name"]
        print(f"[{index}/{len(levels)}] {name}", flush=True)
        candidates = [name] + [title for title in wiki_search(name) if title.casefold() != name.casefold()]
        accepted_title = None
        accepted_rows: list[dict[str, Any]] = []
        errors: list[str] = []
        for title in candidates[:5]:
            try:
                page_html, wikitext = wiki_parse(title)
                rows = extract_rows(level, title, page_html, wikitext)
                if rows:
                    # Prefer exact ID verification. If no page exposes an ID, retain as unverified intake.
                    accepted_title = title
                    accepted_rows = rows
                    if any(row["id_verified"] for row in rows):
                        break
            except Exception as error:
                errors.append(f"{title}: {type(error).__name__}: {error}")
            time.sleep(args.delay)
        observations.extend(accepted_rows)
        audit.append({
            "level_name": name, "gd_level_id": level.get("level_id"),
            "aredl_position": level.get("position"), "candidate_count": len(candidates[:5]),
            "accepted_page": accepted_title or "", "rows_found": len(accepted_rows),
            "id_verified": bool(accepted_rows and any(row["id_verified"] for row in accepted_rows)),
            "errors": " || ".join(errors),
        })

    observation_fields = [
        "level_name", "gd_level_id", "aredl_position", "tags", "page_title", "page_url",
        "id_verified", "table_index", "row_index", "player", "attempts", "relation",
        "raw_attempts", "completion_date_raw", "role_raw", "header", "raw_row",
    ]
    with (args.output / "fandom_attempt_observations.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=observation_fields)
        writer.writeheader(); writer.writerows(observations)
    with (args.output / "fandom_attempt_audit.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(audit[0].keys()))
        writer.writeheader(); writer.writerows(audit)

    manifest = {
        "levels_checked": len(levels), "levels_with_attempt_rows": sum(item["rows_found"] > 0 for item in audit),
        "levels_id_verified": sum(item["id_verified"] for item in audit),
        "observations": len(observations),
        "id_verified_observations": sum(item["id_verified"] for item in observations),
        "exact_observations": sum(item["relation"] == "exact" for item in observations),
        "approx_observations": sum(item["relation"] == "approx" for item in observations),
        "lower_bound_observations": sum(item["relation"] == "lower_bound" for item in observations),
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
