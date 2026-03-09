"""MoleMiner CLI entry point."""

from __future__ import annotations

import asyncio

import click
from rich.console import Console

from moleminer import __version__
from moleminer.models import SearchResult
from moleminer.output import format_json, format_markdown, format_table

console = Console()


def _run_search(query: str, sources: list[str] | None = None) -> list[SearchResult]:
    """Run async search in sync context."""
    from moleminer.pipeline import Pipeline
    from moleminer.sources import default_registry

    pipeline = Pipeline(registry=default_registry)
    return asyncio.run(pipeline.search(query, sources=sources))


@click.group()
@click.version_option(__version__, prog_name="moleminer")
def main() -> None:
    """MoleMiner -- LLM-powered multi-source search aggregation."""
    pass


@main.command()
@click.argument("query")
@click.option("--sources", "-s", default=None, help="Comma-separated list of sources to use.")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["table", "json", "markdown"]),
    default="table",
    help="Output format.",
)
def search(query: str, sources: str | None, output_format: str) -> None:
    """Search across multiple sources."""
    source_list = sources.split(",") if sources else None

    with console.status("[bold green]Searching..."):
        results = _run_search(query, sources=source_list)

    if output_format == "json":
        click.echo(format_json(results))
    elif output_format == "markdown":
        click.echo(format_markdown(results))
    else:
        format_table(results, console=console)
