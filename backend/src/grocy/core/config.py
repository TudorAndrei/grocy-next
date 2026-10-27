from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from grocy.compatibility import client_defaults


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GROCY_", env_file=".env", extra="ignore")

    app_name: str = "grocy-next"
    use_native_php: bool = False
    php_executable: str = "php"
    mode: str = "production"
    currency: str = "USD"
    default_locale: str = "en"
    base_url: str = "/"
    disable_url_rewriting: bool | str = False
    default_permissions: list[str] = ["ADMIN"]
    default_user_settings: dict[str, Any] = {}
    auth_mode: Literal["default", "api-key", "session", "ldap", "reverse-proxy"] = "default"
    disable_auth: bool | str = False
    reverse_proxy_auth_header: str = "Remote-User"
    reverse_proxy_auth_use_env: bool = False
    ldap_address: str = ""
    ldap_base_dn: str = ""
    ldap_bind_dn: str = ""
    ldap_bind_pw: str = Field(default="", repr=False)
    ldap_user_filter: str = ""
    ldap_uid_attr: str = ""
    ldap_start_tls: bool = False
    ldap_ca_certs_file: Path | None = None
    ldap_connect_timeout: int = Field(default=5, gt=0)
    ldap_receive_timeout: int = Field(default=10, gt=0)
    debug: bool = False
    database_url: str = f"sqlite+aiosqlite:///{Path('data') / 'grocy.db'}"
    database_busy_timeout_ms: int = 5000
    database_wal: bool = True
    api_key_header: str = "GROCY-API-KEY"
    host: str = "127.0.0.1"
    port: int = 8000
    auto_create_schema: bool = True
    seed_demo_data: bool = True
    dev_open_api_key: str = "dev-key"
    setup_token: str = ""
    grocy_baseline: str = "v4.5.0"
    mcp_enabled: bool = True
    mcp_api_key: str = ""
    files_root: Path = Path("data/files")
    datapath: Path = Path("data")
    stock_barcode_lookup_plugin: str = "OpenFoodFactsBarcodeLookupPlugin"
    max_upload_bytes: int = 20 * 1024 * 1024
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    label_printer_webhook: str = ""
    label_printer_run_server: bool | str = True
    label_printer_hook_json: bool | str = True
    label_printer_params: dict[str, Any] = {"font_family": "Source Sans Pro (Regular)"}
    thermal_printer_device: str = ""
    thermal_printer_host: str = ""
    thermal_printer_port: int = 9100
    tprinter_is_network_printer: bool | str = False
    tprinter_print_quantity_name: bool | str = True
    tprinter_print_notes: bool | str = True
    tprinter_ip: str = "127.0.0.1"
    tprinter_port: int = 9100
    tprinter_connector: str = "/dev/usb/lp0"
    feature_flag_stock: bool | str = True
    feature_flag_shoppinglist: bool | str = True
    feature_flag_recipes: bool | str = True
    feature_flag_chores: bool | str = True
    feature_flag_tasks: bool | str = True
    feature_flag_batteries: bool | str = True
    feature_flag_equipment: bool | str = True
    feature_flag_calendar: bool | str = True
    feature_flag_label_printer: bool | str = False
    feature_flag_stock_price_tracking: bool | str = True
    feature_flag_stock_location_tracking: bool | str = True
    feature_flag_stock_best_before_date_tracking: bool | str = True
    feature_flag_stock_product_opened_tracking: bool | str = True
    feature_flag_stock_product_freezing: bool | str = True
    feature_flag_stock_best_before_date_field_number_pad: bool | str = True
    feature_flag_shoppinglist_multiple_lists: bool | str = True
    feature_flag_recipes_mealplan: bool | str = True
    feature_flag_chores_assignments: bool | str = True
    feature_flag_thermal_printer: bool | str = False
    feature_flag_disable_browser_barcode_camera_scanning: bool | str = False
    feature_flag_auto_torch_on_with_camera: bool | str = True

    @model_validator(mode="before")
    @classmethod
    def parse_feature_flag_values(cls, values: Any) -> Any:
        if isinstance(values, dict):
            values = dict(values)
            for name, value in values.items():
                if (
                    name.startswith("feature_flag_")
                    or name
                    in {
                        "disable_url_rewriting",
                        "disable_auth",
                        "label_printer_run_server",
                        "label_printer_hook_json",
                        "tprinter_is_network_printer",
                        "tprinter_print_quantity_name",
                        "tprinter_print_notes",
                    }
                ) and isinstance(value, str):
                    value = value.rstrip("\r\n")
                    values[name] = {"true": True, "false": False}.get(value.lower(), value)
        return values

    def user_defaults(self) -> dict[str, Any]:
        return {**client_defaults()["user_settings"], **self.default_user_settings}

    def auth_class_name(self) -> str:
        names = {
            "default": "Default",
            "api-key": "ApiKey",
            "session": "Session",
            "ldap": "Ldap",
            "reverse-proxy": "ReverseProxy",
        }
        return "Grocy\\Middleware\\" + names[self.auth_mode] + "AuthMiddleware"

    def feature_flags(self) -> dict[str, bool | str]:
        flags = {
            name.upper(): getattr(self, name)
            for name in type(self).model_fields
            if name.startswith("feature_flag_")
        }
        # Keep automatic printer setup for existing Grocy Next deployments.
        if "feature_flag_label_printer" not in self.model_fields_set and self.label_printer_webhook:
            flags["FEATURE_FLAG_LABEL_PRINTER"] = True
        if "feature_flag_thermal_printer" not in self.model_fields_set and (
            self.thermal_printer_host or self.thermal_printer_device
        ):
            flags["FEATURE_FLAG_THERMAL_PRINTER"] = True
        return flags

    def feature_enabled(self, name: str) -> bool:
        value = self.feature_flags()[f"FEATURE_FLAG_{name.upper()}"]
        return value is not False and value not in ("", "0")

    def thermal_printer_configuration(self) -> dict[str, Any]:
        values = {
            name.upper(): getattr(self, name)
            for name in type(self).model_fields
            if name.startswith("tprinter_")
        }
        aliases = {
            "tprinter_connector": ("thermal_printer_device", ""),
            "tprinter_ip": ("thermal_printer_host", ""),
            "tprinter_port": ("thermal_printer_port", 9100),
        }
        for name, (legacy, default) in aliases.items():
            if name not in self.model_fields_set and getattr(self, legacy) != default:
                values[name.upper()] = getattr(self, legacy)
        if "tprinter_is_network_printer" not in self.model_fields_set and self.thermal_printer_host:
            values["TPRINTER_IS_NETWORK_PRINTER"] = True
        return values

    def label_printer_runs_on_server(self) -> bool:
        value = self.label_printer_run_server
        return value is not False and value not in ("", "0")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def clear_settings_cache() -> None:
    get_settings.cache_clear()
