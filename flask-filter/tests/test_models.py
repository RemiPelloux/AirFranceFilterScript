"""Input validation."""

from __future__ import annotations

import pytest

from af_filter.models import (
    Route,
    ValidationError,
    parse_carriers,
    parse_dates,
    parse_interval,
)


def test_route_normalises_codes_and_defaults() -> None:
    route = Route.from_payload({"origin": " par ", "destination": "nce"})
    assert route == Route("PAR", "CITY", "NCE", "AIRPORT", "ECONOMY", 1)


@pytest.mark.parametrize(
    "payload",
    [
        {"origin": "PA", "destination": "NCE"},
        {"origin": "PAR", "destination": "N1E"},
        {"origin": "PAR", "destination": "NCE", "cabin": "LUXURY"},
        {"origin": "PAR", "destination": "NCE", "passengers": 0},
        {"origin": "PAR", "destination": "NCE", "passengers": "abc"},
        {"origin": "PAR", "destination": "NCE", "originType": "STATION"},
    ],
)
def test_route_rejects_invalid_payload(payload: dict) -> None:
    with pytest.raises(ValidationError):
        Route.from_payload(payload)


def test_parse_dates_dedupes_and_caps() -> None:
    assert parse_dates(["2027-01-02", "2027-01-01", "2027-01-02"], 5) == [
        "2027-01-02",
        "2027-01-01",
    ]
    with pytest.raises(ValidationError):
        parse_dates(["2027-01-01", "2027-01-02"], 1)
    with pytest.raises(ValidationError):
        parse_dates(["2027-13-01"], 5)
    with pytest.raises(ValidationError):
        parse_dates([], 5)


def test_parse_interval_checks_order() -> None:
    assert parse_interval("2027-01-01/2027-01-31", "i") == "2027-01-01/2027-01-31"
    with pytest.raises(ValidationError):
        parse_interval("2027-02-01/2027-01-01", "i")
    with pytest.raises(ValidationError):
        parse_interval("2027-01-01", "i")


def test_parse_carriers() -> None:
    assert parse_carriers(None, ("AF", "A5")) == frozenset({"AF", "A5"})
    assert parse_carriers(["af", "kl"], ()) == frozenset({"AF", "KL"})
    with pytest.raises(ValidationError):
        parse_carriers(["AIRFRANCE"], ())
    with pytest.raises(ValidationError):
        parse_carriers("AF", ())
