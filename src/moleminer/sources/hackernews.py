"""Hacker News search via Algolia API (free, no key needed)."""

from __future__ import annotations

from urllib.parse import quote_plus

from moleminer.models import SearchResult
from moleminer.sources.base import BaseSource
from moleminer.utils.http import fetch_json

_HN_API = "https://hn.algolia.com/api/v1/search"
_HN_ITEM_URL = "https://news.ycombinator.com/item?id={}"


class HackerNewsSource(BaseSource):
    name = "hackernews"
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
        url = f"{_HN_API}?query={quote_plus(query)}&tags=story&hitsPerPage=20"
        data = await fetch_json(url)
        results: list[SearchResult] = []
        for hit in data.get("hits", []):
            item_url = hit.get("url") or _HN_ITEM_URL.format(hit["objectID"])
            results.append(
                SearchResult(
                    title=hit.get("title", ""),
                    url=item_url,
                    source="hackernews",
                    snippet=hit.get("title", ""),
                    result_type="lead",
                    timestamp=hit.get("created_at"),
                    metadata={
                        "points": hit.get("points", 0),
                        "num_comments": hit.get("num_comments", 0),
                        "hn_id": hit.get("objectID"),
                        "author": hit.get("author"),
                    },
                )
            )
        return results
