"""Configuration system for MoleMiner — TOML file + env var overrides."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path


_DEFAULT_CONFIG_PATH = Path.home() / ".moleminer" / "config.toml"

# Maps source names to the config field(s) that must be set for that source.
_SOURCE_KEY_MAP: dict[str, str] = {
    "brave": "brave_api_key",
    "tavily": "tavily_api_key",
    "exa": "exa_api_key",
    "jina": "jina_api_key",
    "reddit": "reddit_client_id",
    "youtube": "youtube_api_key",
    "github": "github_token",
    "producthunt": "producthunt_token",
}


@dataclass
class Config:
    """Central configuration for MoleMiner."""

    # API keys
    brave_api_key: str | None = None
    tavily_api_key: str | None = None
    exa_api_key: str | None = None
    jina_api_key: str | None = None
    reddit_client_id: str | None = None
    reddit_client_secret: str | None = None
    youtube_api_key: str | None = None
    github_token: str | None = None
    producthunt_token: str | None = None

    # LLM settings
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None

    # Pipeline settings
    source_timeout_api: float = 30.0
    source_timeout_browser: float = 60.0
    browser_concurrency: int = 3
    max_results_per_source: int = 20

    # Storage
    db_path: Path | None = None

    def has_key(self, source_name: str) -> bool:
        """Check whether the required API key for *source_name* is configured."""
        field_name = _SOURCE_KEY_MAP.get(source_name)
        if field_name is None:
            return False
        return getattr(self, field_name, None) is not None

    @classmethod
    def load(cls, config_file: Path | None = None) -> Config:
        """Load config from TOML file then apply env-var overrides.

        Resolution order: defaults → TOML → env vars.
        """
        valid_field_names = {f.name for f in fields(cls)}
        kwargs: dict[str, object] = {}

        # 1. TOML file
        toml_path = config_file or _DEFAULT_CONFIG_PATH
        if toml_path.exists():
            with open(toml_path, "rb") as f:
                data = tomllib.load(f)
            section = data.get("moleminer", {})
            for key, value in section.items():
                if key in valid_field_names:
                    kwargs[key] = value

        # 2. Env-var overrides (MOLEMINER_<FIELD>)
        for f in fields(cls):
            env_key = f"MOLEMINER_{f.name.upper()}"
            env_val = os.environ.get(env_key)
            if env_val is not None:
                kwargs[f.name] = _coerce(env_val, f.type)

        return cls(**kwargs)


def _coerce(value: str, type_hint: str) -> object:
    """Best-effort coercion of an env-var string to a dataclass field type."""
    if "float" in type_hint:
        return float(value)
    if "int" in type_hint:
        return int(value)
    if "Path" in type_hint:
        return Path(value)
    return value
