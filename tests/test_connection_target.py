"""db._target()/get_connection_status(): the display target is host+dbname
only -- user and password must never leak into it (it ends up in an API
response the browser can see)."""

from __future__ import annotations

from energydb_inspect import db


def test_target_strips_user_and_password():
    target = db._target("postgresql://user:secretpass@dbhost:5432/mydb")
    assert target == "dbhost/mydb"
    assert "secretpass" not in target
    assert "user" not in target


def test_target_handles_clickhouse_url():
    assert (
        db._target("http://default:devpassword@localhost:8123/default")
        == "localhost/default"
    )


def test_target_of_empty_dsn_is_none():
    assert db._target("") is None


def test_get_connection_status_single_tenant(monkeypatch):
    monkeypatch.setattr(db, "_pg_error", "RuntimeError: boom")
    monkeypatch.setattr(db, "_ch_error", None)
    monkeypatch.setattr(db, "_PG_TARGET", "host/db")
    monkeypatch.setattr(db, "_CH_TARGET", "chhost/chdb")

    assert db.get_connection_status() == {
        "pg_target": "host/db",
        "ch_target": "chhost/chdb",
        "pg_error": "RuntimeError: boom",
        "ch_error": None,
        "env_file": db.ENV_FILE,
    }
