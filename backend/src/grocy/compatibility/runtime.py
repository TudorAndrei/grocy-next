from typing import Any

from grocy.compatibility.php import parse_request_body


class PythonRuntime:
    async def start(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def purify(self, body: bytes) -> Any:
        return parse_request_body(body)
