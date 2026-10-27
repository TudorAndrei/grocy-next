"""Run state comparisons against a disposable Grocy v4.5.0 server."""

import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qsl, quote
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

REFERENCE_URL = os.getenv("GROCY_REFERENCE_URL")
pytestmark = pytest.mark.skipif(
    not REFERENCE_URL, reason="Set GROCY_REFERENCE_URL for PHP comparison"
)


@pytest.fixture
def reference():
    if os.getenv("GROCY_REFERENCE_DISPOSABLE") != "1":
        pytest.fail(
            "Reference tests require a disposable database. Set GROCY_REFERENCE_DISPOSABLE=1."
        )
    with httpx.Client(
        base_url=REFERENCE_URL or "",
        timeout=15,
        headers={
            "GROCY-API-KEY": os.environ["GROCY_REFERENCE_API_KEY"],
        },
    ) as client:
        info = client.get("/api/system/info")
        info.raise_for_status()
        assert info.json()["grocy_version"]["Version"].lstrip("v") == "4.5.0"
        yield client


def create(client, entity: str, body: dict) -> int:
    response = client.post(f"/api/objects/{entity}", json=body)
    assert response.status_code == 200, response.text
    return int(response.json()["created_object_id"])


@pytest.fixture
def printer(reference, monkeypatch):
    """Receive actual label requests from both backends without a physical printer."""
    from grocy.core.config import get_settings

    database = os.getenv("GROCY_REFERENCE_DATABASE")
    if not database:
        pytest.skip("A local disposable reference database is required for printer setup")
    overrides = Path(database).parent / "settingoverrides"
    overrides.mkdir(exist_ok=True)
    previous = {}

    class Printer(list):
        def __init__(self):
            super().__init__()
            self.status = 200
            self.statuses = []

        def setting(self, name, value):
            for directory in (overrides, get_settings().datapath / "settingoverrides"):
                directory.mkdir(parents=True, exist_ok=True)
                path = directory / f"{name}.txt"
                if path not in previous:
                    previous[path] = path.read_bytes() if path.exists() else None
                path.write_text(str(value).lower() if isinstance(value, bool) else value)
            monkeypatch.setattr(get_settings(), name.lower(), value)

    received = Printer()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            if self.headers["Content-Type"].startswith("application/json"):
                received.append(json.loads(body))
            else:
                received.append(dict(parse_qsl(body.decode(), keep_blank_values=True)))
            self.send_response(received.statuses.pop(0) if received.statuses else received.status)
            self.end_headers()

        def log_message(self, format, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        received.setting("FEATURE_FLAG_LABEL_PRINTER", True)
        received.setting("LABEL_PRINTER_RUN_SERVER", True)
        received.setting("LABEL_PRINTER_WEBHOOK", f"http://127.0.0.1:{server.server_port}/labels")
        yield received
    finally:
        for path, contents in previous.items():
            if contents is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(contents)
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def test_reference_purchase_and_due_date_reprints(client, api_headers, reference, printer):
    from datetime import date, timedelta

    client.headers.update(api_headers)
    snapshots = []
    for app in (reference, client):
        printer.clear()
        name = uuid4().hex
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        freezer = create(app, "locations", {"name": name + " cold", "is_freezer": 1})
        product = create(
            app,
            "products",
            {
                "name": name,
                "location_id": location,
                "qu_id_stock": unit,
                "qu_id_purchase": unit,
                "auto_reprint_stock_label": 1,
                "default_best_before_days_after_open": 1,
                "default_best_before_days_after_freezing": 30,
                "default_best_before_days_after_thawing": 2,
            },
        )
        path = f"/api/stock/products/{product}"
        for amount in (2, 3):
            response = app.post(
                path + "/add",
                json={"amount": amount, "best_before_date": "2037-01-01", "stock_label_type": 1},
            )
            assert response.status_code == 200, response.text
        assert [item["stock_entry"]["amount"] for item in printer] == [2, 3]
        assert [item["details"]["stock_amount"] for item in printer] == [0, 2]
        assert all(item["font_family"] == "Source Sans Pro (Regular)" for item in printer)
        labels = list(printer)
        printer.clear()
        response = app.post(path + "/open", json={"amount": 1})
        assert response.status_code == 200, response.text
        assert len(printer) == 1
        assert printer[0]["stock_entry"]["amount"] == 5
        assert printer[0]["stock_entry"]["open"] == 0
        assert printer[0]["stock_entry"]["best_before_date"] == "2037-01-01"
        assert printer[0]["due_date"] == "DD: " + (date.today() + timedelta(days=1)).isoformat()
        labels.extend(printer)
        entry = next(row for row in app.get(path + "/entries").json() if not row["open"])
        printer.clear()
        response = app.post(
            path + "/transfer",
            json={
                "amount": 1,
                "location_id_from": location,
                "location_id_to": freezer,
                "stock_entry_id": entry["stock_id"],
            },
        )
        assert response.status_code == 200, response.text
        assert len(printer) == 1
        assert printer[0]["stock_entry"]["amount"] == 4
        assert printer[0]["stock_entry"]["location_id"] == location
        assert printer[0]["stock_entry"]["best_before_date"] == "2037-01-01"
        assert printer[0]["due_date"] == "DD: " + (date.today() + timedelta(days=30)).isoformat()

        labels.extend(printer)
        printer.clear()
        response = app.post(
            path + "/transfer",
            json={"amount": 1, "location_id_from": freezer, "location_id_to": location},
        )
        assert response.status_code == 200, response.text
        assert len(printer) == 1
        assert printer[0]["stock_entry"]["location_id"] == freezer
        assert (
            printer[0]["stock_entry"]["best_before_date"]
            == (date.today() + timedelta(days=30)).isoformat()
        )
        assert printer[0]["due_date"] == "DD: " + (date.today() + timedelta(days=2)).isoformat()
        labels.extend(printer)
        snapshots.append(labels)

    def fields(value, path=""):
        if isinstance(value, dict):
            return {
                field for key, item in value.items() for field in fields(item, path + "/" + key)
            }
        if isinstance(value, list):
            return {
                field
                for index, item in enumerate(value)
                for field in fields(item, path + "/" + str(index))
            }
        return {path}

    assert fields(snapshots[0]) == fields(snapshots[1])


def test_reference_printer_errors_preserve_stock_state(client, api_headers, reference, printer):
    from datetime import date, timedelta

    client.headers.update(api_headers)
    for app in (reference, client):
        name = uuid4().hex
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        freezer = create(app, "locations", {"name": name + " freezer", "is_freezer": 1})
        product = create(
            app,
            "products",
            {
                "name": name,
                "location_id": location,
                "qu_id_stock": unit,
                "qu_id_purchase": unit,
                "auto_reprint_stock_label": 1,
                "default_best_before_days_after_open": 1,
                "default_best_before_days_after_freezing": 30,
            },
        )
        path = f"/api/stock/products/{product}"
        printer.status = 500
        response = app.post(
            path + "/add",
            json={"amount": 2, "best_before_date": "2037-01-01", "stock_label_type": 1},
        )
        assert response.status_code == 400, response.text
        assert app.get(path).json()["stock_amount"] == 2
        printer.status = 200
        assert (
            app.post(
                path + "/add", json={"amount": 3, "best_before_date": "2037-01-01"}
            ).status_code
            == 200
        )
        entries = app.get(path + "/entries").json()
        assert len(entries) == 1 and entries[0]["amount"] == 5
        printer.status = 500
        for action, body in (
            ("open", {"amount": 1}),
            ("transfer", {"amount": 1, "location_id_from": location, "location_id_to": freezer}),
        ):
            response = app.post(path + "/" + action, json=body)
            assert response.status_code == 400, response.text
            assert app.get(path + "/entries").json() == entries
        assert app.get(path + "/printlabel").status_code == 400
        assert (
            app.put(
                f"/api/objects/products/{product}",
                json={"move_on_open": 1, "default_consume_location_id": freezer},
            ).status_code
            == 204
        )
        printer.clear()
        printer.statuses = [200, 500]
        response = app.post(path + "/open", json={"amount": 1})
        assert response.status_code == 400, response.text
        assert len(printer) == 2
        assert [item["stock_entry"]["open"] for item in printer] == [0, 1]
        assert [item["stock_entry"]["amount"] for item in printer] == [5, 1]
        entries = app.get(path + "/entries").json()
        assert len(entries) == 2
        opened = next(row for row in entries if row["open"])
        assert opened["amount"] == 1
        assert opened["location_id"] == location
        assert opened["best_before_date"] == (date.today() + timedelta(days=1)).isoformat()
        assert next(row for row in entries if not row["open"])["amount"] == 4


def test_reference_form_label_requests(client, api_headers, reference, printer):
    printer.setting("LABEL_PRINTER_HOOK_JSON", False)
    printer.status = 302
    client.headers.update(api_headers)
    for app in (reference, client):
        name = "Bread & milk ~ " + uuid4().hex
        unit = create(app, "quantity_units", {"name": uuid4().hex})
        location = create(app, "locations", {"name": uuid4().hex})
        product = create(
            app,
            "products",
            {
                "name": name,
                "location_id": location,
                "qu_id_stock": unit,
                "qu_id_purchase": unit,
            },
        )
        path = f"/api/stock/products/{product}"
        printer.clear()
        response = app.post(
            path + "/add",
            json={"amount": 0.000025, "best_before_date": "2037-01-01", "stock_label_type": 1},
        )
        assert response.status_code == 200, response.text
        assert len(printer) == 1
        assert printer[0]["product"] == name
        assert not any(key.startswith("stock_entry[") for key in printer[0])
        assert printer[0]["details[stock_amount]"] == "0"
        assert not any(key.startswith("details[product][") for key in printer[0])
        assert printer[0]["font_family"] == "Source Sans Pro (Regular)"
        assert printer[0]["due_date"] == "DD: 2037-01-01"
        assert "stock_entry[price]" not in printer[0]
        printer.clear()
        response = app.get(path + "/printlabel")
        assert response.status_code == 200, response.text
        assert len(printer) == 1
        assert printer[0]["details[stock_amount]"] == "2.5E-5"
        assert printer[0]["grocycode"] == response.json()["grocycode"]


def test_reference_file_names_binary_content_and_deletion(
    client: TestClient, api_headers: dict, reference, tmp_path, monkeypatch
):
    import base64

    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "files_root", tmp_path)
    client.headers.update(api_headers)
    filename = f"Manual-{uuid4().hex[:8]}.txt"
    encoded = base64.b64encode(filename.encode()).decode()
    path = f"/api/files/equipmentmanuals/{encoded}"
    for app in (reference, client):
        assert (
            app.put(
                path,
                content=b"Household manual\n",
                headers={"Content-Type": "application/octet-stream"},
            ).status_code
            == 204
        )
        response = app.get(path)
        assert response.status_code == 200
        assert response.content == b"Household manual\n"
        assert response.headers["content-type"].startswith("text/plain")
        assert filename in response.headers["content-disposition"]
        assert app.delete(path).status_code == 204
        assert app.get(path).status_code == 404
        assert app.delete(path).status_code == 204
    assert not (tmp_path / "equipmentmanuals" / filename).exists()


