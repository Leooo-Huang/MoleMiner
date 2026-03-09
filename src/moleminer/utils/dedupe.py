"""URL normalization and result deduplication."""

from __future__ import annotations

from urllib.parse import urlparse, urlunparse

from moleminer.models import SearchResult

_TRACKING_PARAMS = {
    "ref",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "gclid",
    "source",
    "via",
}


def normalize_url(url: str) -> str:
    """Normalize a URL for deduplication comparison."""
    parsed = urlparse(url)
    scheme = "https"
    netloc = parsed.netloc.lower()
    path = parsed.path.rstrip("/")
    query = ""
    if parsed.query:
        params = parsed.query.split("&")
        filtered = [p for p in params if p.split("=")[0] not in _TRACKING_PARAMS]
        query = "&".join(sorted(filtered))
    return urlunparse((scheme, netloc, path, "", query, ""))


def dedupe_results(results: list[SearchResult]) -> list[SearchResult]:
    """Remove duplicate results based on normalized URL."""
    seen_urls: set[str] = set()
    deduped: list[SearchResult] = []
    for r in results:
        norm = normalize_url(r.url)
        if norm in seen_urls:
            continue
        seen_urls.add(norm)
        deduped.append(r)
    return deduped
