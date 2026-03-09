"""Jina search and reader API (free, no key needed)."""

from __future__ import annotations

from urllib.parse import quote

from moleminer.models import SearchResult
from moleminer.sources.base import BaseSource
from moleminer.utils.http import create_client

_JINA_SEARCH_URL = "https://s.jina.ai/{}"
_HEADERS = {
    "Accept": "application/json",
    "X-Retain-Images": "none",
}


class JinaSource(BaseSource):
    name = "jina"
    source_type = "api"
    requires_auth = False

    def enabled(self) -> bool:
        return True

    async def search(self, queries: list[str]) -> list[SearchResult]:
        results: list[SearchResult] = []
        for query in queries:
            hits = await self._search_one(query)
            results.extend(hits)
        return results

    async def _search_one(self, query: str) -> list[SearchResult]:
        url = _JINA_SEARCH_URL.format(quote(query))
        async with create_client(headers=_HEADERS) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return []
            data = resp.json()

        results: list[SearchResult] = []
        for item in data.get("data", []):
            if not item.get("url"):
                continue
            results.append(
                SearchResult(
                    title=item.get("title", ""),
                    url=item["url"],
                    source="jina",
                    snippet=item.get("description", ""),
                    result_type="direct",
                    metadata={
                        k: v
                        for k, v in item.items()
                        if k not in ("title", "url", "description", "content")
                    },
                )
            )
        return results
