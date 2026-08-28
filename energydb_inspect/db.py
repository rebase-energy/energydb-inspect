"""Database access for the read-only inspector backend.

Two modes, selected by ``INSPECT_SESSION_AWARE``:

* **Single-tenant (default, unchanged behavior)** -- loads ``TIMEDB_PG_DSN`` /
  ``TIMEDB_CH_URL`` from a ``.env``/the environment at import time and opens ONE
  global pool/client for the process, exactly as before. This is what
  ``energydb-inspect`` (the CLI) and local dev still use.
* **Session-aware (``INSPECT_SESSION_AWARE=1``, the playground deployment)** --
  no global DSNs are read; instead each request supplies ``X-EDB-Session`` /
  ``X-EDB-Token`` headers (checked by the ASGI middleware in ``app.py``), which
  are resolved -- via a small LRU+TTL cache, or a call to the playground
  broker's internal ``/internal/inspect-creds`` endpoint on a cache miss -- to a
  *per-session* Postgres pool + ClickHouse client. ``pg_query``/``ch_query``
  transparently use whichever is active for the current request via a
  ``contextvars.ContextVar``, so ``queries.py`` (the only other caller) needs
  no changes at all.

Reads are allowed against any host in both modes; only writes (the ``/reset``
endpoint) are refused against a non-local host, and the playground deployment
never sets ``INSPECT_WRITABLE`` in the first place (session-aware mode is
always read-only regardless).
"""

from __future__ import annotations

import contextlib
import contextvars
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, LiteralString, cast
from urllib.parse import unquote, urlparse

import clickhouse_connect
import httpx
from dotenv import load_dotenv
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)

# A down/unreachable database is handled gracefully (queries return empty), so quiet
# the per-attempt connection-failure warnings from the pool / ClickHouse client; the
# dashboard just shows empty instead of flooding the console.
logging.getLogger("psycopg.pool").setLevel(logging.ERROR)
logging.getLogger("clickhouse_connect").setLevel(logging.ERROR)

# Load TIMEDB_PG_DSN / TIMEDB_CH_URL from a .env in the CURRENT working directory
# only (no upward walk to a parent directory's .env) -- see .env.example. An
# installed package resolving a stray .env from some ancestor of the cwd is a
# worse failure mode than requiring the file to sit right where you run the
# command from.
_ENV_PATH = Path.cwd() / ".env"
if _ENV_PATH.is_file():
    load_dotenv(_ENV_PATH)
    logger.info("loading environment from %s", _ENV_PATH)
    ENV_FILE: str | None = str(_ENV_PATH)
else:
    logger.info("no .env in %s", Path.cwd())
    ENV_FILE = None

PG_DSN = os.environ.get("TIMEDB_PG_DSN", "")
CH_URL = os.environ.get("TIMEDB_CH_URL", "")

_SCHEMA_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
#: Schema holding the energydb tables, matching the energydb library's own
#: ENERGYDB_SCHEMA (default "public"). Interpolated directly into SQL in
#: queries.py, so it is validated as a plain identifier here.
SCHEMA = os.environ.get("ENERGYDB_SCHEMA", "public") or "public"
if not _SCHEMA_RE.match(SCHEMA):
    raise RuntimeError(
        f"invalid ENERGYDB_SCHEMA {SCHEMA!r}: must match {_SCHEMA_RE.pattern}"
    )

_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", None, ""}

# Writes (the /reset endpoint) are OFF by default, so pointing the inspector at a
# real energydb is safe: it can only read. The writable demo / local dev opt in
# with INSPECT_WRITABLE=1 (against throwaway databases).
WRITABLE = os.environ.get("INSPECT_WRITABLE", "").lower() in ("1", "true", "yes", "on")

# Reads are allowed against any host. The only thing that can mutate a database
# is the Reset button (INSPECT_WRITABLE), so enabling writes is refused against a
# non-local host, which prevents an accidental Reset of a remote/prod DB. Set
# INSPECT_TRUSTED_DB=1 to write to a remote host deliberately.
_TRUST_DB = os.environ.get("INSPECT_TRUSTED_DB", "").lower() in (
    "1",
    "true",
    "yes",
    "on",
)


