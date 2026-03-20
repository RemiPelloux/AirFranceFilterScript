"""
AirFrance Flight Filter — calendrier des tarifs les moins chers AF/A5.

Contournement Akamai :
    POST vers /gql/v1 bloqué si l'URL contient 'SearchResultAvailableOffersQuery'.
    Solution : utiliser un operationName anodin dans l'URL ; le serveur lit l'opération
    réelle depuis le body JSON.

Architecture :
    - patchright (fork stealth de Playwright) ouvre Chrome sur le domaine AF
    - Tous les appels GQL passent par page.evaluate(fetch) — same-origin, Akamai-safe
    - Thread dédié au navigateur ; Flask dispatch via queue
    - Deux requêtes : LowestFare (vue calendrier) + AvailableOffers (détail compagnies)
    - Le batch parallélise N appels avec concurrence limitée + retry + page refresh
"""

import os
import queue
import threading
import time
import uuid
from typing import Any

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

AF_BASE = "https://wwws.airfrance.fr"
GQL_URL = (
    "/gql/v1?bookingFlow=LEISURE"
    "&operationName=SharedSearchLowestFareOffersForSearchQuery"
)
LOWEST_FARE_HASH = (
    "3129e42881c15d2897fe99c294497f2cfa8f2133109dd93ed6cad720633b0243"
)
SEARCH_HASH = (
    "6c2316d35d088fdd0d346203ec93cec7eea953752ff2fc18a759f9f2ba7b690a"
)
MAX_RETRIES = 3
RETRY_BACKOFF_MS = 800
BATCH_CONCURRENCY = 3

_work_q: queue.Queue = queue.Queue()
_ready = threading.Event()

_GQL_HEADERS = """{
    "content-type": "application/json",
    "accept": "application/json, text/plain, */*",
    "afkl-travel-country": "FR",
    "afkl-travel-host": "AF",
    "afkl-travel-language": "fr",
    "afkl-travel-market": "FR",
    "country": "FR", "language": "fr"
}"""

JS_FETCH = """async (payload) => {
    const url = "%s";
    const hdrs = %s;
    for (let i = 0; i < %d; i++) {
        try {
            const r = await fetch(url, {
                method: "POST", credentials: "include",
                headers: hdrs, body: JSON.stringify(payload),
            });
            return {ok: true, status: r.status, data: await r.json()};
        } catch(e) {
            if (i < %d - 1) { await new Promise(r => setTimeout(r, %d * (i+1))); continue; }
            return {ok: false, error: e.message};
        }
    }
}""" % (GQL_URL, _GQL_HEADERS, MAX_RETRIES, MAX_RETRIES, RETRY_BACKOFF_MS)

JS_FETCH_BATCH = """async (payloads) => {
    const url = "%s";
    const hdrs = %s;
    const LIMIT = %d;
    const RETRIES = %d;
    const BACKOFF = %d;
    const results = new Array(payloads.length);
    let idx = 0;

    const worker = async () => {
        while (idx < payloads.length) {
            const i = idx++;
            if (i > 0) await new Promise(r => setTimeout(r, 350));
            for (let a = 0; a < RETRIES; a++) {
                try {
                    const r = await fetch(url, {
                        method: "POST", credentials: "include",
                        headers: hdrs, body: JSON.stringify(payloads[i]),
                    });
                    results[i] = {ok: true, data: await r.json()};
                    break;
                } catch(e) {
                    if (a < RETRIES - 1) {
                        await new Promise(r => setTimeout(r, BACKOFF * (a+1)));
                    } else {
                        results[i] = {ok: false, error: e.message};
                    }
                }
            }
        }
    };

    const n = Math.min(LIMIT, payloads.length);
    await Promise.all(Array.from({length: n}, () => worker()));
    return results;
}""" % (GQL_URL, _GQL_HEADERS, BATCH_CONCURRENCY, MAX_RETRIES, RETRY_BACKOFF_MS)


# ---------------------------------------------------------------------------
# Thread navigateur
# ---------------------------------------------------------------------------

def _browser_loop() -> None:
    import sys
    sys.stdout.reconfigure(line_buffering=True)
    from patchright.sync_api import sync_playwright

    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=False, channel="chrome")
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 800},
        locale="fr-FR",
        timezone_id="Europe/Paris",
    )
    page = ctx.new_page()

    print("[navigateur] Chargement d'Air France…")
    try:
        page.goto(
            f"{AF_BASE}/search/advanced",
            wait_until="domcontentloaded",
            timeout=20_000,
        )
    except Exception as exc:
        print(f"[navigateur] Avertissement : {exc}")

    time.sleep(3)
    print(f"[navigateur] Prêt — {len(ctx.cookies())} cookies")
    _ready.set()

    while True:
        task = _work_q.get()
        if task is None:
            break
        fn, args, result_q = task
        try:
            result_q.put(("ok", fn(page, *args)))
        except Exception as exc:
            result_q.put(("error", exc))

    browser.close()
    pw.stop()


