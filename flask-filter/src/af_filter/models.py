"""Domain models and request validation.

``Route`` describes *what* is searched (origin, destination, cabin, passengers);
it is hashable so it can key the response cache. ``ValidationError`` carries a
user-facing message and maps to HTTP 400 in the web layer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, TypedDict

LOCATION_TYPES = frozenset({"CITY", "AIRPORT"})
CABINS = frozenset({"ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"})
VIEWS = frozenset({"MONTH", "DAY"})
MAX_PASSENGERS = 9

_IATA_RE = re.compile(r"^[A-Z]{3}$")
_CARRIER_RE = re.compile(r"^[A-Z0-9]{2}$")
_INTERVAL_SEP = "/"


class ValidationError(ValueError):
    """Raised when client input is invalid. The message is safe to show to users."""


@dataclass(frozen=True)
class Route:
    """A searchable route: endpoints, cabin and passenger count."""

    origin: str
    origin_type: str
    destination: str
    destination_type: str
    cabin: str = "ECONOMY"
    passengers: int = 1

    @classmethod
    def from_payload(cls, data: dict[str, Any]) -> Route:
        """Validate a JSON payload and build a ``Route``.

        Raises:
            ValidationError: on any malformed field.
        """
        return cls(
            origin=parse_iata(data.get("origin"), "origin"),
            origin_type=parse_choice(data.get("originType", "CITY"), LOCATION_TYPES, "originType"),
            destination=parse_iata(data.get("destination"), "destination"),
            destination_type=parse_choice(
                data.get("destinationType", "AIRPORT"), LOCATION_TYPES, "destinationType"
            ),
            cabin=parse_choice(data.get("cabin", "ECONOMY"), CABINS, "cabin"),
            passengers=parse_passengers(data.get("passengers", 1)),
        )


# Functional syntax because "from" is a Python keyword but is the JSON key.
Segment = TypedDict(
    "Segment",
    {
        "from": str,
        "fromCity": str,
        "to": str,
        "toCity": str,
        "dep": str,
        "arr": str,
        "carrier": str,
        "flightNo": str,
    },
)


class Flight(TypedDict):
    """One bookable itinerary with its cheapest fare."""

    carriers: list[str]
    segments: list[Segment]
    stops: int
    price: float | None
    currency: str


class CalendarDay(TypedDict):
    """One cell of the lowest-fare calendar."""

    date: str
    price: float | None
    roundTrip: float | None
    currency: str
    noFlight: bool
    isPromo: bool


def parse_iata(value: Any, field: str) -> str:
    """Normalise and validate a 3-letter IATA city/airport code."""
    code = str(value or "").strip().upper()
    if not _IATA_RE.match(code):
        raise ValidationError(f"{field}: code IATA à 3 lettres attendu")
    return code


def parse_choice(value: Any, allowed: frozenset[str], field: str) -> str:
    """Validate that ``value`` is one of ``allowed`` (case-insensitive)."""
    choice = str(value or "").strip().upper()
    if choice not in allowed:
        raise ValidationError(f"{field}: valeur invalide ({', '.join(sorted(allowed))})")
    return choice


def parse_passengers(value: Any) -> int:
    """Validate the adult passenger count (1–9)."""
    try:
        count = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError("passengers: entier attendu") from exc
    if not 1 <= count <= MAX_PASSENGERS:
        raise ValidationError(f"passengers: entre 1 et {MAX_PASSENGERS}")
    return count


def parse_date(value: Any, field: str) -> str:
    """Validate an ISO ``YYYY-MM-DD`` date and return it unchanged."""
    raw = str(value or "").strip()
    try:
        date.fromisoformat(raw)
    except ValueError as exc:
        raise ValidationError(f"{field}: date AAAA-MM-JJ attendue") from exc
    return raw


def parse_interval(value: Any, field: str) -> str:
    """Validate a ``YYYY-MM-DD/YYYY-MM-DD`` interval with start <= end."""
    parts = str(value or "").split(_INTERVAL_SEP)
    if len(parts) != 2:
        raise ValidationError(f"{field}: intervalle AAAA-MM-JJ/AAAA-MM-JJ attendu")
    start, end = (parse_date(p, field) for p in parts)
    if start > end:
        raise ValidationError(f"{field}: début postérieur à la fin")
    return f"{start}{_INTERVAL_SEP}{end}"


def parse_dates(value: Any, max_count: int) -> list[str]:
    """Validate a non-empty, de-duplicated list of ISO dates (order preserved)."""
    if not isinstance(value, list) or not value:
        raise ValidationError("dates: liste non vide attendue")
    unique = list(dict.fromkeys(parse_date(v, "dates") for v in value))
    if len(unique) > max_count:
        raise ValidationError(f"dates: {max_count} dates maximum par requête")
    return unique


def parse_carriers(value: Any, default: tuple[str, ...]) -> frozenset[str]:
    """Validate a list of 2-char airline codes; ``None`` yields ``default``."""
    if value is None:
        return frozenset(default)
    if not isinstance(value, list):
        raise ValidationError("airlineFilter: liste attendue")
    codes = {str(v).strip().upper() for v in value}
    if any(not _CARRIER_RE.match(c) for c in codes):
        raise ValidationError("airlineFilter: codes compagnie à 2 caractères attendus")
    return frozenset(codes)
