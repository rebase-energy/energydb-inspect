"""/api/state-version's `connection` payload: distinguishes a healthy backend
from pg down, ch down, and a reachable Postgres pointed at the wrong schema --
the visibility fix for a bug where all three used to render identically empty.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from energydb_inspect import db
from energydb_inspect.app import app

client = TestClient(app)


def _ch_ok(sql, parameters=None):
    return (["count()", "max"], [(10, 123456)])


def test_both_up(monkeypatch):
    def fake_pg_query(sql, params=None):
        if "information_schema.tables" in sql:
            return (["exists"], [(True,)])
        return (["n", "e", "s", "nt", "st"], [(3, 2, 5, 1690000000, 1690000000)])

    monkeypatch.setattr(db, "pg_query", fake_pg_query)
    monkeypatch.setattr(db, "ch_query", _ch_ok)

    resp = client.get("/api/state-version")
    assert resp.status_code == 200
    body = resp.json()
    assert body["counts"] == {"nodes": 3, "edges": 2, "series": 5, "values": 10}

    conn = body["connection"]
    assert conn["pg_ok"] is True
    assert conn["ch_ok"] is True
    assert conn["schema"] == db.SCHEMA
    assert conn["schema_has_tables"] is True
    assert conn["pg_error"] is None
    assert conn["ch_error"] is None
    assert conn["env_file"] == db.ENV_FILE


def test_pg_query_raising(monkeypatch):
    def fake_pg_query(sql, params=None):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(db, "pg_query", fake_pg_query)
    monkeypatch.setattr(db, "ch_query", _ch_ok)

    resp = client.get("/api/state-version")
    assert resp.status_code == 200
    body = resp.json()
    assert body["counts"] == {"nodes": 0, "edges": 0, "series": 0, "values": 10}

    conn = body["connection"]
    assert conn["pg_ok"] is False
    assert conn["ch_ok"] is True
    # A down Postgres also fails the schema probe -- "unknown", not "no tables".
    assert conn["schema_has_tables"] is None
    assert conn["pg_error"] == "RuntimeError: connection refused"
    assert conn["ch_error"] is None


def test_schema_without_tables(monkeypatch):
    def fake_pg_query(sql, params=None):
        if "information_schema.tables" in sql:
            return (["exists"], [(False,)])
        raise RuntimeError('relation "public.node" does not exist')

    monkeypatch.setattr(db, "pg_query", fake_pg_query)
    monkeypatch.setattr(db, "ch_query", _ch_ok)

    resp = client.get("/api/state-version")
    assert resp.status_code == 200
    conn = resp.json()["connection"]
    assert conn["pg_ok"] is False
    # Postgres is reachable, the target schema/table just isn't there.
    assert conn["schema_has_tables"] is False
    assert "relation" in conn["pg_error"]


def test_ch_query_raising(monkeypatch):
    def fake_pg_query(sql, params=None):
        if "information_schema.tables" in sql:
            return (["exists"], [(True,)])
        return (["n", "e", "s", "nt", "st"], [(1, 0, 0, 0, 0)])

    def fake_ch_query(sql, parameters=None):
        raise TimeoutError("ClickHouse did not respond")

    monkeypatch.setattr(db, "pg_query", fake_pg_query)
    monkeypatch.setattr(db, "ch_query", fake_ch_query)

    resp = client.get("/api/state-version")
    assert resp.status_code == 200
    conn = resp.json()["connection"]
    assert conn["pg_ok"] is True
    assert conn["ch_ok"] is False
    assert conn["ch_error"] == "TimeoutError: ClickHouse did not respond"
    assert conn["pg_error"] is None


def test_error_clears_on_next_success(monkeypatch):
    def failing(sql, params=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(db, "pg_query", failing)
    monkeypatch.setattr(db, "ch_query", _ch_ok)
    first = client.get("/api/state-version").json()
    assert first["connection"]["pg_error"] == "RuntimeError: boom"

    def fake_pg_query(sql, params=None):
        if "information_schema.tables" in sql:
            return (["exists"], [(True,)])
        return (["n", "e", "s", "nt", "st"], [(1, 0, 0, 0, 0)])

    monkeypatch.setattr(db, "pg_query", fake_pg_query)
    second = client.get("/api/state-version").json()
    assert second["connection"]["pg_error"] is None
