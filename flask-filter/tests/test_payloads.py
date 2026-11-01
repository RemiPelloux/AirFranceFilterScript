"""GraphQL payload builders and booking deep links."""

from __future__ import annotations

from af_filter.config import AVAILABLE_OFFERS_HASH, LOWEST_FARE_HASH
from af_filter.gql.payloads import booking_url, build_lowest_fare_body, build_offers_body
from af_filter.models import Route


def test_lowest_fare_body_round_trip_adds_inbound_leg(route: Route) -> None:
    body = build_lowest_fare_body(route, "2027-01-01", "2027-01-01/2027-12-31", "MONTH", True)
    req = body["variables"]["lowestFareOffersRequest"]
    assert body["extensions"]["persistedQuery"]["sha256Hash"] == LOWEST_FARE_HASH
    assert req["type"] == "MONTH"
    assert len(req["requestedConnections"]) == 2
    inbound = req["requestedConnections"][1]
    assert inbound["origin"] == {"type": "AIRPORT", "code": "NCE"}
    assert inbound["destination"] == {"type": "CITY", "code": "PAR"}


def test_lowest_fare_body_one_way(route: Route) -> None:
    body = build_lowest_fare_body(route, "2027-01-01", "2027-01-01/2027-01-31", "DAY", False)
    assert len(body["variables"]["lowestFareOffersRequest"]["requestedConnections"]) == 1


def test_offers_body_has_one_passenger_entry_per_adult() -> None:
    route = Route("PAR", "CITY", "NCE", "AIRPORT", "BUSINESS", 3)
    body = build_offers_body(route, "2027-01-10")
    req = body["variables"]["availableOfferRequestBody"]
    assert body["extensions"]["persistedQuery"]["sha256Hash"] == AVAILABLE_OFFERS_HASH
    assert [p["id"] for p in req["passengers"]] == [1, 2, 3]
    assert req["commercialCabins"] == ["BUSINESS"]
    assert req["requestedConnections"][0]["departureDate"] == "2027-01-10"


def test_each_body_gets_a_fresh_search_state_uuid(route: Route) -> None:
    a = build_offers_body(route, "2027-01-10")["variables"]["searchStateUuid"]
    b = build_offers_body(route, "2027-01-10")["variables"]["searchStateUuid"]
    assert a != b


def test_booking_url(route: Route) -> None:
    url = booking_url(route, "2027-01-10")
    assert url.startswith("https://wwws.airfrance.fr/search/offer?")
    assert "connections=PAR:C:NCE:A:2027-01-10" in url
    assert "cabinClass=ECONOMY" in url
    assert "pax=1:ADT" in url
