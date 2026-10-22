import json
from typing import Any


class PythonRuntime:
    async def start(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def purify(self, body: bytes) -> Any:
        if not body:
            return {}
        return json.loads(body)
