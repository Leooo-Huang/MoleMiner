"""MoleMiner -- LLM-powered multi-source search aggregation."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from moleminer.models import SearchResult

__version__ = "0.1.0"

__all__ = ["search", "search_async", "SearchResult", "__version__"]


async def search_async(
    query: str,
    sources: list[str] | None = None,
) -> list[SearchResult]:
    """Async search across multiple sources."""
    from moleminer.pipeline import Pipeline
    from moleminer.sources import default_registry

    pipeline = Pipeline(registry=default_registry)
    return await pipeline.search(query, sources=sources)


def search(
    query: str,
    sources: list[str] | None = None,
) -> list[SearchResult]:
    """Synchronous search across multiple sources."""
    return asyncio.run(search_async(query, sources=sources))
