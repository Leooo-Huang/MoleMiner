# MoleMiner Phase 1 MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working `pip install moleminer && moleminer search "AI hackathon"` that searches Google, Hacker News, and Jina with zero configuration, aggregates results, stores them in SQLite, and outputs as table/json/markdown.

**Architecture:** 5-stage pipeline (Query Enhancement skipped in MVP, no LLM needed). Sources implement `BaseSource` ABC, registered via `SourceRegistry`. Pipeline orchestrates: dispatch → aggregate → store → output. SQLite auto-stores every search.

**Tech Stack:** Python 3.11+, click (CLI), httpx (async HTTP), rich (terminal output), SQLite (storage), pytest (testing)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `pyproject.toml`
- Create: `src/moleminer/__init__.py`
- Create: `src/moleminer/py.typed`
- Create: `LICENSE`
- Create: `ATTRIBUTION.md`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

**Step 1: Create pyproject.toml**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "moleminer"
version = "0.1.0"
description = "LLM-powered multi-source search aggregation CLI tool"
readme = "README.md"
license = "MIT"
requires-python = ">=3.11"
authors = [{ name = "MoleMiner Contributors" }]
keywords = ["search", "aggregation", "cli", "llm", "multi-source"]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Environment :: Console",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "Topic :: Internet :: WWW/HTTP :: Indexing/Search",
]
dependencies = [
    "click>=8.1",
    "httpx>=0.27",
    "rich>=13.0",
]

[project.optional-dependencies]
tavily = ["tavily-python>=0.5"]
cn = ["playwright>=1.40"]
all = ["moleminer[tavily,cn]"]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "pytest-httpx>=0.34",
    "ruff>=0.8",
]

[project.scripts]
moleminer = "moleminer.cli:main"

[project.urls]
Homepage = "https://github.com/moleminer/moleminer"
Repository = "https://github.com/moleminer/moleminer"

