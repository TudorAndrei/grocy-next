"""Client defaults from the pinned Grocy release."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache
def client_defaults() -> dict[str, Any]:
    return json.loads(Path(__file__).with_name("grocy_4_5_0_client_defaults.json").read_text())
