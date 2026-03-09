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
