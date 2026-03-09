import httpx
import pytest

from moleminer.utils.http import create_client, fetch_json, fetch_text


async def test_create_client():
    async with create_client() as client:
        assert isinstance(client, httpx.AsyncClient)
        assert client.timeout.connect == 10.0


async def test_fetch_json(httpx_mock):
    httpx_mock.add_response(
        url="https://api.example.com/data",
        json={"results": [1, 2, 3]},
    )
    data = await fetch_json("https://api.example.com/data")
    assert data == {"results": [1, 2, 3]}


async def test_fetch_text(httpx_mock):
    httpx_mock.add_response(
        url="https://example.com/page",
        text="Hello World",
    )
    text = await fetch_text("https://example.com/page")
    assert text == "Hello World"


async def test_fetch_json_error(httpx_mock):
    httpx_mock.add_response(
        url="https://api.example.com/fail",
        status_code=500,
    )
    with pytest.raises(httpx.HTTPStatusError):
        await fetch_json("https://api.example.com/fail")