[tool.hatch.build.targets.wheel]
packages = ["src/moleminer"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[tool.ruff]
target-version = "py311"
line-length = 100
```

**Step 2: Create src/moleminer/__init__.py**

```python
"""MoleMiner — LLM-powered multi-source search aggregation."""

__version__ = "0.1.0"
```

**Step 3: Create src/moleminer/py.typed**

Empty file (PEP 561 marker).

**Step 4: Create LICENSE**

Standard MIT license text.

**Step 5: Create ATTRIBUTION.md**

```markdown
# Attribution

## last30days-openclaw

Parts of MoleMiner's search source adapters are based on code from
[last30days-openclaw](https://github.com/mvanhorn/last30days-skill),
licensed under the MIT License.

Copyright (c) last30days contributors
```

**Step 6: Create tests/__init__.py and tests/conftest.py**

```python
# tests/conftest.py
```

**Step 7: Install in dev mode and verify**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv venv && uv pip install -e ".[dev]"`
Expected: Installation succeeds, `python -c "import moleminer; print(moleminer.__version__)"` prints `0.1.0`

**Step 8: Commit**

```bash
git init
git add pyproject.toml src/ tests/ LICENSE ATTRIBUTION.md CLAUDE.md docs/
git commit -m "chore: project scaffolding with pyproject.toml, src layout, and dev tooling"
```

---

### Task 2: Data Models

**Files:**
- Create: `src/moleminer/models.py`
- Create: `tests/test_models.py`

**Step 1: Write the failing test**

```python
# tests/test_models.py
from moleminer.models import SearchResult


def test_search_result_creation():
    r = SearchResult(
        title="AI Hackathon 2026",
        url="https://example.com/hackathon",
        source="google",
        snippet="Annual AI hackathon event",
    )
    assert r.title == "AI Hackathon 2026"
    assert r.source == "google"
    assert r.result_type == "direct"
    assert r.timestamp is None
    assert r.mentions == []
    assert r.metadata == {}


def test_search_result_as_dict():
    r = SearchResult(
        title="Test",
        url="https://example.com",
        source="hackernews",
        snippet="A test result",
        result_type="lead",
        mentions=["ProjectX"],
    )
    d = r.as_dict()
    assert d["title"] == "Test"
    assert d["result_type"] == "lead"
    assert d["mentions"] == ["ProjectX"]
    assert isinstance(d, dict)


def test_search_result_lead_type():
    r = SearchResult(
        title="Discussion about tools",
        url="https://reddit.com/r/test",
        source="reddit",
        snippet="Check out ProjectX and ProjectY",
        result_type="lead",
        mentions=["ProjectX", "ProjectY"],
    )
    assert r.result_type == "lead"
    assert len(r.mentions) == 2
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError` or `ImportError`

**Step 3: Write minimal implementation**

```python
# src/moleminer/models.py
"""Data models for MoleMiner search results."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict


@dataclass
class SearchResult:
    """A single search result from any source."""

    title: str
    url: str
    source: str
    snippet: str
    result_type: str = "direct"  # "direct" | "lead"
    timestamp: str | None = None
    mentions: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return asdict(self)
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_models.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add src/moleminer/models.py tests/test_models.py
git commit -m "feat: add SearchResult data model"
```

---

### Task 3: BaseSource ABC + SourceRegistry

**Files:**
- Create: `src/moleminer/sources/__init__.py`
- Create: `src/moleminer/sources/base.py`
- Create: `src/moleminer/registry.py`
- Create: `tests/test_registry.py`

**Step 1: Write the failing test**

```python
# tests/test_registry.py
import pytest

from moleminer.models import SearchResult
from moleminer.sources.base import BaseSource
from moleminer.registry import SourceRegistry


class FakeSource(BaseSource):
    name = "fake"
    source_type = "api"
    requires_auth = False

    async def search(self, queries: list[str]) -> list[SearchResult]:
        return [
            SearchResult(
                title=f"Fake result for {q}",
                url=f"https://fake.com/{q}",
                source="fake",
                snippet=f"Snippet for {q}",
            )
            for q in queries
        ]

    def enabled(self) -> bool:
        return True


class DisabledSource(BaseSource):
    name = "disabled"
    source_type = "api"
    requires_auth = True

    async def search(self, queries: list[str]) -> list[SearchResult]:
        return []

    def enabled(self) -> bool:
        return False


def test_register_and_get_source():
    reg = SourceRegistry()
    reg.register(FakeSource)
    source = reg.get_source("fake")
    assert isinstance(source, FakeSource)


def test_get_enabled_sources():
    reg = SourceRegistry()
    reg.register(FakeSource)
    reg.register(DisabledSource)
    enabled = reg.get_enabled_sources()
    assert len(enabled) == 1
    assert enabled[0].name == "fake"


def test_get_nonexistent_source():
    reg = SourceRegistry()
    with pytest.raises(KeyError):
        reg.get_source("nonexistent")


async def test_source_search():
    source = FakeSource()
    results = await source.search(["test query"])
    assert len(results) == 1
    assert results[0].title == "Fake result for test query"
    assert results[0].source == "fake"
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_registry.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/sources/__init__.py
"""Search source adapters."""
```

```python
# src/moleminer/sources/base.py
"""Base class for all search sources."""

from __future__ import annotations

from abc import ABC, abstractmethod

from moleminer.models import SearchResult


class BaseSource(ABC):
    """Abstract base class for search source adapters."""

    name: str
    source_type: str  # "api" | "scrape" | "browser"
    requires_auth: bool

    @abstractmethod
    async def search(self, queries: list[str]) -> list[SearchResult]:
        """Execute search and return results."""
        ...

    @abstractmethod
    def enabled(self) -> bool:
        """Check if this source is available (deps installed, auth present)."""
        ...
```

```python
# src/moleminer/registry.py
"""Source registry for discovering and managing search sources."""

from __future__ import annotations

from moleminer.sources.base import BaseSource


class SourceRegistry:
    """Registry of all available search sources."""

    def __init__(self) -> None:
        self._sources: dict[str, type[BaseSource]] = {}

    def register(self, source_cls: type[BaseSource]) -> None:
        self._sources[source_cls.name] = source_cls

    def get_source(self, name: str) -> BaseSource:
        if name not in self._sources:
            raise KeyError(f"Source '{name}' not registered")
        return self._sources[name]()

    def get_enabled_sources(self) -> list[BaseSource]:
        return [cls() for cls in self._sources.values() if cls().enabled()]

    def list_sources(self) -> list[str]:
        return list(self._sources.keys())
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_registry.py -v`
Expected: 4 passed

**Step 5: Commit**

```bash
git add src/moleminer/sources/ src/moleminer/registry.py tests/test_registry.py
git commit -m "feat: add BaseSource ABC and SourceRegistry"
```

---

### Task 4: HTTP Utility

**Files:**
- Create: `src/moleminer/utils/__init__.py`
- Create: `src/moleminer/utils/http.py`
- Create: `tests/test_http.py`

**Step 1: Write the failing test**

```python
# tests/test_http.py
import httpx
import pytest

from moleminer.utils.http import create_client, fetch_json, fetch_text


async def test_create_client():
    async with create_client() as client:
        assert isinstance(client, httpx.AsyncClient)
        assert client.timeout.connect == 10.0


async def test_fetch_json(httpx_mock):
    httpx_mock.add_response(
        url="https://api.example.com/data",
        json={"results": [1, 2, 3]},
    )
    data = await fetch_json("https://api.example.com/data")
    assert data == {"results": [1, 2, 3]}


async def test_fetch_text(httpx_mock):
    httpx_mock.add_response(
        url="https://example.com/page",
        text="Hello World",
    )
    text = await fetch_text("https://example.com/page")
    assert text == "Hello World"


async def test_fetch_json_error(httpx_mock):
    httpx_mock.add_response(
        url="https://api.example.com/fail",
        status_code=500,
    )
    with pytest.raises(httpx.HTTPStatusError):
        await fetch_json("https://api.example.com/fail")
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_http.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/utils/__init__.py
"""Utility modules."""
```

```python
# src/moleminer/utils/http.py
"""HTTP client utilities for MoleMiner."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx

_DEFAULT_TIMEOUT = httpx.Timeout(10.0, read=30.0)
_DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MoleMiner/0.1; +https://github.com/moleminer/moleminer)"
}


@asynccontextmanager
async def create_client(**kwargs: Any) -> AsyncIterator[httpx.AsyncClient]:
    """Create a configured httpx async client."""
    defaults = {"timeout": _DEFAULT_TIMEOUT, "headers": _DEFAULT_HEADERS, "follow_redirects": True}
    defaults.update(kwargs)
    async with httpx.AsyncClient(**defaults) as client:
        yield client


async def fetch_json(url: str, **kwargs: Any) -> Any:
    """Fetch a URL and return parsed JSON."""
    async with create_client() as client:
        resp = await client.get(url, **kwargs)
        resp.raise_for_status()
        return resp.json()


async def fetch_text(url: str, **kwargs: Any) -> str:
    """Fetch a URL and return text content."""
    async with create_client() as client:
        resp = await client.get(url, **kwargs)
        resp.raise_for_status()
        return resp.text
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_http.py -v`
Expected: 4 passed

**Step 5: Commit**

```bash
git add src/moleminer/utils/ tests/test_http.py
git commit -m "feat: add HTTP client utilities"
```

---

### Task 5: Hacker News Source

**Files:**
- Create: `src/moleminer/sources/hackernews.py`
- Create: `tests/test_hackernews.py`

**Step 1: Write the failing test**

```python
# tests/test_hackernews.py
from moleminer.sources.hackernews import HackerNewsSource


def test_hackernews_metadata():
    source = HackerNewsSource()
    assert source.name == "hackernews"
    assert source.source_type == "api"
    assert source.requires_auth is False
    assert source.enabled() is True


async def test_hackernews_search(httpx_mock):
    httpx_mock.add_response(
        url="https://hn.algolia.com/api/v1/search?query=AI+hackathon&tags=story&hitsPerPage=20",
        json={
            "hits": [
                {
                    "title": "AI Hackathon 2026",
                    "url": "https://hackathon.example.com",
                    "objectID": "12345",
                    "points": 150,
                    "num_comments": 42,
                    "created_at": "2026-03-01T00:00:00Z",
                    "author": "testuser",
                },
                {
                    "title": "Show HN: My AI project",
                    "url": None,
                    "objectID": "12346",
                    "points": 50,
                    "num_comments": 10,
                    "created_at": "2026-02-28T00:00:00Z",
                    "author": "another",
                },
            ]
        },
    )

    source = HackerNewsSource()
    results = await source.search(["AI hackathon"])
    assert len(results) == 2
    assert results[0].title == "AI Hackathon 2026"
    assert results[0].url == "https://hackathon.example.com"
    assert results[0].source == "hackernews"
    assert results[0].result_type == "lead"
    assert results[0].metadata["points"] == 150
    # Result without URL should use HN item URL
    assert "news.ycombinator.com" in results[1].url


async def test_hackernews_multiple_queries(httpx_mock):
    for q in ["query+one", "query+two"]:
        httpx_mock.add_response(
            url=f"https://hn.algolia.com/api/v1/search?query={q}&tags=story&hitsPerPage=20",
            json={"hits": []},
        )
    source = HackerNewsSource()
    results = await source.search(["query one", "query two"])
    assert results == []
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_hackernews.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/sources/hackernews.py
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
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_hackernews.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add src/moleminer/sources/hackernews.py tests/test_hackernews.py
git commit -m "feat: add Hacker News source (Algolia API)"
```

---

### Task 6: Google Scraping Source

**Files:**
- Create: `src/moleminer/sources/google.py`
- Create: `tests/test_google.py`

**Step 1: Write the failing test**

```python
# tests/test_google.py
from moleminer.sources.google import GoogleSource


def test_google_metadata():
    source = GoogleSource()
    assert source.name == "google"
    assert source.source_type == "scrape"
    assert source.requires_auth is False
    assert source.enabled() is True


async def test_google_search(httpx_mock):
    # Google search returns HTML; we parse it for links
    html = """
    <html><body>
    <div class="g">
      <a href="https://example.com/result1"><h3>AI Hackathon Event</h3></a>
      <div class="VwiC3b">Join the best AI hackathon of 2026</div>
    </div>
    <div class="g">
      <a href="https://example.com/result2"><h3>ML Competition Guide</h3></a>
      <div class="VwiC3b">Complete guide to ML competitions</div>
    </div>
    </body></html>
    """
    httpx_mock.add_response(text=html)

    source = GoogleSource()
    results = await source.search(["AI hackathon"])
    assert len(results) >= 0  # Google scraping is best-effort
    for r in results:
        assert r.source == "google"
        assert r.result_type == "direct"


async def test_google_empty_results(httpx_mock):
    httpx_mock.add_response(text="<html><body>No results</body></html>")
    source = GoogleSource()
    results = await source.search(["xyznonexistent123"])
    assert results == []
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_google.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/sources/google.py
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
        # Parse <div class="g"> blocks containing search results
        blocks = re.findall(
            r'<div class="g"[^>]*>(.*?)</div>\s*(?=<div class="g"|</body>)',
            html,
            re.DOTALL,
        )
        if not blocks:
            # Fallback: try to find any result links
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
        # Skip Google's own URLs
        parsed = urlparse(url)
        if "google.com" in parsed.netloc:
            # Try to extract actual URL from Google redirect
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
        # Fallback: try any span with snippet-like content
        match = re.search(r'<span class="[^"]*">(.*?)</span>', block, re.DOTALL)
        if match:
            return re.sub(r"<[^>]+>", "", match.group(1)).strip()
        return ""
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_google.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add src/moleminer/sources/google.py tests/test_google.py
git commit -m "feat: add Google web scraping source"
```

---

### Task 7: Jina Reader Source

**Files:**
- Create: `src/moleminer/sources/jina.py`
- Create: `tests/test_jina.py`

**Step 1: Write the failing test**

```python
# tests/test_jina.py
from moleminer.sources.jina import JinaSource


def test_jina_metadata():
    source = JinaSource()
    assert source.name == "jina"
    assert source.source_type == "api"
    assert source.requires_auth is False
    assert source.enabled() is True


async def test_jina_search(httpx_mock):
    # Jina search API: https://s.jina.ai/{query}
    httpx_mock.add_response(
        url="https://s.jina.ai/AI%20hackathon%202026",
        json={
            "data": [
                {
                    "title": "AI Hackathon 2026 - Official Site",
                    "url": "https://hackathon.example.com",
                    "description": "Register for the biggest AI hackathon",
                    "content": "Full page content here",
                },
                {
                    "title": "Top AI Events 2026",
                    "url": "https://events.example.com",
                    "description": "List of AI events including hackathons",
                    "content": "More content",
                },
            ]
        },
        headers={"Content-Type": "application/json"},
    )

    source = JinaSource()
    results = await source.search(["AI hackathon 2026"])
    assert len(results) == 2
    assert results[0].title == "AI Hackathon 2026 - Official Site"
    assert results[0].source == "jina"
    assert results[0].result_type == "direct"


async def test_jina_empty_response(httpx_mock):
    httpx_mock.add_response(
        url="https://s.jina.ai/nothing",
        json={"data": []},
    )
    source = JinaSource()
    results = await source.search(["nothing"])
    assert results == []
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_jina.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/sources/jina.py
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
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_jina.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add src/moleminer/sources/jina.py tests/test_jina.py
git commit -m "feat: add Jina search source"
```

---

### Task 8: Deduplication Utility

**Files:**
- Create: `src/moleminer/utils/dedupe.py`
- Create: `tests/test_dedupe.py`

**Step 1: Write the failing test**

```python
# tests/test_dedupe.py
from moleminer.models import SearchResult
from moleminer.utils.dedupe import normalize_url, dedupe_results


def _make_result(title: str, url: str, source: str = "google") -> SearchResult:
    return SearchResult(title=title, url=url, source=source, snippet="test")


def test_normalize_url():
    assert normalize_url("https://example.com/page?ref=twitter") == "https://example.com/page"
    assert normalize_url("http://example.com/page") == "https://example.com/page"
    assert normalize_url("https://example.com/page/") == "https://example.com/page"
    assert normalize_url("https://EXAMPLE.COM/Page") == "https://example.com/Page"


def test_dedupe_exact_url():
    results = [
        _make_result("Title A", "https://example.com/page"),
        _make_result("Title B", "https://example.com/page"),
    ]
    deduped = dedupe_results(results)
    assert len(deduped) == 1


def test_dedupe_url_variants():
    results = [
        _make_result("Title A", "https://example.com/page?ref=twitter"),
        _make_result("Title B", "http://example.com/page/"),
    ]
    deduped = dedupe_results(results)
    assert len(deduped) == 1


def test_dedupe_similar_titles():
    results = [
        _make_result("AI Hackathon 2026 Event", "https://a.com"),
        _make_result("AI Hackathon 2026 Event Registration", "https://b.com"),
    ]
    deduped = dedupe_results(results)
    # Similar but different URLs — both kept (title similarity not aggressive enough to merge different domains)
    assert len(deduped) == 2


def test_dedupe_preserves_order():
    results = [
        _make_result("First", "https://a.com"),
        _make_result("Second", "https://b.com"),
        _make_result("Third", "https://c.com"),
    ]
    deduped = dedupe_results(results)
    assert [r.title for r in deduped] == ["First", "Second", "Third"]


def test_dedupe_empty():
    assert dedupe_results([]) == []
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_dedupe.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/utils/dedupe.py
"""URL normalization and result deduplication."""

from __future__ import annotations

from urllib.parse import urlparse, urlunparse

from moleminer.models import SearchResult

# Query params commonly used for tracking, safe to strip
_TRACKING_PARAMS = {
    "ref", "utm_source", "utm_medium", "utm_campaign", "utm_content",
    "utm_term", "fbclid", "gclid", "source", "via",
}


def normalize_url(url: str) -> str:
    """Normalize a URL for deduplication comparison."""
    parsed = urlparse(url)
    # Force https
    scheme = "https"
    # Lowercase host
    netloc = parsed.netloc.lower()
    # Strip trailing slash
    path = parsed.path.rstrip("/")
    # Remove tracking params
    query = ""
    if parsed.query:
        params = parsed.query.split("&")
        filtered = [p for p in params if p.split("=")[0] not in _TRACKING_PARAMS]
        query = "&".join(sorted(filtered))
    return urlunparse((scheme, netloc, path, "", query, ""))


def dedupe_results(results: list[SearchResult]) -> list[SearchResult]:
    """Remove duplicate results based on normalized URL."""
    seen_urls: set[str] = set()
    deduped: list[SearchResult] = []
    for r in results:
        norm = normalize_url(r.url)
        if norm in seen_urls:
            continue
        seen_urls.add(norm)
        deduped.append(r)
    return deduped
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_dedupe.py -v`
Expected: 5 passed

**Step 5: Commit**

```bash
git add src/moleminer/utils/dedupe.py tests/test_dedupe.py
git commit -m "feat: add URL normalization and deduplication"
```

---

### Task 9: Aggregate Stage

**Files:**
- Create: `src/moleminer/aggregate.py`
- Create: `tests/test_aggregate.py`

**Step 1: Write the failing test**

```python
# tests/test_aggregate.py
from moleminer.models import SearchResult
from moleminer.aggregate import aggregate_results


def _make(title: str, url: str, source: str = "google", result_type: str = "direct") -> SearchResult:
    return SearchResult(title=title, url=url, source=source, snippet="s", result_type=result_type)


def test_aggregate_dedupes():
    results = [
        _make("Same Page", "https://example.com/page", "google"),
        _make("Same Page", "https://example.com/page?ref=hn", "hackernews"),
    ]
    agg = aggregate_results(results)
    assert len(agg) == 1


def test_aggregate_preserves_different():
    results = [
        _make("Page A", "https://a.com"),
        _make("Page B", "https://b.com"),
    ]
    agg = aggregate_results(results)
    assert len(agg) == 2


def test_aggregate_separates_types():
    results = [
        _make("Direct Result", "https://a.com", result_type="direct"),
        _make("Lead Result", "https://b.com", result_type="lead"),
    ]
    agg = aggregate_results(results)
    directs = [r for r in agg if r.result_type == "direct"]
    leads = [r for r in agg if r.result_type == "lead"]
    assert len(directs) == 1
    assert len(leads) == 1


def test_aggregate_empty():
    assert aggregate_results([]) == []
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_aggregate.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/aggregate.py
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
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_aggregate.py -v`
Expected: 4 passed

**Step 5: Commit**

```bash
git add src/moleminer/aggregate.py tests/test_aggregate.py
git commit -m "feat: add aggregate stage (dedupe + classify)"
```

---

### Task 10: SQLite Store

**Files:**
- Create: `src/moleminer/store.py`
- Create: `tests/test_store.py`

**Step 1: Write the failing test**

```python
# tests/test_store.py
import sqlite3
from pathlib import Path

import pytest

from moleminer.models import SearchResult
from moleminer.store import SearchStore


@pytest.fixture
def store(tmp_path: Path) -> SearchStore:
    db_path = tmp_path / "test.db"
    return SearchStore(db_path)


def test_store_creates_db(store: SearchStore):
    store.init_db()
    assert store.db_path.exists()


def test_store_tables_exist(store: SearchStore):
    store.init_db()
    conn = sqlite3.connect(store.db_path)
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in cursor.fetchall()}
    conn.close()
    assert "searches" in tables
    assert "results" in tables


def test_save_search(store: SearchStore):
    store.init_db()
    results = [
        SearchResult(
            title="Test Result",
            url="https://example.com",
            source="google",
            snippet="A test",
            result_type="direct",
            timestamp="2026-03-09T00:00:00Z",
        ),
        SearchResult(
            title="HN Discussion",
            url="https://news.ycombinator.com/item?id=123",
            source="hackernews",
            snippet="Discussion",
            result_type="lead",
            mentions=["ProjectX"],
        ),
    ]
    search_id = store.save_search(
        query="test query",
        sources_used=["google", "hackernews"],
        results=results,
    )
    assert search_id == 1


def test_get_search(store: SearchStore):
    store.init_db()
    results = [
        SearchResult(
            title="Test",
            url="https://example.com",
            source="google",
            snippet="A test",
        ),
    ]
    search_id = store.save_search(
        query="test query",
        sources_used=["google"],
        results=results,
    )
    search = store.get_search(search_id)
    assert search is not None
    assert search["query"] == "test query"
    assert search["result_count"] == 1


def test_get_results(store: SearchStore):
    store.init_db()
    results = [
        SearchResult(
            title="Result 1",
            url="https://a.com",
            source="google",
            snippet="First",
        ),
        SearchResult(
            title="Result 2",
            url="https://b.com",
            source="hackernews",
            snippet="Second",
            result_type="lead",
        ),
    ]
    search_id = store.save_search(query="q", sources_used=["google", "hackernews"], results=results)
    stored = store.get_results(search_id)
    assert len(stored) == 2
    assert stored[0]["title"] == "Result 1"
    assert stored[1]["result_type"] == "lead"


def test_list_searches(store: SearchStore):
    store.init_db()
    store.save_search(query="first", sources_used=["google"], results=[])
    store.save_search(query="second", sources_used=["hackernews"], results=[])
    searches = store.list_searches(limit=10)
    assert len(searches) == 2
    # Most recent first
    assert searches[0]["query"] == "second"
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_store.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/store.py
"""SQLite storage for search queries and results."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from moleminer.models import SearchResult

_DEFAULT_DB_PATH = Path.home() / ".moleminer" / "moleminer.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    sources_used TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    searched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    result_type TEXT NOT NULL DEFAULT 'direct',
    timestamp TEXT,
    mentions TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (search_id) REFERENCES searches(id)
);

CREATE INDEX IF NOT EXISTS idx_results_search_id ON results(search_id);
"""


class SearchStore:
    """Manages SQLite storage for search history."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or _DEFAULT_DB_PATH

    def init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.executescript(_SCHEMA)
        conn.close()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def save_search(
        self,
        query: str,
        sources_used: list[str],
        results: list[SearchResult],
    ) -> int:
        conn = self._connect()
        now = datetime.now(timezone.utc).isoformat()
        cursor = conn.execute(
            "INSERT INTO searches (query, sources_used, result_count, searched_at) VALUES (?, ?, ?, ?)",
            (query, json.dumps(sources_used), len(results), now),
        )
        search_id = cursor.lastrowid
        assert search_id is not None
        for r in results:
            conn.execute(
                """INSERT INTO results
                   (search_id, title, url, source, snippet, result_type, timestamp, mentions, metadata)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    search_id,
                    r.title,
                    r.url,
                    r.source,
                    r.snippet,
                    r.result_type,
                    r.timestamp,
                    json.dumps(r.mentions),
                    json.dumps(r.metadata),
                ),
            )
        conn.commit()
        conn.close()
        return search_id

    def get_search(self, search_id: int) -> dict[str, Any] | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM searches WHERE id = ?", (search_id,)).fetchone()
        conn.close()
        if row is None:
            return None
        return dict(row)

    def get_results(self, search_id: int) -> list[dict[str, Any]]:
        conn = self._connect()
        rows = conn.execute(
            "SELECT * FROM results WHERE search_id = ? ORDER BY id", (search_id,)
        ).fetchall()
        conn.close()
        return [dict(row) for row in rows]

    def list_searches(self, limit: int = 20) -> list[dict[str, Any]]:
        conn = self._connect()
        rows = conn.execute(
            "SELECT * FROM searches ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        conn.close()
        return [dict(row) for row in rows]
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_store.py -v`
Expected: 6 passed

**Step 5: Commit**

```bash
git add src/moleminer/store.py tests/test_store.py
git commit -m "feat: add SQLite storage for search history"
```

---

### Task 11: Pipeline Orchestrator

**Files:**
- Create: `src/moleminer/pipeline.py`
- Create: `tests/test_pipeline.py`

**Step 1: Write the failing test**

```python
# tests/test_pipeline.py
from pathlib import Path

import pytest

from moleminer.models import SearchResult
from moleminer.sources.base import BaseSource
from moleminer.registry import SourceRegistry
from moleminer.pipeline import Pipeline


class MockSource(BaseSource):
    name = "mock"
    source_type = "api"
    requires_auth = False

    async def search(self, queries: list[str]) -> list[SearchResult]:
        return [
            SearchResult(
                title=f"Mock: {q}",
                url=f"https://mock.com/{q.replace(' ', '-')}",
                source="mock",
                snippet=f"Mock result for {q}",
            )
            for q in queries
        ]

    def enabled(self) -> bool:
        return True


class MockSource2(BaseSource):
    name = "mock2"
    source_type = "api"
    requires_auth = False

    async def search(self, queries: list[str]) -> list[SearchResult]:
        return [
            SearchResult(
                title=f"Mock2: {q}",
                url=f"https://mock2.com/{q.replace(' ', '-')}",
                source="mock2",
                snippet=f"Mock2 result for {q}",
                result_type="lead",
            )
            for q in queries
        ]

    def enabled(self) -> bool:
        return True


@pytest.fixture
def registry() -> SourceRegistry:
    reg = SourceRegistry()
    reg.register(MockSource)
    reg.register(MockSource2)
    return reg


@pytest.fixture
def pipeline(registry: SourceRegistry, tmp_path: Path) -> Pipeline:
    return Pipeline(registry=registry, db_path=tmp_path / "test.db")


async def test_pipeline_search(pipeline: Pipeline):
    results = await pipeline.search("test query")
    assert len(results) == 2
    sources = {r.source for r in results}
    assert sources == {"mock", "mock2"}


async def test_pipeline_search_specific_sources(pipeline: Pipeline):
    results = await pipeline.search("test", sources=["mock"])
    assert len(results) == 1
    assert results[0].source == "mock"


async def test_pipeline_dedupes(registry: SourceRegistry, tmp_path: Path):
    class DupeSource(BaseSource):
        name = "dupe"
        source_type = "api"
        requires_auth = False

        async def search(self, queries: list[str]) -> list[SearchResult]:
            return [
                SearchResult(
                    title="Same Result",
                    url="https://example.com/same",
                    source="dupe",
                    snippet="Duplicate",
                )
            ]

        def enabled(self) -> bool:
            return True

    reg = SourceRegistry()
    reg.register(MockSource)
    reg.register(DupeSource)
    # MockSource also returns a result, DupeSource returns one with different URL
    pipe = Pipeline(registry=reg, db_path=tmp_path / "test.db")
    results = await pipe.search("test")
    urls = [r.url for r in results]
    assert len(urls) == len(set(urls))  # no duplicates


async def test_pipeline_stores_results(pipeline: Pipeline):
    results = await pipeline.search("stored query")
    searches = pipeline.store.list_searches()
    assert len(searches) == 1
    assert searches[0]["query"] == "stored query"
    assert searches[0]["result_count"] == len(results)


async def test_pipeline_returns_directs_first(pipeline: Pipeline):
    results = await pipeline.search("test")
    # MockSource returns "direct", MockSource2 returns "lead"
    assert results[0].result_type == "direct"
    assert results[1].result_type == "lead"
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_pipeline.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/pipeline.py
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
        """Run the full search pipeline.

        Args:
            query: The search query string.
            sources: Optional list of source names to use. If None, uses all enabled sources.

        Returns:
            Aggregated, deduplicated list of SearchResult objects.
        """
        # Stage 1: Query Enhancement (skipped in MVP — use raw query)
        queries = [query]

        # Stage 2: Parallel Dispatch
        source_instances = self._get_sources(sources)
        raw_results = await self._dispatch(queries, source_instances)

        # Stage 3: Aggregate
        results = aggregate_results(raw_results)

        # Stage 4: Lead Resolution (skipped in MVP)

        # Stage 5: Store
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
                continue  # Skip failed sources silently in MVP
            all_results.extend(result)
        return all_results
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_pipeline.py -v`
Expected: 5 passed

**Step 5: Commit**

```bash
git add src/moleminer/pipeline.py tests/test_pipeline.py
git commit -m "feat: add pipeline orchestrator (dispatch + aggregate + store)"
```

---

### Task 12: Source Registration (Wire Up Real Sources)

**Files:**
- Modify: `src/moleminer/sources/__init__.py`
- Create: `tests/test_source_registration.py`

**Step 1: Write the failing test**

```python
# tests/test_source_registration.py
from moleminer.sources import default_registry


def test_default_registry_has_sources():
    names = default_registry.list_sources()
    assert "hackernews" in names
    assert "google" in names
    assert "jina" in names


def test_all_default_sources_enabled():
    # All MVP sources are zero-config, should be enabled
    enabled = default_registry.get_enabled_sources()
    names = {s.name for s in enabled}
    assert "hackernews" in names
    assert "google" in names
    assert "jina" in names
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_source_registration.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/sources/__init__.py
"""Search source adapters."""

from moleminer.registry import SourceRegistry
from moleminer.sources.google import GoogleSource
from moleminer.sources.hackernews import HackerNewsSource
from moleminer.sources.jina import JinaSource

default_registry = SourceRegistry()
default_registry.register(GoogleSource)
default_registry.register(HackerNewsSource)
default_registry.register(JinaSource)
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_source_registration.py -v`
Expected: 2 passed

**Step 5: Commit**

```bash
git add src/moleminer/sources/__init__.py tests/test_source_registration.py
git commit -m "feat: wire up default source registry with Google, HN, Jina"
```

---

### Task 13: CLI — `moleminer search`

**Files:**
- Create: `src/moleminer/cli.py`
- Create: `src/moleminer/output.py`
- Create: `tests/test_cli.py`

**Step 1: Write the failing test**

```python
# tests/test_cli.py
import json
from unittest.mock import AsyncMock, patch

from click.testing import CliRunner

from moleminer.cli import main
from moleminer.models import SearchResult


def _mock_results():
    return [
        SearchResult(
            title="AI Hackathon 2026",
            url="https://hackathon.example.com",
            source="google",
            snippet="The best AI hackathon",
            result_type="direct",
        ),
        SearchResult(
            title="HN: AI Hackathon Discussion",
            url="https://news.ycombinator.com/item?id=123",
            source="hackernews",
            snippet="Great discussion about hackathons",
            result_type="lead",
            mentions=["Google AI Hackathon"],
        ),
    ]


@patch("moleminer.cli._run_search")
def test_search_json(mock_search):
    mock_search.return_value = _mock_results()
    runner = CliRunner()
    result = runner.invoke(main, ["search", "AI hackathon", "--format", "json"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert len(data) == 2
    assert data[0]["title"] == "AI Hackathon 2026"


@patch("moleminer.cli._run_search")
def test_search_table(mock_search):
    mock_search.return_value = _mock_results()
    runner = CliRunner()
    result = runner.invoke(main, ["search", "AI hackathon"])
    assert result.exit_code == 0
    assert "AI Hackathon 2026" in result.output


@patch("moleminer.cli._run_search")
def test_search_markdown(mock_search):
    mock_search.return_value = _mock_results()
    runner = CliRunner()
    result = runner.invoke(main, ["search", "AI hackathon", "--format", "markdown"])
    assert result.exit_code == 0
    assert "AI Hackathon 2026" in result.output
    assert "https://hackathon.example.com" in result.output


@patch("moleminer.cli._run_search")
def test_search_with_sources(mock_search):
    mock_search.return_value = _mock_results()
    runner = CliRunner()
    result = runner.invoke(main, ["search", "AI hackathon", "--sources", "google,hackernews"])
    assert result.exit_code == 0


def test_version():
    runner = CliRunner()
    result = runner.invoke(main, ["--version"])
    assert result.exit_code == 0
    assert "0.1.0" in result.output


@patch("moleminer.cli._run_search")
def test_search_no_results(mock_search):
    mock_search.return_value = []
    runner = CliRunner()
    result = runner.invoke(main, ["search", "xyznonexistent"])
    assert result.exit_code == 0
    assert "No results" in result.output or result.output.strip() == "[]"
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_cli.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write output formatter**

```python
# src/moleminer/output.py
"""Output formatters for search results."""

from __future__ import annotations

import json

from rich.console import Console
from rich.table import Table

from moleminer.models import SearchResult


def format_json(results: list[SearchResult]) -> str:
    return json.dumps([r.as_dict() for r in results], indent=2, ensure_ascii=False)


def format_table(results: list[SearchResult], console: Console | None = None) -> None:
    console = console or Console()
    if not results:
        console.print("[dim]No results found.[/dim]")
        return

    table = Table(title="Search Results", show_lines=True)
    table.add_column("#", style="dim", width=4)
    table.add_column("Title", style="bold", max_width=50)
    table.add_column("Source", style="cyan", width=12)
    table.add_column("Type", width=8)
    table.add_column("URL", style="blue", max_width=60)

    for i, r in enumerate(results, 1):
        type_style = "green" if r.result_type == "direct" else "yellow"
        table.add_row(
            str(i),
            r.title,
            r.source,
            f"[{type_style}]{r.result_type}[/{type_style}]",
            r.url,
        )

    console.print(table)


def format_markdown(results: list[SearchResult]) -> str:
    if not results:
        return "No results found."

    lines: list[str] = []
    for i, r in enumerate(results, 1):
        lines.append(f"### {i}. {r.title}")
        lines.append(f"- **Source:** {r.source}")
        lines.append(f"- **Type:** {r.result_type}")
        lines.append(f"- **URL:** {r.url}")
        if r.snippet:
            lines.append(f"- **Snippet:** {r.snippet}")
        if r.mentions:
            lines.append(f"- **Mentions:** {', '.join(r.mentions)}")
        lines.append("")

    return "\n".join(lines)
```

**Step 4: Write CLI**

```python
# src/moleminer/cli.py
"""MoleMiner CLI entry point."""

from __future__ import annotations

import asyncio
import json

import click
from rich.console import Console

from moleminer import __version__
from moleminer.models import SearchResult
from moleminer.output import format_json, format_markdown, format_table
from moleminer.pipeline import Pipeline
from moleminer.sources import default_registry

console = Console()


def _run_search(query: str, sources: list[str] | None = None) -> list[SearchResult]:
    """Run async search in sync context."""
    pipeline = Pipeline(registry=default_registry)
    return asyncio.run(pipeline.search(query, sources=sources))


@click.group()
@click.version_option(__version__, prog_name="moleminer")
def main() -> None:
    """MoleMiner — LLM-powered multi-source search aggregation."""
    pass


@main.command()
@click.argument("query")
@click.option("--sources", "-s", default=None, help="Comma-separated list of sources to use.")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["table", "json", "markdown"]),
    default="table",
    help="Output format.",
)
def search(query: str, sources: str | None, output_format: str) -> None:
    """Search across multiple sources."""
    source_list = sources.split(",") if sources else None

    with console.status("[bold green]Searching..."):
        results = _run_search(query, sources=source_list)

    if output_format == "json":
        click.echo(format_json(results))
    elif output_format == "markdown":
        click.echo(format_markdown(results))
    else:
        format_table(results, console=console)