def test_reference_calendar_stock_tasks_schedules_and_meal_sections(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    name = f"Calendar{uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        product = create(
            app,
            "products",
            {"name": name, "location_id": location, "qu_id_stock": unit, "qu_id_purchase": unit},
        )
        assert (
            app.post(
                f"/api/stock/products/{product}/add",
                json={"amount": 1, "best_before_date": "2027-01-01"},
            ).status_code
            == 200
        )
        create(app, "tasks", {"name": name, "due_date": "2027-01-02 12:00:00"})
        create(
            app,
            "chores",
            {
                "name": name,
                "period_type": "daily",
                "period_interval": 1,
                "start_date": "2027-01-03 08:30:00",
                "track_date_only": 1,
            },
        )
        battery = create(app, "batteries", {"name": name, "charge_interval_days": 7})
        assert (
            app.post(
                f"/api/batteries/{battery}/charge", json={"tracked_time": "2027-01-01 12:00:00"}
            ).status_code
            == 200
        )
        recipe = create(app, "recipes", {"name": name})
        section = create(app, "meal_plan_sections", {"name": "Evening", "time_info": "18:15"})
        for kind, fields in (
            ("recipe", {"recipe_id": recipe, "recipe_servings": 1}),
            ("product", {"product_id": product, "product_amount": 1, "product_qu_id": unit}),
            ("note", {"note": name}),
        ):
            create(
                app,
                "meal_plan",
                {"day": "2027-01-04", "type": kind, "section_id": section, **fields},
            )
        response = app.get("/api/calendar/ical")
        assert response.status_code == 200
        events = []
        for block in response.text.replace("\r\n ", "").replace("\n ", "").split("BEGIN:VEVENT"):
            lines = block.splitlines()
            summary = next(
                (line.partition(":")[2] for line in lines if line.startswith("SUMMARY:")), ""
            )
            if name not in summary:
                continue
            start = next(line for line in lines if line.startswith("DTSTART"))
            end = next((line for line in lines if line.startswith("DTEND")), None)
            events.append((summary, start, end))
        snapshots.append(sorted(events))
    assert snapshots[0] == snapshots[1]
    assert len(snapshots[0]) == 7


@pytest.mark.parametrize(
    "kind", ["users", "recipes", "product-locations", "product-entries", "location-entries"]
)
def test_reference_list_filters_order_and_paging(
    client: TestClient, api_headers: dict, reference, kind: str
):
    client.headers.update(api_headers)
    for app in (reference, client):
        name = f"Filter{uuid4().hex[:8]}"
        if kind == "users":
            for suffix in "ABC":
                assert (
                    app.post(
                        "/api/users",
                        json={"username": f"{name}{suffix}", "password": "test-password"},
                    ).status_code
                    == 204
                )
            path, query, field, expected = "/api/users", f"username~{name}", "username", f"{name}B"
        elif kind == "recipes":
            ids = [create(app, "recipes", {"name": f"{name}{suffix}"}) for suffix in "ABC"]
            path, query, field, expected = (
                "/api/recipes/fulfillment",
                f"recipe_id>={min(ids)}",
                "recipe_id",
                ids[1],
            )
        else:
            unit = create(app, "quantity_units", {"name": name})
            location = create(app, "locations", {"name": name})
            product = create(
                app,
                "products",
                {
                    "name": name,
                    "location_id": location,
                    "qu_id_stock": unit,
                    "qu_id_purchase": unit,
                },
            )
            for number in (1, 2, 3):
                target_location, target_product = location, product
                if kind == "product-locations":
                    target_location = create(app, "locations", {"name": f"{name}{number}"})
                if kind == "location-entries":
                    target_product = create(
                        app,
                        "products",
                        {
                            "name": f"{name}{number}",
                            "location_id": location,
                            "qu_id_stock": unit,
                            "qu_id_purchase": unit,
                        },
                    )
                assert (
                    app.post(
                        f"/api/stock/products/{target_product}/add",
                        json={"amount": number, "price": number, "location_id": target_location},
                    ).status_code
                    == 200
                )
            suffix = "locations" if kind == "product-locations" else "entries"
            path = (
                f"/api/stock/locations/{location}/entries"
                if kind == "location-entries"
                else f"/api/stock/products/{product}/{suffix}"
            )
            query, field, expected = "amount>=1", "amount", 2
            if kind == "product-locations":
                query = f"location_name~{name}"
        response = app.get(
            path, params={"query[]": query, "order": f"{field}:desc", "offset": 1, "limit": 1}
        )
        assert response.status_code == 200, response.text
        rows = response.json()
        assert len(rows) == 1
        assert rows[0][field] == expected