def _assert_write_target_local(url: str, label: str) -> None:
    if _TRUST_DB:
        return
    host = urlparse(url).hostname
    if host not in _LOCAL_HOSTS:
        raise RuntimeError(
            f"{label} points at non-local host {host!r} while INSPECT_WRITABLE is on. "
            f"Writes (the Reset button) are blocked against remote databases. Unset "
            f"INSPECT_WRITABLE to inspect read-only, or set INSPECT_TRUSTED_DB=1 to override."
        )


if WRITABLE:
    _assert_write_target_local(PG_DSN, "TIMEDB_PG_DSN")
    _assert_write_target_local(CH_URL, "TIMEDB_CH_URL")


def _target(url: str) -> str | None:
    """``host/dbname`` for a DSN/URL, for display -- never user or password."""
    if not url:
        return None
    u = urlparse(url)
    return f"{u.hostname or '?'}/{(u.path or '').lstrip('/') or '?'}"


_PG_TARGET = _target(PG_DSN)
_CH_TARGET = _target(CH_URL)

# Last error from a pg_query()/ch_query() call, single-tenant mode only (session
# mode keeps the equivalent on SessionCreds). Recorded by queries.py's
# _safe_pg/_safe_ch, cleared on the next successful call; never the raw
# DSN/password, just ``type(exc).__name__: exc``.
_pg_error: str | None = None
_ch_error: str | None = None

pg_pool: ConnectionPool | None = None
_ch_client = None
# clickhouse-connect's client is not safe for concurrent queries; the dashboard
# fires several CH reads at once, so serialize access with a lock. (Session-aware
# mode gets its own lock per session -- see SessionCreds -- so concurrent
# visitors never contend on this one.)
_ch_lock = threading.Lock()


def open_pools() -> None:
    """Open the Postgres pool + ClickHouse client (called from the app lifespan).

    Only relevant to single-tenant mode -- session-aware mode opens pools lazily,
    per session, from ``resolve_session``. Never blocks startup on an unreachable
    DB: with no DSN nothing is opened, and query-time errors are swallowed
    (queries.py), so the dashboard just starts empty until a database is reachable.
    """
    global pg_pool, _ch_client
    if SESSION_AWARE:
        return
    if PG_DSN:
        # min_size=0 + no wait(): connect on demand, don't block startup or hammer
        # a down DB; timeout keeps a query against a down DB from hanging long.
        pg_pool = ConnectionPool(
            PG_DSN, min_size=0, max_size=4, timeout=3, kwargs={"autocommit": True}
        )
    if CH_URL:
        u = urlparse(CH_URL)
        try:
            _ch_client = clickhouse_connect.get_client(
                host=u.hostname or "localhost",
                port=u.port or 8123,
                username=unquote(u.username or "default"),
                password=unquote(u.password or ""),
                database=(u.path or "/default").lstrip("/") or "default",
            )
        except Exception:
            _ch_client = None


def close_pools() -> None:
    global pg_pool, _ch_client
    if pg_pool is not None:
        pg_pool.close()
        pg_pool = None
    if _ch_client is not None:
        _ch_client.close()
        _ch_client = None
    if SESSION_AWARE:
        _close_all_cached_sessions()


# ---------------------------------------------------------------------------
# Session-aware mode: per-request credential resolution via contextvar
# ---------------------------------------------------------------------------

#: Set by the deploy container (docker-compose's ``inspector`` service). When
#: false, none of the below is used -- pg_query/ch_query fall through to the
#: single-tenant globals above, exactly as before this feature existed.
SESSION_AWARE = os.environ.get("INSPECT_SESSION_AWARE", "").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

#: Where the playground broker's *internal* API lives (compose network only --
#: never proxied by the public Caddy edge, see caddy/Caddyfile's /internal/*
#: 404 and B5 in PLAN_PHASE5.md).
BROKER_INTERNAL_URL = os.environ.get("BROKER_INTERNAL_URL", "http://broker:8000")

