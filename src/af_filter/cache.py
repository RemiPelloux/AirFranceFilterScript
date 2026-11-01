"""Small thread-safe TTL + LRU cache.

Fares move slowly compared to how often the UI re-asks for the same data (e.g.
opening a day after a filtered month scan), so caching parsed responses for a
few minutes removes most redundant round-trips through the rate-limited browser.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Hashable
from typing import Generic, TypeVar

V = TypeVar("V")


class TTLCache(Generic[V]):
    """Least-recently-used cache whose entries expire after ``ttl_s`` seconds."""

    def __init__(
        self, ttl_s: float, max_entries: int, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._ttl = ttl_s
        self._max = max(1, max_entries)
        self._clock = clock
        self._data: OrderedDict[Hashable, tuple[float, V]] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    @property
    def enabled(self) -> bool:
        """False when ``ttl_s`` <= 0 (caching disabled)."""
        return self._ttl > 0

    def get(self, key: Hashable) -> V | None:
        """Return a fresh value or ``None``."""
        if not self.enabled:
            return None
        with self._lock:
            entry = self._data.get(key)
            if entry is None or entry[0] <= self._clock():
                self._data.pop(key, None)
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return entry[1]

    def set(self, key: Hashable, value: V) -> None:
        """Store ``value``, evicting the least recently used entry if full."""
        if not self.enabled:
            return
        with self._lock:
            self._data[key] = (self._clock() + self._ttl, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def clear(self) -> None:
        """Drop every entry."""
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)
