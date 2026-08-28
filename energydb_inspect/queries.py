"""Read-only query layer: assembles the asset tree, edges, series values and raw
rows from Postgres + ClickHouse. Every query tolerates a missing schema (returns
empty) so the dashboard works before the first ``register_tree`` / after a reset.
"""

from __future__ import annotations

import contextlib
import time
from typing import Any

from . import db


def _safe_pg(sql: str, params: tuple | None = None):
    try:
        result = db.pg_query(sql, params)
    except Exception as exc:  # noqa: BLE001
        db.record_pg_error(exc)
        return None
    db.clear_pg_error()
    return result


def _safe_ch(sql: str, parameters: dict | None = None):
    try:
        result = db.ch_query(sql, parameters)
    except Exception as exc:  # noqa: BLE001
        db.record_ch_error(exc)
        return None
    db.clear_ch_error()
    return result


def _schema_has_tables(schema: str) -> bool | None:
    """Cheap, schema-agnostic probe: does ``schema`` hold the energydb tables?

    Runs against ``information_schema`` directly (bypassing ``_safe_pg``) so it
    never clobbers the pg_error just recorded by the main state-version query --
    a wrong ``ENERGYDB_SCHEMA`` and a genuinely unreachable Postgres both fail
    that query the same way, and this is what tells them apart. Returns None
    when Postgres itself can't be reached (query failed too).
    """
    try:
        _, rows = db.pg_query(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = %s AND table_name = 'node')",
            (schema,),
        )
    except Exception:  # noqa: BLE001
        return None
    return bool(rows[0][0])


# ---------------------------------------------------------------------------
# state version, cheap fingerprint the dashboard polls to know when to refetch
# ---------------------------------------------------------------------------
def get_state_version() -> dict[str, Any]:
    schema = db.SCHEMA
    pg = _safe_pg(
        f"""
        SELECT
          (SELECT count(*) FROM {schema}.node),
          (SELECT count(*) FROM {schema}.edge),
          (SELECT count(*) FROM {schema}.series),
          (SELECT coalesce(extract(epoch FROM max(updated_at)), 0)::bigint FROM {schema}.node),
          (SELECT coalesce(extract(epoch FROM max(inserted_at)), 0)::bigint FROM {schema}.series)
        """
    )
    pg_ok = pg is not None
    n, e, s, nt, st = pg[1][0] if pg else (0, 0, 0, 0, 0)

    ch = _safe_ch(
        "SELECT count(), coalesce(toUnixTimestamp64Micro(max(change_time)), 0) FROM series_values"
    )
    ch_ok = ch is not None
    cc, cm = ch[1][0] if ch else (0, 0)

    # A snapshot taken now reflects the two probes above; schema_has_tables runs
    # its own pg_query below and must not be allowed to overwrite it.
    status = db.get_connection_status()

    # n > 0 already proves the schema + its tables exist; skip the extra query.
    schema_has_tables = True if (pg_ok and n > 0) else _schema_has_tables(schema)

    return {
        "version": f"{n}.{e}.{s}.{nt}.{st}.{cc}.{cm}",
        "counts": {"nodes": n, "edges": e, "series": s, "values": cc},
        "connection": {
            "pg_ok": pg_ok,
            "ch_ok": ch_ok,
            "pg_target": status["pg_target"],
            "ch_target": status["ch_target"],
            "schema": schema,
            "schema_has_tables": schema_has_tables,
            "pg_error": status["pg_error"],
            "ch_error": status["ch_error"],
            "env_file": status["env_file"],
        },
    }


# ---------------------------------------------------------------------------
# asset tree (Postgres) + which series already hold values (ClickHouse)
# ---------------------------------------------------------------------------
def _series_value_stats() -> dict[int, tuple[int, int]]:
    """Per-series ``{series_id: (count, max_change_micros)}`` from ClickHouse.

    The count flips a series from empty to populated (``has_data``); ``max_change_micros``
    (max ``change_time``) advances on every (re)write, so the dashboard can pulse
    the right series in the tree even when data is overwritten in place.
    """
    res = _safe_ch(
        "SELECT series_id, count(), toUnixTimestamp64Micro(max(change_time)) "
        "FROM series_values GROUP BY series_id"
    )
    return {int(r[0]): (int(r[1]), int(r[2])) for r in res[1]} if res else {}


