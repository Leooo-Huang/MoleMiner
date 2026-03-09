"""Tests for the config system."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from moleminer.config import Config


def test_config_defaults():
    cfg = Config()
    assert cfg.source_timeout_api == 30.0
    assert cfg.source_timeout_browser == 60.0
    assert cfg.browser_concurrency == 3
    assert cfg.max_results_per_source == 20
    assert cfg.brave_api_key is None
    assert cfg.tavily_api_key is None
    assert cfg.db_path is None


def test_config_env_vars(monkeypatch):
    monkeypatch.setenv("MOLEMINER_BRAVE_API_KEY", "test-brave-key")
    monkeypatch.setenv("MOLEMINER_TAVILY_API_KEY", "test-tavily-key")
    monkeypatch.setenv("MOLEMINER_SOURCE_TIMEOUT_API", "15.0")
    monkeypatch.setenv("MOLEMINER_MAX_RESULTS_PER_SOURCE", "50")
    cfg = Config.load()
    assert cfg.brave_api_key == "test-brave-key"
    assert cfg.tavily_api_key == "test-tavily-key"
    assert cfg.source_timeout_api == 15.0
    assert cfg.max_results_per_source == 50


def test_config_toml_loading(tmp_path):
    toml_file = tmp_path / "config.toml"
    toml_file.write_text(
        '[moleminer]\nbrave_api_key = "from-toml"\nsource_timeout_api = 10.0\n'
    )
    cfg = Config.load(config_file=toml_file)
    assert cfg.brave_api_key == "from-toml"
    assert cfg.source_timeout_api == 10.0


def test_config_env_overrides_toml(tmp_path, monkeypatch):
    toml_file = tmp_path / "config.toml"
    toml_file.write_text('[moleminer]\nbrave_api_key = "from-toml"\n')
    monkeypatch.setenv("MOLEMINER_BRAVE_API_KEY", "from-env")
    cfg = Config.load(config_file=toml_file)
    assert cfg.brave_api_key == "from-env"


def test_config_missing_file_no_crash():
    cfg = Config.load(config_file=Path("/nonexistent/path/config.toml"))
    assert cfg.brave_api_key is None
    assert cfg.source_timeout_api == 30.0


def test_config_has_key():
    cfg = Config(brave_api_key="test-key")
    assert cfg.has_key("brave") is True
    assert cfg.has_key("tavily") is False


def test_config_has_key_mapping():
    cfg = Config(
        tavily_api_key="t",
        exa_api_key="e",
        jina_api_key="j",
        reddit_client_id="r",
        youtube_api_key="y",
        github_token="g",
        producthunt_token="p",
    )
    assert cfg.has_key("tavily") is True
    assert cfg.has_key("exa") is True
    assert cfg.has_key("jina") is True
    assert cfg.has_key("reddit") is True
    assert cfg.has_key("youtube") is True
    assert cfg.has_key("github") is True
    assert cfg.has_key("producthunt") is True
    assert cfg.has_key("unknown_source") is False


def test_config_invalid_env_vars_ignored(monkeypatch):
    monkeypatch.setenv("MOLEMINER_NOT_A_REAL_FIELD", "junk")
    cfg = Config.load()
    assert not hasattr(cfg, "not_a_real_field")
