"""Response parsing: itineraries, carriers, prices and error payloads."""

from __future__ import annotations

import pytest

from af_filter.gql.parsers import (
    UpstreamError,
    cheapest,
    filter_by_carriers,
    parse_lowest_fares,
    parse_offers,
    sort_by_price,
)
from tests.conftest import lowest_fare_reply, make_itinerary, offers_reply


def test_parse_offers_extracts_segments_carriers_and_lowest_price() -> None:
    flights = parse_offers(offers_reply(make_itinerary(["AF", "A5"], 89.0)))
    assert len(flights) == 1
    flight = flights[0]
    assert flight["carriers"] == ["A5", "AF"]
    assert flight["price"] == 89.0
    assert flight["stops"] == 1
    assert flight["segments"][0] == {
        "from": "CDG",
        "fromCity": "Paris",
        "to": "NCE",
        "toCity": "Nice",
        "dep": "2027-01-10T07:15",
        "arr": "2027-01-10T08:45",
        "carrier": "AF",
        "flightNo": "AF1234",
    }


def test_parse_offers_handles_unpriced_itinerary() -> None:
    assert parse_offers(offers_reply(make_itinerary(["AF"], None)))[0]["price"] is None


def test_parse_offers_data_source_error_means_no_flights() -> None:
    reply = {"data": {"availableOffers": {"__typename": "DataSourceError"}}}
    assert parse_offers(reply) == []


def test_parse_offers_raises_on_graphql_errors() -> None:
    with pytest.raises(UpstreamError, match="PersistedQueryNotFound"):
        parse_offers({"errors": [{"message": "PersistedQueryNotFound"}]})


def test_parse_lowest_fares_maps_fields_and_skips_dateless_rows() -> None:
    reply = lowest_fare_reply(("2027-01-01", 120.0), ("2027-02-01", None))
    reply["data"]["lowestFareOffers"]["lowestOffers"].append({"displayPrice": 1})
    days = parse_lowest_fares(reply)
    assert [d["date"] for d in days] == ["2027-01-01", "2027-02-01"]
    assert days[0]["roundTrip"] == 240.0
    assert days[1]["noFlight"] is True


def test_filter_by_carriers_requires_every_carrier_allowed() -> None:
    flights = parse_offers(
        offers_reply(
            make_itinerary(["AF"], 100.0),
            make_itinerary(["AF", "MU"], 60.0),
            make_itinerary(["A5"], 80.0),
        )
    )
    kept = filter_by_carriers(flights, frozenset({"AF", "A5"}))
    assert [f["price"] for f in kept] == [100.0, 80.0]


def test_sort_and_cheapest_put_unpriced_last() -> None:
    flights = parse_offers(
        offers_reply(
            make_itinerary(["AF"], None), make_itinerary(["AF"], 90.0), make_itinerary(["AF"], 70.0)
        )
    )
    assert [f["price"] for f in sort_by_price(flights)] == [70.0, 90.0, None]
    assert cheapest(flights) == 70.0
    assert cheapest([]) is None


def test_parse_lowest_fares_raises_on_typed_error_union() -> None:
    reply = {"data": {"lowestFareOffers": {"__typename": "DataSourceError", "message": "x"}}}
    with pytest.raises(UpstreamError, match="DataSourceError: x"):
        parse_lowest_fares(reply)
