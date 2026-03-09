"""Source registry for discovering and managing search sources."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from moleminer.sources.base import BaseSource


class SourceRegistry:
    """Registry of all available search sources."""

    def __init__(self) -> None:
        self._sources: dict[str, type[BaseSource]] = {}

    def register(self, source_cls: type[BaseSource]) -> None:
        self._sources[source_cls.name] = source_cls

    def get_source(self, name: str) -> BaseSource:
        if name not in self._sources:
            raise KeyError(f"Source '{name}' not registered")
        return self._sources[name]()

    def get_enabled_sources(self) -> list[BaseSource]:
        return [cls() for cls in self._sources.values() if cls().enabled()]

    def list_sources(self) -> list[str]:
        return list(self._sources.keys())
