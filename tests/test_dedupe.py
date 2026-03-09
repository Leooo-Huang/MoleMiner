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
