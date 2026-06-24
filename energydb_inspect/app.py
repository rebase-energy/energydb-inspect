"""FastAPI read-only inspector for energydb.

Serves the dashboard + the read-only API. The ``energydb-inspect`` console
entrypoint launches this with uvicorn; for development:

    uvicorn energydb_inspect.app:app --reload --port 8000
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db, queries

# Writability (and the remote-write guard) live in db, the single source of truth.
WRITABLE = db.WRITABLE


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.open_pools()
    try:
        yield
    finally:
        db.close_pools()


app = FastAPI(title="EnergyDB Inspector", version="0.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/state-version")
def state_version():
    return {**queries.get_state_version(), "writable": WRITABLE}


@app.get("/api/tree")
def tree():
    return queries.get_tree()


@app.get("/api/edges")
def edges():
    return {"edges": queries.get_edges()}


@app.get("/api/series/{series_id}/values")
def series_values(series_id: int, mode: str = "latest"):
    if mode not in ("latest", "overlapping"):
        raise HTTPException(
            status_code=400, detail="mode must be 'latest' or 'overlapping'"
        )
    return queries.get_series_values(series_id, mode)


@app.get("/api/raw/ch/{series_id}")
def raw_ch(series_id: int):
    return queries.get_raw_ch(series_id)


@app.get("/api/node")
def node_row(path: str):
    return queries.get_node_row(path)


@app.get("/api/edge")
def edge_row(from_path: str, to_path: str):
    return queries.get_edge_row(from_path, to_path)


@app.post("/api/reset")
def reset():
    if not WRITABLE:
        raise HTTPException(
            status_code=403,
            detail="read-only inspector: set INSPECT_WRITABLE=1 to enable reset",
        )
    return queries.reset_db()


# Serve the built dashboard (single-page app). Defaults to the bundled `_static`
# (populated at build/publish), so the installed tool serves the UI with no config;
# override with INSPECT_STATIC_DIR. Mounted LAST at "/", so /api/* always wins.
# In local dev `_static` is empty, so this is skipped and the Vite dev server (:5173)
# serves the UI instead.
_STATIC_DIR = os.environ.get("INSPECT_STATIC_DIR") or str(
    Path(__file__).parent / "_static"
)
if (Path(_STATIC_DIR) / "index.html").is_file():
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="dashboard")
