# Phase 2: Architecture Refactoring + Source Expansion

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix architectural gaps that block multi-source scaling, replace broken sources, add 11 new working sources.

**Architecture:** Introduce Config system → update BaseSource/Registry/Pipeline to be config-aware → add per-source timeouts and browser semaphore → then add sources one-by-one with TDD. Each source is a self-contained file implementing BaseSource.

**Tech Stack:** Python 3.11+, httpx (async HTTP), tomllib (config), trafilatura (content extraction), yt-dlp (YouTube), pytest + pytest-httpx (testing)

**Current State:** Phase 1 MVP has 3 sources (Google=broken, HN=working, Jina=broken). 52 tests pass. No config system. Registry has double-instantiation bug. Pipeline has no timeouts.

---

## Task 1: Create Config System

**Files:**
- Create: `src/moleminer/config.py`
- Test: `tests/test_config.py`

**Step 1: Write failing tests**

```python
# tests/test_config.py
"""Tests for Config loading."""

from pathlib import Path
import os

from moleminer.config import Config


def test_config_defaults():
    config = Config()
    assert config.brave_api_key is None
    assert config.tavily_api_key is None
    assert config.source_timeout_api == 30.0
    assert config.source_timeout_browser == 60.0
    assert config.browser_concurrency == 3
    assert config.max_results_per_source == 20


def test_config_from_env(monkeypatch):
    monkeypatch.setenv("MOLEMINER_BRAVE_API_KEY", "test-brave-key")
    monkeypatch.setenv("MOLEMINER_TAVILY_API_KEY", "test-tavily-key")
    config = Config.load()
    assert config.brave_api_key == "test-brave-key"
    assert config.tavily_api_key == "test-tavily-key"


def test_config_from_toml(tmp_path):
    toml_file = tmp_path / "config.toml"
    toml_file.write_text("""
[auth]
brave_api_key = "file-brave-key"
exa_api_key = "file-exa-key"

[pipeline]
source_timeout_api = 15.0
max_results_per_source = 10
""")
    config = Config.load(config_file=toml_file)
    assert config.brave_api_key == "file-brave-key"
    assert config.exa_api_key == "file-exa-key"
    assert config.source_timeout_api == 15.0
    assert config.max_results_per_source == 10


def test_config_env_overrides_toml(tmp_path, monkeypatch):
    toml_file = tmp_path / "config.toml"
    toml_file.write_text("""
[auth]
brave_api_key = "file-key"
""")
    monkeypatch.setenv("MOLEMINER_BRAVE_API_KEY", "env-key")
    config = Config.load(config_file=toml_file)
    assert config.brave_api_key == "env-key"


def test_config_load_missing_file():
    config = Config.load(config_file=Path("/nonexistent/config.toml"))
    assert config.brave_api_key is None  # defaults, no crash


def test_config_has_key():
    config = Config(brave_api_key="key")
    assert config.has_key("brave")
    assert not config.has_key("tavily")
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'moleminer.config'`

**Step 3: Implement Config**

