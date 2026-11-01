"""Stealth Chrome session running on a dedicated thread.

Playwright's sync API objects are bound to the thread that created them, so a
single worker thread owns the browser and every other thread (Flask handlers)
submits jobs through a queue and blocks on a per-job reply queue.

Session hygiene:
    * the page is reloaded after ``keepalive_s`` seconds without any job, which
      renews the Akamai cookies before they go stale;
    * a failed first call triggers a reload before the rest of a batch is sent;
    * items that still fail after the in-page retries get one more pass after a reload.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from collections.abc import Callable
from typing import Any, TypedDict

from af_filter.browser.scripts import FETCH_POOL_JS, pool_config
from af_filter.config import AF_BASE_URL, GQL_PATH, Settings

log = logging.getLogger(__name__)

LANDING_PATH = "/search/advanced"
NAV_TIMEOUT_MS = 20_000
RELOAD_TIMEOUT_MS = 15_000
SETTLE_S = 3.0
BASE_JOB_TIMEOUT_S = 90
PER_ITEM_TIMEOUT_S = 12
_STOP = object()


class GqlResult(TypedDict, total=False):
    """Outcome of one in-page fetch."""

    ok: bool
    status: int
    data: dict[str, Any]
    error: str


class BrowserUnavailableError(RuntimeError):
    """The browser thread is not ready (still starting, crashed or stopped)."""


class BrowserTimeoutError(TimeoutError):
    """A job did not complete within its deadline."""


_Job = tuple[Callable[..., Any], tuple[Any, ...], "queue.Queue[tuple[bool, Any]]"]


class BrowserSession:
    """Owns the patchright Chrome page and serialises GraphQL calls through it."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jobs: queue.Queue[_Job | object] = queue.Queue()
        self._ready = threading.Event()
        self._done = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_refresh = 0.0
        self.startup_error: BaseException | None = None
        self._pool_cfg = pool_config(
            url=GQL_PATH,
            retries=settings.max_retries,
            backoff_ms=settings.retry_backoff_ms,
            limit=settings.batch_concurrency,
            delay_ms=settings.batch_item_delay_ms,
        )

    # -- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        """Launch the browser thread (non-blocking)."""
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="af-browser", daemon=True)
        self._thread.start()

    def wait_ready(self, timeout: float) -> bool:
        """Block until the page is loaded, startup failed, or ``timeout`` elapsed."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._ready.wait(0.25) or self._done.is_set():
                break
        return self._ready.is_set()

    def stop(self) -> None:
        """Ask the browser thread to close Chrome and exit."""
        self._jobs.put(_STOP)
        if self._thread is not None:
            self._thread.join(timeout=10)

    @property
    def ready(self) -> bool:
        """True once the page is loaded and the thread is serving jobs."""
        return self._ready.is_set() and not self._done.is_set()

    @property
    def session_age_s(self) -> float:
        """Seconds since the page was last (re)loaded; -1 before first load."""
        return time.monotonic() - self._last_refresh if self._last_refresh else -1.0

    # -- public API (any thread) ---------------------------------------------

    def fetch(self, body: dict[str, Any]) -> GqlResult:
        """Run one GraphQL call; reloads the page once if it fails."""
        return self._submit(self._job_single, (body,), BASE_JOB_TIMEOUT_S)

    def fetch_many(self, bodies: list[dict[str, Any]]) -> list[GqlResult]:
        """Run several GraphQL calls with bounded in-page concurrency."""
        if not bodies:
            return []
        timeout = max(BASE_JOB_TIMEOUT_S, len(bodies) * PER_ITEM_TIMEOUT_S)
        return self._submit(self._job_batch, (bodies,), timeout)

    def _submit(self, fn: Callable[..., Any], args: tuple[Any, ...], timeout: float) -> Any:
        if not self.ready:
            raise BrowserUnavailableError("Navigateur non prêt")
        reply: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)
        self._jobs.put((fn, args, reply))
        try:
            ok, value = reply.get(timeout=timeout)
        except queue.Empty as exc:
            raise BrowserTimeoutError(f"Pas de réponse du navigateur en {timeout:.0f}s") from exc
        if not ok:
            raise value
        return value

    # -- browser thread ------------------------------------------------------

    def _run(self) -> None:
        # Imported lazily so tests and tooling never need patchright installed.
        from patchright.sync_api import sync_playwright

        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(
                    headless=self._settings.headless, channel=self._settings.browser_channel
                )
                try:
                    page = self._open_page(browser)
                    self._ready.set()
                    self._serve(page)
                finally:
                    browser.close()
        except Exception as exc:  # surfaced to the main thread via startup_error
            self.startup_error = exc
            log.exception("Le thread navigateur s'est arrêté")
        finally:
            self._done.set()

    def _open_page(self, browser: Any) -> Any:
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 800}, locale="fr-FR", timezone_id="Europe/Paris"
        )
        page = ctx.new_page()
        log.info("Chargement d'Air France…")
        self._navigate(
            lambda: page.goto(
                f"{AF_BASE_URL}{LANDING_PATH}",
                wait_until="domcontentloaded",
                timeout=NAV_TIMEOUT_MS,
            )
        )
        log.info("Navigateur prêt — %d cookies", len(ctx.cookies()))
        return page

    def _serve(self, page: Any) -> None:
        while True:
            try:
                job = self._jobs.get(timeout=self._settings.keepalive_s)
            except queue.Empty:
                log.info("Keepalive — %ds sans activité, rechargement", self._settings.keepalive_s)
                self._refresh(page)
                continue
            if job is _STOP:
                return
            fn, args, reply = job  # type: ignore[misc]
            try:
                reply.put((True, fn(page, *args)))
            except Exception as exc:  # noqa: BLE001 - forwarded to the waiting caller
                reply.put((False, exc))

    def _navigate(self, action: Callable[[], Any]) -> None:
        # Navigation timeouts are common on AF's heavy SPA; the cookies we need are
        # usually set long before ``domcontentloaded``, so log and carry on.
        try:
            action()
        except Exception as exc:  # noqa: BLE001 - logged; session usually still valid
            log.warning("Navigation incomplète : %s", exc)
        time.sleep(SETTLE_S)
        self._last_refresh = time.monotonic()

    def _refresh(self, page: Any) -> None:
        self._navigate(
            lambda: page.reload(wait_until="domcontentloaded", timeout=RELOAD_TIMEOUT_MS)
        )

    def _evaluate(self, page: Any, bodies: list[dict[str, Any]]) -> list[GqlResult]:
        return page.evaluate(FETCH_POOL_JS, {"payloads": bodies, "cfg": self._pool_cfg})

    def _job_single(self, page: Any, body: dict[str, Any]) -> GqlResult:
        result = self._evaluate(page, [body])[0]
        if result.get("ok"):
            return result
        log.warning("Échec fetch (%s) — rechargement", result.get("error"))
        self._refresh(page)
        return self._evaluate(page, [body])[0]

    def _job_batch(self, page: Any, bodies: list[dict[str, Any]]) -> list[GqlResult]:
        # Probe with the first item: if the session is stale, reload before
        # burning the whole batch on Akamai rejections.
        first = self._job_single(page, bodies[0])
        results = [first, *self._evaluate(page, bodies[1:])] if len(bodies) > 1 else [first]
        failed = [i for i, r in enumerate(results) if not r.get("ok")]
        if failed:
            log.warning("%d échec(s) dans le lot — rechargement puis nouvel essai", len(failed))
            self._refresh(page)
            retried = self._evaluate(page, [bodies[i] for i in failed])
            for idx, res in zip(failed, retried, strict=True):
                results[idx] = res
        return results
