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
    assert searches[0]["query"] == "second"
