import pytest

from grocy.core.config import get_settings


def test_native_calendar_context_requires_authentication_but_not_calendar_grants(
    client, api_headers, monkeypatch
):
    response = client.get("/api/v2/calendar/context", headers=api_headers)
    assert response.status_code == 200, response.text
    assert client.get("/api/v2/calendar/context").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Calendar reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Calendar reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    monkeypatch.setattr(get_settings(), "feature_flag_calendar", False)
    response = client.get("/api/v2/calendar/context", headers={"GROCY-API-KEY": key})
    assert response.status_code == 200, response.text
    assert set(response.json()) == {"events", "user_settings", "config", "locale"}
    assert response.json()["config"]["FEATURE_FLAG_CALENDAR"] is False


@pytest.fixture
def calendar_records(client, api_headers):
    def create(entity, **values):
        response = client.post(f"/api/objects/{entity}", headers=api_headers, json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    product = create(
        "products", name="Context stock", location_id=1, qu_id_stock=1, qu_id_purchase=1
    )
    client.post(
        f"/api/stock/products/{product}/add",
        headers=api_headers,
        json={"amount": 1, "best_before_date": "2040-03-06"},
    ).raise_for_status()
    create("tasks", name="Context task", due_date="2040-03-05")
    create(
        "chores",
        name="Context chore",
        period_type="daily",
        period_interval=1,
        start_date="2040-03-05 06:07:08",
        track_date_only=1,
    )
    create(
        "chores",
        name="Context timed chore",
        period_type="daily",
        period_interval=1,
        start_date="2040-03-05 09:10:11",
        track_date_only=0,
    )
    battery = create("batteries", name="Context battery", charge_interval_days=2)
    client.post(
        f"/api/batteries/{battery}/charge",
        headers=api_headers,
        json={"tracked_time": "2040-03-03 10:11:12"},
    ).raise_for_status()
    section = create("meal_plan_sections", name="Supper", time_info="18:15")
    zero_section = create("meal_plan_sections", name="Any time", time_info="0")
    recipe = create("recipes", name="Context dinner", type="normal")
    for kind, values in [
        ("recipe", {"recipe_id": recipe, "recipe_servings": 1}),
        ("note", {"note": "Context note"}),
        ("product", {"product_id": product, "product_amount": 1, "product_qu_id": 1}),
    ]:
        create("meal_plan", type=kind, day="2040-03-05", section_id=section, **values)
    create(
        "meal_plan", type="note", day="2040-03-07", section_id=zero_section, note="Context untimed"
    )
    return {"product": product, "recipe": recipe}


def test_native_calendar_context_projects_all_families_with_actor_colors_and_prefixed_links(
    client, api_headers, monkeypatch, calendar_records
):
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Color reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Color reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    reader = {"GROCY-API-KEY": key}
    colors = {
        "products": "#102030",
        "tasks": "#203040",
        "chores": "#304050",
        "batteries": "#405060",
        "meal_plan": "#506070",
    }
    for family, color in colors.items():
        client.put(
            f"/api/user/settings/calendar_color_{family}", headers=reader, json={"value": color}
        ).raise_for_status()
    monkeypatch.setattr(get_settings(), "base_url", "https://calendar.example/pantry")
    monkeypatch.setattr(get_settings(), "base_path", "/pantry")
    monkeypatch.setattr(get_settings(), "disable_url_rewriting", True)
    response = client.get("/pantry/api/v2/calendar/context", headers=reader)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["locale"] == "en"
    assert body["config"]["LOCALE"] == "en"
    for family, color in colors.items():
        assert body["user_settings"]["calendar_color_" + family] == color
    events = {event["title"]: event for event in body["events"]}
    base = "https://calendar.example/pantry/index.php"
    recipe = calendar_records["recipe"]
    expected = {
        "Product due: Context stock": ("2040-03-06", "date", "/stockoverview", "products"),
        "Task due: Context task": ("2040-03-05", "date", "/tasks", "tasks"),
        "Chore due: Context chore": (
            "2040-03-05 23:59:59",
            "datetime",
            "/choresoverview",
            "chores",
        ),
        "Chore due: Context timed chore": (
            "2040-03-05 09:10:11",
            "datetime",
            "/choresoverview",
            "chores",
        ),
        "Battery charge cycle due: Context battery": (
            "2040-03-05 10:11:12",
            "datetime",
            "/batteriesoverview",
            "batteries",
        ),
        "Meal plan recipe: Supper: Context dinner": (
            "2040-03-05 18:15:00",
            "datetime",
            f"/recipes?recipe={recipe}#fullscreen",
            "meal_plan",
        ),
        "Meal plan note: Supper: Context note": (
            "2040-03-05 18:15:00",
            "datetime",
            "/mealplan?start=2040-03-05 18:15:00",
            "meal_plan",
        ),
        "Meal plan product: Supper: Context stock": (
            "2040-03-05 18:15:00",
            "datetime",
            "/mealplan?start=2040-03-05 18:15:00",
            "meal_plan",
        ),
        "Meal plan note: Any time: Context untimed": (
            "2040-03-07",
            "date",
            "/mealplan?start=2040-03-07",
            "meal_plan",
        ),
    }
    for title, (start, date_format, link, family) in expected.items():
        event = events[title]
        assert event["start"] == start
        assert event["date_format"] == date_format
        assert event["link"] == base + link
        assert event["color"] == colors[family]
    assert events["Chore due: Context chore"]["allDay"] is True
    assert events["Chore due: Context timed chore"]["allDay"] is False
    assert "allDay" not in events["Battery charge cycle due: Context battery"]
    assert (
        events["Meal plan recipe: Supper: Context dinner"]["description"]
        == base + "/mealplan?week=2040-03-05"
    )
    other = client.get("/pantry/api/v2/calendar/context", headers=api_headers).json()
    other_events = {event["title"]: event for event in other["events"]}
    for title, (_start, _format, _link, family) in expected.items():
        assert other_events[title]["color"] == other["user_settings"]["calendar_color_" + family]
        assert other_events[title]["color"] != events[title]["color"]
    client.put(
        "/pantry/api/user/settings/calendar_color_tasks", headers=reader, json={"value": None}
    ).raise_for_status()
    unset = client.get("/pantry/api/v2/calendar/context", headers=reader).json()
    assert unset["user_settings"]["calendar_color_tasks"] is None
    assert (
        next(event for event in unset["events"] if event["title"] == "Task due: Context task")[
            "color"
        ]
        is None
    )
    old = client.get("/pantry/api/v2/calendar/events", headers=reader).json()
    old_event = next(
        event for event in old if event["title"] == "Meal plan recipe: Supper: Context dinner"
    )
    assert "link" not in old_event and "color" not in old_event
    assert old_event["start"] == "2040-03-05 18:15:00"
    exported = client.get("/pantry/api/calendar/ical", headers=reader)
    assert exported.status_code == 200, exported.text
    unfolded = exported.text.replace("\r\n ", "")
    block = next(
        part
        for part in unfolded.split("BEGIN:VEVENT")
        if "SUMMARY:Meal plan recipe: Supper: Context dinner" in part
    )
    assert "DESCRIPTION:" + base + "/mealplan?week=2040-03-05" in block
    assert "COLOR:" not in unfolded and "URL:" not in unfolded


def test_native_calendar_context_selects_actor_locale_and_preserves_per_family_feature_rules(
    client, api_headers, monkeypatch, calendar_records
):
    client.put(
        "/api/user/settings/locale", headers=api_headers, json={"value": "de"}
    ).raise_for_status()
    response = client.get(
        "/api/v2/calendar/context", headers={**api_headers, "Accept-Language": "fr"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["locale"] == "de"
    assert body["config"]["LOCALE"] == "de"
    assert "Produkt fällig: Context stock" in {event["title"] for event in body["events"]}
    monkeypatch.setattr(get_settings(), "feature_flag_stock", False)
    stock_off = client.get("/api/v2/calendar/context", headers=api_headers).json()
    # The native stock calendar gate is the due-date flag, independently of STOCK.
    assert any(event["title"] == "Produkt fällig: Context stock" for event in stock_off["events"])
    for flag in [
        "stock_best_before_date_tracking",
        "tasks",
        "chores",
        "batteries",
        "recipes_mealplan",
    ]:
        monkeypatch.setattr(get_settings(), "feature_flag_" + flag, False)
    assert client.get("/api/v2/calendar/context", headers=api_headers).json()["events"] == []