def test_reference_custom_fields_declared_values_and_record_types(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    snapshots = []
    for app in (reference, client):
        name = f"record{uuid4().hex[:8]}"
        entity_id = create(app, "userentities", {"name": name, "caption": name})
        entity = f"userentity-{name}"
        create(
            app,
            "userfields",
            {"entity": entity, "name": "serial", "caption": "Serial", "type": "text-single-line"},
        )
        record = create(app, "userobjects", {"userentity_id": entity_id})
        path = f"/api/userfields/{entity}/{record}"
        states = [app.get(path).json()]
        for value in ("ABC123", None, 0):
            response = app.put(path, json={"serial": value})
            assert response.status_code == 204, response.text
            states.append(app.get(path).json())
        assert app.put(path, json={"unknown": "invalid"}).status_code == 400
        states.append(app.get(path).json())
        snapshots.append(states)
    assert (
        snapshots[0]
        == snapshots[1]
        == [
            {"serial": None},
            {"serial": "ABC123"},
            {"serial": None},
            {"serial": "0"},
            {"serial": "0"},
        ]
    )


@pytest.mark.parametrize("move_on_open", [0, 1])
def test_reference_partial_open_keeps_scanned_entry_and_metadata(
    client: TestClient, api_headers: dict, reference, move_on_open: int
):
    client.headers.update(api_headers)
    snapshots = []
    for app in (reference, client):
        name = f"Opening {uuid4().hex[:8]}"
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        target = create(app, "locations", {"name": f"{name} opened"})
        store = create(app, "shopping_locations", {"name": name})
        product = create(
            app,
            "products",
            {
                "name": name,
                "location_id": location,
                "qu_id_stock": unit,
                "qu_id_purchase": unit,
                "disable_open": 1,
                "move_on_open": move_on_open,
                "default_consume_location_id": target,
            },
        )
        base = f"/api/stock/products/{product}"
        assert (
            app.post(
                f"{base}/add",
                json={
                    "amount": 3,
                    "best_before_date": "2027-01-01",
                    "purchased_date": "2026-01-01",
                    "shopping_location_id": store,
                    "note": "sealed batch",
                    "price": 2.5,
                },
            ).status_code
            == 200
        )
        original = app.get(f"{base}/entries").json()[0]
        blocked = app.post(f"{base}/open", json={"amount": 1})
        assert blocked.status_code == 400
        assert (
            app.put(f"/api/objects/products/{product}", json={"disable_open": 0}).status_code == 204
        )
        opened = app.post(
            f"/api/stock/products/by-barcode/grcy:p:{product}:{original['stock_id']}/open",
            json={"amount": 1},
        )
        assert opened.status_code == 200
        entries = app.get(f"{base}/entries").json()
        selected = next(row for row in entries if row["stock_id"] == original["stock_id"])
        closed = next(row for row in entries if not row["open"])
        snapshots.append(
            (
                float(selected["amount"]),
                int(selected["open"]),
                float(closed["amount"]),
                selected["shopping_location_id"] == closed["shopping_location_id"] == store,
                selected["note"],
                closed["note"],
                float(selected["price"]),
                opened.json()[0]["stock_id"] == original["stock_id"],
                selected["location_id"] == (target if move_on_open else location),
                [row["transaction_type"] for row in opened.json()],
            )
        )
        assert (
            app.post(
                f"/api/stock/transactions/{opened.json()[0]['transaction_id']}/undo"
            ).status_code
            == 204
        )
        assert sum(float(row["amount"]) for row in app.get(f"{base}/entries").json()) == 3
        assert app.get(base).json()["stock_amount_opened"] == 0
    types = ["product-opened"] + (["transfer_from", "transfer_to"] if move_on_open else [])
    assert (
        snapshots[0]
        == snapshots[1]
        == (1, 1, 2, True, "sealed batch", "sealed batch", 2.5, True, True, types)
    )


def test_reference_stock_recipe_and_household_state(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    snapshots = []
    name = f"Compatibility {uuid4().hex[:8]}"
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name, "name_plural": name})
        location = create(app, "locations", {"name": name})
        product = create(
            app,
            "products",
            {"name": name, "location_id": location, "qu_id_purchase": unit, "qu_id_stock": unit},
        )
        base = f"/api/stock/products/{product}"
        bought = app.post(f"{base}/add", json={"amount": 5, "best_before_date": "2027-01-01"})
        assert bought.status_code == 200
        assert isinstance(bought.json(), list)
        assert app.post(f"{base}/consume", json={"amount": 2}).status_code == 200
        stock = app.get(base).json()["stock_amount"]
        recipe = create(app, "recipes", {"name": name, "base_servings": 1, "desired_servings": 1})
        create(
            app,
            "recipes_pos",
            {"recipe_id": recipe, "product_id": product, "amount": 1, "qu_id": unit},
        )
        fulfilled = app.get(f"/api/recipes/{recipe}/fulfillment").json()["need_fulfilled"]
        assert app.post(f"/api/recipes/{recipe}/consume").status_code == 204
        after_recipe = app.get(base).json()["stock_amount"]
        task = create(app, "tasks", {"name": name})
        assert app.post(f"/api/tasks/{task}/complete", json={}).status_code == 204
        done = app.get(f"/api/objects/tasks/{task}").json()["done"]
        assert app.post(f"/api/tasks/{task}/undo").status_code == 204
        undone = app.get(f"/api/objects/tasks/{task}").json()["done"]
        chore = create(
            app,
            "chores",
            {"name": name, "period_type": "manually", "assignment_type": "no-assignment"},
        )
        execution = app.post(
            f"/api/chores/{chore}/execute", json={"tracked_time": "2026-10-15 12:00:00"}
        )
        assert execution.status_code == 200
        assert app.post(f"/api/chores/executions/{execution.json()['id']}/undo").status_code == 204
        snapshots.append(
            (float(stock), bool(fulfilled), float(after_recipe), int(done), int(undone))
        )
    assert snapshots[0] == snapshots[1] == (3.0, True, 2.0, 1, 0)