#: Shared secret sent as X-Internal-Secret on the /internal/inspect-creds call;
#: must match the broker's own INTERNAL_SHARED_SECRET.
INTERNAL_SHARED_SECRET = os.environ.get("INTERNAL_SHARED_SECRET", "")

SESSION_CACHE_MAX = 50
SESSION_IDLE_SECONDS = 300.0  # 5 minutes


class SessionAuthError(Exception):
    """Raised when the broker rejects a (session_id, token) pair (expired/unknown)."""


class SessionCreds:
    """One session's resolved, read-only Postgres pool + ClickHouse client.

    Each session gets its OWN ``ch_lock``: clickhouse-connect's client isn't
    safe for concurrent queries on the same client instance, but different
    sessions' clients are entirely independent objects, so serializing them
    behind one global lock (as single-tenant mode does) would need to become a
    per-session lock the moment there's more than one tenant -- this is that.
    """

    __slots__ = (
        "pg_pool",
        "ch_client",
        "ch_lock",
        "resolved_at",
        "last_used",
        "pg_target",
        "ch_target",
        "pg_error",
        "ch_error",
    )

    def __init__(
        self,
        pg_pool: ConnectionPool,
        ch_client,
        pg_target: str | None = None,
        ch_target: str | None = None,
    ) -> None:
        self.pg_pool = pg_pool
        self.ch_client = ch_client
        self.ch_lock = threading.Lock()
        now = time.monotonic()
        self.resolved_at = now
        self.last_used = now
        self.pg_target = pg_target
        self.ch_target = ch_target
        self.pg_error: str | None = None
        self.ch_error: str | None = None


# The active session's creds for the duration of one request (set by the ASGI
# middleware in app.py, reset in a finally). None in single-tenant mode, or
# between requests.
_current: contextvars.ContextVar[SessionCreds | None] = contextvars.ContextVar(
    "_current", default=None
)

_session_cache: "OrderedDict[str, SessionCreds]" = OrderedDict()
_session_cache_lock = threading.Lock()


def _close_creds(creds: SessionCreds) -> None:
    with contextlib.suppress(Exception):
        creds.pg_pool.close()
    with contextlib.suppress(Exception):
        creds.ch_client.close()


def _evict_locked() -> None:
    """Cap size (LRU) + drop idle entries. Caller must hold _session_cache_lock."""
    while len(_session_cache) > SESSION_CACHE_MAX:
        _, victim = _session_cache.popitem(last=False)
        _close_creds(victim)
    now = time.monotonic()
    stale_keys = [
        k for k, v in _session_cache.items() if now - v.last_used > SESSION_IDLE_SECONDS
    ]
    for k in stale_keys:
        victim = _session_cache.pop(k)
        _close_creds(victim)


def _close_all_cached_sessions() -> None:
    with _session_cache_lock:
        victims = list(_session_cache.values())
        _session_cache.clear()
    for v in victims:
        _close_creds(v)


def _build_creds(pg_dsn: str, ch_url: str) -> SessionCreds:
    pg_pool_ = ConnectionPool(
        pg_dsn, min_size=0, max_size=2, timeout=3, kwargs={"autocommit": True}
    )
    u = urlparse(ch_url)
    ch_client_ = clickhouse_connect.get_client(
        host=u.hostname or "localhost",
        port=u.port or 8123,
        username=unquote(u.username or "default"),
        password=unquote(u.password or ""),
        database=(u.path or "/default").lstrip("/") or "default",
    )
    return SessionCreds(pg_pool_, ch_client_, _target(pg_dsn), _target(ch_url))


