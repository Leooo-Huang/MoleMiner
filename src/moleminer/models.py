"""Data models for MoleMiner search results."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict


@dataclass
class SearchResult:
    """A single search result from any source."""

    title: str
    url: str
    source: str
    snippet: str
    result_type: str = "direct"  # "direct" | "lead"
    timestamp: str | None = None
    mentions: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return asdict(self)
