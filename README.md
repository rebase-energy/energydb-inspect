# energydb-inspect

A local visual inspector for [energydb](https://github.com/rebase-energy/energydb): a read-only
dashboard over your Postgres + ClickHouse showing the asset tree, timeseries plots, a map of the
assets, and the raw rows plus the SQL "under the hood".

![The energydb-inspect dashboard: the asset tree, the timeseries plot for a selected series, the map of asset footprints, and the SQL under the hood](docs/readme.gif)

## Inspect your energydb

Point it at any energydb. It is strictly **read-only** by default, so it is safe against production:

```sh
uvx energydb-inspect --pg-dsn postgresql://… --ch-url http://…
# or: pip install energydb-inspect && energydb-inspect --pg-dsn … --ch-url …
```

The dashboard opens at http://localhost:8000.

You can also pass the connection via the environment or a `.env` in the working directory. Prefer
this for real credentials, so they don't show up in `ps`/shell history:

```sh
# .env
TIMEDB_PG_DSN=postgresql://…
TIMEDB_CH_URL=http://…
```

```sh
uvx energydb-inspect
```

## Try it on a throwaway database

Spin up energydb's local-db (in the [energydb repo](https://github.com/rebase-energy/energydb),
under `local-db/`):

```sh
docker compose up -d        # Postgres :5433 + ClickHouse :8123
```

Point the inspector at it. `INSPECT_WRITABLE=1` enables the Reset button against the throwaway DB:

```sh
# .env
TIMEDB_PG_DSN=postgresql://postgres:devpassword@localhost:5433/devdb
TIMEDB_CH_URL=http://default:devpassword@localhost:8123/default
INSPECT_WRITABLE=1
```

```sh
uvx energydb-inspect        # dashboard at http://localhost:8000 (empty until you add data)
```

To fill it with a demo portfolio, run the example notebook below and watch the dashboard update live.

`INSPECT_WRITABLE` only works against a local database; to enable it against a remote host, also set
`INSPECT_TRUSTED_DB=1`.

## The example notebook

The repo ships a guided [marimo](https://marimo.io) notebook,
`energydb_inspect/notebooks/demo.py`, that builds the demo portfolio step by step. It is run
**separately** with marimo (from a checkout):

```sh
uv run --extra notebook python -m marimo edit energydb_inspect/notebooks/demo.py
```

It opens at http://localhost:2718. Run the cells top to bottom against a writable database (the
local-db above) and watch the tree, map and plots fill in live in the dashboard.

## Develop from source

```sh
git clone https://github.com/rebase-energy/energydb-inspect && cd energydb-inspect
uv sync
```

Run the backend (read-only API; also serves the built dashboard if `web/dist` has been bundled into
`energydb_inspect/_static`) and the Vite dev server (hot reload) in two terminals:

```sh
INSPECT_WRITABLE=1 uv run python -m uvicorn energydb_inspect.app:app --reload --port 8000
cd web && npm install && npm run dev        # http://localhost:5173
```

On NixOS, `bun`/`node` may not be on PATH; use `nix shell nixpkgs#bun -c bun run dev`.

## Web demo (in-browser, no database)

A zero-backend build of the dashboard exists for hosting a public "what is energydb" demo. See
[docs/HOSTING.md](docs/HOSTING.md).
