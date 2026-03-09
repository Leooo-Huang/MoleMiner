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
