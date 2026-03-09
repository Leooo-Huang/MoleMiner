"""Base class for all search sources."""

from __future__ import annotations

from abc import ABC, abstractmethod

from moleminer.models import SearchResult


class BaseSource(ABC):
    """Abstract base class for search source adapters."""

    name: str
    source_type: str  # "api" | "scrape" | "browser"
    requires_auth: bool

    @abstractmethod
    async def search(self, queries: list[str]) -> list[SearchResult]:
        """Execute search and return results."""
        ...

    @abstractmethod
    def enabled(self) -> bool:
        """Check if this source is available (deps installed, auth present)."""
        ...
