"""Builders for the Air France GraphQL persisted-query payloads and booking URLs."""

from __future__ import annotations

import uuid
from typing import Any
from urllib.parse import urlencode

from af_filter.config import AF_BASE_URL, AVAILABLE_OFFERS_HASH, LOWEST_FARE_HASH
from af_filter.models import Route

BOOKING_FLOW = "LEISURE"
LOWEST_FARE_OP = "SharedSearchLowestFareOffersForSearchQuery"
AVAILABLE_OFFERS_OP = "SearchResultAvailableOffersQuery"
_URL_LOCATION_TYPE = {"CITY": "C", "AIRPORT": "A"}


def _passengers(count: int) -> list[dict[str, Any]]:
    return [{"id": i + 1, "type": "ADT"} for i in range(count)]


def _location(code: str, loc_type: str) -> dict[str, str]:
    return {"type": loc_type, "code": code}


def _persisted(sha256: str) -> dict[str, Any]:
    return {"persistedQuery": {"version": 1, "sha256Hash": sha256}}


def _connections(route: Route, dep_date: str, interval: str, return_trip: bool) -> list[dict]:
    outbound = {
        "departureDate": dep_date,
        "dateInterval": interval,
        "origin": _location(route.origin, route.origin_type),
        "destination": _location(route.destination, route.destination_type),
    }
    if not return_trip:
        return [outbound]
    inbound = {
        "dateInterval": None,
        "origin": _location(route.destination, route.destination_type),
        "destination": _location(route.origin, route.origin_type),
    }
    return [outbound, inbound]


def build_lowest_fare_body(
    route: Route, dep_date: str, interval: str, view: str, return_trip: bool
) -> dict[str, Any]:
    """Payload for the calendar query (cheapest fare per day or month, all carriers)."""
    return {
        "operationName": LOWEST_FARE_OP,
        "variables": {
            "lowestFareOffersRequest": {
                "bookingFlow": BOOKING_FLOW,
                "withUpsellCabins": True,
                "passengers": _passengers(route.passengers),
                "commercialCabins": [route.cabin],
                "type": view,
                "requestedConnections": _connections(route, dep_date, interval, return_trip),
            },
            "activeConnection": 0,
            "searchStateUuid": str(uuid.uuid4()),
            "bookingFlow": BOOKING_FLOW,
        },
        "extensions": _persisted(LOWEST_FARE_HASH),
    }


def build_offers_body(route: Route, dep_date: str) -> dict[str, Any]:
    """Payload for the per-date offers query (itineraries with operating carriers)."""
    return {
        "operationName": AVAILABLE_OFFERS_OP,
        "variables": {
            "activeConnectionIndex": 0,
            "bookingFlow": BOOKING_FLOW,
            "availableOfferRequestBody": {
                "commercialCabins": [route.cabin],
                "passengers": _passengers(route.passengers),
                "requestedConnections": [
                    {
                        "origin": _location(route.origin, route.origin_type),
                        "destination": _location(route.destination, route.destination_type),
                        "departureDate": dep_date,
                    }
                ],
                "bookingFlow": BOOKING_FLOW,
            },
            "searchStateUuid": str(uuid.uuid4()),
        },
        "extensions": _persisted(AVAILABLE_OFFERS_HASH),
    }


def booking_url(route: Route, dep_date: str) -> str:
    """Deep link to the airfrance.fr offer page for a given date."""
    conn = ":".join(
        [
            route.origin,
            _URL_LOCATION_TYPE.get(route.origin_type, "A"),
            route.destination,
            _URL_LOCATION_TYPE.get(route.destination_type, "A"),
            dep_date,
        ]
    )
    query = urlencode(
        {
            "activeConnection": 0,
            "connections": conn,
            "bookingFlow": BOOKING_FLOW,
            "cabinClass": route.cabin,
            "pax": f"{route.passengers}:ADT",
        },
        safe=":",
    )
    return f"{AF_BASE_URL}/search/offer?{query}"
