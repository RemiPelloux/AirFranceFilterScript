"""TTL/LRU cache behaviour with an injected clock."""

from __future__ import annotations

from af_filter.cache import TTLCache


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_entries_expire_after_ttl() -> None:
    clock = Clock()
    cache: TTLCache[int] = TTLCache(ttl_s=10, max_entries=4, clock=clock)
    cache.set("a", 1)
    clock.now = 9.9
    assert cache.get("a") == 1
    clock.now = 10.0
    assert cache.get("a") is None
    assert (cache.hits, cache.misses) == (1, 1)


def test_least_recently_used_is_evicted() -> None:
    cache: TTLCache[int] = TTLCache(ttl_s=60, max_entries=2)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.get("a")
    cache.set("c", 3)
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert len(cache) == 2


def test_zero_ttl_disables_cache() -> None:
    cache: TTLCache[int] = TTLCache(ttl_s=0, max_entries=2)
    cache.set("a", 1)
    assert cache.get("a") is None
    assert len(cache) == 0
