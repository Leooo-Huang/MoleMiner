from moleminer.sources.jina import JinaSource


def test_jina_metadata():
    source = JinaSource()
    assert source.name == "jina"
    assert source.source_type == "api"
    assert source.requires_auth is False
    assert source.enabled() is True


async def test_jina_search(httpx_mock):
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