def _dispatch(fn: Any, *args: Any, timeout: int = 90) -> Any:
    rq: queue.Queue = queue.Queue()
    _work_q.put((fn, args, rq))
    status, val = rq.get(timeout=timeout)
    if status == "error":
        raise val
    return val


def _refresh_page(page: Any) -> None:
    try:
        page.reload(wait_until="domcontentloaded", timeout=15_000)
    except Exception:
        pass
    time.sleep(3)


# ---------------------------------------------------------------------------
# Appels GQL — simple et batch
# ---------------------------------------------------------------------------

def _do_gql(page: Any, body: dict) -> dict:
    return page.evaluate(JS_FETCH, body)


def _do_gql_with_refresh(page: Any, body: dict) -> dict:
    result = page.evaluate(JS_FETCH, body)
    if result.get("ok"):
        return result
    print("[navigateur] Échec fetch — rechargement…")
    _refresh_page(page)
    return page.evaluate(JS_FETCH, body)


def _do_gql_batch(page: Any, bodies: list[dict]) -> list[dict]:
    """Batch parallèle avec warm-up + retry des échecs après refresh."""
    if not bodies:
        return []

    first = page.evaluate(JS_FETCH, bodies[0])
    if not first.get("ok"):
        print("[navigateur] Session expirée — rechargement avant batch…")
        _refresh_page(page)
        return page.evaluate(JS_FETCH_BATCH, bodies)

    if len(bodies) == 1:
        return [first]

    rest = page.evaluate(JS_FETCH_BATCH, bodies[1:])
    results = [first] + rest

    failed_idx = [i for i, r in enumerate(results) if not r.get("ok")]
    if failed_idx:
        print(f"[navigateur] {len(failed_idx)} échecs — refresh + retry…")
        _refresh_page(page)
        retry_bodies = [bodies[i] for i in failed_idx]
        retried = page.evaluate(JS_FETCH_BATCH, retry_bodies)
        for j, idx in enumerate(failed_idx):
            results[idx] = retried[j]

    return results


def gql_fetch(body: dict, *, refresh_on_fail: bool = False) -> dict:
    fn = _do_gql_with_refresh if refresh_on_fail else _do_gql
    return _dispatch(fn, body)


def gql_fetch_batch(bodies: list[dict]) -> list[dict]:
    timeout = max(90, len(bodies) * 12)
    return _dispatch(_do_gql_batch, bodies, timeout=timeout)


# ---------------------------------------------------------------------------
# Construction des payloads GQL
# ---------------------------------------------------------------------------

def _make_pax(count: int) -> list[dict]:
    return [{"id": i + 1, "type": "ADT"} for i in range(count)]


def build_lowest_fare_body(
    origin: str, o_type: str, dest: str, d_type: str,
    dep_date: str, date_interval: str, view_type: str,
    cabin: str, pax_count: int, return_trip: bool,
) -> dict:
    conns: list[dict[str, Any]] = [{
        "departureDate": dep_date,
        "dateInterval": date_interval,
        "origin": {"type": o_type, "code": origin},
        "destination": {"type": d_type, "code": dest},
    }]
    if return_trip:
        conns.append({
            "dateInterval": None,
            "origin": {"type": d_type, "code": dest},
            "destination": {"type": o_type, "code": origin},
        })
    return {
        "operationName": "SharedSearchLowestFareOffersForSearchQuery",
        "variables": {
            "lowestFareOffersRequest": {
                "bookingFlow": "LEISURE",
                "withUpsellCabins": True,
                "passengers": _make_pax(pax_count),
                "commercialCabins": [cabin],
                "type": view_type,
                "requestedConnections": conns,
            },
            "activeConnection": 0,
            "searchStateUuid": str(uuid.uuid4()),
            "bookingFlow": "LEISURE",
        },
        "extensions": {
            "persistedQuery": {"version": 1, "sha256Hash": LOWEST_FARE_HASH},
        },
    }