```python
# src/moleminer/config.py
"""Configuration management for MoleMiner."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, fields
from pathlib import Path

_DEFAULT_CONFIG_PATH = Path.home() / ".moleminer" / "config.toml"

# Map of source name -> config field for API keys
_KEY_MAP = {
    "brave": "brave_api_key",
    "tavily": "tavily_api_key",
    "exa": "exa_api_key",
    "serper": "serper_api_key",
    "jina": "jina_api_key",
    "reddit_client_id": "reddit_client_id",
    "reddit_client_secret": "reddit_client_secret",
    "youtube": "youtube_api_key",
    "github": "github_token",
    "producthunt": "producthunt_token",
}


@dataclass
class Config:
    """MoleMiner configuration."""

    # Auth — API keys
    brave_api_key: str | None = None
    tavily_api_key: str | None = None
    exa_api_key: str | None = None
    serper_api_key: str | None = None
    jina_api_key: str | None = None
    reddit_client_id: str | None = None
    reddit_client_secret: str | None = None
    youtube_api_key: str | None = None
    github_token: str | None = None
    producthunt_token: str | None = None

    # LLM
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o-mini"
    llm_api_key: str | None = None

    # Pipeline behaviour
    source_timeout_api: float = 30.0
    source_timeout_browser: float = 60.0
    browser_concurrency: int = 3
    max_results_per_source: int = 20

    # Storage
    db_path: Path | None = None

    def has_key(self, source_name: str) -> bool:
        """Check if an API key is configured for the given source."""
        field_name = _KEY_MAP.get(source_name)
        if field_name is None:
            return False
        return getattr(self, field_name, None) is not None

    @classmethod
    def load(cls, config_file: Path | None = None) -> "Config":
        """Load config: TOML file < environment variables."""
        kwargs: dict = {}

        # 1. Read TOML file
        toml_path = config_file or _DEFAULT_CONFIG_PATH
        if toml_path.exists():
            with open(toml_path, "rb") as f:
                data = tomllib.load(f)
            # Flatten sections
            auth = data.get("auth", {})
            pipeline = data.get("pipeline", {})
            llm = data.get("llm", {})
            storage = data.get("storage", {})
            for section in (auth, pipeline, llm, storage):
                kwargs.update(section)

        # 2. Environment variable overrides (MOLEMINER_<FIELD_NAME>)
        valid_fields = {f.name for f in fields(cls)}
        for field_name in valid_fields:
            env_key = f"MOLEMINER_{field_name.upper()}"
            env_val = os.environ.get(env_key)
            if env_val is not None:
                kwargs[field_name] = env_val

        # 3. Type coercion for known numeric fields
        for float_field in ("source_timeout_api", "source_timeout_browser"):
            if float_field in kwargs and isinstance(kwargs[float_field], str):
                kwargs[float_field] = float(kwargs[float_field])
        for int_field in ("browser_concurrency", "max_results_per_source"):
            if int_field in kwargs and isinstance(kwargs[int_field], str):
                kwargs[int_field] = int(kwargs[int_field])

        # 4. Filter to valid fields only
        kwargs = {k: v for k, v in kwargs.items() if k in valid_fields}

        return cls(**kwargs)
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_config.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/moleminer/config.py tests/test_config.py
git commit -m "feat: add Config system with TOML + env var loading"
```

---

## Task 2: Update BaseSource to Accept Config

**Files:**
- Modify: `src/moleminer/sources/base.py`
- Modify: `src/moleminer/sources/google.py`
- Modify: `src/moleminer/sources/hackernews.py`
- Modify: `src/moleminer/sources/jina.py`
- Modify: `tests/test_pipeline.py` (MockSource.enabled signature)
- Test: existing tests must still pass

**Step 1: Update BaseSource**

```python
# src/moleminer/sources/base.py
"""Base class for all search sources."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from moleminer.models import SearchResult

if TYPE_CHECKING:
    from moleminer.config import Config


class BaseSource(ABC):
    """Abstract base class for search source adapters."""

    name: str
    source_type: str  # "api" | "scrape" | "browser"
    requires_auth: bool
    install_extra: str = "core"  # "core" | "tavily" | "cn" | "llm"

    @abstractmethod
    async def search(self, queries: list[str]) -> list[SearchResult]:
        """Execute search and return results."""
        ...

    @abstractmethod
    def enabled(self, config: Config) -> bool:
        """Check if this source is available (deps installed, auth present)."""
        ...
```

**Step 2: Update 3 existing sources — change `enabled(self)` → `enabled(self, config)`**

Each source:
- `google.py`: `def enabled(self, config: Config) -> bool: return True`
- `hackernews.py`: `def enabled(self, config: Config) -> bool: return True`
- `jina.py`: `def enabled(self, config: Config) -> bool: return True`

Add `from __future__ import annotations` and TYPE_CHECKING import to each.

**Step 3: Update MockSource in tests**

In `tests/test_pipeline.py`, update both MockSource and MockSource2:
```python
def enabled(self, config=None) -> bool:
    return True
```

And the inline DupeSource as well.

**Step 4: Run all tests**

Run: `uv run pytest -v`
Expected: ALL PASS (52 tests)

**Step 5: Commit**

```bash
git add src/moleminer/sources/base.py src/moleminer/sources/google.py src/moleminer/sources/hackernews.py src/moleminer/sources/jina.py tests/test_pipeline.py
git commit -m "feat: BaseSource.enabled() now accepts Config parameter"
```

---

## Task 3: Fix Registry + Thread Config

**Files:**
- Modify: `src/moleminer/registry.py`
- Modify: `tests/test_registry.py`

**Step 1: Write failing test for config-aware registry**

Add to `tests/test_registry.py`:

```python
from moleminer.config import Config


def test_get_enabled_sources_with_config():
    """Registry passes config to source.enabled()."""
    from moleminer.sources.base import BaseSource
    from moleminer.models import SearchResult

    class NeedsKeySource(BaseSource):
        name = "needs_key"
        source_type = "api"
        requires_auth = True

        async def search(self, queries):
            return []

        def enabled(self, config):
            return config.has_key("brave")

    reg = SourceRegistry()
    reg.register(NeedsKeySource)

    # No key → not enabled
    config_no_key = Config()
    assert reg.get_enabled_sources(config_no_key) == []

    # With key → enabled
    config_with_key = Config(brave_api_key="test")
    enabled = reg.get_enabled_sources(config_with_key)
    assert len(enabled) == 1
    assert enabled[0].name == "needs_key"
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_registry.py::test_get_enabled_sources_with_config -v`
Expected: FAIL — `TypeError: get_enabled_sources() takes 1 positional argument but 2 were given`

