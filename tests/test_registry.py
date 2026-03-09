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
