"""Runtime configuration loaded from environment variables.

Every knob has a sane default so ``python -m af_filter`` works out of the box.
See ``.env.example`` for the full list of variables.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

AF_BASE_URL = "https://wwws.airfrance.fr"

# Akamai blocks POST /gql/v1 when the URL names ``SearchResultAvailableOffersQuery``.
# The AF backend reads the real operation from the JSON body, so every call goes
# through this innocuous URL whatever the body says.
GQL_PATH = "/gql/v1?bookingFlow=LEISURE&operationName=SharedSearchLowestFareOffersForSearchQuery"

LOWEST_FARE_HASH = "3129e42881c15d2897fe99c294497f2cfa8f2133109dd93ed6cad720633b0243"
AVAILABLE_OFFERS_HASH = "6c2316d35d088fdd0d346203ec93cec7eea953752ff2fc18a759f9f2ba7b690a"

DEFAULT_AIRLINE_FILTER: tuple[str, ...] = ("AF", "A5")


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """Immutable application settings."""

    host: str = "127.0.0.1"
    port: int = 5555
    headless: bool = False
    browser_channel: str = "chrome"
    startup_timeout_s: int = 45
    keepalive_s: int = 480
    max_retries: int = 3
    retry_backoff_ms: int = 800
    batch_concurrency: int = 3
    batch_item_delay_ms: int = 350
    max_batch_dates: int = 31
    cache_ttl_s: int = 600
    cache_max_entries: int = 512
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> Settings:
        """Build settings from ``AFF_*`` environment variables (``PORT`` also honoured)."""
        d = cls()
        return cls(
            host=os.environ.get("AFF_HOST", d.host),
            port=_env_int("PORT", _env_int("AFF_PORT", d.port)),
            headless=_env_bool("AFF_HEADLESS", d.headless),
            browser_channel=os.environ.get("AFF_BROWSER_CHANNEL", d.browser_channel),
            startup_timeout_s=_env_int("AFF_STARTUP_TIMEOUT", d.startup_timeout_s),
            keepalive_s=_env_int("AFF_KEEPALIVE", d.keepalive_s),
            max_retries=_env_int("AFF_MAX_RETRIES", d.max_retries),
            retry_backoff_ms=_env_int("AFF_RETRY_BACKOFF_MS", d.retry_backoff_ms),
            batch_concurrency=_env_int("AFF_BATCH_CONCURRENCY", d.batch_concurrency),
            batch_item_delay_ms=_env_int("AFF_BATCH_ITEM_DELAY_MS", d.batch_item_delay_ms),
            max_batch_dates=_env_int("AFF_MAX_BATCH_DATES", d.max_batch_dates),
            cache_ttl_s=_env_int("AFF_CACHE_TTL", d.cache_ttl_s),
            cache_max_entries=_env_int("AFF_CACHE_MAX", d.cache_max_entries),
            log_level=os.environ.get("AFF_LOG_LEVEL", d.log_level).upper(),
        )