**Step 3: Fix Registry**

```python
# src/moleminer/registry.py
"""Source registry for discovering and managing search sources."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from moleminer.config import Config
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

    def get_enabled_sources(self, config: Config | None = None) -> list[BaseSource]:
        """Return instances of all enabled sources.

        Fixes: previous version instantiated each class twice.
        """
        result: list[BaseSource] = []
        for cls in self._sources.values():
            instance = cls()
            if config is None or instance.enabled(config):
                result.append(instance)
        return result

    def list_sources(self) -> list[str]:
        return list(self._sources.keys())
```

Note: `get_enabled_sources(config=None)` — when config is None (backward compat for existing tests), all sources are returned. This is a temporary bridge until Pipeline always passes config.

**Step 4: Run all tests**

Run: `uv run pytest -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/moleminer/registry.py tests/test_registry.py
git commit -m "fix: Registry double-instantiation bug, add config threading"
```

---

## Task 4: Update Pipeline — Config, Timeouts, Error Logging

**Files:**
- Modify: `src/moleminer/pipeline.py`
- Modify: `tests/test_pipeline.py`

**Step 1: Write failing test for timeout handling**

Add to `tests/test_pipeline.py`:

```python
import asyncio
from moleminer.config import Config


class SlowSource(BaseSource):
    name = "slow"
    source_type = "api"
    requires_auth = False

    async def search(self, queries: list[str]) -> list[SearchResult]:
        await asyncio.sleep(10)
        return []

    def enabled(self, config=None) -> bool:
        return True


async def test_pipeline_timeout_slow_source(tmp_path):
    """Slow sources should be timed out, not block the pipeline."""
    config = Config(source_timeout_api=0.1)  # 100ms timeout
    reg = SourceRegistry()
    reg.register(MockSource)
    reg.register(SlowSource)
    pipe = Pipeline(registry=reg, db_path=tmp_path / "test.db", config=config)
    results = await pipe.search("test")
    # MockSource should still return results; SlowSource timed out
    assert len(results) == 1
    assert results[0].source == "mock"
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_pipeline.py::test_pipeline_timeout_slow_source -v`
Expected: FAIL — `TypeError: Pipeline.__init__() got an unexpected keyword argument 'config'`

**Step 3: Update Pipeline**

```python
# src/moleminer/pipeline.py
"""Search pipeline orchestrator — dispatch, aggregate, store."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from moleminer.aggregate import aggregate_results
from moleminer.config import Config
from moleminer.models import SearchResult
from moleminer.registry import SourceRegistry
from moleminer.store import SearchStore

logger = logging.getLogger(__name__)


class Pipeline:
    """Orchestrates the multi-stage search pipeline."""

    def __init__(
        self,
        registry: SourceRegistry,
        db_path: Path | None = None,
        config: Config | None = None,
    ) -> None:
        self.registry = registry
        self.config = config or Config()
        self.store = SearchStore(db_path or self.config.db_path)
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
        return self.registry.get_enabled_sources(self.config)

    async def _dispatch(self, queries, sources) -> list[SearchResult]:
        """Dispatch searches to all sources with per-source timeouts."""
        timeout_map = {
            "api": self.config.source_timeout_api,
            "scrape": self.config.source_timeout_api,
            "browser": self.config.source_timeout_browser,
        }

        async def _run_source(source):
            timeout = timeout_map.get(source.source_type, self.config.source_timeout_api)
            try:
                return await asyncio.wait_for(source.search(queries), timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning("Source '%s' timed out after %.1fs", source.name, timeout)
                return []
            except Exception:
                logger.warning("Source '%s' failed", source.name, exc_info=True)
                return []

        tasks = [_run_source(s) for s in sources]
        results_per_source = await asyncio.gather(*tasks)
        all_results: list[SearchResult] = []
        for result_list in results_per_source:
            all_results.extend(result_list)
        return all_results
```

**Step 4: Update existing Pipeline tests for backward compatibility**

The existing `pipeline` fixture in `tests/test_pipeline.py` creates `Pipeline(registry=reg, db_path=...)` — this still works because `config` defaults to `None` → `Config()`.

**Step 5: Run all tests**

