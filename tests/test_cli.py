import json
from unittest.mock import patch

from click.testing import CliRunner

from moleminer.cli import main
from moleminer.models import SearchResult


def _mock_results():
    return [
        SearchResult(
            title="AI Hackathon 2026",
            url="https://hackathon.example.com",
            source="google",
            snippet="The best AI hackathon",
            result_type="direct",
        ),
        SearchResult(
            title="HN: AI Hackathon Discussion",
            url="https://news.ycombinator.com/item?id=123",
            source="hackernews",
            snippet="Great discussion about hackathons",
            result_type="lead",
            mentions=["Google AI Hackathon"],
        ),
    ]


@patch("moleminer.cli._run_search")
def test_search_json(mock_search):
    mock_search.return_value = _mock_results()
    runner = CliRunner()
    result = runner.invoke(main, ["search", "AI hackathon", "--format", "json"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert len(data) == 2
    assert data[0]["title"] == "AI Hackathon 2026"


@patch("moleminer.cli._run_search")
def test_search_table(mock_search):
    mock_search.return_value = _mock_results()
    runner = CliRunner()
    result = runner.invoke(main, ["search", "AI hackathon"])
    assert result.exit_code == 0
    assert "AI Hackathon 2026" in result.output


@patch("moleminer.cli._run_search")
def test_search_markdown(mock_search):
    mock_search.return_value = _mock_results()
    runner = CliRunner()
    result = runner.invoke(main, ["search", "AI hackathon", "--format", "markdown"])
    assert result.exit_code == 0
    assert "AI Hackathon 2026" in result.output
    assert "https://hackathon.example.com" in result.output


@patch("moleminer.cli._run_search")
def test_search_with_sources(mock_search):
    mock_search.return_value = _mock_results()
    runner = CliRunner()
    result = runner.invoke(main, ["search", "AI hackathon", "--sources", "google,hackernews"])
    assert result.exit_code == 0


def test_version():
    runner = CliRunner()
    result = runner.invoke(main, ["--version"])
    assert result.exit_code == 0
    assert "0.1.0" in result.output


@patch("moleminer.cli._run_search")
def test_search_no_results(mock_search):
    mock_search.return_value = []
    runner = CliRunner()
    result = runner.invoke(main, ["search", "xyznonexistent", "--format", "json"])
    assert result.exit_code == 0
    assert result.output.strip() == "[]"
