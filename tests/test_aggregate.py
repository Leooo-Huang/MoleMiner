from moleminer.models import SearchResult
from moleminer.aggregate import aggregate_results


def _make(
    title: str, url: str, source: str = "google", result_type: str = "direct"
) -> SearchResult:
    return SearchResult(title=title, url=url, source=source, snippet="s", result_type=result_type)


def test_aggregate_dedupes():
    results = [
        _make("Same Page", "https://example.com/page", "google"),
        _make("Same Page", "https://example.com/page?ref=hn", "hackernews"),
    ]
    agg = aggregate_results(results)
    assert len(agg) == 1


def test_aggregate_preserves_different():
    results = [
        _make("Page A", "https://a.com"),
        _make("Page B", "https://b.com"),
    ]
    agg = aggregate_results(results)
    assert len(agg) == 2


def test_aggregate_separates_types():
    results = [
        _make("Direct Result", "https://a.com", result_type="direct"),
        _make("Lead Result", "https://b.com", result_type="lead"),
    ]
    agg = aggregate_results(results)
    directs = [r for r in agg if r.result_type == "direct"]
    leads = [r for r in agg if r.result_type == "lead"]
    assert len(directs) == 1
    assert len(leads) == 1


def test_aggregate_empty():
    assert aggregate_results([]) == []
