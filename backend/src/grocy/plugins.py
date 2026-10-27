"""Public Python interface for administrator-installed barcode lookup plugins."""

from abc import ABC, abstractmethod
from collections.abc import Awaitable
from typing import Any


class BaseBarcodeLookupPlugin(ABC):
    plugin_name: str

    def __init__(
        self,
        locations: list[dict[str, Any]],
        quantity_units: list[dict[str, Any]],
        user_settings: dict[str, Any],
    ) -> None:
        self.locations = locations
        self.quantity_units = quantity_units
        self.user_settings = user_settings

    @abstractmethod
    def execute_lookup(self, barcode: str) -> Any | Awaitable[Any]:
        """Return product fields, or None when the barcode is unknown."""
