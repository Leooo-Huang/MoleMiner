"""End-to-end integration test using mocked HTTP responses."""

from pathlib import Path

import httpx
import pytest

from moleminer.pipeline import Pipeline
from moleminer.sources import default_registry


@pytest.fixture
def pipeline(tmp_path: Path) -> Pipeline:
    return Pipeline(registry=default_registry, db_path=tmp_path / "test.db")


async def test_full_pipeline(pipeline: Pipeline, httpx_mock):
    google_html = """
    <html><body>
    <div class="g">
      <a href="https://hackathon.dev"><h3>AI Hackathon 2026</h3></a>
      <div class="VwiC3b">Official site for the AI Hackathon</div>
    </div>
    </body></html>
    """

    hn_json = {
        "hits": [
            {
                "title": "AI Hackathon 2026 - Anyone going?",
                "url": "https://hn-hackathon.dev",
                "objectID": "99999",
                "points": 200,
                "num_comments": 80,
                "created_at": "2026-03-01T00:00:00Z",
                "author": "hnuser",
            }
        ]
    }

    jina_json = {
        "data": [
            {
                "title": "Top AI Events 2026",
                "url": "https://events.example.com/ai-2026",
                "description": "A curated list of AI events",
            }
        ]
    }

    def custom_response(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "google.com/search" in url:
            return httpx.Response(200, text=google_html)
        elif "hn.algolia.com" in url:
            return httpx.Response(200, json=hn_json)
        elif "s.jina.ai" in url:
            return httpx.Response(200, json=jina_json)
        return httpx.Response(404)

    httpx_mock.add_callback(custom_response, is_reusable=True)

    results = await pipeline.search("AI hackathon 2026")

    # Should have results from all 3 sources (minus dedupes)
    assert len(results) >= 2
    sources = {r.source for r in results}
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
