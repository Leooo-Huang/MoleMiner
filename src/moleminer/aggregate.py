"""Stage 3: Aggregate search results — dedupe, filter, classify."""

from __future__ import annotations

from moleminer.models import SearchResult
from moleminer.utils.dedupe import dedupe_results


def aggregate_results(results: list[SearchResult]) -> list[SearchResult]:
    """Deduplicate and organize search results.

    Returns results ordered: directs first, then leads.
    """
    if not results:
        return []

    deduped = dedupe_results(results)

    directs = [r for r in deduped if r.result_type == "direct"]
    leads = [r for r in deduped if r.result_type == "lead"]

    return directs + leads
