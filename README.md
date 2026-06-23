# energydb-inspect

A visual inspector for [energydb](https://github.com/rebase-energy/energydb): a **marimo notebook**
drives energydb and a **read-only dashboard** mirrors the live state. The asset tree (Postgres) on the
left, the timeseries (ClickHouse) as plots, a map of the assets, and the raw backing rows plus the SQL
"under the hood".

## Quick start

You need a Postgres + ClickHouse for energydb to talk to. The easiest is energydb's **local-db**
(in the [energydb repo](https://github.com/rebase-energy/energydb), under `local-db/`):

```sh
docker compose up -d        # in energydb/local-db: Postgres :5433 + ClickHouse :8123
```

Point the inspector at it with a `.env` in your working directory, then run it:

```sh
# .env
TIMEDB_PG_DSN=postgresql://postgres:devpassword@localhost:5433/devdb
TIMEDB_CH_URL=http://default:devpassword@localhost:8123/default
INSPECT_WRITABLE=1          # throwaway DB: enables the Reset button
```

```sh
uvx energydb-inspect        # or: pip install energydb-inspect && energydb-inspect
```

Open the **dashboard** at http://localhost:8000 and the **notebook** at http://localhost:2718 side by
side, then run the notebook cells top-to-bottom and watch the tree fill in live.

## Inspect your own energydb (read-only)

Point it at any energydb. Without `INSPECT_WRITABLE` it is strictly read-only (no Reset, no writes), so
it is safe against production:

```sh
TIMEDB_PG_DSN=postgresql://USER:PASS@HOST:5432/DB \
TIMEDB_CH_URL=http://USER:PASS@HOST:8123/DB \
uvx energydb-inspect --no-notebook
```

## Run from source

```sh
git clone https://github.com/rebase-energy/energydb-inspect && cd energydb-inspect
uv sync                     # Python deps (uv fetches its own Python)
./run.fish                  # backend :8000 + marimo :2718 + Vite dashboard :5173
```

`run.fish` reads `.env` and starts all three. Individually:

```sh
env INSPECT_WRITABLE=1 uv run uvicorn energydb_inspect.app:app --reload --port 8000
uv run marimo edit energydb_inspect/notebooks/demo.py --port 2718
cd web && npm install && npm run dev        # or bun
```

**NixOS:** `uv` works as-is; `bun`/`node` usually aren't on PATH, so front the frontend with nix
(`run.fish` does this automatically): `cd web; nix shell nixpkgs#bun -c bash -c 'bun install && bun run dev'`.

## Static web demo (in-browser, no server)

A zero-backend build (in-memory mock + a guided Playground) for hosting a "what is energydb" demo:

```sh
cd web && npm ci && VITE_TARGET=wasm VITE_BASE="/your-base/" npm run build   # -> web/dist
```

## Layout

- `energydb_inspect/` is the Python package: `app.py` (read-only FastAPI), `db.py`, `queries.py`,
  `demo_data.py`, `cli.py` (the `energydb-inspect` entrypoint), `notebooks/demo.py`, and the bundled
  dashboard (`_static/`, built from `web/` at publish time).
- `web/` is the React + Vite dashboard (D3 tree, ECharts plots, Leaflet map).

Clicking a node or grid edge shows its Postgres metadata and a map of the assets; clicking a series
shows its values. Geometry is stored by energydb in `node.data` / `edge.data` as GeoJSON, so the
dashboard reads it straight from the API.
