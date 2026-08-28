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
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, queries

# Writability (and the remote-write guard) live in db, the single source of truth.
WRITABLE = db.WRITABLE


class SessionAuthMiddleware:
    """Pure ASGI middleware (deliberately NOT Starlette's ``BaseHTTPMiddleware``,
    which runs the downstream app in a separate task -- context propagation
    across that boundary is a well-known footgun). Running in-line in the
    current task means setting ``db._current`` here is guaranteed visible to
    the route handler that runs inside ``self.app(...)``.

    A no-op pass-through when ``db.SESSION_AWARE`` is false (the default --
    unmodified single-tenant behavior, e.g. the plain ``energydb-inspect`` CLI).
    When true (the playground deployment), every ``/api/*`` request MUST carry
    valid ``X-EDB-Session`` / ``X-EDB-Token`` headers -- missing or invalid is a
    401, never a silent fallback to some other session's or the global pool.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not db.SESSION_AWARE:
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if not path.startswith("/api/"):
            return await self.app(scope, receive, send)

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        session_id = headers.get("x-edb-session", "")
        token = headers.get("x-edb-token", "")
        if not session_id or not token:
            resp = JSONResponse(
                {"detail": "missing X-EDB-Session/X-EDB-Token headers"}, status_code=401
            )
            return await resp(scope, receive, send)

        try:
            creds = await db.resolve_session(session_id, token)
        except db.SessionAuthError:
            resp = JSONResponse({"detail": "invalid or expired session"}, status_code=401)
            return await resp(scope, receive, send)
        except Exception:
            resp = JSONResponse(
                {"detail": "credential resolution unavailable"}, status_code=502
            )
            return await resp(scope, receive, send)

        cv_token = db._current.set(creds)
        try:
            await self.app(scope, receive, send)
        finally:
            db._current.reset(cv_token)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.open_pools()
    try:
        yield
    finally:
        db.close_pools()


app = FastAPI(title="EnergyDB Inspector", version="0.0.0", lifespan=lifespan)

# INSPECT_CORS_ORIGINS: comma-separated allow-list, e.g. the deploy origin(s)
# plus localhost dev ports. Falls back to the original dev-only default (Vite's
# :5173) when unset, unchanged from before session-awareness existed.
_cors_origins_env = os.environ.get("INSPECT_CORS_ORIGINS", "").strip()
_CORS_ORIGINS = (
    [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
    if _cors_origins_env
    else ["http://localhost:5173", "http://127.0.0.1:5173"]
)
# Order matters: Starlette makes the LAST-added middleware the OUTERMOST one.
# SessionAuthMiddleware is added first (inner) so CORSMiddleware (outer) always
# gets first look at a request -- an OPTIONS preflight (which never carries the
# X-EDB-Session/X-EDB-Token headers being asked permission for) is answered by
# CORS before it would otherwise 401 against SessionAuthMiddleware.
app.add_middleware(SessionAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
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


# Serve the built dashboard (single-page app). Defaults to the bundled _static
# (populated at build/publish), so the installed tool serves the UI with no config;
# override with INSPECT_STATIC_DIR. Mounted LAST at "/", so /api/* always wins.
# In local dev _static is empty, so this is skipped and the Vite dev server (:5173)
# serves the UI instead.
_STATIC_DIR = os.environ.get("INSPECT_STATIC_DIR") or str(
    Path(__file__).parent / "_static"
)
if (Path(_STATIC_DIR) / "index.html").is_file():
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="dashboard")
