"""Pure classification rules: stored value vs companyfacts truth."""

from __future__ import annotations

import math

EXACT = "exact"
ROUNDED = "rounded"
MISMATCH = "value_mismatch"
UNVERIFIABLE = "unverifiable"


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(b))


def classify_value(
    value: float, decimals: float | None, truths: list[float], percent: bool
) -> tuple[str, tuple[str, ...]]:
    """Returns (class, flags). ``percent`` accepts value == truth * 100 and flags it."""
    if any(_close(value, t) for t in truths):
        return EXACT, ()
    # decimals="INF" (or absent) means no rounding slack.
    if (
        decimals is not None
        and math.isfinite(decimals)
        and any(abs(value - t) <= 0.5 * 10.0 ** (-decimals) for t in truths)
    ):
        return ROUNDED, ()
    if percent and any(_close(value, t * 100) for t in truths):
        return EXACT, ("percent_convention",)
    return MISMATCH, ()


def unit_matches(stored: str | None, measure: str) -> bool:
    """The extractor stores percent facts as 'percent' and may leave pure numbers unit-less."""
    if measure == "pure":
        return stored in (None, "percent")
    return stored == measure
