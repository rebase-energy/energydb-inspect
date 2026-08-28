"""ENERGYDB_SCHEMA: read once at import (default "public", matching the
energydb library), validated as a plain SQL identifier since it is
interpolated into every query, and honored by every table reference.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from energydb_inspect import db, queries

_PACKAGE_DIR = Path(queries.__file__).parent


def _run(
    code: str, cwd: Path, env_overrides: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env.pop("ENERGYDB_SCHEMA", None)
    env.pop("TIMEDB_PG_DSN", None)
    env.pop("TIMEDB_CH_URL", None)
    if env_overrides:
        env.update(env_overrides)
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(cwd),
        check=False,
    )


def test_schema_defaults_to_public(tmp_path):
    result = _run("from energydb_inspect import db; print(db.SCHEMA)", tmp_path)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "public"


def test_schema_reads_energydb_schema_env(tmp_path):
    result = _run(
        "from energydb_inspect import db; print(db.SCHEMA)",
        tmp_path,
        {"ENERGYDB_SCHEMA": "energydb"},
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "energydb"


def test_invalid_schema_is_rejected(tmp_path):
    result = _run(
        "from energydb_inspect import db",
        tmp_path,
        {"ENERGYDB_SCHEMA": "bad; drop table node"},
    )
    assert result.returncode != 0
    assert "invalid ENERGYDB_SCHEMA" in result.stderr


def test_get_tree_queries_the_configured_schema(monkeypatch):
    monkeypatch.setattr(db, "SCHEMA", "myschema")
    seen: list[str] = []

    def fake_pg_query(sql, params=None):
        seen.append(sql)
        return ([], [])

    monkeypatch.setattr(db, "pg_query", fake_pg_query)
    monkeypatch.setattr(db, "ch_query", lambda *a, **k: ([], []))

    assert queries.get_tree() == {"portfolios": []}
    assert any("myschema.node" in sql for sql in seen)
    assert not any("energydb.node" in sql for sql in seen)


def test_get_edges_queries_the_configured_schema(monkeypatch):
    monkeypatch.setattr(db, "SCHEMA", "myschema")
    seen: list[str] = []

    def fake_pg_query(sql, params=None):
        seen.append(sql)
        return ([], [])

    monkeypatch.setattr(db, "pg_query", fake_pg_query)
    monkeypatch.setattr(db, "ch_query", lambda *a, **k: ([], []))

    assert queries.get_edges() == []
    assert any("myschema.edge" in sql and "myschema.node" in sql for sql in seen)


def test_get_node_row_queries_the_configured_schema(monkeypatch):
    monkeypatch.setattr(db, "SCHEMA", "myschema")
    seen: list[str] = []

    def fake_pg_query(sql, params=None):
        seen.append(sql)
        return ([], [])

    monkeypatch.setattr(db, "pg_query", fake_pg_query)

    result = queries.get_node_row("root/a")
    assert "myschema.node" in result["sql"]  # the display SQL
    assert any("myschema.node" in sql for sql in seen)  # the executed SQL


def test_get_edge_row_queries_the_configured_schema(monkeypatch):
    monkeypatch.setattr(db, "SCHEMA", "myschema")
    seen: list[str] = []

    def fake_pg_query(sql, params=None):
        seen.append(sql)
        return ([], [])

    monkeypatch.setattr(db, "pg_query", fake_pg_query)

    result = queries.get_edge_row("root/a", "root/b")
    assert "myschema.edge" in result["sql"]
    assert any("myschema.edge" in sql for sql in seen)


def test_no_hardcoded_energydb_schema_qualifier_in_queries():
    """Regression lock for the bug this PR fixes: every table reference must go
    through db.SCHEMA, never a literal "energydb." qualifier."""
    source = _PACKAGE_DIR.joinpath("queries.py").read_text()
    assert not re.search(r"\b(FROM|JOIN)\s+energydb\.", source, re.IGNORECASE)
