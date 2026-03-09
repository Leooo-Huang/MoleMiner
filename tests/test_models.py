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
