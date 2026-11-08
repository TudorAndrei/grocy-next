"""Exercise native form/session transport against an explicitly disposable installation."""

import argparse
import os
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from http.cookies import SimpleCookie
from urllib.parse import urljoin, urlsplit

import httpx


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def check(api: str, web: str, key: str) -> None:
    username = "Native transport café"
    password = "Native form += password"
    with httpx.Client(headers={"GROCY-API-KEY": key}, trust_env=False) as admin:
        users = admin.get(api + "/api/users")
        users.raise_for_status()
        user = next((row for row in users.json() if row["username"] == username), None)
        if user is None:
            created = admin.post(
                api + "/api/users",
                json={"username": username, "password": password},
            )
            created.raise_for_status()
            user = next(
                row for row in admin.get(api + "/api/users").json() if row["username"] == username
            )
    prefix = urlsplit(web).path.rstrip("/")

    def redirect(response: httpx.Response, path: str, query: str = "") -> None:
        require(response.status_code == 302, f"Expected native redirect for {response.request.url}")
        location = urlsplit(response.headers.get("location", ""))
        require(location.path == prefix + path and location.query == query, "Wrong native redirect")

    with httpx.Client(follow_redirects=False, trust_env=False) as browser:
        index = browser.get(web + "/")
        login = browser.get(web + "/login?invalid=true")
        require(
            login.status_code == 200 and login.content == index.content, "Login GET escaped SPA"
        )
        context = browser.get(web + "/api/v2/system/login-context")
        require(context.status_code == 200, "Public login targets were unavailable")
        require(
            set(context.json()) == {"login_url", "logout_url"}, "Unexpected login presentation data"
        )
        login_action = urljoin(web + "/", context.json()["login_url"])
        logout_action = urljoin(web + "/", context.json()["logout_url"])
        for path in ("/login", "/logout"):
            options = browser.options(web + path)
            require(options.status_code == 200, "Native auth preflight was intercepted")
            require(
                options.headers.get("access-control-allow-origin") == "*",
                "Native auth CORS changed",
            )
        redirect(browser.get(logout_action), "/login")
        invalid = browser.post(
            login_action + "?returnto=https://outside.invalid/",
            data={
                "username": username,
                "password": "Incorrect password",
            },
        )
        redirect(invalid, "/login", "invalid=true")
        require("set-cookie" not in invalid.headers, "Invalid credentials created a cookie")
        unsupported = browser.post(login_action, json={"username": username, "password": password})
        require(unsupported.status_code == 500, "Native login incorrectly accepted JSON transport")

        for permanent in (False, True):
            fields = {"username": username, "password": password}
            if permanent:
                fields["stay_logged_in"] = "on"
                logged_in = browser.post(
                    login_action, files={name: (None, value) for name, value in fields.items()}
                )
            else:
                logged_in = browser.post(login_action, data=fields)
            redirect(logged_in, "/")
            cookies = SimpleCookie(logged_in.headers.get("set-cookie", ""))
            require("grocy_session" in cookies, "Native login did not create its session cookie")
            cookie = cookies["grocy_session"]
            require(len(cookie.value) == 50, "Wrong native session key length")
            require(
                parsedate_to_datetime(cookie["expires"]) == datetime.fromtimestamp(2147483647, UTC),
                "Wrong native cookie expiry",
            )
            require(
                not any(cookie[attr] for attr in ("path", "secure", "httponly", "samesite")),
                "Native cookie attributes changed",
            )
            actor = browser.get(web + "/api/user")
            require(actor.status_code == 200, "Cookie-only API authentication failed")
            require(
                actor.json()[0]["id"] == user["id"], "A connection key replaced the native user"
            )
            logged_out = browser.request(
                "HEAD" if permanent else "GET", logout_action + "?returnto=/tasks"
            )
            redirect(logged_out, "/")
            require(
                "set-cookie" not in logged_out.headers, "Native logout changed the cookie header"
            )
            require(not logged_out.content, "Native logout returned a document body")
            retired = browser.get(web + "/api/user")
            if prefix:
                redirect(retired, "/login")
            else:
                require(retired.status_code == 401, "Native logout retained its session")
            require(
                browser.get(web + "/api/v2/user/permissions").status_code == 401,
                "Native logout retained extension authentication",
            )
    print(f"Checked native form login/logout transport through {web}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--web-url", action="append", required=True)
    parser.add_argument(
        "--disposable", action="store_true", help="Confirm session/account writes are safe"
    )
    args = parser.parse_args()
    if not args.disposable:
        parser.error("--disposable is required: this check creates a fixture account and sessions")
    for url in (args.api_url, *args.web_url):
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.query
            or parsed.fragment
        ):
            parser.error("Use HTTP base URLs without queries or fragments")
        if parsed.username or parsed.password:
            parser.error("Do not put credentials in verification URLs")
    for web in args.web_url:
        check(
            args.api_url.rstrip("/"),
            web.rstrip("/"),
            os.environ.get("GROCY_TEST_API_KEY", "dev-key"),
        )


if __name__ == "__main__":
    main()
