#!/usr/bin/env python3
"""Compare public web resource links with a running Python API without changing data."""

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class Result:
    status: int
    headers: dict[str, str]
    body: bytes


def fetch(base: str, path: str, headers: dict[str, str], method: str = "GET") -> Result:
    request = Request(
        base + path, headers={"Accept-Encoding": "identity", **headers}, method=method
    )
    try:
        response = build_opener(NoRedirect).open(request, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        status = response.status
        if status is None:
            raise RuntimeError("The HTTP response has no status")
        return Result(
            status,
            {key.lower(): value for key, value in response.headers.items()},
            response.read(),
        )


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def compare(api: str, web: str, path: str, headers: dict[str, str], method: str) -> Result:
    expected = fetch(api, path, headers, method)
    actual = fetch(web, path, headers, method)
    require(actual.status == expected.status, f"{method} {web}{path}: wrong status")
    for name in ["content-type", "content-disposition", "cache-control"]:
        require(
            actual.headers.get(name) == expected.headers.get(name),
            f"{method} {web}{path}: wrong {name}",
        )
    if location := expected.headers.get("location"):
        target = actual.headers.get("location", "")
        require(
            urlsplit(target).path == urlsplit(location).path
            and urlsplit(target).query == urlsplit(location).query,
            f"{method} {web}{path}: wrong redirect",
        )
    normalized = expected.body.replace(api.encode(), web.encode())
    require(actual.body in (expected.body, normalized), f"{method} {web}{path}: wrong content")
    if method == "GET" and actual.status == 200:
        require(
            int(actual.headers["content-length"]) == len(actual.body),
            f"GET {web}{path}: wrong content length",
        )
    if method == "HEAD":
        require(not actual.body, f"HEAD {web}{path}: unexpected body")
        lengths = {expected.headers.get("content-length")}
        if expected.headers.get("content-type", "").startswith("text/html"):
            document = fetch(api, path, headers)
            lengths.add(str(len(document.body.replace(api.encode(), web.encode()))))
        require(
            actual.headers.get("content-length") in lengths,
            f"HEAD {web}{path}: wrong content length",
        )
    return actual


def check_sounds(web: str) -> int:
    source = Path(__file__).resolve().parents[1] / "frontend" / "public" / "uisounds"
    count = 0
    for name in ["silence", "barcodescannerbeep", "success", "error"]:
        path = f"/uisounds/{name}.mp3"
        expected = (source / f"{name}.mp3").read_bytes()
        for method in ["GET", "HEAD"]:
            result = fetch(web, path, {}, method)
            require(result.status == 200, f"{method} {web}{path}: audio access failed")
            require(
                result.headers.get("content-type", "").split(";")[0] == "audio/mpeg",
                f"{method} {web}{path}: expected MPEG audio",
            )
            require(
                result.body == (expected if method == "GET" else b""),
                f"{method} {web}{path}: wrong audio bytes",
            )
            require(
                result.headers.get("content-length") == str(len(expected)),
                f"{method} {web}{path}: wrong audio length",
            )
            count += 1
    return count


def check(api: str, web: str, credentials: list[dict[str, str]]) -> None:
    count = check_sounds(web)
    catalog = fetch(api, "/api/objects/stock", credentials[0])
    require(catalog.status == 200, "The API stock catalog could not be read")
    stock = json.loads(catalog.body)
    entry = stock[0]["id"] if stock else 99999
    paths = [f"/{entity}/17/grocycode" for entity in ["product", "recipe", "chore", "battery"]] + [
        f"/stockentry/{entry}/grocycode"
    ]
    for headers in credentials:
        for path in paths:
            for query in ["", "?size=40&download=false"]:
                for method in ["GET", "HEAD"]:
                    result = compare(api, web, path + query, headers, method)
                    require(result.status == 200, f"{method} {web}{path}: access failed")
                    if method == "GET":
                        require(result.body.startswith(b"\x89PNG\r\n\x1a\n"), "Expected PNG data")
                    count += 1
        result = compare(api, web, "/product/17/grocycode?size=0", headers, "GET")
        require(result.status == 500, "Expected the native invalid-size response")
        count += 1
        for label_id in dict.fromkeys([entry, 99999]):
            for method in ["GET", "HEAD"]:
                result = compare(api, web, f"/stockentry/{label_id}/label", headers, method)
                require(result.status == 200, "Expected the stock entry label")
                count += 1
    for path in [paths[0], f"/stockentry/{entry}/label"]:
        compare(api, web, path, {}, "GET")
        count += 1
    index = fetch(web, "/", {})
    for path in ["/product/new", "/product/17"]:
        form = fetch(web, path, {})
        require(form.status == 200 and form.body == index.body, "Product form routing changed")
        count += 1
    parsed_web = urlsplit(web)
    prefix = parsed_web.path
    if "." in prefix:
        alternate = parsed_web._replace(path=prefix.replace(".", "X", 1)).geturl()
        form = fetch(alternate, "/product/new", {})
        image = fetch(alternate, "/product/17/grocycode", {})
        require(
            form.status == image.status
            and form.headers.get("content-type") == image.headers.get("content-type"),
            "The resource route matched outside its configured path prefix",
        )
        count += 1
    print(f"Checked {count} resource and form responses through {web}")


def base_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        raise argparse.ArgumentTypeError(
            "Use an HTTP base URL without credentials, query, or fragment"
        )
    return value.rstrip("/")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", type=base_url, required=True)
    parser.add_argument("--web-url", type=base_url, action="append", required=True)
    args = parser.parse_args()
    credentials = [{"GROCY-API-KEY": os.environ.get("GROCY_TEST_API_KEY", "dev-key")}]
    if cookie := os.environ.get("GROCY_TEST_SESSION_COOKIE"):
        credentials.append({"Cookie": cookie})
    for web in args.web_url:
        check(args.api_url, web, credentials)


if __name__ == "__main__":
    main()
