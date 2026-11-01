"""Pure functions turning raw Air France GraphQL responses into compact models.

Nothing here does I/O, so every function is unit-testable with JSON fixtures.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from af_filter.models import CalendarDay, Flight, Segment

DEFAULT_CURRENCY = "EUR"
_ISO_MINUTES = 16  # "YYYY-MM-DDTHH:MM"


class UpstreamError(RuntimeError):
    """Air France answered, but with an error payload instead of data."""


def _dig(obj: Any, *keys: str) -> Any:
    """Safe nested ``get`` that tolerates ``None`` at any level."""
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def _graphql_errors(payload: dict[str, Any]) -> str | None:
    errors = payload.get("errors")
    if not errors:
        return None
    messages = [str(e.get("message", e)) for e in errors if isinstance(e, dict)]
    return "; ".join(messages) or "Erreur GraphQL"


def parse_lowest_fares(payload: dict[str, Any]) -> list[CalendarDay]:
    """Extract calendar cells from a ``SharedSearchLowestFareOffersForSearchQuery`` reply.

    Raises:
        UpstreamError: when the reply carries GraphQL errors and no data.
    """
    container = _dig(payload, "data", "lowestFareOffers")
    typename = str(_dig(container, "__typename") or "")
    if typename.endswith("Error"):
        # Typed GraphQL error union: an empty calendar here would look like "no flights".
        raise UpstreamError(f"{typename}: {_dig(container, 'message') or 'réponse vide'}")
    offers = _dig(container, "lowestOffers")
    if offers is None and (err := _graphql_errors(payload)):
        raise UpstreamError(err)
    return [
        {
            "date": o["flightDate"],
            "price": o.get("displayPrice"),
            "roundTrip": o.get("displayPriceItinerary"),
            "currency": o.get("currency") or DEFAULT_CURRENCY,
            "noFlight": bool(o.get("noFlight", False)),
            "isPromo": bool(o.get("isPromoFare", False)),
        }
        for o in offers or []
        if o.get("flightDate")
    ]


def _parse_segment(seg: dict[str, Any]) -> Segment:
    marketing = seg.get("marketingCarrier") or {}
    mkt_code = marketing.get("code", "")
    number = marketing.get("flightNumber", "")
    return {
        "from": _dig(seg, "origin", "code") or "",
        "fromCity": _dig(seg, "origin", "name") or "",
        "to": _dig(seg, "destination", "code") or "",
        "toCity": _dig(seg, "destination", "name") or "",
        "dep": (seg.get("departureDateTime") or "")[:_ISO_MINUTES],
        "arr": (seg.get("arrivalDateTime") or "")[:_ISO_MINUTES],
        "carrier": _dig(seg, "operatingCarrier", "code") or mkt_code,
        "flightNo": f"{mkt_code}{number}" if number else "",
    }


def _cheapest_price(itin: dict[str, Any]) -> tuple[float | None, str]:
    best: float | None = None
    currency = DEFAULT_CURRENCY
    for product in itin.get("upsellCabinProducts") or []:
        for conn in product.get("connections") or []:
            amount = _dig(conn, "price", "amount")
            if amount is not None and (best is None or amount < best):
                best = float(amount)
                currency = _dig(conn, "price", "currencyCode") or DEFAULT_CURRENCY
    return best, currency


def _parse_itinerary(itin: dict[str, Any]) -> Flight:
    carriers: set[str] = set()
    segments: list[Segment] = []
    for conn in itin.get("connections") or []:
        carriers.update(c.get("code", "") for c in conn.get("operatingCarriers") or [])
        segments.extend(_parse_segment(s) for s in conn.get("segments") or [])
    # Some replies omit connection-level carriers: fall back to segment carriers.
    carriers.update(s["carrier"] for s in segments)
    carriers.discard("")
    price, currency = _cheapest_price(itin)
    return {
        "carriers": sorted(carriers),
        "segments": segments,
        "stops": max(0, len(segments) - 1),
        "price": price,
        "currency": currency,
    }


def parse_offers(payload: dict[str, Any]) -> list[Flight]:
    """Extract itineraries from a ``SearchResultAvailableOffersQuery`` reply.

    A ``DataSourceError`` (no availability for that date) yields an empty list.

    Raises:
        UpstreamError: when the reply carries GraphQL errors and no data.
    """
    offers = _dig(payload, "data", "availableOffers")
    if offers is None:
        if err := _graphql_errors(payload):
            raise UpstreamError(err)
        return []
    if offers.get("__typename") == "DataSourceError":
        return []
    return [_parse_itinerary(i) for i in offers.get("offerItineraries") or []]


def filter_by_carriers(flights: Iterable[Flight], allowed: frozenset[str]) -> list[Flight]:
    """Keep itineraries whose every operating carrier is in ``allowed``."""
    return [f for f in flights if f["carriers"] and set(f["carriers"]) <= allowed]


def sort_by_price(flights: Iterable[Flight]) -> list[Flight]:
    """Cheapest first; unpriced itineraries last."""
    return sorted(flights, key=lambda f: (f["price"] is None, f["price"] or 0.0))


def cheapest(flights: Iterable[Flight]) -> float | None:
    """Lowest known price among ``flights``, or ``None``."""
    return min((f["price"] for f in flights if f["price"] is not None), default=None)