def test_reference_recipe_options_consumption_and_produced_stock(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    snapshots = []
    for app in (reference, client):
        name = f"Recipe options {uuid4().hex[:8]}"
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        defaults = {"location_id": location, "qu_id_stock": unit, "qu_id_purchase": unit}
        spice = create(app, "products", {**defaults, "name": f"{name} spice"})
        parent = create(app, "products", {**defaults, "name": f"{name} flour", "no_own_stock": 1})
        child = create(
            app, "products", {**defaults, "name": f"{name} flour bag", "parent_product_id": parent}
        )
        output = create(app, "products", {**defaults, "name": f"{name} bread"})
        for product, amount, price in ((spice, 0.25, 4), (child, 3, 2.5)):
            assert (
                app.post(
                    f"/api/stock/products/{product}/add", json={"amount": amount, "price": price}
                ).status_code
                == 200
            )
        recipe = create(app, "recipes", {"name": name, "base_servings": 2, "product_id": output})
        create(
            app,
            "recipes_pos",
            {
                "recipe_id": recipe,
                "product_id": spice,
                "amount": 5,
                "qu_id": unit,
                "only_check_single_unit_in_stock": 1,
            },
        )
        create(
            app,
            "recipes_pos",
            {
                "recipe_id": recipe,
                "product_id": parent,
                "amount": 1.2,
                "qu_id": unit,
                "round_up": 1,
                "price_factor": 0.5,
            },
        )
        status = app.get(f"/api/recipes/{recipe}/fulfillment").json()
        assert app.post(f"/api/recipes/{recipe}/consume").status_code == 204
        stocks = [
            app.get(f"/api/stock/products/{product}").json() for product in (spice, child, output)
        ]
        logs = app.get("/api/objects/stock_log", params={"query[]": f"recipe_id={recipe}"}).json()
        snapshots.append(
            (
                bool(status["need_fulfilled"]),
                float(status["costs"]),
                [float(row["stock_amount"]) for row in stocks],
                float(stocks[2]["last_price"]),
                len(logs),
                all(row["transaction_type"] == "consume" for row in logs),
            )
        )
    assert snapshots[0] == snapshots[1] == (True, 21.5, [0.25, 1, 2], 10.75, 1, True)


def timestamp(value):
    from datetime import datetime

    return datetime.fromisoformat(value) if value else None


def test_reference_household_schedule_and_tracking(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    snapshots = []
    name = f"Household {uuid4().hex[:8]}"
    for app in (reference, client):
        chore = create(
            app,
            "chores",
            {
                "name": name,
                "period_type": "weekly",
                "period_interval": 2,
                "period_config": "monday,thursday",
                "start_date": "2027-01-01 10:00:00",
                "track_date_only": 1,
                "rollover": 0,
                "assignment_type": "no-assignment",
            },
        )
        states = []
        for body in (
            {"tracked_time": "2027-01-04 15:00:00"},
            {"tracked_time": "2027-01-14 15:00:00", "skipped": True},
        ):
            result = app.post(f"/api/chores/{chore}/execute", json=body)
            assert result.status_code == 200, result.text
            details = app.get(f"/api/chores/{chore}").json()
            states.append(
                (
                    timestamp(result.json()["tracked_time"]),
                    timestamp(result.json()["scheduled_execution_time"]),
                    timestamp(details["last_tracked"]),
                    int(details["tracked_count"]),
                    timestamp(details["next_estimated_execution_time"]),
                )
            )
        assert app.post(f"/api/chores/executions/{result.json()['id']}/undo").status_code == 204
        states.append(
            timestamp(app.get(f"/api/chores/{chore}").json()["next_estimated_execution_time"])
        )
        response = app.put(f"/api/objects/chores/{chore}", json={"rescheduled_date": "2027-03-01"})
        assert response.status_code == 204, response.text
        states.append(
            timestamp(app.get(f"/api/chores/{chore}").json()["next_estimated_execution_time"])
        )
        battery = create(app, "batteries", {"name": name, "charge_interval_days": 7})
        states.append(app.get(f"/api/batteries/{battery}").json()["next_estimated_charge_time"])
        cycle = app.post(
            f"/api/batteries/{battery}/charge", json={"tracked_time": "2027-01-04 15:00:00"}
        )
        assert cycle.status_code == 200, cycle.text
        details = app.get(f"/api/batteries/{battery}").json()
        states.append(
            (
                timestamp(details["last_charged"]),
                int(details["charge_cycles_count"]),
                timestamp(details["next_estimated_charge_time"]),
            )
        )
        assert (
            app.post(f"/api/batteries/charge-cycles/{cycle.json()['id']}/undo").status_code == 204
        )
        states.append(int(app.get(f"/api/batteries/{battery}").json()["charge_cycles_count"]))
        category = create(app, "task_categories", {"name": name})
        task = create(
            app, "tasks", {"name": name, "category_id": category, "assigned_to_user_id": 1}
        )
        current = next(row for row in app.get("/api/tasks").json() if int(row["id"]) == task)
        states.append((int(current["assigned_to_user"]["id"]), current["category"]["name"]))
        assert (
            app.put(f"/api/objects/task_categories/{category}", json={"active": 0}).status_code
            == 204
        )
        states.append(
            next(row for row in app.get("/api/tasks").json() if int(row["id"]) == task)["category"]
        )
        completed = app.post(
            f"/api/tasks/{task}/complete", json={"done_time": "2027-01-04 15:00:00"}
        )
        assert completed.status_code == 204, completed.text
        states.append(timestamp(app.get(f"/api/objects/tasks/{task}").json()["done_timestamp"]))
        recipe = create(app, "recipes", {"name": name})
        for entity, record_id, kind in (
            ("chores", chore, "chore"),
            ("batteries", battery, "battery"),
            ("recipes", recipe, "recipe"),
        ):
            label = app.get(f"/api/{entity}/{record_id}/printlabel")
            assert label.status_code == 200, label.text
            payload = label.json()
            record = payload["details"] if kind == "recipe" else payload["details"][kind]
            states.append((payload[kind], record["name"], sorted(record)))
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize("first_price", [2, 2.25])
def test_reference_purchase_prices_and_catalog_views(
    client: TestClient, api_headers: dict, reference, first_price
):
    client.headers.update(api_headers)
    name = f"Price comparison {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        store = create(app, "shopping_locations", {"name": name})
        product = create(
            app,
            "products",
            {"name": name, "location_id": location, "qu_id_purchase": unit, "qu_id_stock": unit},
        )
        base = f"/api/stock/products/{product}"
        for body in (
            {
                "amount": 4,
                "price": first_price,
                "purchased_date": "2027-01-10",
                "best_before_date": "2027-02-06",
            },
            {
                "amount": 1,
                "price": 10,
                "purchased_date": "2027-01-01",
                "best_before_date": "2027-01-15",
            },
        ):
            result = app.post(f"{base}/add", json={**body, "shopping_location_id": store})
            assert result.status_code == 200, result.text
        details = app.get(base).json()
        states: list[object] = [
            {
                key: details[key]
                for key in (
                    "last_purchased",
                    "last_price",
                    "avg_price",
                    "current_price",
                    "oldest_price",
                    "stock_value",
                    "average_shelf_life_days",
                )
            }
        ]
        history = app.get(f"{base}/price-history").json()
        states.append(
            [
                (row["date"], float(row["price"]), row["shopping_location"]["name"])
                for row in history
            ]
        )
        for entity, keys in (
            (
                "products_last_purchased",
                ("id", "amount", "best_before_date", "purchased_date", "price"),
            ),
            ("products_average_price", ("id", "price")),
            ("stock_current_locations", ("id", "amount", "location_name")),
        ):
            rows = app.get(
                f"/api/objects/{entity}", params={"query[]": f"product_id={product}"}
            ).json()
            states.append([{key: row[key] for key in keys} for row in rows])
        barcode = f"{uuid4().int % 1000000000000:012d}"
        create(app, "product_barcodes", {"product_id": product, "barcode": barcode, "qu_id": unit})
        rows = app.get(
            "/api/objects/product_barcodes_view", params={"query[]": f"product_id={product}"}
        ).json()
        states.append(
            sorted(
                "grocycode" if row["barcode"].startswith("grcy:p:") else "retail" for row in rows
            )
        )
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


def test_reference_stock_entry_edit_and_undo(client: TestClient, api_headers: dict, reference):
    client.headers.update(api_headers)
    name = f"Entry edit {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        product = create(
            app,
            "products",
            {"name": name, "location_id": location, "qu_id_stock": unit, "qu_id_purchase": unit},
        )
        base = f"/api/stock/products/{product}"
        assert (
            app.post(
                f"{base}/add",
                json={
                    "amount": 4,
                    "price": 2.5,
                    "purchased_date": "2027-01-01",
                    "best_before_date": "2027-02-01",
                    "note": "original",
                },
            ).status_code
            == 200
        )
        assert app.post(f"{base}/consume", json={"amount": 1}).status_code == 200
        entry = app.get(f"{base}/entries").json()[0]
        edited = app.put(
            f"/api/stock/entry/{entry['id']}",
            json={
                "amount": 5,
                "price": 3.25,
                "open": False,
                "purchased_date": "2027-01-04",
                "best_before_date": "2027-02-14",
                "location_id": location,
                "note": "corrected",
            },
        )
        assert edited.status_code == 200, edited.text
        states: list[object] = [
            [(row["transaction_type"], row["amount"], row["price"]) for row in edited.json()]
        ]
        for undo in (False, True):
            if undo:
                response = app.post(f"/api/stock/bookings/{edited.json()[0]['id']}/undo")
                assert response.status_code == 204, response.text
            details = app.get(base).json()
            rows = app.get(f"{base}/entries").json()
            states.append(
                (
                    details["stock_amount"],
                    details["avg_price"],
                    details["last_price"],
                    [
                        (row["amount"], row["price"], row["purchased_date"], row["note"])
                        for row in rows
                    ],
                )
            )
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize(
    "entity,fields",
    [
        (
            "products",
            {
                "due_type": 2,
                "default_best_before_days_after_freezing": 90,
                "default_best_before_days_after_thawing": 3,
                "calories": 120,
                "cumulate_min_stock_amount_of_sub_products": 1,
                "quick_consume_amount": 2.5,
                "quick_open_amount": 2,
                "hide_on_stock_overview": 1,
                "default_stock_label_type": 2,
                "disable_open": 1,
                "default_purchase_price_type": 2,
            },
        ),
        ("locations", {"active": 0}),
        ("quantity_units", {"active": 0, "plural_forms": "one;many"}),
        ("shopping_locations", {"active": 0}),
        ("product_groups", {"active": 0}),
        ("recipes", {"picture_file_name": "recipe.jpg", "not_check_shoppinglist": 1}),
        ("meal_plan_sections", {"time_info": "Breakfast"}),
        (
            "userfields",
            {
                "entity": "products",
                "caption": "Origin",
                "type": "text",
                "input_required": 1,
                "default_value": "Farm",
            },
        ),
    ],
)
def test_reference_catalog_options(
    client: TestClient, api_headers: dict, reference, entity, fields
):
    client.headers.update(api_headers)
    name = f"Catalog {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        body = {"name": name, **fields}
        if entity == "products":
            unit = create(app, "quantity_units", {"name": name})
            location = create(app, "locations", {"name": name})
            body.update(location_id=location, qu_id_purchase=unit, qu_id_stock=unit)
        record_id = create(app, entity, body)
        record = app.get(f"/api/objects/{entity}/{record_id}").json()
        snapshots.append({key: record[key] for key in fields})
        listed = app.get(f"/api/objects/{entity}").json()
        assert any(int(row["id"]) == record_id for row in listed)
    assert snapshots[0] == snapshots[1] == fields


def test_reference_resolved_recipe_and_conversion_records(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    name = f"Resolved records {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        other_unit = create(app, "quantity_units", {"name": f"{name} larger"})
        location = create(app, "locations", {"name": name})
        product = create(
            app,
            "products",
            {
                "name": name,
                "location_id": location,
                "qu_id_purchase": unit,
                "qu_id_stock": unit,
                "calories": 120,
            },
        )
        create(
            app,
            "quantity_unit_conversions",
            {"from_qu_id": unit, "to_qu_id": other_unit, "factor": 2.5},
        )
        recipe = create(app, "recipes", {"name": name, "base_servings": 2, "desired_servings": 3})
        assert app.get(f"/api/objects/recipes/{recipe}").json()["desired_servings"] == 2
        assert (
            app.put(f"/api/objects/recipes/{recipe}", json={"desired_servings": 3}).status_code
            == 204
        )
        position = create(
            app,
            "recipes_pos",
            {
                "recipe_id": recipe,
                "product_id": product,
                "qu_id": unit,
                "amount": 0.75,
                "price_factor": 2,
                "round_up": 1,
            },
        )
        assert (
            app.post(
                f"/api/stock/products/{product}/add",
                json={"amount": 3, "price": 3.25, "best_before_date": "2027-12-31"},
            ).status_code
            == 200
        )
        rows = app.get(
            "/api/objects/recipes_pos_resolved", params={"query[]": f"recipe_id={recipe}"}
        ).json()
        assert len(rows) == 1
        row = rows[0]
        for key, record_id in (
            ("id", position),
            ("recipe_pos_id", position),
            ("recipe_id", recipe),
            ("child_recipe_id", recipe),
            ("product_id", product),
            ("product_id_effective", product),
            ("qu_id", unit),
        ):
            assert row[key] == record_id
            row[key] = 1
        conversions = app.get(
            "/api/objects/quantity_unit_conversions_resolved",
            params={"query[]": [f"product_id={product}", f"from_qu_id={unit}"]},
        ).json()
        normalized = []
        for conversion in conversions:
            conversion.pop("userfields", None)
            assert conversion["product_id"] == product
            conversion["product_id"] = 1
            conversion["from_qu_id"] = 1
            conversion["to_qu_id"] = {unit: 1, other_unit: 2}[conversion["to_qu_id"]]
            conversion["path"] = (
                "/"
                + "/".join(
                    str({unit: 1, other_unit: 2}[int(part)])
                    for part in conversion["path"].split("/")
                    if part
                )
                + "/"
            )
            normalized.append(conversion)
        snapshots.append((row, sorted(normalized, key=lambda item: item["to_qu_id"])))
    expected, actual = snapshots
    assert actual[1] == expected[1]
    for key, value in expected[0].items():
        assert actual[0][key] == value, key


def test_reference_parent_stock_and_volatile_records(
    client: TestClient, api_headers: dict, reference
):
    from datetime import date, timedelta

    client.headers.update(api_headers)
    name = f"Parent stock {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        defaults = {"location_id": location, "qu_id_purchase": unit, "qu_id_stock": unit}
        parent = create(
            app,
            "products",
            {
                **defaults,
                "name": name,
                "no_own_stock": 1,
                "cumulate_min_stock_amount_of_sub_products": 1,
            },
        )
        children = []
        for suffix, due_type, minimum, amount in (("A", 1, 4, 2), ("B", 2, 3, 1)):
            child = create(
                app,
                "products",
                {
                    **defaults,
                    "name": f"{name} {suffix}",
                    "parent_product_id": parent,
                    "due_type": due_type,
                    "min_stock_amount": minimum,
                },
            )
            children.append(child)
            assert (
                app.post(
                    f"/api/stock/products/{child}/add",
                    json={
                        "amount": amount,
                        "price": 2.5,
                        "best_before_date": (date.today() - timedelta(days=1)).isoformat(),
                    },
                ).status_code
                == 200
            )
        assert (
            app.post(f"/api/stock/products/{children[0]}/open", json={"amount": 1}).status_code
            == 200
        )
        details = app.get(f"/api/stock/products/{parent}").json()
        states: list[object] = [
            {
                key: details[key]
                for key in (
                    "stock_amount",
                    "stock_amount_aggregated",
                    "stock_amount_opened",
                    "stock_amount_opened_aggregated",
                    "is_aggregated_amount",
                    "stock_value",
                )
            }
        ]
        overview = app.get("/api/stock").json()
        keys = (
            "amount",
            "amount_aggregated",
            "amount_opened",
            "amount_opened_aggregated",
            "value",
            "is_aggregated_amount",
            "due_type",
        )
        relevant = {parent, *children}
        states.append(
            {
                row["product"]["name"]: {key: row[key] for key in keys}
                for row in overview
                if row["product_id"] in relevant
            }
        )
        volatile = app.get("/api/stock/volatile").json()
        states.append(
            {
                kind: sorted(
                    row["product"]["name"]
                    for row in rows
                    if int(row.get("product_id", row.get("id"))) in relevant
                )
                for kind, rows in volatile.items()
            }
        )
        snapshots.append(states)
        selected = app.get(f"/api/stock/products/{children[1]}/entries").json()[0]
        assert (
            app.post(
                f"/api/stock/products/{parent}/open",
                json={
                    "amount": 1,
                    "stock_entry_id": selected["stock_id"],
                    "allow_subproduct_substitution": True,
                },
            ).status_code
            == 200
        )
        assert (
            app.post(
                f"/api/stock/products/{parent}/consume",
                json={
                    "amount": 1,
                    "stock_entry_id": selected["stock_id"],
                    "allow_subproduct_substitution": True,
                },
            ).status_code
            == 200
        )
        assert app.get(f"/api/stock/products/{children[1]}").json()["stock_amount"] == 0
        assert app.get(f"/api/stock/products/{children[0]}").json()["stock_amount"] == 2
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize(
    "start", ["0000-01-01 00:30:00", "0000-01-01 01:44:24", "0000-01-02 00:30:00"]
)
def test_reference_calendar_utc_year_boundary(client, api_headers, reference, start):
    client.headers.update(api_headers)
    name = "Calendar boundary " + uuid4().hex
    snapshots = []
    for app in (reference, client):
        chore = create(
            app,
            "chores",
            {
                "name": name,
                "period_type": "daily",
                "start_date": start,
                "rollover": 0,
                "track_date_only": 0,
            },
        )
        try:
            details = app.get(f"/api/chores/{chore}").json()
            assert details["next_estimated_execution_time"] == start
            response = app.get("/api/calendar/ical")
            snapshots.append(
                (
                    response.status_code,
                    response.json()["error_message"]
                    if response.status_code != 200
                    else name in response.text,
                )
            )
        finally:
            assert app.delete(f"/api/objects/chores/{chore}").status_code == 204
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize(
    "suffix,encodings",
    [
        ("box/part/add", 1),
        ("https://example.test/item?q=1#code", 1),
        ("literal%2Fcode", 1),
        ("literal%2Fcode", 2),
        ("box + café", 1),
    ],
)
def test_reference_encoded_barcode_paths(client, api_headers, reference, suffix, encodings):
    client.headers.update(api_headers)
    name = f"Encoded barcode {uuid4().hex[:8]}"
    barcode = f"{name}:{suffix}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        destination = create(app, "locations", {"name": name + " destination"})
        product = create(
            app,
            "products",
            {
                "name": name,
                "location_id": location,
                "qu_id_stock": unit,
                "qu_id_purchase": unit,
                "qu_id_consume": unit,
            },
        )
        create(app, "product_barcodes", {"product_id": product, "barcode": barcode})
        products = [product]
        if "%2F" in barcode:
            decoded_product = create(
                app,
                "products",
                {
                    "name": name + " decoded",
                    "location_id": location,
                    "qu_id_stock": unit,
                    "qu_id_purchase": unit,
                    "qu_id_consume": unit,
                },
            )
            products.append(decoded_product)
            create(
                app,
                "product_barcodes",
                {"product_id": decoded_product, "barcode": barcode.replace("%2F", "/")},
            )
        encoded = barcode
        for _ in range(encodings):
            encoded = quote(encoded, safe="")
        path = "/api/stock/products/by-barcode/" + encoded
        found = app.get(path)
        results = [
            (
                found.status_code,
                found.json()["product"]["name"] if found.status_code == 200 else None,
            )
        ]
        for action, body in [
            ("add", {"amount": 3, "price": 1, "best_before_date": "2999-12-31"}),
            ("open", {"amount": 1}),
            (
                "transfer",
                {"amount": 1, "location_id_from": location, "location_id_to": destination},
            ),
            ("consume", {"amount": 1, "location_id": destination}),
            ("inventory", {"new_amount": 2}),
        ]:
            response = app.post(path + "/" + action, json=body)
            results.append((response.status_code, None))
        results.append(
            [
                app.get(f"/api/stock/products/{identity}").json()["stock_amount"]
                for identity in products
            ]
        )
        snapshots.append(results)
    assert snapshots[0] == snapshots[1]


def test_reference_product_units_and_barcode_stock_selection(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    name = f"Barcode units {uuid4().hex[:8]}"
    barcode = f"AbC{uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        stock_unit = create(app, "quantity_units", {"name": f"{name} piece"})
        purchase_unit = create(app, "quantity_units", {"name": f"{name} case"})
        consume_unit = create(app, "quantity_units", {"name": f"{name} portion"})
        for source, factor in ((purchase_unit, 6), (consume_unit, 0.5)):
            create(
                app,
                "quantity_unit_conversions",
                {"from_qu_id": source, "to_qu_id": stock_unit, "factor": factor},
            )
        location = create(app, "locations", {"name": name})
        product = create(
            app,
            "products",
            {
                "name": name,
                "location_id": location,
                "qu_id_stock": stock_unit,
                "qu_id_purchase": purchase_unit,
                "qu_id_consume": consume_unit,
                "qu_id_price": purchase_unit,
            },
        )
        create(
            app,
            "product_barcodes",
            {"product_id": product, "barcode": barcode, "qu_id": purchase_unit, "amount": 1},
        )
        details = app.get(f"/api/stock/products/{product}").json()
        states: list[object] = [
            (
                [
                    details[key]["name"]
                    for key in (
                        "quantity_unit_stock",
                        "default_quantity_unit_purchase",
                        "default_quantity_unit_consume",
                        "quantity_unit_price",
                    )
                ],
                details["qu_conversion_factor_purchase_to_stock"],
                details["qu_conversion_factor_price_to_stock"],
                [row["barcode"] for row in details["product_barcodes"]],
            )
        ]
        found = app.get(f"/api/stock/products/by-barcode/{barcode.lower()}")
        assert found.status_code == 200, found.text
        assert int(found.json()["product"]["id"]) == product
        for price, purchased, expiry in (
            (2.5, "2027-01-01", "2027-02-01"),
            (3.5, "2027-01-04", "2027-03-01"),
        ):
            added = app.post(
                f"/api/stock/products/by-barcode/{barcode}/add",
                json={
                    "amount": 2,
                    "price": price,
                    "purchased_date": purchased,
                    "best_before_date": expiry,
                },
            )
            assert added.status_code == 200, added.text
        entries = app.get(f"/api/stock/products/{product}/entries").json()
        selected = next(row for row in entries if float(row["price"]) == 3.5)
        code = f"grcy:p:{product}:{selected['stock_id']}"
        assert (
            app.post(
                f"/api/stock/products/by-barcode/{code}/consume", json={"amount": 1}
            ).status_code
            == 200
        )
        opened = app.post(f"/api/stock/products/by-barcode/{code}/open", json={"amount": 1})
        assert opened.status_code == 200, opened.text
        entries = app.get(f"/api/stock/products/{product}/entries").json()
        states.append(
            sorted(
                (float(row["price"]), float(row["amount"]), int(row["open"]), row["purchased_date"])
                for row in entries
            )
        )
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


def test_reference_freezing_transfer_bookings_and_undo(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    name = f"Freezing {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        fridge = create(app, "locations", {"name": name})
        freezer = create(app, "locations", {"name": f"{name} freezer", "is_freezer": 1})
        store = create(app, "shopping_locations", {"name": name})
        product = create(
            app,
            "products",
            {
                "name": name,
                "location_id": fridge,
                "qu_id_stock": unit,
                "qu_id_purchase": unit,
                "default_best_before_days": 7,
                "default_best_before_days_after_freezing": 90,
                "default_best_before_days_after_thawing": 3,
            },
        )
        base = f"/api/stock/products/{product}"
        assert (
            app.post(
                f"{base}/add",
                json={
                    "amount": 3,
                    "location_id": freezer,
                    "price": 2.5,
                    "shopping_location_id": store,
                    "note": "frozen batch",
                },
            ).status_code
            == 200
        )
        original = app.get(f"{base}/entries").json()[0]
        states: list[object] = [original["best_before_date"]]
        code = f"grcy:p:{product}:{original['stock_id']}"
        thawed = app.post(
            f"/api/stock/products/by-barcode/{code}/transfer",
            json={"amount": 1, "location_id_from": freezer, "location_id_to": fridge},
        )
        assert thawed.status_code == 200, thawed.text
        bookings = thawed.json()
        states.append(
            [
                (
                    row["transaction_type"],
                    row["amount"],
                    row["best_before_date"],
                    row["price"],
                    row["note"],
                )
                for row in bookings
            ]
        )
        assert all(row["correlation_id"] == bookings[0]["correlation_id"] for row in bookings)
        entries = app.get(f"{base}/entries").json()
        states.append(
            sorted(
                (
                    row["amount"],
                    row["best_before_date"],
                    row["note"],
                    row["stock_id"] == original["stock_id"],
                    row["shopping_location_id"] == store,
                )
                for row in entries
            )
        )
        assert app.post(f"/api/stock/bookings/{bookings[0]['id']}/undo").status_code == 204
        entries = app.get(f"{base}/entries").json()
        states.append(
            [
                (row["amount"], row["best_before_date"], row["location_id"] == freezer, row["note"])
                for row in entries
            ]
        )
        assert (
            app.put(f"/api/objects/products/{product}", json={"location_id": freezer}).status_code
            == 204
        )
        assert (
            app.post(
                f"{base}/add",
                json={
                    "amount": 2,
                    "location_id": freezer,
                    "price": 4,
                    "note": "second batch",
                    "best_before_date": "2999-12-31",
                },
            ).status_code
            == 200
        )
        moved = app.post(
            f"{base}/transfer",
            json={
                "amount": 4,
                "location_id_from": freezer,
                "location_id_to": fridge,
            },
        )
        assert moved.status_code == 200
        assert len(moved.json()) == 4
        assert app.post(f"/api/stock/bookings/{moved.json()[0]['id']}/undo").status_code == 204
        entries = app.get(f"{base}/entries").json()
        states.append(
            (
                sum(row["amount"] for row in entries if row["location_id"] == freezer),
                sum(row["amount"] for row in entries if row["location_id"] == fridge),
            )
        )
        assert (
            app.post(
                f"/api/stock/transactions/{moved.json()[0]['transaction_id']}/undo"
            ).status_code
            == 204
        )
        entries = app.get(f"{base}/entries").json()
        states.append(
            (
                sum(row["amount"] for row in entries if row["location_id"] == freezer),
                sum(row["amount"] for row in entries if row["location_id"] == fridge),
            )
        )
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


def test_reference_system_metadata_localization_and_time(
    client: TestClient, api_headers: dict, reference
):
    from datetime import datetime

    client.headers.update(api_headers)
    expected = reference.get("/api/system/info").json()
    info = client.get("/api/system/info").json()
    assert info["grocy_version"] == expected["grocy_version"]
    assert info["db_version"] == expected["db_version"]
    runtime_version = info["php_version"] or info["python_version"]
    assert re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+.*", runtime_version)
    expected_config = reference.get("/api/system/config").json()
    config = client.get("/api/system/config").json()
    for key in (
        "FEATURE_FLAG_STOCK",
        "FEATURE_FLAG_RECIPES",
        "FEATURE_FLAG_CHORES_ASSIGNMENTS",
        "FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS",
        "FEATURE_FLAG_STOCK_PRODUCT_FREEZING",
        "DEFAULT_LOCALE",
        "CURRENCY",
    ):
        assert config[key] == expected_config[key]
    strings = client.get("/api/system/localization-strings")
    assert strings.status_code == 200
    assert strings.json() == reference.get("/api/system/localization-strings").json()
    for offset in (-60, 3600):
        expected_time = reference.get("/api/system/time", params={"offset": offset}).json()
        actual_time = client.get("/api/system/time", params={"offset": offset}).json()
        assert actual_time["offset"] == offset
        assert actual_time["timezone"] == expected_time["timezone"]
        assert (
            abs(
                (
                    datetime.fromisoformat(actual_time["time_local"])
                    - datetime.fromisoformat(expected_time["time_local"])
                ).total_seconds()
            )
            < 5
        )
        assert (
            abs(
                (
                    datetime.fromisoformat(actual_time["time_local_sqlite3"])
                    - datetime.fromisoformat(expected_time["time_local_sqlite3"])
                ).total_seconds()
            )
            < 5
        )
        assert abs(actual_time["timestamp"] - expected_time["timestamp"]) < 5
        assert (
            abs(
                (
                    datetime.fromisoformat(actual_time["time_utc"])
                    - datetime.fromisoformat(expected_time["time_utc"])
                ).total_seconds()
            )
            < 5
        )
    for app in (reference, client):
        invalid = app.get("/api/system/time", params={"offset": "tomorrow"})
        assert invalid.status_code == 400


def test_reference_user_setting_defaults_values_and_reset(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    key = f"compatibility_{uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        states: list[object] = [app.get("/api/user/settings").json()]
        default = app.get("/api/user/settings/stock_due_soon_days")
        assert default.status_code == 200, default.text
        states.append(default.json())
        try:
            for value in (True, False, 2.5, None):
                saved = app.put(f"/api/user/settings/{key}", json={"value": value})
                assert saved.status_code == 204, saved.text
                states.append(app.get(f"/api/user/settings/{key}").json())
            assert (
                app.put("/api/user/settings/stock_due_soon_days", json={"value": 3}).status_code
                == 204
            )
            states.append(app.get("/api/user/settings/stock_due_soon_days").json())
        finally:
            assert app.delete(f"/api/user/settings/{key}").status_code == 204
            assert app.delete("/api/user/settings/stock_due_soon_days").status_code == 204
        states.append(app.get("/api/user/settings/stock_due_soon_days").json())
        states.append(app.get(f"/api/user/settings/{key}").json())
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize(
    ("image_format", "mode", "orientation"),
    [
        ("PNG", "RGBA", 1),
        ("PNG", "P", 1),
        ("PNG", "L", 1),
        ("JPEG", "RGB", 1),
        ("JPEG", "RGB", 6),
        ("JPEG", "RGB", 5),
        ("GIF", "RGBA", 1),
        ("WEBP", "RGBA", 1),
        ("BMP", "RGB", 1),
    ],
)
def test_reference_native_picture_bytes(
    client: TestClient,
    api_headers: dict,
    reference,
    tmp_path,
    monkeypatch,
    image_format,
    mode,
    orientation,
):
    import base64
    from io import BytesIO

    from PIL import Image

    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "files_root", tmp_path)
    image = Image.new("RGBA", (32, 20))
    image.putdata(
        [
            ((x * 7) % 256, (y * 11) % 256, ((x + y) * 13) % 256, (x * 17 + y * 7) % 256)
            for y in range(20)
            for x in range(32)
        ]
    )
    if mode != "RGBA":
        image = image.convert(mode)
    source = BytesIO()
    save_options = {}
    if image_format == "JPEG":
        exif = image.getexif()
        exif[274] = orientation
        save_options["exif"] = exif
    image.save(source, image_format, **save_options)
    name = uuid4().hex + "." + image_format.lower()
    path = "/api/files/productpictures/" + base64.b64encode(name.encode()).decode()
    snapshots = []
    for app in [client, reference]:
        headers = api_headers if app is client else {}
        assert app.put(path, content=source.getvalue(), headers=headers).status_code == 204
        try:
            rows = []
            for parameters in [
                {"force_serve_as": "picture"},
                {"force_serve_as": "picture", "best_fit_width": "17"},
                {"force_serve_as": "picture", "best_fit_width": "17", "best_fit_height": "13"},
                {"force_serve_as": "picture", "best_fit_width": "17.8"},
                {"force_serve_as": "picture", "best_fit_width": "17", "best_fit_height": "5"},
            ]:
                response = app.get(path, params=parameters, headers=headers)
                assert response.status_code == 200, response.text
                rows.append((response.content, response.headers["content-type"]))
            snapshots.append(rows)
        finally:
            assert app.delete(path, headers=headers).status_code == 204
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize("value", [[], {}, [1, "saved"], {"nested": {"value": True}}, 1e100])
def test_reference_native_setting_value_storage(client, api_headers, reference, value):
    client.headers.update(api_headers)
    key = "native_" + uuid4().hex
    snapshots = []
    for app in (reference, client):
        try:
            response = app.put(f"/api/user/settings/{key}", json={"value": value})
            data = response.json() if response.content else None
            if data and "error_details" in data:
                data["error_details"] = True
            snapshots.append(
                (response.status_code, data, app.get(f"/api/user/settings/{key}").json())
            )
        finally:
            assert app.delete(f"/api/user/settings/{key}").status_code == 204
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize("key", ["0", "01", "1"])
def test_reference_native_numeric_setting_keys(client, api_headers, reference, key):
    client.headers.update(api_headers)
    value = "saved_" + uuid4().hex
    snapshots = []
    for app in (reference, client):
        try:
            assert app.put(f"/api/user/settings/{key}", json={"value": value}).status_code == 204
            settings = app.get("/api/user/settings").json()
            snapshots.append(
                (
                    app.get(f"/api/user/settings/{key}").content,
                    [name for name, stored in settings.items() if stored == value],
                )
            )
        finally:
            assert app.delete(f"/api/user/settings/{key}").status_code == 204
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize("printer_status,json_body", [(200, True), (500, False)])
def test_reference_native_recipe_output_label_and_partial_failure(
    client, api_headers, reference, printer, printer_status, json_body
):
    client.headers.update(api_headers)
    printer.setting("LABEL_PRINTER_HOOK_JSON", json_body)
    snapshots = []
    errors = []
    for app in (reference, client):
        name = uuid4().hex
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        fields = {"location_id": location, "qu_id_stock": unit, "qu_id_purchase": unit}
        ingredient = create(app, "products", {**fields, "name": name + " ingredient"})
        output = create(
            app, "products", {**fields, "name": name + " output", "default_stock_label_type": 1}
        )
        recipe = create(app, "recipes", {"name": name, "product_id": output})
        create(
            app,
            "recipes_pos",
            {"recipe_id": recipe, "product_id": ingredient, "amount": 2, "qu_id": unit},
        )
        assert (
            app.post(
                f"/api/stock/products/{ingredient}/add", json={"amount": 3, "price": 2}
            ).status_code
            == 200
        )
        printer.clear()
        printer.status = printer_status
        response = app.post(f"/api/recipes/{recipe}/consume")
        assert response.status_code == (204 if printer_status == 200 else 400), response.text
        assert len(printer) == 1
        label = printer[0]
        assert label["product"] == name + " output"
        assert label["grocycode"].startswith(f"grcy:p:{output}:")
        assert label["font_family"] == "Source Sans Pro (Regular)"
        if json_body:
            assert label["details"]["product"]["id"] == output
            assert label["stock_entry"]["amount"] == 1
        else:
            assert "stock_entry" not in label and "details[product]" not in label
        if printer_status == 500:
            error = response.json()["error_message"]
            assert "500 Internal Server Error" in error
            errors.append(error)
        else:
            assert response.content == b""
        snapshots.append(
            [
                app.get(f"/api/stock/products/{product}").json()["stock_amount"]
                for product in [ingredient, output]
            ]
        )
        printer.status = 200
    assert snapshots == [[1, 1], [1, 1]]
    assert not errors or errors[0] == errors[1]


def test_reference_stock_label_modes_and_disabled_printer_controls(
    client, api_headers, reference, printer
):
    client.headers.update(api_headers)
    for app in (reference, client):
        printer.clear()
        printer.setting("FEATURE_FLAG_LABEL_PRINTER", True)
        printer.setting("LABEL_PRINTER_RUN_SERVER", True)
        unit = create(app, "quantity_units", {"name": uuid4().hex})
        location = create(app, "locations", {"name": uuid4().hex})
        product = create(
            app,
            "products",
            {
                "name": uuid4().hex,
                "location_id": location,
                "qu_id_stock": unit,
                "qu_id_purchase": unit,
            },
        )
        response = app.post(
            f"/api/stock/products/{product}/add", json={"amount": 2.5, "stock_label_type": 2}
        )
        assert response.status_code == 200
        bookings = response.json()
        assert [row["amount"] for row in bookings] == [1, 1]
        assert len({row["transaction_id"] for row in bookings}) == 1
        assert [payload["grocycode"] for payload in printer] == [
            f"grcy:p:{product}:{row['stock_id']}" for row in bookings
        ]
        assert [payload["stock_entry"]["amount"] for payload in printer] == [1, 1]
        assert app.get(f"/api/stock/products/{product}").json()["stock_amount"] == 2
        assert (
            app.post(f"/api/stock/transactions/{bookings[0]['transaction_id']}/undo").status_code
            == 204
        )
        assert app.get(f"/api/stock/products/{product}").json()["stock_amount"] == 0
        printer.clear()
        for mode in (0, 1):
            assert (
                app.post(
                    f"/api/stock/products/{product}/inventory",
                    json={
                        "new_amount": mode + 1,
                        "stock_label_type": mode,
                        "purchased_date": "2026-01-01",
                    },
                ).status_code
                == 200
            )
        assert len(printer) == 1
        assert printer[0]["stock_entry"]["purchased_date"] == "2026-01-01"
        printer.clear()
        printer.setting("FEATURE_FLAG_LABEL_PRINTER", False)
        assert (
            app.post(
                f"/api/stock/products/{product}/add", json={"amount": 1, "stock_label_type": 1}
            ).status_code
            == 200
        )
        assert printer == []
        assert app.get(f"/api/stock/products/{product}/printlabel").status_code == 200
        assert len(printer) == 1
        printer.setting("LABEL_PRINTER_RUN_SERVER", False)
        assert app.get(f"/api/stock/products/{product}/printlabel").status_code == 200
        assert len(printer) == 1
        printer.setting("FEATURE_FLAG_LABEL_PRINTER", True)
        assert (
            app.post(
                f"/api/stock/products/{product}/add", json={"amount": 1, "stock_label_type": 1}
            ).status_code
            == 200
        )
        assert len(printer) == 1


@pytest.fixture
def thermal_printer(reference, client, monkeypatch, tmp_path):
    from grocy.core.config import get_settings

    database = os.getenv("GROCY_REFERENCE_DATABASE")
    if not database:
        pytest.skip("A local disposable reference is required for thermal printer setup")
    overrides = Path(database).parent / "settingoverrides"
    overrides.mkdir(exist_ok=True)
    previous = {}
    aliases = {
        "TPRINTER_CONNECTOR": "thermal_printer_device",
        "TPRINTER_IP": "thermal_printer_host",
        "TPRINTER_PORT": "thermal_printer_port",
    }

    class ThermalPrinter:
        output = tmp_path / "receipt"

        def setting(self, name, value):
            for directory in (overrides, get_settings().datapath / "settingoverrides"):
                directory.mkdir(parents=True, exist_ok=True)
                path = directory / f"{name}.txt"
                previous.setdefault(path, path.read_bytes() if path.exists() else None)
                path.write_text(str(value).lower() if isinstance(value, bool) else str(value))
            monkeypatch.setattr(get_settings(), name.lower(), value)
            if name in aliases:
                monkeypatch.setattr(get_settings(), aliases[name], value)

    device = ThermalPrinter()
    device.setting("TPRINTER_IS_NETWORK_PRINTER", False)
    device.setting("TPRINTER_CONNECTOR", str(device.output))
    try:
        yield device
    finally:
        for path, contents in previous.items():
            if contents is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(contents)
        if any(path.name == "BASE_URL.txt" for path in previous):
            reference.get("/api/system/info")
            client.options("/api/system/info")


def thermal_list(app, name):
    unit = create(app, "quantity_units", {"name": "Piece " + name, "name_plural": "Pieces " + name})
    location = create(app, "locations", {"name": "Thermal kitchen " + name})
    product = create(
        app,
        "products",
        {
            "name": "Receipt product " + name,
            "location_id": location,
            "qu_id_stock": unit,
            "qu_id_purchase": unit,
        },
    )
    shopping = create(app, "shopping_lists", {"name": "Printer list " + name})
    create(
        app,
        "shopping_list",
        {
            "shopping_list_id": shopping,
            "product_id": product,
            "amount": 2.6,
            "qu_id": unit,
            "note": "Crème €",
        },
    )
    create(
        app,
        "shopping_list",
        {
            "shopping_list_id": shopping,
            "amount": 1.5,
            "note": "Loose item",
            "done": 1,
        },
    )
    return shopping


@pytest.mark.parametrize(
    "header,list_form,quantity_names,notes",
    [
        (None, "{}", True, True),
        ("true", "{}", True, True),
        ("false", "{}", True, True),
        ("TRUE", "{}", True, True),
        ("1", "{}", True, True),
        ("", "{}", True, True),
        ("false", "0{}", False, True),
        ("false", "{}.0", True, False),
        ("false", "{}e0", False, False),
    ],
)
def test_reference_native_thermal_file_output(
    client, api_headers, reference, thermal_printer, header, list_form, quantity_names, notes
):
    client.headers.update(api_headers)
    thermal_printer.setting("TPRINTER_PRINT_QUANTITY_NAME", quantity_names)
    thermal_printer.setting("TPRINTER_PRINT_NOTES", notes)
    # Grocy's printer route runs even when the UI feature flag is disabled.
    thermal_printer.setting("FEATURE_FLAG_THERMAL_PRINTER", False)
    outputs = []
    name = uuid4().hex
    for app in (reference, client):
        shopping = thermal_list(app, name)
        params = [("list", list_form.format(shopping))]
        if header is not None:
            params.append(("printHeader", header))
        response = app.get("/api/print/shoppinglist/thermal", params=params)
        assert response.status_code == 200, response.text
        assert response.json() == {"result": "OK"}
        receipt = thermal_printer.output.read_bytes()
        assert b"Receipt product" in receipt and b"Loose item" in receipt
        assert receipt.startswith(b"\x1b@") and receipt.endswith(b"\x1dV\x41\x03")
        # The two calls can span a minute boundary. Only the clock text can differ.
        outputs.append(re.sub(rb"\d{2}/\d{2}/\d{4} \d{2}:\d{2}", b"CLOCK", receipt))
    assert outputs[0] == outputs[1]


@pytest.mark.parametrize("failure", ["missing-parent", "empty-path", "network"])
def test_reference_native_thermal_connector_errors(
    client, api_headers, reference, thermal_printer, tmp_path, failure
):
    import socket

    client.headers.update(api_headers)
    if failure == "network":
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        thermal_printer.setting("TPRINTER_IS_NETWORK_PRINTER", True)
        thermal_printer.setting("TPRINTER_IP", "127.0.0.1")
        thermal_printer.setting("TPRINTER_PORT", port)
    else:
        path = "" if failure == "empty-path" else str(tmp_path / "missing" / "printer")
        thermal_printer.setting("TPRINTER_CONNECTOR", path)
    results = []
    for app in (reference, client):
        shopping = create(app, "shopping_lists", {"name": "Failed print " + uuid4().hex})
        response = app.get("/api/print/shoppinglist/thermal", params={"list": shopping})
        assert response.status_code == (500 if failure == "empty-path" else 400), response.text
        results.append(response.json()["error_message"])
    assert results[0] == results[1]


def test_reference_native_thermal_network_output(client, api_headers, reference, thermal_printer):
    from queue import Queue
    from socketserver import BaseRequestHandler, ThreadingTCPServer

    received = Queue()

    class Receiver(BaseRequestHandler):
        def handle(self):
            chunks = []
            while chunk := self.request.recv(4096):
                chunks.append(chunk)
            received.put(b"".join(chunks))

    with ThreadingTCPServer(("127.0.0.1", 0), Receiver) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        thermal_printer.setting("TPRINTER_IS_NETWORK_PRINTER", True)
        thermal_printer.setting("TPRINTER_IP", "127.0.0.1")
        thermal_printer.setting("TPRINTER_PORT", server.server_address[1])
        client.headers.update(api_headers)
        outputs = []
        name = uuid4().hex
        try:
            for app in (reference, client):
                shopping = thermal_list(app, name)
                response = app.get(
                    "/api/print/shoppinglist/thermal",
                    params={"list": shopping, "printHeader": "false"},
                )
                assert response.status_code == 200 and response.json() == {"result": "OK"}
                outputs.append(received.get(timeout=5))
            assert outputs[0] == outputs[1]
            assert b"Receipt product" in outputs[0]
        finally:
            server.shutdown()
            thread.join(timeout=5)


@pytest.mark.parametrize(
    "locale,language",
    [("", "de-DE,de;q=0.9,en;q=0.1"), ("fr", "de"), ("unknown", "xx,en;q=0.5"), ("", "unknown")],
)
def test_reference_native_system_locale_and_localized_copy(
    client, api_headers, reference, locale, language
):
    client.headers.update(api_headers)
    results = []
    name = "Locale recipe " + uuid4().hex
    for app in (reference, client):
        before = app.get("/api/user/settings").json().get("locale")
        try:
            assert app.put("/api/user/settings/locale", json={"value": locale}).status_code == 204
            headers = {"Accept-Language": language}
            response = app.get("/api/system/localization-strings", headers=headers)
            assert response.status_code == 200, response.text
            assert response.headers["cache-control"] == "max-age=2592000"
            recipe = create(app, "recipes", {"name": name})
            copied = app.post(f"/api/recipes/{recipe}/copy", headers=headers)
            assert copied.status_code == 200, copied.text
            copied_name = app.get(
                "/api/objects/recipes/" + copied.json()["created_object_id"]
            ).json()["name"]
            config = app.get("/api/system/config", headers=headers).json()
            results.append((config["LOCALE"], response.json(), copied_name))
        finally:
            if before is None:
                app.delete("/api/user/settings/locale")
            else:
                app.put("/api/user/settings/locale", json={"value": before})
    assert results[0] == results[1]


def test_reference_native_system_config_exposes_current_printer_and_url_settings(
    client, api_headers, reference, thermal_printer
):
    client.headers.update(api_headers)
    values = {
        "TPRINTER_PRINT_NOTES": False,
        "TPRINTER_PRINT_QUANTITY_NAME": False,
        "STOCK_BARCODE_LOOKUP_PLUGIN": "DemoBarcodeLookupPlugin",
        "LABEL_PRINTER_HOOK_JSON": False,
        "BASE_URL": "/native-prefix/",
    }
    for name, value in values.items():
        thermal_printer.setting(name, value)
    # Grocy refreshes its view cache once after the base URL changes.
    reference.get("/api/system/config")
    client.options("/api/system/config")
    for app in (reference, client):
        response = app.get("/api/system/config")
        assert response.status_code == 200, response.text
        assert {key: response.json()[key] for key in values} == values
        specification = app.get("/api/openapi/specification")
        assert specification.status_code == 200, specification.text
        assert specification.json()["servers"][0]["url"] == "/native-prefix/api"
        assert "/native-prefix/manageapikeys" in specification.json()["info"]["description"]
        link = app.get("/api/calendar/ical/sharing-link")
        assert link.status_code == 200, link.text
        assert link.json()["url"].startswith("/native-prefix/api/calendar/ical?secret=")


@pytest.mark.parametrize(
    "method,path,origin",
    [
        ("HEAD", "/api/system/info", "https://example.invalid"),
        ("HEAD", "/api/missing-route", "https://example.invalid"),
        ("OPTIONS", "/api/system/info", "https://example.invalid"),
        ("OPTIONS", "/api/missing-route", "http://localhost:5173"),
        ("OPTIONS", "/api/", "https://example.invalid"),
        ("GET", "/api/missing-route", "http://localhost:5173"),
        ("PATCH", "/api/system/info", "https://example.invalid"),
        ("POST", "/api/system/info", "https://example.invalid"),
        ("PATCH", "/api/objects/products", "https://example.invalid"),
        ("PATCH", "/api/objects/products/1", "https://example.invalid"),
        ("PATCH", "/api/files/productpictures/aW1hZ2U=", "https://example.invalid"),
        ("GET", "/api/system/info", "http://localhost:5173"),
    ],
)
def test_reference_native_http_methods_and_cors(
    client, api_headers, reference, method, path, origin
):
    client.headers.update(api_headers)
    results = []
    headers = {"Origin": origin}
    if method == "OPTIONS":
        headers.update(
            {
                "GROCY-API-KEY": "",
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers": "GROCY-API-KEY, X-Custom",
            }
        )
    for app in (reference, client):
        response = app.request(method, path, headers=headers)
        assert response.headers["access-control-allow-origin"] == "*"
        assert response.headers["access-control-allow-methods"] == "GET, POST, PUT, DELETE, OPTIONS"
        assert response.headers["access-control-allow-headers"] == "*"
        if method in {"HEAD", "OPTIONS"}:
            assert response.content == b""
        message = None
        if response.status_code >= 400 and method != "HEAD":
            error = response.json()
            assert set(error) == {"error_message", "error_details"}
            assert set(error["error_details"]) == {"stack_trace", "file", "line"}
            message = error["error_message"]
        results.append((response.status_code, response.headers["content-type"], message))
    assert results[0] == results[1]


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_reference_native_unauthorized_response_is_empty(client, api_headers, reference, method):
    client.headers.update(api_headers)
    results = []
    for app in (reference, client):
        response = app.request(method, "/api/system/info", headers={"GROCY-API-KEY": "invalid"})
        assert response.status_code == 401
        assert response.content == b""
        assert response.headers["access-control-allow-origin"] == "*"
        results.append(response.headers["content-type"])
    assert results[0] == results[1]


def test_reference_native_openapi_specification_includes_user_entities(
    client, api_headers, reference
):
    client.headers.update(api_headers)
    name = "native-spec-" + uuid4().hex
    results = []
    for app in (reference, client):
        create(app, "userentities", {"name": name, "caption": "Native specification"})
        response = app.get("/api/openapi/specification")
        assert response.status_code == 200, response.text
        spec = response.json()
        assert spec["info"]["version"] == "4.5.0"
        enum = spec["components"]["schemas"]["ExposedEntity_IncludingUserEntities"]["enum"]
        assert "userentity-" + name in enum
        for schema in spec["components"]["schemas"].values():
            if isinstance(schema, dict) and isinstance(schema.get("enum"), list):
                schema["enum"] = [
                    value
                    for value in schema["enum"]
                    if not isinstance(value, str)
                    or not value.startswith("userentity-")
                    or value == "userentity-" + name
                ]
        base = str(app.base_url).rstrip("/")
        assert spec["servers"][0]["url"] == base + "/api"
        results.append(json.loads(json.dumps(spec).replace(base, "BASE")))
    assert results[0] == results[1]
