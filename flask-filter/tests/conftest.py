"""Shared fixtures: canned Air France replies and a fake browser transport."""

from __future__ import annotations

from typing import Any

import pytest
from flask import Flask
from flask.testing import FlaskClient

from af_filter.config import Settings
from af_filter.models import Route
from af_filter.web import create_app


def make_itinerary(carriers: list[str], price: float | None, flight_no: str = "1234") -> dict:
    """Minimal ``offerItineraries`` entry with one segment per carrier."""
    segments = [
        {
            "origin": {"code": "CDG", "name": "Paris"},
            "destination": {"code": "NCE", "name": "Nice"},
            "departureDateTime": "2027-01-10T07:15:00",
            "arrivalDateTime": "2027-01-10T08:45:00",
            "operatingCarrier": {"code": c},
            "marketingCarrier": {"code": c, "flightNumber": flight_no},
        }
        for c in carriers
    ]
    products = (
        []
        if price is None
        else [
            {"connections": [{"price": {"amount": price, "currencyCode": "EUR"}}]},
            {"connections": [{"price": {"amount": price + 50, "currencyCode": "EUR"}}]},
        ]
    )
    return {
        "connections": [
            {"operatingCarriers": [{"code": c} for c in carriers], "segments": segments}
        ],
        "upsellCabinProducts": products,
    }


def offers_reply(*itineraries: dict) -> dict:
    """Wrap itineraries into a ``SearchResultAvailableOffersQuery`` response."""
    return {"data": {"availableOffers": {"offerItineraries": list(itineraries)}}}


def lowest_fare_reply(*days: tuple[str, float | None]) -> dict:
    """``SharedSearchLowestFareOffersForSearchQuery`` response from (date, price) pairs."""
    return {
        "data": {
            "lowestFareOffers": {
                "lowestOffers": [
                    {
                        "flightDate": d,
                        "displayPrice": p,
                        "displayPriceItinerary": None if p is None else p * 2,
                        "currency": "EUR",
                        "noFlight": p is None,
                        "isPromoFare": False,
                    }
                    for d, p in days
                ]
            }
        }
    }


class FakeSession:
    """Stands in for ``BrowserSession``; replies come from a date → payload map."""

    def __init__(self) -> None:
        self.ready = True
        self.session_age_s = 12.0
        self.replies: dict[str, dict[str, Any]] = {}
        self.default_reply: dict[str, Any] = {"ok": True, "data": offers_reply()}
        self.calls: list[dict[str, Any]] = []

    def _reply_for(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(body)
        variables = body["variables"]
        if "availableOfferRequestBody" in variables:
            conn = variables["availableOfferRequestBody"]["requestedConnections"][0]
            return self.replies.get(conn["departureDate"], self.default_reply)
        return self.replies.get("calendar", self.default_reply)

    def fetch(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._reply_for(body)

    def fetch_many(self, bodies: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [self._reply_for(b) for b in bodies]


@pytest.fixture
def route() -> Route:
    return Route("PAR", "CITY", "NCE", "AIRPORT", "ECONOMY", 1)


@pytest.fixture
def session() -> FakeSession:
    return FakeSession()


@pytest.fixture
def app(session: FakeSession) -> Flask:
    return create_app(Settings(cache_ttl_s=300), session)


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    return app.test_client()