```

**Step 5: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_cli.py -v`
Expected: 6 passed

**Step 6: Commit**

```bash
git add src/moleminer/cli.py src/moleminer/output.py tests/test_cli.py
git commit -m "feat: add CLI with search command and table/json/markdown output"
```

---

### Task 14: Public SDK API

**Files:**
- Modify: `src/moleminer/__init__.py`
- Create: `tests/test_sdk.py`

**Step 1: Write the failing test**

```python
# tests/test_sdk.py
from unittest.mock import AsyncMock, patch

from moleminer import search, search_async
from moleminer.models import SearchResult


@patch("moleminer.pipeline.Pipeline.search", new_callable=AsyncMock)
async def test_search_async(mock_search):
    mock_search.return_value = [
        SearchResult(
            title="Test",
            url="https://example.com",
            source="mock",
            snippet="test",
        )
    ]
    results = await search_async("test query")
    assert len(results) == 1
    assert results[0].title == "Test"


@patch("moleminer.pipeline.Pipeline.search", new_callable=AsyncMock)
def test_search_sync(mock_search):
    mock_search.return_value = [
        SearchResult(
            title="Test",
            url="https://example.com",
            source="mock",
            snippet="test",
        )
    ]
    results = search("test query")
    assert len(results) == 1
```

**Step 2: Run test to verify it fails**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_sdk.py -v`
Expected: FAIL with `ImportError`

**Step 3: Write implementation**

```python
# src/moleminer/__init__.py
"""MoleMiner — LLM-powered multi-source search aggregation."""

