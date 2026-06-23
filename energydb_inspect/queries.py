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
        return db.pg_query(sql, params)
    except Exception:
        return None


def _safe_ch(sql: str, parameters: dict | None = None):
    try:
        return db.ch_query(sql, parameters)
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# state version, cheap fingerprint the dashboard polls to know when to refetch
# --------------------------------------------------------------------------- #
def get_state_version() -> dict[str, Any]:
    pg = _safe_pg(
        """
        SELECT
          (SELECT count(*) FROM energydb.node),
          (SELECT count(*) FROM energydb.edge),
          (SELECT count(*) FROM energydb.series),
          (SELECT coalesce(extract(epoch FROM max(updated_at)), 0)::bigint FROM energydb.node),
          (SELECT coalesce(extract(epoch FROM max(inserted_at)), 0)::bigint FROM energydb.series)
        """
    )
    n, e, s, nt, st = pg[1][0] if pg else (0, 0, 0, 0, 0)

    ch = _safe_ch(
        "SELECT count(), coalesce(toUnixTimestamp64Micro(max(change_time)), 0) FROM series_values"
    )
    cc, cm = ch[1][0] if ch else (0, 0)

    return {
        "version": f"{n}.{e}.{s}.{nt}.{st}.{cc}.{cm}",
        "counts": {"nodes": n, "edges": e, "series": s, "values": cc},
    }


# --------------------------------------------------------------------------- #
# asset tree (Postgres) + which series already hold values (ClickHouse)
# --------------------------------------------------------------------------- #
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
    nres = _safe_pg(
        "SELECT uuid, node_type, name, parent_uuid, path, data FROM energydb.node ORDER BY path"
    )
    if nres is None:
        return {"portfolios": []}

    sres = _safe_pg(
        "SELECT series_id, node_uuid, data_type, name, canonical_unit, timeseries_type, retention "
        "FROM energydb.series WHERE node_uuid IS NOT NULL ORDER BY series_id"
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


# --------------------------------------------------------------------------- #
# grid edges (Postgres)
# --------------------------------------------------------------------------- #
def get_edges() -> list[dict]:
    res = _safe_pg(
        "SELECT e.uuid, e.edge_type, e.name, e.from_node_uuid, e.to_node_uuid, e.data, "
        "nf.path AS from_path, nt.path AS to_path FROM energydb.edge e "
        "JOIN energydb.node nf ON nf.uuid = e.from_node_uuid "
        "JOIN energydb.node nt ON nt.uuid = e.to_node_uuid ORDER BY e.uuid"
    )
    if res is None:
        return []

    # Edge-owned series (energydb.series.edge_uuid), keyed by edge uuid.
    sres = _safe_pg(
        "SELECT series_id, edge_uuid, data_type, name, canonical_unit, timeseries_type, retention "
        "FROM energydb.series WHERE edge_uuid IS NOT NULL ORDER BY series_id"
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


# --------------------------------------------------------------------------- #
# series values (ClickHouse)
# --------------------------------------------------------------------------- #
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


# --------------------------------------------------------------------------- #
# raw rows, the literal backing tables, with the SQL used (for "show SQL")
# --------------------------------------------------------------------------- #
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
    sql = f"SELECT * FROM energydb.node WHERE path = '{path}'"
    res = _safe_pg("SELECT * FROM energydb.node WHERE path = %s", (path,))
    if res is None or not res[1]:
        return {"columns": [], "rows": [], "sql": sql}
    return {"columns": res[0], "rows": [list(res[1][0])], "sql": sql}


def get_edge_row(from_path: str, to_path: str) -> dict[str, Any]:
    """The full Postgres row for one edge, looked up by its endpoint tree paths
    (joining the node table), plus the SQL used."""
    sql = (
        "SELECT e.* FROM energydb.edge e\n"
        "  JOIN energydb.node nf ON nf.uuid = e.from_node_uuid\n"
        "  JOIN energydb.node nt ON nt.uuid = e.to_node_uuid\n"
        f"WHERE nf.path = '{from_path}' AND nt.path = '{to_path}'"
    )
    res = _safe_pg(
        "SELECT e.* FROM energydb.edge e "
        "JOIN energydb.node nf ON nf.uuid = e.from_node_uuid "
        "JOIN energydb.node nt ON nt.uuid = e.to_node_uuid "
        "WHERE nf.path = %s AND nt.path = %s",
        (from_path, to_path),
    )
    if res is None:
        return {"columns": [], "rows": [], "sql": sql}
    return {"columns": res[0], "rows": [list(r) for r in res[1]], "sql": sql}


# --------------------------------------------------------------------------- #
# reset, the only write path; full schema wipe + recreate (PG + CH)
# --------------------------------------------------------------------------- #
def reset_db() -> dict[str, Any]:
    import energydb as edb

    client = edb.Client()
    try:
        with contextlib.suppress(Exception):
            client.delete()  # nothing to drop on a fresh DB
        client.create()
    finally:
        with contextlib.suppress(Exception):
            client.close()
    return {"ok": True}
