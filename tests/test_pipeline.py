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
    pipe = Pipeline(registry=reg, db_path=tmp_path / "test.db")
    results = await pipe.search("test")
    urls = [r.url for r in results]
    assert len(urls) == len(set(urls))


async def test_pipeline_stores_results(pipeline: Pipeline):
    results = await pipeline.search("stored query")
    searches = pipeline.store.list_searches()
    assert len(searches) == 1
    assert searches[0]["query"] == "stored query"
    assert searches[0]["result_count"] == len(results)


async def test_pipeline_returns_directs_first(pipeline: Pipeline):
    results = await pipeline.search("test")
    assert results[0].result_type == "direct"
    assert results[1].result_type == "lead"