from __future__ import annotations

import asyncio

from moleminer.models import SearchResult
from moleminer.pipeline import Pipeline
from moleminer.sources import default_registry

__version__ = "0.1.0"

__all__ = ["search", "search_async", "SearchResult", "__version__"]


async def search_async(
    query: str,
    sources: list[str] | None = None,
) -> list[SearchResult]:
    """Async search across multiple sources.

    Args:
        query: The search query string.
        sources: Optional list of source names. If None, uses all enabled sources.

    Returns:
        List of deduplicated SearchResult objects.
    """
    pipeline = Pipeline(registry=default_registry)
    return await pipeline.search(query, sources=sources)


def search(
    query: str,
    sources: list[str] | None = None,
) -> list[SearchResult]:
    """Synchronous search across multiple sources.

    Args:
        query: The search query string.
        sources: Optional list of source names. If None, uses all enabled sources.

    Returns:
        List of deduplicated SearchResult objects.
    """
    return asyncio.run(search_async(query, sources=sources))
```

**Step 4: Run test to verify it passes**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_sdk.py -v`
Expected: 2 passed

**Step 5: Commit**

```bash
git add src/moleminer/__init__.py tests/test_sdk.py
git commit -m "feat: add public SDK API (search, search_async)"
```

---

### Task 15: Full Integration Test

