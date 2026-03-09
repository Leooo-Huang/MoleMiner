from moleminer.sources import default_registry


def test_default_registry_has_sources():
    names = default_registry.list_sources()
    assert "hackernews" in names
    assert "google" in names
    assert "jina" in names


def test_all_default_sources_enabled():
    enabled = default_registry.get_enabled_sources()
    names = {s.name for s in enabled}
    assert "hackernews" in names
    assert "google" in names
    assert "jina" in names