Run: `uv run pytest -v`
Expected: ALL PASS (including new timeout test)

**Step 6: Commit**

```bash
git add src/moleminer/pipeline.py tests/test_pipeline.py
git commit -m "feat: Pipeline accepts Config, adds per-source timeouts and error logging"
```

---

## Task 5: Add `language` Field to SearchResult + Store

**Files:**
- Modify: `src/moleminer/models.py`
- Modify: `src/moleminer/store.py`
- Modify: `tests/test_models.py`
- Modify: `tests/test_store.py`

**Step 1: Write failing test**

Add to `tests/test_models.py`:
```python
def test_search_result_language_field():
    r = SearchResult(title="t", url="u", source="s", snippet="sn", language="zh")
    assert r.language == "zh"
    d = r.as_dict()
    assert d["language"] == "zh"

def test_search_result_language_default_none():
    r = SearchResult(title="t", url="u", source="s", snippet="sn")
    assert r.language is None
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_models.py::test_search_result_language_field -v`
Expected: FAIL — `TypeError: SearchResult.__init__() got an unexpected keyword argument 'language'`

**Step 3: Update models.py**

Add after `result_type`:
```python
    language: str | None = None  # "en" | "zh" | None
```

**Step 4: Update store.py schema and save_search**

In `_SCHEMA`, add `language TEXT` column to results table.
In `save_search`, add `r.language` to the INSERT.

**Step 5: Run all tests**

Run: `uv run pytest -v`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/moleminer/models.py src/moleminer/store.py tests/test_models.py tests/test_store.py
git commit -m "feat: add language field to SearchResult and SQLite schema"
```

---

## Task 6: Update CLI + SDK to Use Config

**Files:**
- Modify: `src/moleminer/cli.py`
- Modify: `src/moleminer/__init__.py`

**Step 1: Update CLI**

```python
# In cli.py _run_search:
def _run_search(query: str, sources: list[str] | None = None) -> list[SearchResult]:
    from moleminer.config import Config
    from moleminer.pipeline import Pipeline
    from moleminer.sources import default_registry

    config = Config.load()
    pipeline = Pipeline(registry=default_registry, config=config)
    return asyncio.run(pipeline.search(query, sources=sources))
```

**Step 2: Update SDK**

```python
# In __init__.py:
async def search_async(
    query: str,
    sources: list[str] | None = None,
    config: Config | None = None,
) -> list[SearchResult]:
    from moleminer.config import Config as _Config
    from moleminer.pipeline import Pipeline
    from moleminer.sources import default_registry

    cfg = config or _Config.load()
    pipeline = Pipeline(registry=default_registry, config=cfg)
    return await pipeline.search(query, sources=sources)
```

**Step 3: Run all tests**

Run: `uv run pytest -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/moleminer/cli.py src/moleminer/__init__.py
git commit -m "feat: CLI and SDK now load Config automatically"
```

---

## Task 7: Guarded Source Imports

**Files:**
- Modify: `src/moleminer/sources/__init__.py`

**Step 1: Update to use try/except for optional sources**

```python
# src/moleminer/sources/__init__.py
"""Search source adapters."""

from moleminer.registry import SourceRegistry

default_registry = SourceRegistry()

# Core sources (always available)
from moleminer.sources.google import GoogleSource  # noqa: E402
from moleminer.sources.hackernews import HackerNewsSource  # noqa: E402

default_registry.register(GoogleSource)
default_registry.register(HackerNewsSource)

# Optional sources — graceful degradation if deps missing
_optional_sources = [
    "moleminer.sources.jina",
    "moleminer.sources.brave",
    "moleminer.sources.tavily",
    "moleminer.sources.exa",
    "moleminer.sources.github",
    "moleminer.sources.stackoverflow",
    "moleminer.sources.devto",
    "moleminer.sources.lobsters",
    "moleminer.sources.youtube",
    "moleminer.sources.reddit",
    "moleminer.sources.producthunt",
]

for _module_path in _optional_sources:
    try:
        import importlib
        _mod = importlib.import_module(_module_path)
        # Convention: each module exposes a class ending in "Source"
        for _attr_name in dir(_mod):
            _attr = getattr(_mod, _attr_name)
            if (
                isinstance(_attr, type)
                and hasattr(_attr, "name")
                and hasattr(_attr, "search")
                and _attr is not object
                and _attr_name.endswith("Source")
                and _attr_name not in ("BaseSource",)
            ):
                default_registry.register(_attr)
    except ImportError:
        pass
