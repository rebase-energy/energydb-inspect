"""Console entrypoint for ``energydb-inspect``.

Serves the read-only dashboard against the Postgres + ClickHouse you point it at:
``--pg-dsn`` / ``--ch-url``, or ``TIMEDB_PG_DSN`` / ``TIMEDB_CH_URL`` from a ``.env``
in the current directory or the environment (see ``.env.example``).

    energydb-inspect                              # dashboard :8000 (TIMEDB_* / .env)
    energydb-inspect --pg-dsn ... --ch-url ...    # pass the connection explicitly

Reads are always allowed; the Reset button needs ``INSPECT_WRITABLE=1`` (use it
only against throwaway/dev databases). The example notebook is a separate thing you
run with marimo; see the README.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="energydb-inspect", description="Visual inspector for energydb."
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="dashboard + API port (default 8000)"
    )
    parser.add_argument(
        "--pg-dsn", help="Postgres DSN (overrides TIMEDB_PG_DSN / .env)"
    )
    parser.add_argument(
        "--ch-url", help="ClickHouse URL (overrides TIMEDB_CH_URL / .env)"
    )
    args = parser.parse_args()

    # Only a .env in the cwd, no upward walk to a parent directory (db.py does
    # the same check again on import, once TIMEDB_PG_DSN/CH_URL are read there).
    _env = Path.cwd() / ".env"
    if _env.is_file():
        load_dotenv(_env)  # TIMEDB_PG_DSN / TIMEDB_CH_URL from a .env in the cwd
        logger.info("loading environment from %s", _env)
    else:
        logger.info("no .env in %s", Path.cwd())
    # Explicit args win over .env/env. Note: a DSN on the command line is visible in
    # ps/shell history, so prefer .env for real credentials.
    if args.pg_dsn:
        os.environ["TIMEDB_PG_DSN"] = args.pg_dsn
    if args.ch_url:
        os.environ["TIMEDB_CH_URL"] = args.ch_url
    if not os.environ.get("TIMEDB_PG_DSN") or not os.environ.get("TIMEDB_CH_URL"):
        print(
            "warning: TIMEDB_PG_DSN / TIMEDB_CH_URL are not set; the dashboard will be empty.\n"
            "  Create a .env (see .env.example) or start the energydb local-db.\n",
            file=sys.stderr,
        )

    print(f"  dashboard → http://localhost:{args.port}\n")
    import uvicorn

    uvicorn.run("energydb_inspect.app:app", host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