def build_search_body(
    origin: str, o_type: str, dest: str, d_type: str,
    dep_date: str, cabin: str, pax_count: int,
) -> dict:
    return {
        "operationName": "SearchResultAvailableOffersQuery",
        "variables": {
            "activeConnectionIndex": 0,
            "bookingFlow": "LEISURE",
            "availableOfferRequestBody": {
                "commercialCabins": [cabin],
                "passengers": _make_pax(pax_count),
                "requestedConnections": [{
                    "origin": {"code": origin, "type": o_type},
                    "destination": {"code": dest, "type": d_type},
                    "departureDate": dep_date,
                }],
                "bookingFlow": "LEISURE",
            },
            "searchStateUuid": str(uuid.uuid4()),
        },
        "extensions": {
            "persistedQuery": {"version": 1, "sha256Hash": SEARCH_HASH},
        },
    }


# ---------------------------------------------------------------------------
# Extraction des données de vol
# ---------------------------------------------------------------------------

def extract_flights(api_data: dict) -> list[dict]:
    offers = api_data.get("data", {}).get("availableOffers", {})
    if offers.get("__typename") == "DataSourceError":
        return []

    flights: list[dict] = []
    for itin in offers.get("offerItineraries", []):
        carriers: set[str] = set()
        segments: list[dict] = []

        for conn in itin.get("connections", []):
            for op in conn.get("operatingCarriers", []):
                carriers.add(op.get("code", ""))
            for seg in conn.get("segments", []):
                op_carrier = seg.get("operatingCarrier", {}).get("code", "")
                mkt_carrier = seg.get("marketingCarrier", {}).get("code", "")
                flight_num = seg.get("marketingCarrier", {}).get("flightNumber", "")
                segments.append({
                    "from": seg.get("origin", {}).get("code"),
                    "fromCity": seg.get("origin", {}).get("name", ""),
                    "to": seg.get("destination", {}).get("code"),
                    "toCity": seg.get("destination", {}).get("name", ""),
                    "dep": (seg.get("departureDateTime") or "")[:16],
                    "arr": (seg.get("arrivalDateTime") or "")[:16],
                    "carrier": op_carrier or mkt_carrier,
                    "flightNo": f"{mkt_carrier}{flight_num}" if flight_num else "",
                })

        best_price: float | None = None
        currency = "EUR"
        for prod in itin.get("upsellCabinProducts", []):
            for c in prod.get("connections", []):
                amt = c.get("price", {}).get("amount")
                if amt is not None and (best_price is None or amt < best_price):
                    best_price = amt
                    currency = c.get("price", {}).get("currencyCode", "EUR")

        flights.append({
            "carriers": sorted(carriers),
            "segments": segments,
            "stops": max(0, len(segments) - 1),
            "price": best_price,
            "currency": currency,
        })
    return flights


