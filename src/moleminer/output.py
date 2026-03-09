"""Output formatters for search results."""

from __future__ import annotations

import json

from rich.console import Console
from rich.table import Table

from moleminer.models import SearchResult


def format_json(results: list[SearchResult]) -> str:
    return json.dumps([r.as_dict() for r in results], indent=2, ensure_ascii=False)


def format_table(results: list[SearchResult], console: Console | None = None) -> None:
    console = console or Console()
    if not results:
        console.print("[dim]No results found.[/dim]")
        return

    table = Table(title="Search Results", show_lines=True)
    table.add_column("#", style="dim", width=4)
    table.add_column("Title", style="bold", max_width=50)
    table.add_column("Source", style="cyan", width=12)
    table.add_column("Type", width=8)
    table.add_column("URL", style="blue", max_width=60)

    for i, r in enumerate(results, 1):
        type_style = "green" if r.result_type == "direct" else "yellow"
        table.add_row(
            str(i),
            r.title,
            r.source,
            f"[{type_style}]{r.result_type}[/{type_style}]",
            r.url,
        )

    console.print(table)


def format_markdown(results: list[SearchResult]) -> str:
    if not results:
        return "No results found."

    lines: list[str] = []
    for i, r in enumerate(results, 1):
        lines.append(f"### {i}. {r.title}")
        lines.append(f"- **Source:** {r.source}")
        lines.append(f"- **Type:** {r.result_type}")
        lines.append(f"- **URL:** {r.url}")
        if r.snippet:
            lines.append(f"- **Snippet:** {r.snippet}")
        if r.mentions:
            lines.append(f"- **Mentions:** {', '.join(r.mentions)}")
        lines.append("")

    return "\n".join(lines)
