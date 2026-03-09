"""HTTP client utilities for MoleMiner."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx

_DEFAULT_TIMEOUT = httpx.Timeout(10.0, read=30.0)
_DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MoleMiner/0.1; +https://github.com/moleminer/moleminer)"
}


@asynccontextmanager
async def create_client(**kwargs: Any) -> AsyncIterator[httpx.AsyncClient]:
    """Create a configured httpx async client."""
    defaults = {"timeout": _DEFAULT_TIMEOUT, "headers": _DEFAULT_HEADERS, "follow_redirects": True}
    defaults.update(kwargs)
    async with httpx.AsyncClient(**defaults) as client:
        yield client


async def fetch_json(url: str, **kwargs: Any) -> Any:
    """Fetch a URL and return parsed JSON."""
    async with create_client() as client:
        resp = await client.get(url, **kwargs)
        resp.raise_for_status()
        return resp.json()


async def fetch_text(url: str, **kwargs: Any) -> str:
    """Fetch a URL and return text content."""
    async with create_client() as client:
        resp = await client.get(url, **kwargs)
        resp.raise_for_status()
        return resp.text