def _series_dict(
    sid, data_type, sname, unit, ts_type, retention, stats
) -> dict[str, Any]:
    """Shape one ``energydb.series`` row for the API (node- and edge-owned alike)."""
    count, last_change = stats.get(int(sid), (0, 0))
    return {
        "series_id": int(sid),
        "data_type": data_type,
        "name": sname,
        "canonical_unit": unit,
        "timeseries_type": ts_type,
        "retention": retention,
        "has_data": count > 0,
        "last_change": last_change,
    }


def get_tree() -> dict[str, Any]:
    schema = db.SCHEMA
    nres = _safe_pg(
        f"SELECT uuid, node_type, name, parent_uuid, path, data FROM {schema}.node ORDER BY path"
    )
    if nres is None:
        return {"portfolios": []}

    sres = _safe_pg(
        "SELECT series_id, node_uuid, data_type, name, canonical_unit, timeseries_type, retention "
        f"FROM {schema}.series WHERE node_uuid IS NOT NULL ORDER BY series_id"
    )
    stats = _series_value_stats()

    nodes: dict[str, dict] = {}
    for uuid, node_type, name, parent, path, data in nres[1]:
        nodes[str(uuid)] = {
            "uuid": str(uuid),
            "node_type": node_type,
            "name": name,
            "parent_uuid": str(parent) if parent else None,
            "path": path,
            "data": data,
            "series": [],
            "children": [],
        }

    if sres is not None:
        for sid, nuuid, data_type, sname, unit, ts_type, retention in sres[1]:
            node = nodes.get(str(nuuid))
            if node is not None:
                node["series"].append(
                    _series_dict(sid, data_type, sname, unit, ts_type, retention, stats)
                )

    roots: list[dict] = []
    for node in nodes.values():
        parent = node["parent_uuid"]
        if parent and parent in nodes:
            nodes[parent]["children"].append(node)
        else:
            roots.append(node)
    return {"portfolios": roots}


# ---------------------------------------------------------------------------
# grid edges (Postgres)
# ---------------------------------------------------------------------------
def get_edges() -> list[dict]:
    schema = db.SCHEMA
    res = _safe_pg(
        "SELECT e.uuid, e.edge_type, e.name, e.from_node_uuid, e.to_node_uuid, e.data, "
        "nf.path AS from_path, nt.path AS to_path "
        f"FROM {schema}.edge e "
        f"JOIN {schema}.node nf ON nf.uuid = e.from_node_uuid "
        f"JOIN {schema}.node nt ON nt.uuid = e.to_node_uuid ORDER BY e.uuid"
    )
    if res is None:
        return []

    # Edge-owned series (<schema>.series.edge_uuid), keyed by edge uuid.
    sres = _safe_pg(
        "SELECT series_id, edge_uuid, data_type, name, canonical_unit, timeseries_type, retention "
        f"FROM {schema}.series WHERE edge_uuid IS NOT NULL ORDER BY series_id"
    )
    stats = _series_value_stats()
    series_by_edge: dict[str, list[dict]] = {}
    if sres is not None:
        for sid, euuid, data_type, sname, unit, ts_type, retention in sres[1]:
            series_by_edge.setdefault(str(euuid), []).append(
                _series_dict(sid, data_type, sname, unit, ts_type, retention, stats)
            )

    out = []
    for uuid, edge_type, name, fu, tu, data, from_path, to_path in res[1]:
        out.append(
            {
                "uuid": str(uuid),
                "edge_type": edge_type,
                "name": name,
                "from_uuid": str(fu),
                "to_uuid": str(tu),
                "from_path": from_path,
                "to_path": to_path,
                "data": data,
                "series": series_by_edge.get(str(uuid), []),
            }
        )
    return out


# ---------------------------------------------------------------------------
# series values (ClickHouse)
# ---------------------------------------------------------------------------
def _value_stats(cols: list[str], rows: list[list]) -> dict[str, Any]:
    if not rows:
        return {"count": 0}
    vt = [r[cols.index("valid_time")] for r in rows]
    vals = [r[cols.index("value")] for r in rows if r[cols.index("value")] is not None]
    return {
        "count": len(rows),
        "min_valid": min(vt),
        "max_valid": max(vt),
        "min_value": min(vals) if vals else None,
        "max_value": max(vals) if vals else None,
    }