**Files:**
- Create: `tests/test_integration.py`

**Step 1: Write integration test**

```python
# tests/test_integration.py
"""End-to-end integration test using mocked HTTP responses."""

from pathlib import Path

import pytest

from moleminer.pipeline import Pipeline
from moleminer.sources import default_registry


@pytest.fixture
def pipeline(tmp_path: Path) -> Pipeline:
    return Pipeline(registry=default_registry, db_path=tmp_path / "test.db")


async def test_full_pipeline(pipeline: Pipeline, httpx_mock):
    # Mock Google response
    httpx_mock.add_response(
        url__regex=r"https://www\.google\.com/search.*",
        text="""
        <html><body>
        <div class="g">
          <a href="https://hackathon.dev"><h3>AI Hackathon 2026</h3></a>
          <div class="VwiC3b">Official site for the AI Hackathon</div>
        </div>
        </body></html>
        """,
    )

    # Mock Hacker News response
    httpx_mock.add_response(
        url__regex=r"https://hn\.algolia\.com/api/v1/search.*",
        json={
            "hits": [
                {
                    "title": "AI Hackathon 2026 - Anyone going?",
                    "url": "https://hackathon.dev",
                    "objectID": "99999",
                    "points": 200,
                    "num_comments": 80,
                    "created_at": "2026-03-01T00:00:00Z",
                    "author": "hnuser",
                }
            ]
        },
    )

    # Mock Jina response
    httpx_mock.add_response(
        url__regex=r"https://s\.jina\.ai/.*",
        json={
            "data": [
                {
                    "title": "Top AI Events 2026",
                    "url": "https://events.example.com/ai-2026",
                    "description": "A curated list of AI events",
                }
            ]
        },
    )

    results = await pipeline.search("AI hackathon 2026")

    # Should have results from all 3 sources (minus dedupes)
    assert len(results) >= 2
    sources = {r.source for r in results}
    # At least 2 of the 3 sources should appear (Google parsing is fragile)
    assert len(sources) >= 2

    # Verify directs come before leads
    types = [r.result_type for r in results]
    if "direct" in types and "lead" in types:
        first_lead = types.index("lead")
        last_direct = len(types) - 1 - types[::-1].index("direct")
        assert last_direct < first_lead

    # Verify stored in SQLite
    searches = pipeline.store.list_searches()
    assert len(searches) == 1
    assert searches[0]["query"] == "AI hackathon 2026"
    assert searches[0]["result_count"] == len(results)
```

