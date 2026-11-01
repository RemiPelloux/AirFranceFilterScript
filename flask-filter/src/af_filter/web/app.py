"""Flask application factory.

``create_app`` wires settings, browser session and service together without
starting anything, so tests can inject a fake session.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, send_from_directory
from werkzeug.exceptions import HTTPException

from af_filter.browser.session import BrowserTimeoutError, BrowserUnavailableError
from af_filter.cache import TTLCache
from af_filter.config import Settings
from af_filter.gql.parsers import UpstreamError
from af_filter.models import ValidationError
from af_filter.service import FlightService
from af_filter.web.routes import api

log = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

_ERROR_STATUS: dict[type[Exception], int] = {
    ValidationError: 400,
    UpstreamError: 502,
    BrowserUnavailableError: 503,
    BrowserTimeoutError: 504,
}


def _json_error(message: str, status: int) -> tuple[Response, int]:
    return jsonify({"error": message}), status


def _register_error_handlers(app: Flask) -> None:
    for exc_type, status in _ERROR_STATUS.items():
        app.register_error_handler(exc_type, lambda exc, s=status: _json_error(str(exc), s))

    @app.errorhandler(HTTPException)
    def _http(exc: HTTPException) -> tuple[Response, int]:
        return _json_error(exc.description or exc.name, exc.code or 500)


def _add_security_headers(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


def create_app(settings: Settings, session: Any) -> Flask:
    """Build the Flask app around an already-constructed browser ``session``."""
    app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
    app.json.ensure_ascii = False  # type: ignore[attr-defined]
    if settings.host in LOOPBACK_HOSTS:
        # Blocks DNS-rebinding pages from driving the local API (and thus the
        # user's live Air France session) through a hostile domain name.
        app.config["TRUSTED_HOSTS"] = sorted(LOOPBACK_HOSTS)
    cache: TTLCache[Any] = TTLCache(settings.cache_ttl_s, settings.cache_max_entries)
    app.extensions["af_settings"] = settings
    app.extensions["af_session"] = session
    app.extensions["af_service"] = FlightService(session, cache)

    app.register_blueprint(api)
    _register_error_handlers(app)
    app.after_request(_add_security_headers)

    @app.get("/")
    def index() -> Response:
        return send_from_directory(STATIC_DIR, "index.html")

    return app