async def resolve_session(session_id: str, token: str) -> SessionCreds:
    """Return the (cached, or freshly broker-resolved) creds for one session.

    Raises ``SessionAuthError`` for an unknown/expired/mismatched session (the
    middleware turns that into a 401); any other failure (broker unreachable,
    unexpected status) raises a plain exception (the middleware turns that
    into a 502 -- credential resolution is unavailable, not "invalid session").
    """
    cache_key = f"{session_id}:{token}"
    now = time.monotonic()
    with _session_cache_lock:
        entry = _session_cache.get(cache_key)
        if entry is not None:
            entry.last_used = now
            _session_cache.move_to_end(cache_key)
            return entry

    try:
        async with httpx.AsyncClient(timeout=3.0) as http_client:
            resp = await http_client.post(
                f"{BROKER_INTERNAL_URL}/internal/inspect-creds",
                json={"session_id": session_id, "token": token},
                headers={"X-Internal-Secret": INTERNAL_SHARED_SECRET},
            )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"broker unreachable: {exc}") from exc

    if resp.status_code == 401:
        raise SessionAuthError("invalid or expired session")
    if resp.status_code != 200:
        raise RuntimeError(f"broker returned {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    creds = _build_creds(data["pg_dsn"], data["ch_url"])

    with _session_cache_lock:
        # A concurrent request may have resolved (and cached) the same session
        # while we were awaiting the broker -- keep the winner's pools, close
        # the ones we just built so we don't leak connections.
        existing = _session_cache.get(cache_key)
        if existing is not None:
            existing.last_used = now
            _session_cache.move_to_end(cache_key)
            to_close, creds = creds, existing
        else:
            _session_cache[cache_key] = creds
            to_close = None
            _evict_locked()
    if to_close is not None:
        _close_creds(to_close)
    return creds


def pg_query(sql: str, params: tuple | None = None) -> tuple[list[str], list[tuple]]:
    creds = _current.get()
    pool = creds.pg_pool if creds is not None else pg_pool
    if pool is None:
        raise RuntimeError("Postgres pool is not open")
    with pool.connection() as conn, conn.cursor() as cur:
        # sql is assembled from static query text plus db.SCHEMA, which is
        # regex-validated as a plain identifier at import time (never raw user
        # input), so the cast is sound: it's a str, not a LiteralString, only
        # because f-strings can't express "this variable is a fixed identifier".
        cur.execute(cast(LiteralString, sql), params)
        cols = [d.name for d in cur.description] if cur.description else []
        rows = cur.fetchall()
    return cols, rows


def ch_query(sql: str, parameters: dict | None = None) -> tuple[list[str], list[list]]:
    creds = _current.get()
    client = creds.ch_client if creds is not None else _ch_client
    lock = creds.ch_lock if creds is not None else _ch_lock
    if client is None:
        raise RuntimeError("ClickHouse client is not open")
    with lock:
        res = client.query(sql, parameters=parameters or {})
    return list(res.column_names), [list(r) for r in res.result_rows]


_MAX_ERROR_LEN = 300


def _format_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"[:_MAX_ERROR_LEN]


def record_pg_error(exc: Exception) -> None:
    """Record the last pg_query() failure, session-aware. Never the DSN/password:
    just the exception type + message, and only from a genuine query failure."""
    global _pg_error
    creds = _current.get()
    if creds is not None:
        creds.pg_error = _format_error(exc)
    else:
        _pg_error = _format_error(exc)


def clear_pg_error() -> None:
    global _pg_error
    creds = _current.get()
    if creds is not None:
        creds.pg_error = None
    else:
        _pg_error = None


def record_ch_error(exc: Exception) -> None:
    global _ch_error
    creds = _current.get()
    if creds is not None:
        creds.ch_error = _format_error(exc)
    else:
        _ch_error = _format_error(exc)


def clear_ch_error() -> None:
    global _ch_error
    creds = _current.get()
    if creds is not None:
        creds.ch_error = None
    else:
        _ch_error = None


def get_connection_status() -> dict[str, Any]:
    """Snapshot of the active (session, or single-tenant) connection: targets,
    last errors, and (single-tenant only) the resolved .env path."""
    creds = _current.get()
    if creds is not None:
        return {
            "pg_target": creds.pg_target,
            "ch_target": creds.ch_target,
            "pg_error": creds.pg_error,
            "ch_error": creds.ch_error,
            "env_file": None,
        }
    return {
        "pg_target": _PG_TARGET,
        "ch_target": _CH_TARGET,
        "pg_error": _pg_error,
        "ch_error": _ch_error,
        "env_file": ENV_FILE,
    }
