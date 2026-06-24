"""Database access for the read-only inspector backend.

Loads connection settings from a ``.env`` in the working directory (or the environment),
allows read-only access to any host (only writes are refused against a non-local host),
and exposes thin Postgres + ClickHouse query helpers. energydb itself is only imported by
the ``/reset`` endpoint; everything else is plain SQL.
"""

from __future__ import annotations

import logging
import os
import threading
from urllib.parse import unquote, urlparse

import clickhouse_connect
from dotenv import load_dotenv
from psycopg_pool import ConnectionPool

# A down/unreachable database is handled gracefully (queries return empty), so quiet
# the per-attempt connection-failure warnings from the pool / ClickHouse client; the
# dashboard just shows empty instead of flooding the console.
logging.getLogger("psycopg.pool").setLevel(logging.ERROR)
logging.getLogger("clickhouse_connect").setLevel(logging.ERROR)

# Load TIMEDB_PG_DSN / TIMEDB_CH_URL from a .env in the working directory (or the
# already-exported environment); see .env.example.
load_dotenv()

PG_DSN = os.environ.get("TIMEDB_PG_DSN", "")
CH_URL = os.environ.get("TIMEDB_CH_URL", "")

_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", None, ""}

# Writes (the /reset endpoint) are OFF by default, so pointing the inspector at a
# real energydb is safe: it can only read. The writable demo / local dev opt in
# with INSPECT_WRITABLE=1 (against throwaway databases).
WRITABLE = os.environ.get("INSPECT_WRITABLE", "").lower() in ("1", "true", "yes", "on")

# Reads are allowed against any host. The only thing that can mutate a database is
# the Reset button (INSPECT_WRITABLE), so we refuse only to enable writes against a
# non-local host: that prevents an accidental Reset of a remote/prod DB. Set
# INSPECT_TRUSTED_DB=1 if you really do want to write to a remote host.
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

pg_pool: ConnectionPool | None = None
_ch_client = None
# clickhouse-connect's client is not safe for concurrent queries; the dashboard
# fires several CH reads at once, so serialize access with a lock.
_ch_lock = threading.Lock()


def open_pools() -> None:
    """Open the Postgres pool + ClickHouse client (called from the app lifespan).

    Never blocks startup on an unreachable DB: with no DSN nothing is opened, and
    query-time errors are swallowed (queries.py), so the dashboard just starts
    empty until a database is reachable.
    """
    global pg_pool, _ch_client
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


def pg_query(sql: str, params: tuple | None = None) -> tuple[list[str], list[tuple]]:
    if pg_pool is None:
        raise RuntimeError("Postgres pool is not open")
    with pg_pool.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description] if cur.description else []
        rows = cur.fetchall()
    return cols, rows


def ch_query(sql: str, parameters: dict | None = None) -> tuple[list[str], list[list]]:
    if _ch_client is None:
        raise RuntimeError("ClickHouse client is not open")
    with _ch_lock:
        res = _ch_client.query(sql, parameters=parameters or {})
    return list(res.column_names), [list(r) for r in res.result_rows]
