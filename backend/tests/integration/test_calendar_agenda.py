from grocy.core.config import get_settings


def test_calendar_agenda_and_export_keep_stock_names_and_meal_section_times(client, api_headers):
    client.headers.update(api_headers)
    assert (
        client.post(
            "/api/stock/products/1/add",
            json={"amount": 1, "best_before_date": "2027-01-02"},
        ).status_code
        == 200
    )
    section = client.post(
        "/api/objects/meal_plan_sections",
        json={"name": "Evening", "time_info": "18:15"},
    ).json()["created_object_id"]
    recipe = client.post("/api/objects/recipes", json={"name": "Vegetable stew"}).json()[
        "created_object_id"
    ]
    for kind, values in (
        ("recipe", {"recipe_id": recipe, "recipe_servings": 1}),
        ("product", {"product_id": 1, "product_amount": 1, "product_qu_id": 1}),
        ("note", {"note": "Family meal"}),
    ):
        assert (
            client.post(
                "/api/objects/meal_plan",
                json={"day": "2027-01-04", "section_id": section, "type": kind, **values},
            ).status_code
            == 200
        )
    response = client.get("/api/v2/calendar/events")
    assert response.status_code == 200, response.text
    events = {event["title"]: event for event in response.json()}
    expected = {
        "Product due: Greek Yogurt": ("2027-01-02", "date"),
        "Meal plan recipe: Evening: Vegetable stew": ("2027-01-04 18:15:00", "datetime"),
        "Meal plan product: Evening: Greek Yogurt": ("2027-01-04 18:15:00", "datetime"),
        "Meal plan note: Evening: Family meal": ("2027-01-04 18:15:00", "datetime"),
    }
    exported = client.get("/api/calendar/ical").text.replace("\r\n ", "")
    for title, (start, date_format) in expected.items():
        assert events[title]["start"] == start
        assert events[title]["date_format"] == date_format
        assert "SUMMARY:" + title in exported


def test_calendar_agenda_follows_task_feature_setting(client, api_headers, monkeypatch):
    client.headers.update(api_headers)
    client.post("/api/objects/tasks", json={"name": "Calendar task", "due_date": "2027-01-03"})
    title = "Task due: Calendar task"
    assert title in {event["title"] for event in client.get("/api/v2/calendar/events").json()}
    monkeypatch.setattr(get_settings(), "feature_flag_tasks", False)
    assert title not in {event["title"] for event in client.get("/api/v2/calendar/events").json()}
    assert title not in client.get("/api/calendar/ical").text
