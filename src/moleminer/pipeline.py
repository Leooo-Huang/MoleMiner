"""Search pipeline orchestrator — dispatch, aggregate, store."""

from __future__ import annotations

import asyncio
from pathlib import Path

from moleminer.aggregate import aggregate_results
from moleminer.models import SearchResult
from moleminer.registry import SourceRegistry
from moleminer.store import SearchStore


class Pipeline:
    """Orchestrates the multi-stage search pipeline."""

    def __init__(
        self,
        registry: SourceRegistry,
        db_path: Path | None = None,
    ) -> None:
        self.registry = registry
        self.store = SearchStore(db_path)
        self.store.init_db()

    async def search(
        self,
        query: str,
        sources: list[str] | None = None,
    ) -> list[SearchResult]:
        """Run the full search pipeline."""
        queries = [query]

        source_instances = self._get_sources(sources)
        raw_results = await self._dispatch(queries, source_instances)

        results = aggregate_results(raw_results)

        sources_used = [s.name for s in source_instances]
        self.store.save_search(
            query=query,
            sources_used=sources_used,
            results=results,
        )

        return results

    def _get_sources(self, source_names: list[str] | None = None):
        if source_names:
            return [self.registry.get_source(name) for name in source_names]
        return self.registry.get_enabled_sources()

    async def _dispatch(self, queries, sources) -> list[SearchResult]:
        tasks = [source.search(queries) for source in sources]
        results_per_source = await asyncio.gather(*tasks, return_exceptions=True)
        all_results: list[SearchResult] = []
        for result in results_per_source:
            if isinstance(result, Exception):
                continue
            all_results.extend(result)
        return all_results
