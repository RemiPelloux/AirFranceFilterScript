"""JSON API blueprint.

Endpoints:
    GET  /api/status             browser/session health + cache stats
    POST /api/calendar           cheapest fare per month/day (all carriers)
    POST /api/flights            itineraries for one date (optional carrier filter)
    POST /api/calendar-filtered  cheapest fare per date for selected carriers
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from flask import Blueprint, Response, current_app, jsonify, request

from af_filter.config import DEFAULT_AIRLINE_FILTER, Settings
from af_filter.models import (
    VIEWS,
    Route,
    ValidationError,
    parse_carriers,
    parse_choice,
    parse_date,
    parse_dates,
    parse_interval,
)
from af_filter.service import FlightService

api = Blueprint("api", __name__, url_prefix="/api")
CALENDAR_SPAN_DAYS = 365


def _service() -> FlightService:
    return current_app.extensions["af_service"]


def _settings() -> Settings:
    return current_app.extensions["af_settings"]


def _payload() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValidationError("Corps JSON attendu")
    return data


def _default_interval(today: date) -> str:
    start = today.replace(day=1)
    return f"{start.isoformat()}/{(start + timedelta(days=CALENDAR_SPAN_DAYS)).isoformat()}"


def _route_echo(route: Route) -> dict[str, Any]:
    return {"origin": route.origin, "destination": route.destination, "cabin": route.cabin}


@api.get("/status")
def status() -> Response:
    """Browser readiness, session age and cache statistics."""
    session = current_app.extensions["af_session"]
    cache = _service().cache
    return jsonify(
        {
            "ready": session.ready,
            "sessionAgeSec": round(session.session_age_s),
            "keepaliveIntervalSec": _settings().keepalive_s,
            "cache": {"entries": len(cache), "hits": cache.hits, "misses": cache.misses},
        }
    )


@api.post("/calendar")
def calendar() -> Response:
    """Lowest-fare calendar for a route (``view`` = MONTH or DAY)."""
    data = _payload()
    route = Route.from_payload(data)
    today = date.today()
    view = parse_choice(data.get("view", "MONTH"), VIEWS, "view")
    dep_date = parse_date(data.get("departureDate") or today.isoformat(), "departureDate")
    interval = parse_interval(data.get("dateInterval") or _default_interval(today), "dateInterval")
    return_trip = bool(data.get("returnTrip", True))
    days = _service().calendar(route, view, dep_date, interval, return_trip)
    return jsonify({**_route_echo(route), "view": view, "days": days})


@api.post("/flights")
def flights() -> Response:
    """Every itinerary for a date, cheapest first."""
    data = _payload()
    route = Route.from_payload(data)
    dep_date = parse_date(data.get("departureDate"), "departureDate")
    carriers = parse_carriers(data.get("airlineFilter") or [], ())
    return jsonify({**_route_echo(route), **_service().flights(route, dep_date, carriers)})


@api.post("/calendar-filtered")
def calendar_filtered() -> Response:
    """Per-date cheapest fare restricted to ``airlineFilter`` (default AF + HOP)."""
    data = _payload()
    route = Route.from_payload(data)
    dates = parse_dates(data.get("dates"), _settings().max_batch_dates)
    carriers = parse_carriers(data.get("airlineFilter"), DEFAULT_AIRLINE_FILTER)
    if not carriers:
        raise ValidationError("airlineFilter: au moins une compagnie")
    days = _service().scan(route, dates, carriers)
    return jsonify({**_route_echo(route), "airlineFilter": sorted(carriers), "days": days})