```

**Step 2: Run all tests**

Run: `uv run pytest -v`
Expected: ALL PASS (missing source modules just get skipped)

**Step 3: Commit**

```bash
git add src/moleminer/sources/__init__.py
git commit -m "feat: guarded imports for optional sources, no ImportError on missing deps"
```

---

## Task 8: Add Trafilatura Content Extraction Utility

**Files:**
- Create: `src/moleminer/utils/extract.py`
- Test: `tests/test_extract.py`
- Modify: `pyproject.toml` (add trafilatura to core deps)

**Step 1: Add trafilatura dependency**

In `pyproject.toml`, add `"trafilatura>=1.8"` to `dependencies`.

Run: `uv pip install -e ".[dev]"`

**Step 2: Write failing test**

```python
# tests/test_extract.py
"""Tests for content extraction utilities."""

from moleminer.utils.extract import extract_text


def test_extract_text_from_html():
    html = "<html><body><article><p>Hello world. This is a test article about AI.</p></article></body></html>"
    text = extract_text(html)
    assert "Hello world" in text


def test_extract_text_empty():
    assert extract_text("") == ""
    assert extract_text(None) == ""
```

**Step 3: Implement extract utility**

```python
# src/moleminer/utils/extract.py
"""Content extraction utilities — Trafilatura primary, with fallbacks."""

from __future__ import annotations


def extract_text(html: str | None) -> str:
    """Extract main text content from HTML using trafilatura."""
    if not html:
        return ""
    try:
        import trafilatura
        result = trafilatura.extract(html)
        return result or ""
    except Exception:
        return ""
```

**Step 4: Run tests**

Run: `uv run pytest tests/test_extract.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/moleminer/utils/extract.py tests/test_extract.py pyproject.toml
git commit -m "feat: add trafilatura-based content extraction utility"
```

---

## Task 9: Replace Jina Search → Jina Reader (Content Extraction Only)

**Files:**
- Modify: `src/moleminer/sources/jina.py` → becomes content extraction helper, not a search source
- Create: `src/moleminer/utils/jina_reader.py`
- Test: `tests/test_jina_reader.py`
- Modify: `tests/test_jina.py` → remove or update

**Step 1: Write test for Jina Reader utility**

```python
# tests/test_jina_reader.py
"""Tests for Jina Reader content extraction."""

import pytest
from moleminer.utils.jina_reader import jina_read_url


async def test_jina_read_url(httpx_mock):
    httpx_mock.add_response(
        url="https://r.jina.ai/https://example.com",
        json={"data": {"content": "Extracted article text", "title": "Example"}},
    )
    result = await jina_read_url("https://example.com")
    assert result["content"] == "Extracted article text"
    assert result["title"] == "Example"


async def test_jina_read_url_failure(httpx_mock):
    httpx_mock.add_response(url="https://r.jina.ai/https://bad.com", status_code=500)
    result = await jina_read_url("https://bad.com")
    assert result is None
```

**Step 2: Implement Jina Reader**

```python
# src/moleminer/utils/jina_reader.py
"""Jina Reader API — extract clean content from URLs."""

from __future__ import annotations

from typing import Any

from moleminer.utils.http import create_client

_JINA_READER_URL = "https://r.jina.ai/{}"
_HEADERS = {
    "Accept": "application/json",
    "X-Retain-Images": "none",
}


async def jina_read_url(url: str, api_key: str | None = None) -> dict[str, Any] | None:
    """Read a URL via Jina Reader API. Returns dict with 'content' and 'title', or None on failure."""
    headers = dict(_HEADERS)
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    reader_url = _JINA_READER_URL.format(url)
    try:
        async with create_client(headers=headers) as client:
            resp = await client.get(reader_url)
            if resp.status_code != 200:
                return None
            data = resp.json()
            return data.get("data")
    except Exception:
        return None
```

**Step 3: Remove Jina as a search source**

Delete `src/moleminer/sources/jina.py` (the search source). It will be replaced by new web search sources. The Jina Reader utility in `utils/jina_reader.py` serves content extraction for Stage 4.

Update `tests/test_jina.py` to test the reader utility instead, or delete and rely on `test_jina_reader.py`.

**Step 4: Run all tests**

Run: `uv run pytest -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/moleminer/utils/jina_reader.py tests/test_jina_reader.py
git rm src/moleminer/sources/jina.py tests/test_jina.py
git commit -m "refactor: Jina moves from search source to content extraction utility"
```

---

## Task 10: Add Brave Search Source

**Files:**
- Create: `src/moleminer/sources/brave.py`
- Test: `tests/test_brave.py`

**Step 1: Write failing test**

```python
# tests/test_brave.py
"""Tests for Brave Search source."""

import pytest
from moleminer.config import Config
from moleminer.sources.brave import BraveSource


