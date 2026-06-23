"""Database access for the read-only inspector backend.

Loads connection settings from a ``.env`` in the working directory (or the environment),
refuses any non-local host, and exposes thin Postgres + ClickHouse query helpers. energydb
itself is only imported by the ``/reset`` endpoint; everything else is plain SQL.
"""

from __future__ import annotations

import os
import threading
from urllib.parse import unquote, urlparse

import clickhouse_connect
from dotenv import load_dotenv
from psycopg_pool import ConnectionPool

# Load TIMEDB_PG_DSN / TIMEDB_CH_URL from a .env in the working directory (or the
# already-exported environment); see .env.example.
load_dotenv()

PG_DSN = os.environ.get("TIMEDB_PG_DSN", "")
CH_URL = os.environ.get("TIMEDB_CH_URL", "")

_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", None, ""}

# INSPECT_TRUSTED_DB=1 opts out of the local-host guard so the inspector can reach
# a database on any host. The read-only connect path sets it (the lean ``:connect``
# image bakes it in, and start.sh's connect branch exports it): you are deliberately
# pointing the tool at your own energydb and writes are off, so it is safe. The guard
# otherwise stops a casual local dev run from accidentally connecting to a remote DB.
_TRUST_DB = os.environ.get("INSPECT_TRUSTED_DB", "").lower() not in (
    "",
    "0",
    "false",
    "no",
)


def _assert_local(url: str, label: str) -> None:
    if _TRUST_DB:
        return
    host = urlparse(url).hostname
    if host not in _LOCAL_HOSTS:
        raise RuntimeError(
            f"{label} points at host {host!r}, which is not local. This tool only connects to the local dev database."
        )


_assert_local(PG_DSN, "TIMEDB_PG_DSN")
_assert_local(CH_URL, "TIMEDB_CH_URL")

pg_pool: ConnectionPool | None = None
_ch_client = None
# clickhouse-connect's client is not safe for concurrent queries; the dashboard
# fires several CH reads at once, so serialize access with a lock.
_ch_lock = threading.Lock()


def open_pools() -> None:
    """Open the Postgres pool and ClickHouse client (called from the app lifespan)."""
    global pg_pool, _ch_client
    pg_pool = ConnectionPool(
        PG_DSN, min_size=1, max_size=4, kwargs={"autocommit": True}
    )
    pg_pool.wait()
    u = urlparse(CH_URL)
    _ch_client = clickhouse_connect.get_client(
        host=u.hostname or "localhost",
        port=u.port or 8123,
        username=unquote(u.username or "default"),
        password=unquote(u.password or ""),
        database=(u.path or "/default").lstrip("/") or "default",
    )


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
