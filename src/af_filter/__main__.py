"""Entry point: ``python -m af_filter`` (or the ``af-filter`` console script).

Starts the stealth browser, waits for the Air France session, then serves the
web UI. Configuration comes from environment variables (see ``.env.example``).
"""

from __future__ import annotations

import logging
import sys

from af_filter import __version__
from af_filter.browser import BrowserSession
from af_filter.config import Settings
from af_filter.web import create_app

log = logging.getLogger("af_filter")


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )
    # Werkzeug logs every request at INFO; keep the console focused on the scraper.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)


def main() -> int:
    """Run the application; returns a process exit code."""
    settings = Settings.from_env()
    _configure_logging(settings.log_level)
    log.info("AF Filter v%s — démarrage du navigateur…", __version__)

    session = BrowserSession(settings)
    session.start()
    if not session.wait_ready(settings.startup_timeout_s):
        reason = session.startup_error or f"délai de {settings.startup_timeout_s}s dépassé"
        log.error("Le navigateur n'a pas démarré : %s", reason)
        session.stop()
        return 1

    app = create_app(settings, session)
    log.info("Interface : http://%s:%d", settings.host, settings.port)
    try:
        app.run(host=settings.host, port=settings.port, debug=False, threaded=True)
    except KeyboardInterrupt:
        pass
    finally:
        session.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