def test_brave_disabled_without_key():
    config = Config()
    source = BraveSource()
    assert not source.enabled(config)


def test_brave_enabled_with_key():
    config = Config(brave_api_key="test-key")
    source = BraveSource()
    assert source.enabled(config)


async def test_brave_search(httpx_mock):
    httpx_mock.add_response(
        json={
            "web": {
                "results": [
                    {
                        "title": "AI Hackathon 2026",
                        "url": "https://example.com/hackathon",
                        "description": "Annual AI hackathon event",
                        "page_age": "2026-03-01",
                    }
                ]
            }
        }
    )
    source = BraveSource()
    results = await source.search(["AI hackathon"])
    assert len(results) == 1
    assert results[0].title == "AI Hackathon 2026"
    assert results[0].source == "brave"
    assert results[0].result_type == "direct"
```

**Step 2: Implement Brave source**

```python
# src/moleminer/sources/brave.py
"""Brave Search API source."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote_plus

from moleminer.models import SearchResult
from moleminer.sources.base import BaseSource
from moleminer.utils.http import create_client

if TYPE_CHECKING:
    from moleminer.config import Config

_BRAVE_API = "https://api.search.brave.com/res/v1/web/search"


class BraveSource(BaseSource):
    name = "brave"
    source_type = "api"
    requires_auth = True
    install_extra = "core"  # no extra deps, just needs API key

    _api_key: str | None = None

    def configure(self, config: Config) -> None:
        self._api_key = config.brave_api_key

    def enabled(self, config: Config) -> bool:
        return config.brave_api_key is not None

    async def search(self, queries: list[str]) -> list[SearchResult]:
        results: list[SearchResult] = []
        for q in queries:
            results.extend(await self._search_one(q))
        return results

    async def _search_one(self, query: str) -> list[SearchResult]:
        if not self._api_key:
            return []
        headers = {"X-Subscription-Token": self._api_key}
        params = {"q": query, "count": 20}
        async with create_client(headers=headers) as client:
            resp = await client.get(_BRAVE_API, params=params)
            if resp.status_code != 200:
                return []
            data = resp.json()

        results: list[SearchResult] = []
        for item in data.get("web", {}).get("results", []):
            results.append(
                SearchResult(
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    source="brave",
                    snippet=item.get("description", ""),
                    result_type="direct",
                    timestamp=item.get("page_age"),
                    language=item.get("language"),
                )
            )
        return results
```

Note: The `configure(config)` pattern — Pipeline should call `source.configure(config)` after instantiation. This will be added to Pipeline._get_sources() in the next task.

**Step 3: Run tests**

Run: `uv run pytest tests/test_brave.py -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/moleminer/sources/brave.py tests/test_brave.py
git commit -m "feat: add Brave Search source"
```

---

## Task 11: Source Configure Pattern + Pipeline Update

**Files:**
- Modify: `src/moleminer/sources/base.py` — add `configure()` with default no-op
- Modify: `src/moleminer/pipeline.py` — call `configure()` after instantiation

**Step 1: Add configure() to BaseSource**

```python
# In base.py, add after enabled():
    def configure(self, config: Config) -> None:
        """Inject runtime config (API keys, etc). Override in subclasses that need it."""
        pass
```

**Step 2: Update Pipeline._get_sources()**

```python
def _get_sources(self, source_names: list[str] | None = None):
    if source_names:
        sources = [self.registry.get_source(name) for name in source_names]
    else:
        sources = self.registry.get_enabled_sources(self.config)
    for s in sources:
        s.configure(self.config)
    return sources
```

**Step 3: Run all tests**

Run: `uv run pytest -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/moleminer/sources/base.py src/moleminer/pipeline.py
git commit -m "feat: BaseSource.configure() pattern for runtime config injection"
```

---

## Task 12: Add Tavily Source

**Files:**
- Create: `src/moleminer/sources/tavily.py`
- Test: `tests/test_tavily.py`

**Step 1: Write failing test**

```python
# tests/test_tavily.py
"""Tests for Tavily source."""

from moleminer.config import Config
from moleminer.sources.tavily import TavilySource


def test_tavily_disabled_without_key():
    config = Config()
    assert not TavilySource().enabled(config)


def test_tavily_enabled_with_key():
    config = Config(tavily_api_key="test")
    assert TavilySource().enabled(config)


async def test_tavily_search(httpx_mock):
    httpx_mock.add_response(
        json={
            "results": [
                {
                    "title": "AI Event 2026",
                    "url": "https://example.com/ai",
                    "content": "Description of AI event",
                    "score": 0.95,
                }
            ]
        }
    )
    source = TavilySource()
    source._api_key = "test-key"
    results = await source.search(["AI event"])
    assert len(results) == 1
    assert results[0].source == "tavily"
```

**Step 2: Implement (using httpx directly, not tavily-python SDK)**

Use httpx directly to avoid the optional `tavily-python` dependency for basic search. The SDK is only needed for advanced features.

```python
# src/moleminer/sources/tavily.py
"""Tavily search API source."""

from __future__ import annotations

from typing import TYPE_CHECKING

from moleminer.models import SearchResult
from moleminer.sources.base import BaseSource
from moleminer.utils.http import create_client

if TYPE_CHECKING:
    from moleminer.config import Config

_TAVILY_API = "https://api.tavily.com/search"


class TavilySource(BaseSource):
    name = "tavily"
    source_type = "api"
    requires_auth = True
    install_extra = "core"  # uses httpx directly, no extra dep

    _api_key: str | None = None

    def configure(self, config: Config) -> None:
        self._api_key = config.tavily_api_key

    def enabled(self, config: Config) -> bool:
        return config.tavily_api_key is not None

    async def search(self, queries: list[str]) -> list[SearchResult]:
        results: list[SearchResult] = []
        for q in queries:
            results.extend(await self._search_one(q))
        return results

    async def _search_one(self, query: str) -> list[SearchResult]:
        if not self._api_key:
            return []
        payload = {
            "api_key": self._api_key,
            "query": query,
            "max_results": 20,
            "include_answer": False,
        }
        async with create_client() as client:
            resp = await client.post(_TAVILY_API, json=payload)
            if resp.status_code != 200:
                return []
            data = resp.json()

        results: list[SearchResult] = []
        for item in data.get("results", []):
            results.append(
                SearchResult(
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    source="tavily",
                    snippet=item.get("content", ""),
                    result_type="direct",
                    metadata={"score": item.get("score")},
                )
            )
        return results
```

**Step 3: Run tests, commit**

```bash
git add src/moleminer/sources/tavily.py tests/test_tavily.py
git commit -m "feat: add Tavily search source (httpx, no SDK dep)"
```

---

## Task 13: Add Exa Source

Same TDD pattern. Key details:
- API: `POST https://api.exa.ai/search` with `x-api-key` header
- Returns: title, url, publishedDate, author, score
- Special: `findSimilar` endpoint for Lead Resolution (Phase 4)
- `enabled()`: `config.exa_api_key is not None`

**Files:** `src/moleminer/sources/exa.py`, `tests/test_exa.py`

---

## Task 14: Add GitHub Source

Key details:
- API: `https://api.github.com/search/repositories?q={query}`
- Auth: Optional (GitHub token increases rate limit from 10→30 req/min)
- No extra deps — uses httpx
- `enabled()`: always True (works without auth, just slower)
- Returns: repo name, URL, description, stars, language, topics
- `result_type`: "direct" for repos with homepage URL, "lead" for repos without

**Files:** `src/moleminer/sources/github.py`, `tests/test_github.py`

---

## Task 15: Add Stack Overflow Source

Key details:
- API: `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle={query}&site=stackoverflow`
- Auth: Optional (free key → 10,000/day vs 300/day)
- Returns: title, link, score, answer_count, tags, is_answered
- `result_type`: "direct"
- Response is gzip-compressed by default

**Files:** `src/moleminer/sources/stackoverflow.py`, `tests/test_stackoverflow.py`

---

## Task 16: Add Dev.to Source

Key details:
- API: `https://dev.to/api/articles?tag={query}` and `https://dev.to/api/articles?username=&per_page=10`
- Auth: Not needed for public articles
- Returns: title, url, description, published_at, positive_reactions_count, comments_count
- `enabled()`: always True

**Files:** `src/moleminer/sources/devto.py`, `tests/test_devto.py`

---

## Task 17: Add Lobsters Source

Key details:
- API: `https://lobste.rs/search` with query params, returns JSON when `format=json`
  - Actually: `https://lobste.rs/search?q={query}&what=stories&order=relevance` returns HTML
  - Better: `https://lobste.rs/newest.json` for recent, parse HTML for search
  - Simplest: use the RSS/JSON feed + filter client-side, or scrape search page
- Auth: Not needed
- `enabled()`: always True

**Files:** `src/moleminer/sources/lobsters.py`, `tests/test_lobsters.py`

---

## Task 18: Add YouTube Source (yt-dlp)

Key details:
- Method: `yt-dlp` library, `ytsearch10:{query}` format
- Auth: Not needed (zero config)
- Dependency: `yt-dlp` — should be an optional dep since it's heavy (~3MB)
- Module-level guard: `try: import yt_dlp; _YT_DLP_AVAILABLE = True except ImportError: ...`
- `enabled()`: `return _YT_DLP_AVAILABLE`
- Returns: title, video URL, channel name, upload_date, view_count, description

**Files:** `src/moleminer/sources/youtube.py`, `tests/test_youtube.py`
**Modify:** `pyproject.toml` — add `social = ["yt-dlp>=2024.0"]`

---

## Task 19: Add Reddit Source

Key details:
- Method: Reddit app-only OAuth via httpx (NOT PRAW)
- Auth: `reddit_client_id` + `reddit_client_secret` (register at reddit.com/prefs/apps, free)
- OAuth flow: POST `https://www.reddit.com/api/v1/access_token` with client credentials → bearer token
- Search: `GET https://oauth.reddit.com/search.json?q={query}&sort=relevance&limit=20`
- `enabled()`: `config.reddit_client_id is not None and config.reddit_client_secret is not None`
- Returns: title, URL, subreddit, score, num_comments, created_utc
- `result_type`: "lead" (community discussions)

**Files:** `src/moleminer/sources/reddit.py`, `tests/test_reddit.py`

---

## Task 20: Add Product Hunt Source

Key details:
- Method: GraphQL API at `https://api.producthunt.com/v2/api/graphql`
- Auth: OAuth access token (register app, free for non-commercial)
- `enabled()`: `config.producthunt_token is not None`
- Returns: name, tagline, URL, votesCount, website

**Files:** `src/moleminer/sources/producthunt.py`, `tests/test_producthunt.py`

---

## Task 21: Update pyproject.toml Extras

**Files:**
- Modify: `pyproject.toml`

```toml
[project.optional-dependencies]
tavily = ["tavily-python>=0.5"]
social = ["yt-dlp>=2024.0"]
cn = ["playwright>=1.40"]
llm = ["openai>=1.0"]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "pytest-httpx>=0.34",
    "ruff>=0.8",
]
all = ["moleminer[tavily,social,cn,llm]"]
```

Key insight: Brave, Exa, Serper, Reddit, GitHub, SO, Dev.to, Lobsters, Product Hunt all use httpx only — no extra packages. They're controlled by API keys in Config, not by install extras.

**Commit:**
```bash
git add pyproject.toml
git commit -m "feat: update extras — social (yt-dlp), llm (openai), simplified"
```

---

## Task 22: Update Integration Test

**Files:**
- Modify: `tests/test_integration.py`

Update to use Config, test with the new source set. The integration test should mock HTTP responses for at least 3 sources and verify the full pipeline flow.

---

## Task 23: Run Full Test Suite + Smoke Test

Run: `uv run pytest -v`
Expected: ALL PASS

Then real smoke test:
```bash
# With Brave key
MOLEMINER_BRAVE_API_KEY=xxx moleminer search "AI hackathon 2026"

# HN only (zero config)
moleminer search "AI hackathon 2026" --sources hackernews
```

**Commit:**
```bash
git add -A
git commit -m "feat: Phase 2 complete — 12 sources, Config system, robust pipeline"
```

---

## Summary: Source Count After Phase 2

| Source | Type | Auth | Status |
|--------|------|------|--------|
| Google | scrape | No | Kept (unreliable, fallback) |
| HackerNews | api | No | ✅ Existing |
| Brave | api | Key | **New** |
| Tavily | api | Key | **New** |
| Exa | api | Key | **New** |
| GitHub | api | Optional | **New** |
| Stack Overflow | api | Optional | **New** |
| Dev.to | api | No | **New** |
| Lobsters | scrape | No | **New** |
| YouTube | lib | No | **New** (yt-dlp) |
| Reddit | api | Key | **New** |
| Product Hunt | api | Key | **New** |

**Total: 12 sources** (up from 3 broken ones)

**Jina** moves from search source → content extraction utility (`utils/jina_reader.py`)

---

## Phase 3+ Outline (Future Plans)

### Phase 3: Chinese Sources (requires Playwright)
- 知乎, 小红书, 微博, Bilibili, 微信
- All need `[cn]` extra (playwright)
- Auth: cookie-based login flow

### Phase 4a: LLM Query Enhancement
- `enhance.py` — generate platform-specific queries
- Requires `[llm]` extra

### Phase 4b: Lead Resolution
- `resolve.py` — extract entities from leads → search official links
- Uses: Trafilatura + Jina Reader + Exa findSimilar
- Depends on Phase 3 community sources being available

### Phase 5: Polish
- README + demo GIF
- GitHub Actions CI
- Documentation site
- PyPI publish
