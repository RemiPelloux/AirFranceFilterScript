"""JavaScript executed inside the Air France page via ``page.evaluate``.

Running ``fetch`` from the page makes every call same-origin with the live Akamai
cookies (``_abck``, ``bm_sz``…), which a plain Python HTTP client cannot reproduce.
Configuration is passed as an argument rather than string-formatted into the source.
"""

from __future__ import annotations

from typing import Any

GQL_HEADERS: dict[str, str] = {
    "content-type": "application/json",
    "accept": "application/json, text/plain, */*",
    "afkl-travel-country": "FR",
    "afkl-travel-host": "AF",
    "afkl-travel-language": "fr",
    "afkl-travel-market": "FR",
    "country": "FR",
    "language": "fr",
}

# Bounded-concurrency pool: ``limit`` workers pull from a shared index, each item
# retried ``retries`` times with linear backoff. Non-2xx answers count as failures
# so that an Akamai block page is retried instead of being parsed as data.
FETCH_POOL_JS = """async ({payloads, cfg}) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const one = async (payload) => {
    let last = "unknown error";
    for (let a = 0; a < cfg.retries; a++) {
      try {
        const r = await fetch(cfg.url, {
          method: "POST", credentials: "include",
          headers: cfg.headers, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return {ok: true, status: r.status, data: await r.json()};
      } catch (e) {
        last = (e && e.message) || String(e);
        if (a < cfg.retries - 1) await sleep(cfg.backoff * (a + 1));
      }
    }
    return {ok: false, error: last};
  };
  const results = new Array(payloads.length);
  let next = 0;
  const worker = async () => {
    while (next < payloads.length) {
      const i = next++;
      if (i > 0) await sleep(cfg.delay);
      results[i] = await one(payloads[i]);
    }
  };
  const n = Math.min(cfg.limit, payloads.length);
  await Promise.all(Array.from({length: n}, worker));
  return results;
}"""


def pool_config(
    url: str, retries: int, backoff_ms: int, limit: int, delay_ms: int
) -> dict[str, Any]:
    """Serialisable config object consumed by ``FETCH_POOL_JS``."""
    return {
        "url": url,
        "headers": GQL_HEADERS,
        "retries": max(1, retries),
        "backoff": max(0, backoff_ms),
        "limit": max(1, limit),
        "delay": max(0, delay_ms),
    }
