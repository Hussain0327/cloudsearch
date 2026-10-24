"""SEC companyfacts as ground truth, filtered to one filing by accession number."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ingestion.edgar.client import EdgarClient

# (taxonomy:tag, unit measure, period start or None for an instant, period end)
TruthKey = tuple[str, str, str | None, str]
Truth = dict[TruthKey, list[float]]


def slim(payload: dict, accession: str) -> dict:
    """Same shape as companyfacts, keeping only rows of ``accession``."""
    facts: dict = {}
    for taxonomy, tags in (payload.get("facts") or {}).items():
        for tag, body in tags.items():
            units = {}
            for unit, rows in (body.get("units") or {}).items():
                kept = [r for r in rows if r.get("accn") == accession]
                if kept:
                    units[unit] = kept
            if units:
                facts.setdefault(taxonomy, {})[tag] = {"units": units}
    return {"cik": payload.get("cik"), "facts": facts}


def flatten(payload: dict, accession: str) -> Truth:
    """Flattens companyfacts rows of ``accession`` to {(name, unit, start, end): [values]}."""
    truth: Truth = {}
    for taxonomy, tags in slim(payload, accession)["facts"].items():
        for tag, body in tags.items():
            for unit, rows in body["units"].items():
                for row in rows:
                    if not isinstance(row.get("val"), (int, float)) or not row.get("end"):
                        continue
                    key = (f"{taxonomy}:{tag}", unit, row.get("start"), row["end"])
                    truth.setdefault(key, []).append(float(row["val"]))
    return truth


def load_truth(path: str | Path, accession: str) -> Truth:
    """Reads a companyfacts JSON file and flattens it for ``accession``."""
    return flatten(json.loads(Path(path).read_text(encoding="utf-8")), accession)


async def fetch_truth(
    client: EdgarClient, cik: str, accession: str, cache_dir: Path = Path(".cache/edgar")
) -> Truth:
    """Live path (untested offline): companyfacts for ``cik``, cached slim per accession."""
    cache = cache_dir / cik / f"{accession}.facts.json"
    if cache.exists():
        return load_truth(cache, accession)
    slimmed = slim(await client.companyfacts(cik), accession)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(slimmed), encoding="utf-8")
    return flatten(slimmed, accession)
