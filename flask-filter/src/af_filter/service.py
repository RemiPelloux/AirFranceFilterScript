"""Use-cases exposed by the API: calendar, per-day flights, and carrier-filtered scan.

The service only depends on a ``Transport`` (anything with ``fetch``/``fetch_many``),
so it can be exercised in tests with a fake instead of a real browser.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Hashable
from typing import Any, Protocol

from af_filter.browser.session import GqlResult
from af_filter.cache import TTLCache
from af_filter.gql.parsers import (
    UpstreamError,
    cheapest,
    filter_by_carriers,
    parse_lowest_fares,
    parse_offers,
    sort_by_price,
)
from af_filter.gql.payloads import booking_url, build_lowest_fare_body, build_offers_body
from af_filter.models import Flight, Route

log = logging.getLogger(__name__)


class Transport(Protocol):
    """Executes GraphQL payloads against airfrance.fr."""

    def fetch(self, body: dict[str, Any]) -> GqlResult:
        """Run one payload."""
        ...

    def fetch_many(self, bodies: list[dict[str, Any]]) -> list[GqlResult]:
        """Run several payloads, results in input order."""
        ...


def _unwrap(result: GqlResult) -> dict[str, Any]:
    if not result.get("ok"):
        raise UpstreamError(result.get("error") or "Échec de la requête Air France")
    return result.get("data") or {}


class FlightService:
    """Caches and orchestrates Air France queries for the web layer."""

    def __init__(self, transport: Transport, cache: TTLCache[Any]) -> None:
        self._transport = transport
        self._cache = cache

    @property
    def cache(self) -> TTLCache[Any]:
        """The response cache (exposed for status reporting)."""
        return self._cache

    def calendar(
        self, route: Route, view: str, dep_date: str, interval: str, return_trip: bool
    ) -> list[dict[str, Any]]:
        """Cheapest fare per month or day (all carriers), each with a booking link.

        Raises:
            UpstreamError: when Air France rejects the call.
        """
        key: Hashable = ("calendar", route, view, dep_date, interval, return_trip)
        days = self._cache.get(key)
        if days is None:
            body = build_lowest_fare_body(route, dep_date, interval, view, return_trip)
            days = parse_lowest_fares(_unwrap(self._transport.fetch(body)))
            self._cache.set(key, days)
        return [{**d, "bookingUrl": booking_url(route, d["date"])} for d in days]

    def flights(self, route: Route, dep_date: str, carriers: frozenset[str]) -> dict[str, Any]:
        """All itineraries for one date, optionally restricted to ``carriers``.

        Raises:
            UpstreamError: when Air France rejects the call.
        """
        flights = self._offers(route, dep_date)
        if carriers:
            flights = filter_by_carriers(flights, carriers)
        flights = sort_by_price(flights)
        return {
            "date": dep_date,
            "totalFlights": len(flights),
            "cheapestPrice": cheapest(flights),
            "flights": flights,
            "bookingUrl": booking_url(route, dep_date),
        }

    def scan(
        self, route: Route, dates: list[str], carriers: frozenset[str]
    ) -> list[dict[str, Any]]:
        """Cheapest fare per date for ``carriers`` vs. all carriers.

        Dates already cached are served instantly; the rest go out as one batch.
        Per-date failures are reported inline (``error``) rather than raised.
        """
        cached = {d: self._cache.get(("offers", route, d)) for d in dates}
        missing = [d for d, v in cached.items() if v is None]
        started = time.monotonic()
        errors = self._fetch_offers(route, missing, cached)
        log.info(
            "Scan %s→%s : %d dates (%d en cache), %d échecs, %.1fs",
            route.origin,
            route.destination,
            len(dates),
            len(dates) - len(missing),
            len(errors),
            time.monotonic() - started,
        )
        return [self._scan_day(route, d, cached.get(d), errors.get(d), carriers) for d in dates]

    # -- helpers -------------------------------------------------------------

    def _offers(self, route: Route, dep_date: str) -> list[Flight]:
        key: Hashable = ("offers", route, dep_date)
        flights = self._cache.get(key)
        if flights is None:
            body = build_offers_body(route, dep_date)
            flights = parse_offers(_unwrap(self._transport.fetch(body)))
            self._cache.set(key, flights)
        return flights

    def _fetch_offers(
        self, route: Route, dates: list[str], into: dict[str, list[Flight] | None]
    ) -> dict[str, str]:
        """Fetch ``dates`` in one batch, fill ``into`` and the cache; return errors."""
        if not dates:
            return {}
        raw = self._transport.fetch_many([build_offers_body(route, d) for d in dates])
        errors: dict[str, str] = {}
        for dep, result in zip(dates, raw, strict=True):
            try:
                flights = parse_offers(_unwrap(result))
            except UpstreamError as exc:
                errors[dep] = str(exc)
                continue
            into[dep] = flights
            self._cache.set(("offers", route, dep), flights)
        return errors

    @staticmethod
    def _scan_day(
        route: Route,
        dep: str,
        flights: list[Flight] | None,
        error: str | None,
        carriers: frozenset[str],
    ) -> dict[str, Any]:
        all_flights = flights or []
        matching = filter_by_carriers(all_flights, carriers)
        return {
            "date": dep,
            "afPrice": cheapest(matching),
            "allPrice": cheapest(all_flights),
            "afFlights": len(matching),
            "allFlights": len(all_flights),
            "noFlight": not all_flights,
            "bookingUrl": None if error else booking_url(route, dep),
            "error": error,
        }
