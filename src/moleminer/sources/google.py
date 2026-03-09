"""Google web search via HTML scraping (no API key needed)."""

from __future__ import annotations

import re
from urllib.parse import quote_plus, urlparse, parse_qs

from moleminer.models import SearchResult
from moleminer.sources.base import BaseSource
from moleminer.utils.http import create_client

_GOOGLE_URL = "https://www.google.com/search?q={}&num=20"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


class GoogleSource(BaseSource):
    name = "google"
    source_type = "scrape"
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
        url = _GOOGLE_URL.format(quote_plus(query))
        async with create_client(headers=_HEADERS) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return []
            return self._parse_html(resp.text)

    def _parse_html(self, html: str) -> list[SearchResult]:
        results: list[SearchResult] = []
        blocks = re.findall(
            r'<div class="g"[^>]*>(.*?)</div>\s*(?=<div class="g"|</body>)',
            html,
            re.DOTALL,
        )
        if not blocks:
            blocks = re.findall(r'<div class="[^"]*g[^"]*">(.*?)</div>', html, re.DOTALL)

        for block in blocks:
            link = self._extract_link(block)
            title = self._extract_title(block)
            snippet = self._extract_snippet(block)
            if link and title:
                results.append(
                    SearchResult(
                        title=title,
                        url=link,
                        source="google",
                        snippet=snippet,
                        result_type="direct",
                    )
                )
        return results

    def _extract_link(self, block: str) -> str | None:
        match = re.search(r'href="(https?://[^"]+)"', block)
        if not match:
            return None
        url = match.group(1)
        parsed = urlparse(url)
        if "google.com" in parsed.netloc:
            qs = parse_qs(parsed.query)
            if "q" in qs:
                return qs["q"][0]
            return None
        return url

    def _extract_title(self, block: str) -> str:
        match = re.search(r"<h3[^>]*>(.*?)</h3>", block, re.DOTALL)
        if match:
            return re.sub(r"<[^>]+>", "", match.group(1)).strip()
        return ""

    def _extract_snippet(self, block: str) -> str:
        match = re.search(r'<div class="VwiC3b[^"]*"[^>]*>(.*?)</div>', block, re.DOTALL)
        if match:
            return re.sub(r"<[^>]+>", "", match.group(1)).strip()
        match = re.search(r'<span class="[^"]*">(.*?)</span>', block, re.DOTALL)
        if match:
            return re.sub(r"<[^>]+>", "", match.group(1)).strip()
        return ""