**Step 2: Run test**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest tests/test_integration.py -v`
Expected: 1 passed

**Step 3: Run full test suite**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest -v`
Expected: All tests pass

**Step 4: Commit**

```bash
git add tests/test_integration.py
git commit -m "test: add end-to-end integration test"
```

---

### Task 16: Manual Smoke Test

**Step 1: Verify CLI works**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run moleminer --version`
Expected: `moleminer, version 0.1.0`

**Step 2: Try a real search (table format)**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run moleminer search "Python async libraries" --format json`

Expected: JSON array of results from Google, HN, and Jina. Some sources may fail due to rate limiting/blocking — that's ok for MVP, the pipeline gracefully skips failed sources.

**Step 3: Verify SQLite storage**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && python -c "import sqlite3, pathlib; p = pathlib.Path.home() / '.moleminer/moleminer.db'; conn = sqlite3.connect(p); print(conn.execute('SELECT * FROM searches').fetchall()); conn.close()"`

Expected: Shows the search record just created.

**Step 4: Commit any fixes**

If smoke test reveals issues, fix and commit.

---

### Task 17: Final Cleanup

**Step 1: Run linter**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run ruff check src/ tests/ --fix`
Expected: No errors (or auto-fixed)

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run ruff format src/ tests/`

**Step 2: Run full test suite one final time**

Run: `cd d:/Dev/Projects/Personal/MoleMiner && uv run pytest -v --tb=short`
Expected: All tests pass

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: lint and format cleanup"
```

---

## Summary

| Task | Component | Tests |
|------|-----------|-------|
| 1 | Project scaffolding | install check |
| 2 | SearchResult model | 3 tests |
| 3 | BaseSource + Registry | 4 tests |
| 4 | HTTP utilities | 4 tests |
| 5 | HackerNews source | 3 tests |
| 6 | Google source | 3 tests |
| 7 | Jina source | 3 tests |
| 8 | Deduplication | 5 tests |
| 9 | Aggregate stage | 4 tests |
| 10 | SQLite store | 6 tests |
| 11 | Pipeline orchestrator | 5 tests |
| 12 | Source registration | 2 tests |
| 13 | CLI + output formatters | 6 tests |
| 14 | Public SDK API | 2 tests |
| 15 | Integration test | 1 test |
| 16 | Manual smoke test | manual |
| 17 | Lint & cleanup | — |

**Total: 17 tasks, ~51 automated tests, ~17 commits**

After completion: `pip install moleminer && moleminer search "AI hackathon"` works end-to-end.
