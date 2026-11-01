"""HTTP API end-to-end against a fake browser session."""

from __future__ import annotations

from flask.testing import FlaskClient

from af_filter.browser import BrowserUnavailableError
from tests.conftest import FakeSession, lowest_fare_reply, make_itinerary, offers_reply

ROUTE = {"origin": "PAR", "originType": "CITY", "destination": "NCE", "destinationType": "AIRPORT"}


def test_index_serves_frontend(client: FlaskClient) -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"/static/js/main.js" in resp.data
    assert resp.headers["X-Content-Type-Options"] == "nosniff"


def test_static_assets_are_served(client: FlaskClient) -> None:
    for path in ("/static/css/app.css", "/static/js/main.js", "/static/js/calendar.js"):
        assert client.get(path).status_code == 200, path


def test_status(client: FlaskClient) -> None:
    data = client.get("/api/status").get_json()
    assert data["ready"] is True
    assert data["sessionAgeSec"] == 12
    assert data["cache"] == {"entries": 0, "hits": 0, "misses": 0}


def test_calendar_adds_booking_urls_and_uses_dynamic_defaults(
    client: FlaskClient, session: FakeSession
) -> None:
    session.replies["calendar"] = {"ok": True, "data": lowest_fare_reply(("2027-01-01", 99.0))}
    resp = client.post("/api/calendar", json=ROUTE)
    assert resp.status_code == 200
    day = resp.get_json()["days"][0]
    assert day["price"] == 99.0
    assert "PAR:C:NCE:A:2027-01-01" in day["bookingUrl"]


def test_flights_filters_and_sorts(client: FlaskClient, session: FakeSession) -> None:
    session.replies["2027-01-10"] = {
        "ok": True,
        "data": offers_reply(
            make_itinerary(["AF"], 150.0),
            make_itinerary(["MU"], 40.0),
            make_itinerary(["A5"], 90.0),
        ),
    }
    body = {**ROUTE, "departureDate": "2027-01-10", "airlineFilter": ["AF", "A5"]}
    data = client.post("/api/flights", json=body).get_json()
    assert [f["price"] for f in data["flights"]] == [90.0, 150.0]
    assert data["cheapestPrice"] == 90.0


def test_filtered_calendar_compares_af_with_all_carriers(
    client: FlaskClient, session: FakeSession
) -> None:
    session.replies["2027-01-10"] = {
        "ok": True,
        "data": offers_reply(make_itinerary(["AF"], 150.0), make_itinerary(["MU"], 40.0)),
    }
    session.replies["2027-01-11"] = {"ok": False, "error": "HTTP 403"}
    body = {**ROUTE, "dates": ["2027-01-10", "2027-01-11", "2027-01-12"]}
    days = client.post("/api/calendar-filtered", json=body).get_json()["days"]

    assert days[0]["afPrice"] == 150.0
    assert days[0]["allPrice"] == 40.0
    assert days[0]["afFlights"] == 1
    assert days[1]["error"] == "HTTP 403"
    assert days[1]["bookingUrl"] is None
    assert days[2]["noFlight"] is True
    assert days[2]["error"] is None


def test_scan_results_are_cached_and_reused_by_flights(
    client: FlaskClient, session: FakeSession
) -> None:
    session.replies["2027-01-10"] = {"ok": True, "data": offers_reply(make_itinerary(["AF"], 1.0))}
    client.post("/api/calendar-filtered", json={**ROUTE, "dates": ["2027-01-10"]})
    client.post("/api/calendar-filtered", json={**ROUTE, "dates": ["2027-01-10"]})
    client.post("/api/flights", json={**ROUTE, "departureDate": "2027-01-10"})
    assert len(session.calls) == 1


def test_failed_dates_are_not_cached(client: FlaskClient, session: FakeSession) -> None:
    session.replies["2027-01-10"] = {"ok": False, "error": "boom"}
    client.post("/api/calendar-filtered", json={**ROUTE, "dates": ["2027-01-10"]})
    client.post("/api/calendar-filtered", json={**ROUTE, "dates": ["2027-01-10"]})
    assert len(session.calls) == 2


def test_validation_errors_return_400(client: FlaskClient) -> None:
    assert client.post("/api/flights", json={**ROUTE, "origin": "X"}).status_code == 400
    assert client.post("/api/calendar-filtered", json={**ROUTE, "dates": []}).status_code == 400
    assert client.post("/api/calendar", data="nope").status_code == 400


def test_upstream_failure_returns_502(client: FlaskClient, session: FakeSession) -> None:
    session.replies["2027-01-10"] = {"ok": False, "error": "HTTP 403"}
    resp = client.post("/api/flights", json={**ROUTE, "departureDate": "2027-01-10"})
    assert resp.status_code == 502
    assert resp.get_json()["error"] == "HTTP 403"


def test_browser_unavailable_returns_503(client: FlaskClient, session: FakeSession) -> None:
    def unavailable(_body: dict) -> dict:
        raise BrowserUnavailableError("Navigateur non prêt")

    session.fetch = unavailable  # type: ignore[method-assign]
    resp = client.post("/api/flights", json={**ROUTE, "departureDate": "2027-01-10"})
    assert resp.status_code == 503


def test_unknown_route_returns_json_404(client: FlaskClient) -> None:
    resp = client.get("/api/nope")
    assert resp.status_code == 404
    assert "error" in resp.get_json()


def test_foreign_host_header_is_rejected(client: FlaskClient) -> None:
    """DNS-rebinding guard: only loopback Host headers reach the API."""
    assert client.get("/api/status", headers={"Host": "evil.example"}).status_code == 400
    assert client.get("/api/status", headers={"Host": "127.0.0.1:5555"}).status_code == 200