def get_series_values(series_id: int, mode: str) -> dict[str, Any]:
    if mode == "overlapping":
        sql = (
            "SELECT valid_time, knowledge_time, value FROM series_values "
            "WHERE series_id = {sid:UInt64} "
            "ORDER BY valid_time, knowledge_time, change_time DESC "
            "LIMIT 1 BY valid_time, knowledge_time"
        )
    else:
        sql = (
            "SELECT valid_time, argMax(value, (knowledge_time, change_time)) AS value "
            "FROM series_values WHERE series_id = {sid:UInt64} "
            "GROUP BY valid_time ORDER BY valid_time"
        )
    t0 = time.perf_counter()
    res = _safe_ch(sql, {"sid": series_id})
    query_ms = round((time.perf_counter() - t0) * 1000, 1)
    if res is None:
        return {
            "mode": mode,
            "columns": [],
            "rows": [],
            "sql": sql,
            "stats": {"count": 0},
            "query_ms": query_ms,
        }
    cols, rows = res
    return {
        "mode": mode,
        "columns": cols,
        "rows": rows,
        "sql": sql,
        "stats": _value_stats(cols, rows),
        "query_ms": query_ms,
    }


# ---------------------------------------------------------------------------
# raw rows, the literal backing tables, with the SQL used (for "show SQL")
# ---------------------------------------------------------------------------
def get_raw_ch(series_id: int) -> dict[str, Any]:
    sql = (
        "SELECT series_id, valid_time, knowledge_time, change_time, value, "
        "toString(run_id) AS run_id, changed_by, annotation, retention "
        "FROM series_values WHERE series_id = {sid:UInt64} "
        "ORDER BY valid_time, knowledge_time, change_time LIMIT 2000"
    )
    res = _safe_ch(sql, {"sid": series_id})
    if res is None:
        return {"columns": [], "rows": [], "sql": sql}
    return {"columns": res[0], "rows": res[1], "sql": sql}


def get_node_row(path: str) -> dict[str, Any]:
    """The full Postgres row for one node, looked up by its tree path (the way
    you'd normally address a node), plus the SQL used."""
    schema = db.SCHEMA
    sql = f"SELECT * FROM {schema}.node WHERE path = '{path}'"
    res = _safe_pg(f"SELECT * FROM {schema}.node WHERE path = %s", (path,))
    if res is None or not res[1]:
        return {"columns": [], "rows": [], "sql": sql}
    return {"columns": res[0], "rows": [list(res[1][0])], "sql": sql}


def get_edge_row(from_path: str, to_path: str) -> dict[str, Any]:
    """The full Postgres row for one edge, looked up by its endpoint tree paths
    (joining the node table), plus the SQL used."""
    schema = db.SCHEMA
    sql = (
        f"SELECT e.* FROM {schema}.edge e\n"
        f"  JOIN {schema}.node nf ON nf.uuid = e.from_node_uuid\n"
        f"  JOIN {schema}.node nt ON nt.uuid = e.to_node_uuid\n"
        f"WHERE nf.path = '{from_path}' AND nt.path = '{to_path}'"
    )
    res = _safe_pg(
        f"SELECT e.* FROM {schema}.edge e "
        f"JOIN {schema}.node nf ON nf.uuid = e.from_node_uuid "
        f"JOIN {schema}.node nt ON nt.uuid = e.to_node_uuid "
        "WHERE nf.path = %s AND nt.path = %s",
        (from_path, to_path),
    )
    if res is None:
        return {"columns": [], "rows": [], "sql": sql}
    return {"columns": res[0], "rows": [list(r) for r in res[1]], "sql": sql}


# ---------------------------------------------------------------------------
# reset, the only write path; full schema wipe + recreate (PG + CH)
# ---------------------------------------------------------------------------
def reset_db() -> dict[str, Any]:
    import energydb as edb

    client = edb.Client()
    dropped, note = True, ""
    try:
        try:
            client.delete()
        except Exception as exc:  # noqa: BLE001
            # A fresh database has nothing to drop, which is fine. Anything else
            # means the wipe did not happen, and reporting ok would be a lie:
            # create() below is idempotent, so the caller would see success while
            # the old rows survive and the next register_tree fails on a unique
            # violation.
            dropped, note = False, f"{type(exc).__name__}: {exc}"
        client.create()
    finally:
        with contextlib.suppress(Exception):
            client.close()
    if not dropped:
        print(
            f"energydb-inspect: reset could not drop the existing schema: {note}",
            flush=True,
        )
    return {"ok": True, "dropped": dropped, "note": note}
