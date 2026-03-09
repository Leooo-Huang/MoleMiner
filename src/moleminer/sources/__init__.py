"""Search source adapters."""

from moleminer.registry import SourceRegistry
from moleminer.sources.google import GoogleSource
from moleminer.sources.hackernews import HackerNewsSource
from moleminer.sources.jina import JinaSource

default_registry = SourceRegistry()
default_registry.register(GoogleSource)
default_registry.register(HackerNewsSource)
default_registry.register(JinaSource)