def af_booking_url(
    origin: str, o_type: str, dest: str, d_type: str,
    dep_date: str, cabin: str, pax: int,
) -> str:
    t = {"CITY": "C", "AIRPORT": "A"}
    conn = f"{origin}:{t.get(o_type, 'A')}:{dest}:{t.get(d_type, 'A')}:{dep_date}"
    return (
        f"{AF_BASE}/search/offer"
        f"?activeConnection=0&connections={conn}"
        f"&bookingFlow=LEISURE&cabinClass={cabin}&pax={pax}:ADT"
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _common_params(data: dict) -> dict:
    return {
        "origin": data.get("origin", "SHA"),
        "o_type": data.get("originType", "CITY"),
        "dest": data.get("destination", "BIO"),
        "d_type": data.get("destinationType", "AIRPORT"),
        "cabin": data.get("cabin", "ECONOMY"),
        "pax": data.get("passengers", 1),
    }


def _process_batch_results(
    dates: list[str], raw_results: list[dict],
    airline_filter: set[str], p: dict,
) -> list[dict]:
    results: list[dict] = []
    for dep, raw in zip(dates, raw_results):
        if not raw.get("ok"):
            results.append({
                "date": dep, "afPrice": None, "allPrice": None,
                "afFlights": 0, "allFlights": 0, "noFlight": True,
                "bookingUrl": None, "error": raw.get("error", "Échec"),
            })
            continue

        flights = extract_flights(raw["data"])
        filtered = [f for f in flights if set(f["carriers"]).issubset(airline_filter)]
        cheapest_af = min(
            (f["price"] for f in filtered if f["price"] is not None),
            default=None,
        )
        cheapest_all = min(
            (f["price"] for f in flights if f["price"] is not None),
            default=None,
        )
        results.append({
            "date": dep,
            "afPrice": cheapest_af,
            "allPrice": cheapest_all,
            "afFlights": len(filtered),
            "allFlights": len(flights),
            "noFlight": len(flights) == 0,
            "bookingUrl": af_booking_url(
                p["origin"], p["o_type"], p["dest"], p["d_type"],
                dep, p["cabin"], p["pax"],
            ),
        })
    return results


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index() -> Response:
    return send_from_directory("static", "index.html")


@app.route("/api/calendar", methods=["POST"])
def api_calendar() -> tuple[Response, int] | Response:
    data = request.get_json() or {}
    p = _common_params(data)
    view = data.get("view", "MONTH")
    dep_date = data.get("departureDate", "2026-06-01")
    interval = data.get("dateInterval", "2026-03-01/2027-02-28")
    return_trip = data.get("returnTrip", True)

    body = build_lowest_fare_body(
        p["origin"], p["o_type"], p["dest"], p["d_type"],
        dep_date, interval, view, p["cabin"], p["pax"], return_trip,
    )
    result = gql_fetch(body)
    if not result.get("ok"):
        return jsonify({"error": result.get("error", "Erreur inconnue")}), 502

    offers = (
        result["data"].get("data", {})
        .get("lowestFareOffers", {})
        .get("lowestOffers", [])
    )

    days = [{
        "date": o.get("flightDate"),
        "price": o.get("displayPrice"),
        "roundTrip": o.get("displayPriceItinerary"),
        "currency": o.get("currency", "EUR"),
        "noFlight": o.get("noFlight", False),
        "isPromo": o.get("isPromoFare", False),
        "bookingUrl": af_booking_url(
            p["origin"], p["o_type"], p["dest"], p["d_type"],
            o["flightDate"], p["cabin"], p["pax"],
        ) if o.get("flightDate") else None,
    } for o in offers]

    return jsonify({
        "view": view, "origin": p["origin"], "destination": p["dest"],
        "cabin": p["cabin"], "days": days,
    })


@app.route("/api/flights", methods=["POST"])
def api_flights() -> tuple[Response, int] | Response:
    data = request.get_json() or {}
    p = _common_params(data)
    dep_date = data.get("departureDate", "2026-06-10")
    airline_filter = set(data.get("airlineFilter", []))

    body = build_search_body(
        p["origin"], p["o_type"], p["dest"], p["d_type"],
        dep_date, p["cabin"], p["pax"],
    )
    result = gql_fetch(body, refresh_on_fail=True)
    if not result.get("ok"):
        return jsonify({"error": result.get("error", "Erreur inconnue")}), 502

    flights = extract_flights(result["data"])
    if airline_filter:
        flights = [f for f in flights if set(f["carriers"]).issubset(airline_filter)]
    flights.sort(key=lambda f: f["price"] if f["price"] is not None else float("inf"))

    return jsonify({
        "date": dep_date, "origin": p["origin"], "destination": p["dest"],
        "cabin": p["cabin"], "totalFlights": len(flights),
        "cheapestPrice": flights[0]["price"] if flights else None,
        "flights": flights,
        "bookingUrl": af_booking_url(
            p["origin"], p["o_type"], p["dest"], p["d_type"],
            dep_date, p["cabin"], p["pax"],
        ),
    })


@app.route("/api/calendar-filtered", methods=["POST"])
def api_calendar_filtered() -> Response:
    """Batch parallélisé avec retry des échecs via page refresh."""
    data = request.get_json() or {}
    p = _common_params(data)
    airline_filter = set(data.get("airlineFilter", ["AF", "A5"]))
    dates: list[str] = data.get("dates", [])

    bodies = [
        build_search_body(
            p["origin"], p["o_type"], p["dest"], p["d_type"],
            dep, p["cabin"], p["pax"],
        )
        for dep in dates
    ]

    print(f"[batch] {len(dates)} jours — concurrence {BATCH_CONCURRENCY}")
    t0 = time.monotonic()

    raw_results = gql_fetch_batch(bodies)
    results = _process_batch_results(dates, raw_results, airline_filter, p)

    elapsed = time.monotonic() - t0
    ok_count = sum(1 for r in results if not r["noFlight"])
    fail_count = sum(1 for r in results if r.get("error"))
    print(f"[batch] {ok_count} ok, {fail_count} échecs — {elapsed:.1f}s")

    return jsonify({
        "origin": p["origin"], "destination": p["dest"],
        "cabin": p["cabin"], "airlineFilter": sorted(airline_filter),
        "days": results, "elapsedSeconds": round(elapsed, 1),
    })


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    t = threading.Thread(target=_browser_loop, daemon=True)
    t.start()
    print("Démarrage du navigateur…")
    _ready.wait(timeout=30)
    if not _ready.is_set():
        raise SystemExit("Le navigateur n'a pas démarré en 30 s")
    port = int(os.environ.get("PORT", "5555"))
    print(f"Serveur : http://127.0.0.1:{port}")
    app.run(debug=False, port=port, threaded=True)
