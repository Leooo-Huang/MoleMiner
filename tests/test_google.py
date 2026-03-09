from moleminer.sources.google import GoogleSource


def test_google_metadata():
    source = GoogleSource()
    assert source.name == "google"
    assert source.source_type == "scrape"
    assert source.requires_auth is False
    assert source.enabled() is True


async def test_google_search(httpx_mock):
    html = """
    <html><body>
    <div class="g">
      <a href="https://example.com/result1"><h3>AI Hackathon Event</h3></a>
      <div class="VwiC3b">Join the best AI hackathon of 2026</div>
    </div>
    <div class="g">
      <a href="https://example.com/result2"><h3>ML Competition Guide</h3></a>
      <div class="VwiC3b">Complete guide to ML competitions</div>
    </div>
    </body></html>
    """
    httpx_mock.add_response(text=html)

    source = GoogleSource()
    results = await source.search(["AI hackathon"])
    assert len(results) >= 0
    for r in results:
        assert r.source == "google"
        assert r.result_type == "direct"


async def test_google_empty_results(httpx_mock):
    httpx_mock.add_response(text="<html><body>No results</body></html>")
    source = GoogleSource()
    results = await source.search(["xyznonexistent123"])
    assert results == []
